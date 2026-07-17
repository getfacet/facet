import {
  isContainer,
  MAX_DEPTH,
  MAX_FIELD_VALUE_CHARS,
  MAX_FIELDS_KEYS,
  sanitizeActionPayload,
  type AgentAction,
  type FacetTree,
  type FieldValue,
  type FieldValues,
  type NodeId,
} from "@facet/core";
import { EMPTY_ANCESTORS, RENDER_BUDGET, childIdsOf } from "./renderer-safe.js";

export type ClassifiedPress =
  | { readonly kind: "navigate"; readonly to: string }
  | { readonly kind: "toggle"; readonly target: NodeId }
  | { readonly kind: "agent"; readonly action: AgentAction; readonly collect?: NodeId };

/**
 * Snapshots the visitor-typed values of the MOUNTED field inputs inside the
 * `collectId` container's subtree (invariant #6: field text is browser view-state —
 * this read-only, press-time snapshot lives only in the emitted event; nothing
 * is ever written back into the tree).
 *
 * Enumeration is data-side (the tree names the fields, in walk order — first
 * name wins) and the read is DOM-side, scoped to `root` so two renderers on one
 * page can never cross-read. Only mounted inputs are readable: a field on a
 * non-current screen or hidden by toggle simply isn't in the DOM and is omitted.
 * Every failure mode (unknown/non-box target, zero fields, missing DOM input,
 * cyclic/too-deep subtree) degrades to omission / `{}` — never a throw (DC-002).
 */
export function collectFieldValues(
  tree: FacetTree,
  collectId: NodeId,
  root: ParentNode,
): FieldValues {
  const target = tree.nodes[collectId];
  if (target == null) {
    return {};
  }

  // Data-side pass: (name → node ids) for every field in the subtree, in walk
  // order — mirrors renderNode's own ancestor-set cycle guard + depth cap so a
  // cyclic raw-path tree terminates. Keeping ALL ids per name (not just the
  // first) lets the DOM pass pick a MOUNTED one, so a hidden/off-screen field
  // can't shadow a visible same-named field and drop its value.
  const idsByName = new Map<string, NodeId[]>();
  // Total-visit budget for THIS invocation: `ancestors` breaks cycles but a raw
  // shared-child DAG (no validateTree on the live path) has an exponential number
  // of paths, so cap total gather steps the way renderNode caps total renders.
  let gatherBudget = RENDER_BUDGET;
  let gatherRefsBudget = RENDER_BUDGET;
  const gather = (id: NodeId, ancestors: ReadonlySet<NodeId>, depth: number): void => {
    if (depth > MAX_DEPTH || ancestors.has(id) || --gatherBudget < 0) {
      return;
    }
    const node = tree.nodes[id];
    if (node == null) {
      return;
    }
    if (node.type === "input") {
      // Never harvest secrets: a password field's value is excluded from
      // collection outright, so it can't ride the action event into an agent
      // (and, for the reference brain, into a third-party LLM + history replay).
      if (node.input === "password") {
        return;
      }
      if (typeof node.name === "string") {
        // Cap the NAME the same way the value is capped below: field names come
        // from untrusted LLM output, and an over-cap key would make the server's
        // isFieldsRecord reject the whole submit (a silent no-op). Capping keeps
        // the two sides from drifting so an over-long name degrades gracefully.
        const name = node.name.slice(0, MAX_FIELD_VALUE_CHARS);
        const ids = idsByName.get(name);
        if (ids === undefined) idsByName.set(name, [id]);
        else ids.push(id);
      }
      return;
    }
    if (!isContainer(node)) {
      return; // non-field, non-box nodes contribute nothing (DC-003)
    }
    const childAncestors = new Set(ancestors).add(id);
    for (const childId of childIdsOf(node)) {
      if (--gatherRefsBudget < 0) {
        break;
      }
      gather(childId, childAncestors, depth + 1);
    }
  };
  gather(collectId, EMPTY_ANCESTORS, 0);

  // DOM-side pass: enumerate the stamped controls ONCE and match by attribute
  // comparison — no CSS.escape (jsdom exposes no window.CSS, and comparing
  // sidesteps escaping arbitrary node ids). Radio groups stamp several inputs
  // with ONE node id, so keep all matches in DOM order.
  const elementsByNodeId = new Map<string, Element[]>();
  for (const el of Array.from(root.querySelectorAll("[data-facet-field-id]"))) {
    const nodeId = el.getAttribute("data-facet-field-id");
    if (nodeId !== null) {
      const elements = elementsByNodeId.get(nodeId);
      if (elements === undefined) elementsByNodeId.set(nodeId, [el]);
      else elements.push(el);
    }
  }

  const readMountedValue = (elements: readonly Element[]): FieldValue | undefined => {
    const first = elements[0];
    if (first === undefined) {
      return undefined;
    }
    if (first instanceof HTMLSelectElement) {
      return first.value.slice(0, MAX_FIELD_VALUE_CHARS);
    }
    const inputs = elements.filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    if (inputs.length === 0) {
      return undefined;
    }
    if (inputs.some((input) => input.type === "radio")) {
      const checked = inputs.find((input) => input.type === "radio" && input.checked);
      return checked === undefined ? undefined : checked.value.slice(0, MAX_FIELD_VALUE_CHARS);
    }
    const input = inputs[0];
    if (input === undefined) {
      return undefined;
    }
    if (input.type === "checkbox") {
      return input.checked ? true : undefined;
    }
    return String(input.value).slice(0, MAX_FIELD_VALUE_CHARS);
  };

  const fields: Record<string, FieldValue> = {};
  for (const [name, ids] of idsByName) {
    // Bound the field COUNT with the same cap the server enforces, so the
    // renderer can't emit a fields object the server rejects wholesale (400).
    if (Object.keys(fields).length >= MAX_FIELDS_KEYS) break;
    // Pick the first MOUNTED control among same-named fields that has a defined
    // value (an earlier unchecked radio group must not shadow a checked later one).
    for (const id of ids) {
      const elements = elementsByNodeId.get(id);
      if (elements === undefined) continue;
      const value = readMountedValue(elements);
      if (value !== undefined) {
        fields[name] = value;
        break;
      }
    }
  }
  return fields;
}

