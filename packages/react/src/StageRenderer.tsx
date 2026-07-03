import { useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  FIELD_INPUTS,
  isSafeImageSrc,
  isTreeShaped,
  MAX_DEPTH,
  MAX_FIELD_VALUE_CHARS,
  MAX_FIELDS_KEYS,
  sanitizeActionPayload,
  type AgentAction,
  type FacetAction,
  type FacetNode,
  type FacetTree,
  type NodeId,
} from "@facet/core";
import { boxStyle, fieldStyle, imageStyle, textStyle } from "./theme.js";

const EMPTY_ANCESTORS: ReadonlySet<NodeId> = new Set<NodeId>();

// Fail-safe (invariant #2): the live path applies raw RFC 6902 patches with no
// validateTree, so any node FIELD can hold arbitrary JSON (children: "oops",
// src: 42, style: null). Coerce shapes here instead of trusting the types.
function styleOf<T extends object>(style: T | undefined): T | undefined {
  return typeof style === "object" && style !== null ? style : undefined;
}

/** A tree is renderable only if it's tree-shaped (core floor) AND its root resolves. */
function isRenderableTree(tree: FacetTree): boolean {
  // != null: a patch can set the root node to JSON null, not just remove it.
  return isTreeShaped(tree) && tree.nodes[tree.root] != null;
}

/**
 * Resolves `name` to a screen's live root node id, or null. Defensive against
 * raw-path junk: `screens` may not be an object, its values may not be strings,
 * and a value may name a node that no longer exists.
 */
function liveScreenRoot(tree: FacetTree, name: unknown): NodeId | null {
  const screens: unknown = tree.screens;
  if (typeof screens !== "object" || screens === null || typeof name !== "string") {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(screens, name)) {
    return null;
  }
  const rootId: unknown = (screens as Record<string, unknown>)[name];
  return typeof rootId === "string" && tree.nodes[rootId] != null ? rootId : null;
}

/**
 * Total function from view-state to the node id to render (invariant #6):
 * current screen if live → entry if live → first live screen → plain `root`.
 */
function resolveScreenRoot(tree: FacetTree, currentScreen: string | null): NodeId {
  const current = liveScreenRoot(tree, currentScreen);
  if (current !== null) {
    return current;
  }
  const entry = liveScreenRoot(tree, tree.entry);
  if (entry !== null) {
    return entry;
  }
  const screens: unknown = tree.screens;
  if (typeof screens === "object" && screens !== null) {
    for (const name of Object.keys(screens)) {
      const first = liveScreenRoot(tree, name);
      if (first !== null) {
        return first;
      }
    }
  }
  return tree.root;
}

/** A press the renderer has classified from an UNTRUSTED `onPress` value. */
type ClassifiedPress =
  | { readonly kind: "navigate"; readonly to: string }
  | { readonly kind: "toggle"; readonly target: NodeId }
  | { readonly kind: "agent"; readonly action: AgentAction; readonly collect?: NodeId };

/**
 * Snapshots the visitor-typed values of the MOUNTED field inputs inside the
 * `collectId` box's subtree (invariant #6: field text is browser view-state —
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
function collectFieldValues(
  tree: FacetTree,
  collectId: NodeId,
  root: ParentNode,
): Readonly<Record<string, string>> {
  const target = tree.nodes[collectId];
  if (target == null || target.type !== "box") {
    return {};
  }

  // Data-side pass: (name → node ids) for every field in the subtree, in walk
  // order — mirrors RenderNode's own ancestor-set cycle guard + depth cap so a
  // cyclic raw-path tree terminates. Keeping ALL ids per name (not just the
  // first) lets the DOM pass pick a MOUNTED one, so a hidden/off-screen field
  // can't shadow a visible same-named field and drop its value.
  const idsByName = new Map<string, NodeId[]>();
  const gather = (id: NodeId, ancestors: ReadonlySet<NodeId>, depth: number): void => {
    if (depth > MAX_DEPTH || ancestors.has(id)) {
      return;
    }
    const node = tree.nodes[id];
    if (node == null) {
      return;
    }
    if (node.type === "field") {
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
    if (node.type !== "box") {
      return; // non-field, non-box nodes contribute nothing (DC-003)
    }
    const childIds: readonly NodeId[] = Array.isArray(node.children) ? node.children : [];
    const childAncestors = new Set(ancestors).add(id);
    for (const childId of childIds) {
      gather(childId, childAncestors, depth + 1);
    }
  };
  gather(collectId, EMPTY_ANCESTORS, 0);

  // DOM-side pass: enumerate the stamped inputs ONCE and match by attribute
  // comparison — no CSS.escape (jsdom exposes no window.CSS, and comparing
  // sidesteps escaping arbitrary node ids). If a node is mounted more than
  // once, the FIRST match in DOM order wins (deterministic).
  const inputByNodeId = new Map<string, Element>();
  for (const el of Array.from(root.querySelectorAll("input[data-facet-field-id]"))) {
    const nodeId = el.getAttribute("data-facet-field-id");
    if (nodeId !== null && !inputByNodeId.has(nodeId)) {
      inputByNodeId.set(nodeId, el);
    }
  }

  const fields: Record<string, string> = {};
  for (const [name, ids] of idsByName) {
    // Bound the field COUNT with the same cap the server enforces, so the
    // renderer can't emit a fields object the server rejects wholesale (400).
    if (Object.keys(fields).length >= MAX_FIELDS_KEYS) break;
    // Pick the first MOUNTED input among same-named fields (a hidden earlier
    // one must not shadow a visible later one).
    const mountedId = ids.find((id) => inputByNodeId.has(id));
    const input = mountedId === undefined ? undefined : inputByNodeId.get(mountedId);
    if (input !== undefined) {
      // The selector only matches <input> elements, whose .value is a string;
      // String() is belt-and-braces before the shared cap is applied.
      fields[name] = String((input as HTMLInputElement).value).slice(0, MAX_FIELD_VALUE_CHARS);
    }
  }
  return fields;
}

/**
 * Classifies an untrusted `onPress` (the raw live-patch path bypasses
 * validateTree). Unclassifiable shapes return null — the box renders as a plain
 * NON-pressable box, never a broken button.
 */
function classifyPress(onPress: unknown): ClassifiedPress | null {
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
function isHiddenByDefault(node: FacetNode): boolean {
  return (node as { readonly hidden?: unknown }).hidden === true;
}

export interface StageRendererProps {
  readonly tree: FacetTree;
  /**
   * Invoked when an interactive brick fires (a pressed box, a submitted field).
   * When the pressed action declares `collect`, `fields` carries the press-time
   * snapshot of the mounted field values in that box's subtree (possibly `{}`);
   * without `collect` it is `undefined` — narrower `(action) => void` handlers
   * remain assignable, so existing consumers compile unchanged.
   */
  readonly onAction?: (action: FacetAction, fields?: Readonly<Record<string, string>>) => void;
}

/**
 * Renders a stage tree into React elements from the four low-level bricks.
 *
 * This is the security boundary and the fail-safe boundary: only known brick
 * types are rendered, there is no node that carries raw HTML/JS, and any id that
 * can't be resolved (e.g. a removed node still referenced by a parent) is simply
 * skipped — so a partial or imperfect stage renders as "plain", never broken.
 *
 * It also owns the browser's VIEW-STATE (invariant #6): `currentScreen` and
 * `visibilityOverrides` live here as React state; navigate/toggle presses
 * mutate only this state and NEVER reach `onAction` (the only channel to any
 * transport). Content stays server-owned via the patch flow.
 */
export function StageRenderer({ tree, onAction }: StageRendererProps): ReactNode {
  const [currentScreen, setCurrentScreen] = useState<string | null>(null);
  const [visibilityOverrides, setVisibilityOverrides] = useState<Readonly<Record<NodeId, boolean>>>(
    {},
  );
  // Scope handle for collectFieldValues — reads stay inside THIS renderer
  // instance so two stages on one page never cross-read each other's inputs.
  const stageRootRef = useRef<HTMLDivElement>(null);

  // Fail-safe boundary (invariant #2): a malformed tree — e.g. `render 'null'` on
  // the unvalidated CLI path — renders as nothing, never a crash.
  if (!isRenderableTree(tree)) {
    return null;
  }

  const handlePress = (press: ClassifiedPress): void => {
    switch (press.kind) {
      case "navigate":
        // Only a live screen is navigable; unknown targets no-op (DC-004).
        if (liveScreenRoot(tree, press.to) !== null) {
          setCurrentScreen(press.to);
        }
        return;
      case "toggle": {
        const target = tree.nodes[press.target];
        if (target == null) {
          return; // unknown target no-ops (DC-004)
        }
        setVisibilityOverrides((prev) => {
          const effective = prev[press.target] ?? !isHiddenByDefault(target);
          return { ...prev, [press.target]: !effective };
        });
        return;
      }
      case "agent":
        if (press.collect === undefined) {
          onAction?.(press.action); // no collect ⇒ today's exact emission (fields undefined)
          return;
        }
        // Always a fields object when collect is declared — {} on any degrade,
        // including an unexpectedly null stage root (no document-wide fallback).
        onAction?.(
          press.action,
          stageRootRef.current === null
            ? {}
            : collectFieldValues(tree, press.collect, stageRootRef.current),
        );
    }
  };

  const stage = (
    <RenderNode
      tree={tree}
      id={resolveScreenRoot(tree, currentScreen)}
      onPress={handlePress}
      visibilityOverrides={visibilityOverrides}
      depth={0}
    />
  );
  if (onAction === undefined) {
    // No handler ⇒ no press can emit, so field collection is unreachable and
    // the scope wrapper is unnecessary — handler-less output stays byte-
    // identical to the pre-collect renderer (pinned by the static suite).
    return stage;
  }
  // display: contents adds no layout box, so flow layout is unchanged
  // (invariant #5); the div exists only to scope the press-time field read.
  return (
    <div style={{ display: "contents" }} ref={stageRootRef}>
      {stage}
    </div>
  );
}

interface RenderNodeProps {
  readonly tree: FacetTree;
  readonly id: NodeId;
  readonly onPress: (press: ClassifiedPress) => void;
  readonly visibilityOverrides: Readonly<Record<NodeId, boolean>>;
  /** Ids on the path from the root to here — used to break cycles fail-safe. */
  readonly ancestors?: ReadonlySet<NodeId> | undefined;
  readonly depth: number;
}

function RenderNode({
  tree,
  id,
  onPress,
  visibilityOverrides,
  ancestors,
  depth,
}: RenderNodeProps): ReactNode {
  const node = tree.nodes[id];
  // == null also skips a node a patch replaced with JSON null (not just missing ids).
  if (node == null || depth > MAX_DEPTH) {
    return null;
  }
  // Effective visibility = browser override ?? content default. A hidden node
  // is skipped (never thrown on), same as an unresolvable id.
  const visible = visibilityOverrides[id] ?? !isHiddenByDefault(node);
  if (!visible) {
    return null;
  }

  switch (node.type) {
    case "box": {
      // Fail-safe (invariant #2): skip a child that points back to an ancestor so
      // a cyclic tree (which never passes through validateTree on the live path)
      // can't infinitely recurse and crash the render.
      const seen = ancestors ?? EMPTY_ANCESTORS;
      const childAncestors = new Set(seen).add(id);
      const childIds: readonly NodeId[] = Array.isArray(node.children) ? node.children : [];
      // One linear pass skips ancestors (cycle break) and dedupes sibling ids
      // (raw path can repeat one; validateTree dedupes too) — first occurrence
      // wins so React keys stay unique.
      const emitted = new Set<NodeId>(seen);
      const uniqueChildIds = childIds.filter((childId) => {
        if (emitted.has(childId)) {
          return false;
        }
        emitted.add(childId);
        return true;
      });
      const children = uniqueChildIds.map((childId) => (
        <RenderNode
          key={childId}
          tree={tree}
          id={childId}
          onPress={onPress}
          visibilityOverrides={visibilityOverrides}
          ancestors={childAncestors}
          depth={depth + 1}
        />
      ));
      // onPress is untrusted on the raw path — an unclassifiable action renders
      // a plain non-pressable box instead of a dead or dangerous button.
      const press = classifyPress(node.onPress);
      if (press !== null) {
        return (
          <div
            role="button"
            tabIndex={0}
            style={{ ...boxStyle(styleOf(node.style)), cursor: "pointer" }}
            onClick={() => onPress(press)}
          >
            {children}
          </div>
        );
      }
      return <div style={boxStyle(styleOf(node.style))}>{children}</div>;
    }
    case "text":
      // A non-string value (an object would make React itself throw) is skipped.
      return typeof node.value === "string" ? (
        <p style={textStyle(styleOf(node.style))}>{node.value}</p>
      ) : null;
    case "image":
      // Fail-safe/security: never put an unsafe URL scheme (javascript:, …) in the DOM.
      return typeof node.src === "string" && isSafeImageSrc(node.src) ? (
        <img
          src={node.src}
          alt={typeof node.alt === "string" ? node.alt : ""}
          style={imageStyle(styleOf(node.style))}
        />
      ) : null;
    case "field": {
      // Raw-path junk: constrain `input` to the token set (else "text") and
      // omit non-string name/placeholder, mirroring core's field coercion.
      const input =
        typeof node.input === "string" && (FIELD_INPUTS as readonly string[]).includes(node.input)
          ? node.input
          : "text";
      const name = typeof node.name === "string" ? node.name : undefined;
      const placeholder = typeof node.placeholder === "string" ? node.placeholder : undefined;
      return (
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            ...fieldStyle(styleOf(node.style)),
          }}
        >
          {typeof node.label === "string" ? <span>{node.label}</span> : null}
          {/* Uncontrolled on purpose (invariant #6): the DOM owns the text; the
              stamp lets a collect press find this input by node id at press time. */}
          <input type={input} name={name} placeholder={placeholder} data-facet-field-id={id} />
        </label>
      );
    }
  }
}