/**
 * Classifies an untrusted `onPress` (the raw live-patch path bypasses
 * validateTree). Unclassifiable shapes return null — the box renders as a plain
 * NON-pressable box, never a broken button.
 */
export function classifyPress(onPress: unknown): ClassifiedPress | null {
  if (typeof onPress !== "object" || onPress === null) {
    return null;
  }
  const press = onPress as {
    readonly kind?: unknown;
    readonly to?: unknown;
    readonly target?: unknown;
    readonly name?: unknown;
    readonly payload?: unknown;
    readonly collect?: unknown;
  };
  if (press.kind === "navigate") {
    return typeof press.to === "string" ? { kind: "navigate", to: press.to } : null;
  }
  if (press.kind === "toggle") {
    return typeof press.target === "string" ? { kind: "toggle", target: press.target } : null;
  }
  if ((press.kind === undefined || press.kind === "agent") && typeof press.name === "string") {
    // Emit the canonical kind-stamped agent action (a bare {name} IS an agent action).
    // Reuse core's fail-safe filter: a plain (non-array) object keeps only its
    // primitive values; anything else yields undefined and no payload is emitted.
    const payload = sanitizeActionPayload(press.payload);
    const action: AgentAction =
      payload !== undefined
        ? { kind: "agent", name: press.name, payload }
        : { kind: "agent", name: press.name };
    // A string collect rides the classification (not the emitted action): it is
    // the renderer's instruction to snapshot fields at press time. Non-string
    // raw-path junk is dropped — the button still works, just without fields.
    if (typeof press.collect === "string") {
      return { kind: "agent", action, collect: press.collect };
    }
    return { kind: "agent", action };
  }
  return null;
}

/** Content-declared default visibility; only literal `true` hides (raw-path junk is visible). */
