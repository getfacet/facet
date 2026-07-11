import {
  BoundedIssues,
  caughtErrorDetail,
  isForbiddenKey,
  printableKey,
  type IssueSink,
  nullMap,
} from "./issues.js";
import { isContainer, type FacetAction, type FacetNode, type NodeId } from "./nodes.js";
import { MAX_PATCH_OPS } from "./patch.js";
import { MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import { SLOT_MARKER_RE, validateComposition, type FacetComposition } from "./validate.js";

export type CompositionParams = Readonly<Record<string, unknown>>;

export interface ExpandAt {
  readonly parent: NodeId;
}

export interface UseCompositionResult {
  readonly root?: NodeId;
  readonly slots: Readonly<Record<string, NodeId>>;
  readonly ids: Readonly<Record<NodeId, NodeId>>;
}

export interface ExpandCompositionResult extends UseCompositionResult {
  readonly nodes: Readonly<Record<NodeId, FacetNode>>;
  readonly issues: readonly string[];
}

export interface ExpandCompositionOptions {
  readonly existingIds?: Iterable<NodeId>;
  readonly mintId?: () => string;
}

const MAX_EXISTING_IDS = 5000;
const MAX_MINT_ATTEMPTS = 4096;
const MAX_EXPANDED_NODES = MAX_PATCH_OPS - 1;

// Null-prototype so a marker named after an Object.prototype member (e.g.
// {{constructor}}) falls through to "" instead of resolving an inherited value.
const EMPTY_SLOTS: Readonly<Record<string, string>> = Object.freeze(
  Object.create(null),
) as Readonly<Record<string, string>>;

export function expandComposition(
  composition: unknown,
  params: unknown,
  at: ExpandAt,
  options: ExpandCompositionOptions = {},
): ExpandCompositionResult {
  const issues = new BoundedIssues();
  try {
    return expandCompositionInner(composition, params, at, options, issues);
  } catch (error) {
    issues.push(`composition expansion failed: ${caughtErrorDetail(error)}`);
    return noOp(issues);
  }
}

function expandCompositionInner(
  composition: unknown,
  params: unknown,
  at: ExpandAt,
  options: ExpandCompositionOptions,
  issues: BoundedIssues,
): ExpandCompositionResult {
  const parent = typeof at === "object" && at !== null ? at.parent : undefined;
  if (typeof parent !== "string" || parent.length === 0 || isForbiddenKey(parent)) {
    issues.push("composition expansion parent is missing or not a string");
    return noOp(issues);
  }

  const rawExistingIds = options.existingIds;
  const mintId = options.mintId;
  const existingIds = existingIdSet(rawExistingIds, issues);
  if (existingIds === undefined) return noOp(issues);
  if (rawExistingIds !== undefined && !existingIds.has(parent)) {
    issues.push(`composition expansion parent "${printableKey(parent)}" is not known`);
    return noOp(issues);
  }

  const initial = validateComposition(composition);
  pushIssues(issues, initial.issues);
  if (initial.composition === undefined) {
    return noOp(issues);
  }

  const initialComposition = reachableComposition(initial.composition, issues);
  const safeParams = paramMap(params, issues);
  const slotSources = collectSlotSources(initialComposition);
  const filled = fillComposition(initialComposition, safeParams, issues);
  const sanitized = validateComposition(filled);
  pushIssues(issues, sanitized.issues);
  if (sanitized.composition === undefined) {
    return noOp(issues);
  }

  const finalComposition = reachableComposition(sanitized.composition, issues);
  // A slot marker that survives fill (e.g. a marker-shaped slot default) would
  // ship a node the shared fold is guaranteed to drop — the tool would report a
  // success whose root/slots/ids name a node that never lands. Refuse instead.
  for (const node of Object.values(finalComposition.nodes)) {
    for (const value of [...nodeStringLeaves(node), ...nodeActionStrings(node)]) {
      const unfilled = SLOT_MARKER_RE.exec(value)?.[1];
      if (unfilled !== undefined) {
        issues.push(`composition slot "${unfilled}" was not filled; expansion refused`);
        return noOp(issues);
      }
    }
  }
  const oldIds = Object.keys(finalComposition.nodes);
  if (oldIds.length > MAX_EXPANDED_NODES) {
    issues.push(`composition expansion exceeds the ${MAX_EXPANDED_NODES}-node output cap; refused`);
    return noOp(issues);
  }
  const ids = mintIds(oldIds, existingIds, mintId, issues);
  if (ids === undefined) return noOp(issues);

  const nodes = remapNodes(finalComposition.nodes, ids);
  const root = ids[finalComposition.root];
  if (root === undefined) {
    issues.push("composition expansion root was not remapped");
    return noOp(issues);
  }

  return {
    root,
    nodes,
    slots: remapSlots(slotSources, ids, nodes),
    ids,
    issues: issues.list,
  };
}

function noOp(issues: BoundedIssues): ExpandCompositionResult {
  return { nodes: {}, slots: {}, ids: {}, issues: issues.list };
}

function pushIssues(issues: IssueSink, incoming: readonly string[]): void {
  for (const issue of incoming) issues.push(issue);
}

function existingIdSet(
  raw: Iterable<NodeId> | undefined,
  issues: IssueSink,
): Set<string> | undefined {
  const ids = new Set<string>();
  if (raw === undefined) return ids;
  let count = 0;
  try {
    for (const id of raw) {
      count += 1;
      if (count > MAX_EXISTING_IDS) {
        issues.push(
          `composition expansion existingIds exceeds the ${MAX_EXISTING_IDS}-entry cap; refused`,
        );
        return undefined;
      }
      if (typeof id !== "string" || id.length === 0 || isForbiddenKey(id)) {
        issues.push("composition expansion existingIds yielded a malformed id; refused");
        return undefined;
      }
      ids.add(id);
    }
  } catch (error) {
    issues.push(`composition expansion existingIds failed: ${caughtErrorDetail(error)}`);
    return undefined;
  }
  return ids;
}

function paramMap(params: unknown, issues: IssueSink): Readonly<Record<string, unknown>> {
  if (isParamRecord(params)) return params;
  issues.push("composition expansion params is not an object map; ignored");
  return {};
}

function isParamRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reachableComposition(composition: FacetComposition, issues: IssueSink): FacetComposition {
  const reachable = new Set<NodeId>();
  const visit = (id: NodeId): void => {
    if (reachable.has(id)) return;
    const node = composition.nodes[id];
    if (node === undefined) return;
    reachable.add(id);
    if (isContainer(node)) {
      for (const child of node.children) visit(child);
    }
  };
  visit(composition.root);

  const allIds = Object.keys(composition.nodes);
  const dropped = allIds.filter((id) => !reachable.has(id));
  if (dropped.length === 0) return composition;

  const nodes: Record<NodeId, FacetNode> = {};
  for (const id of allIds) {
    if (reachable.has(id)) {
      const node = composition.nodes[id];
      if (node !== undefined) nodes[id] = node;
    }
  }
  issues.push(
    `composition expansion dropped unreachable node(s): ${dropped
      .slice(0, 5)
      .map(printableKey)
      .join(", ")}`,
  );

  const next: {
    name: string;
    description?: string;
    metadata?: typeof composition.metadata;
    slots?: Readonly<Record<string, string>>;
    root: NodeId;
    nodes: Record<NodeId, FacetNode>;
  } = { name: composition.name, root: composition.root, nodes };
  if (composition.description !== undefined) next.description = composition.description;
  if (composition.metadata !== undefined) next.metadata = composition.metadata;
  if (composition.slots !== undefined) next.slots = composition.slots;
  return next;
}

function fillComposition(
  composition: FacetComposition,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
) {
  const nodes: Record<string, FacetNode> = {};
  for (const [id, node] of Object.entries(composition.nodes)) {
    const defaults = composition.slots ?? EMPTY_SLOTS;
    nodes[id] = fillNodeActions(fillNode(node, defaults, params, issues), defaults, params, issues);
  }
  const filled: {
    name: string;
    description?: string;
    metadata?: typeof composition.metadata;
    slots?: Readonly<Record<string, string>>;
    root: NodeId;
    nodes: Record<string, FacetNode>;
  } = { name: composition.name, root: composition.root, nodes };
  if (composition.description !== undefined) filled.description = composition.description;
  if (composition.metadata !== undefined) filled.metadata = composition.metadata;
  if (composition.slots !== undefined) filled.slots = composition.slots;
  return filled;
}

function fillNode(
  node: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  switch (node.type) {
    case "box":
      return node;
    case "text":
      return { ...node, value: fillString(node.value, defaults, params, issues) };
    case "media": {
      const next = { ...node, src: fillString(node.src, defaults, params, issues) };
      if (node.alt !== undefined) next.alt = fillString(node.alt, defaults, params, issues);
      if (node.poster !== undefined) {
        next.poster = fillString(node.poster, defaults, params, issues);
      }
      return next;
    }
    case "field": {
      const next = { ...node, name: fillString(node.name, defaults, params, issues) };
      if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
      if (node.placeholder !== undefined) {
        next.placeholder = fillString(node.placeholder, defaults, params, issues);
      }
      if (node.options !== undefined) {
        next.options = node.options.map((option) => fillString(option, defaults, params, issues));
      }
      return next;
    }
    case "button": {
      return { ...node, label: fillString(node.label, defaults, params, issues) };
    }
    case "section": {
      const next = { ...node };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      if (node.eyebrow !== undefined) {
        next.eyebrow = fillString(node.eyebrow, defaults, params, issues);
      }
      if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
      return next;
    }
    case "card": {
      const next = { ...node };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
      return next;
    }
    case "tabs": {
      return {
        ...node,
        items: node.items.map((item) => ({
          label: fillString(item.label, defaults, params, issues),
          to: fillString(item.to, defaults, params, issues),
        })),
      };
    }
    case "nav": {
      return {
        ...node,
        items: node.items.map((item) => ({
          label: fillString(item.label, defaults, params, issues),
          to: fillString(item.to, defaults, params, issues),
        })),
      };
    }
    case "table": {
      const next = {
        ...node,
        columns: node.columns.map((column) => ({
          ...column,
          label: fillString(column.label, defaults, params, issues),
        })),
        rows: node.rows.map((row) => {
          const next: Record<string, string | number | boolean> = {};
          for (const [key, value] of Object.entries(row)) {
            next[key] =
              typeof value === "string" ? fillString(value, defaults, params, issues) : value;
          }
          return next;
        }),
      };
      if (node.caption !== undefined) {
        next.caption = fillString(node.caption, defaults, params, issues);
      }
      return next;
    }
    case "chart": {
      const next = { ...node };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      if (node.labels !== undefined) {
        next.labels = node.labels.map((label) => fillString(label, defaults, params, issues));
      }
      next.series = node.series.map((series) => ({
        ...series,
        label: fillString(series.label, defaults, params, issues),
      }));
      return next;
    }
    case "metric":
    case "stat": {
      const next = {
        ...node,
        label: fillString(node.label, defaults, params, issues),
        value: fillString(node.value, defaults, params, issues),
      };
      if (node.delta !== undefined) next.delta = fillString(node.delta, defaults, params, issues);
      return next;
    }
    case "keyValue": {
      return {
        ...node,
        items: node.items.map((item) => {
          const next = {
            ...item,
            label: fillString(item.label, defaults, params, issues),
            value: fillString(item.value, defaults, params, issues),
          };
          if (item.key !== undefined) next.key = fillString(item.key, defaults, params, issues);
          return next;
        }),
      };
    }
    case "badge":
      return { ...node, label: fillString(node.label, defaults, params, issues) };
    case "progress": {
      const next = { ...node };
      if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
      return next;
    }
    case "alert": {
      const next = { ...node, body: fillString(node.body, defaults, params, issues) };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      return next;
    }
    case "list": {
      return {
        ...node,
        items: node.items.map((item) => {
          const next = { ...item, title: fillString(item.title, defaults, params, issues) };
          if (item.body !== undefined) next.body = fillString(item.body, defaults, params, issues);
          return next;
        }),
      };
    }
    case "divider": {
      const next = { ...node };
      if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
      return next;
    }
    case "form": {
      const next = { ...node };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
      if (node.submitLabel !== undefined) {
        next.submitLabel = fillString(node.submitLabel, defaults, params, issues);
      }
      return next;
    }
    case "search": {
      const next = { ...node, name: fillString(node.name, defaults, params, issues) };
      if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
      if (node.placeholder !== undefined) {
        next.placeholder = fillString(node.placeholder, defaults, params, issues);
      }
      if (node.value !== undefined) next.value = fillString(node.value, defaults, params, issues);
      if (node.submitLabel !== undefined) {
        next.submitLabel = fillString(node.submitLabel, defaults, params, issues);
      }
      return next;
    }
    case "filterBar": {
      return {
        ...node,
        filters: node.filters.map((filter) => ({
          ...filter,
          name: fillString(filter.name, defaults, params, issues),
          label: fillString(filter.label, defaults, params, issues),
          ...(filter.options === undefined
            ? {}
            : {
                options: filter.options.map((option) =>
                  fillString(option, defaults, params, issues),
                ),
              }),
          ...(typeof filter.value === "string"
            ? { value: fillString(filter.value, defaults, params, issues) }
            : {}),
        })),
      };
    }
    case "emptyState": {
      const next = { ...node };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
      if (node.actionLabel !== undefined) {
        next.actionLabel = fillString(node.actionLabel, defaults, params, issues);
      }
      return next;
    }
    case "loading": {
      const next = { ...node };
      if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
      return next;
    }
  }
}

function fillString(
  value: string,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): string {
  const match = SLOT_MARKER_RE.exec(value);
  const name = match?.[1];
  if (name === undefined) return value;

  if (Object.prototype.hasOwnProperty.call(params, name)) {
    const raw = params[name];
    if (typeof raw !== "string") {
      issues.push(`composition param "${name}" is not a string; using default`);
    } else if (SLOT_MARKER_RE.test(raw)) {
      // A model echoing the template literal back as the value is a missing
      // param, not a fill — fall through to the slot's declared default.
      issues.push(`composition param "${name}" echoed the slot marker; using default`);
    } else if (raw.length > MAX_FIELD_VALUE_CHARS) {
      issues.push(`composition param "${name}" truncated to ${MAX_FIELD_VALUE_CHARS} characters`);
      return raw.slice(0, MAX_FIELD_VALUE_CHARS);
    } else {
      return raw;
    }
  }
  return Object.prototype.hasOwnProperty.call(defaults, name) ? (defaults[name] ?? "") : "";
}

function collectSlotSources(composition: FacetComposition): ReadonlyMap<string, NodeId> {
  const sources = new Map<string, NodeId>();
  for (const [id, node] of Object.entries(composition.nodes)) {
    for (const value of [...nodeStringLeaves(node), ...nodeActionStrings(node)]) {
      const name = SLOT_MARKER_RE.exec(value)?.[1];
      if (name !== undefined && !sources.has(name)) sources.set(name, id);
    }
  }
  return sources;
}

const ACTION_KEYS = ["onPress", "onHold", "onSubmit", "onChange"] as const;

type ActionBearing = Partial<Record<(typeof ACTION_KEYS)[number], FacetAction>>;

function nodeActions(node: FacetNode): readonly FacetAction[] {
  const source = node as ActionBearing;
  const actions: FacetAction[] = [];
  for (const key of ACTION_KEYS) {
    const action = source[key];
    if (action !== undefined) actions.push(action);
  }
  return actions;
}

/**
 * Every string an action carries — fillable strings (navigate `to`, agent
 * `name`, string payload values) plus non-fillable node-id references
 * (toggle `target`, agent `collect`), so the unfilled-marker refusal gate
 * sees markers in ref fields too.
 */
function nodeActionStrings(node: FacetNode): readonly string[] {
  const out: string[] = [];
  for (const action of nodeActions(node)) {
    if (action.kind === "navigate") {
      out.push(action.to);
      continue;
    }
    if (action.kind === "toggle") {
      out.push(action.target);
      continue;
    }
    out.push(action.name);
    if (action.payload !== undefined) {
      for (const value of Object.values(action.payload)) {
        if (typeof value === "string") out.push(value);
      }
    }
    if (action.collect !== undefined) out.push(action.collect);
  }
  return out;
}

function fillAction(
  action: FacetAction,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetAction {
  if (action.kind === "navigate") {
    const to = fillString(action.to, defaults, params, issues);
    return to === action.to ? action : { ...action, to };
  }
  // toggle.target and agent.collect are node-id references consumed by
  // remapAction — never param-filled.
  if (action.kind === "toggle") return action;
  let next: FacetAction = action;
  const name = fillString(action.name, defaults, params, issues);
  if (name !== action.name) next = { ...next, name };
  if (action.payload !== undefined) {
    let changed = false;
    const payload: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(action.payload)) {
      if (typeof value === "string") {
        const filled = fillString(value, defaults, params, issues);
        payload[key] = filled;
        if (filled !== value) changed = true;
      } else {
        payload[key] = value;
      }
    }
    if (changed) next = { ...next, payload };
  }
  return next;
}

function fillNodeActions(
  node: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const source = node as ActionBearing;
  let next: FacetNode | undefined;
  for (const key of ACTION_KEYS) {
    const action = source[key];
    if (action === undefined) continue;
    const filled = fillAction(action, defaults, params, issues);
    if (filled === action) continue;
    next = next ?? { ...node };
    (next as ActionBearing)[key] = filled;
  }
  return next ?? node;
}

function nodeStringLeaves(node: FacetNode): readonly string[] {
  switch (node.type) {
    case "box":
      return [];
    case "text":
      return [node.value];
    case "media":
      return [node.src, node.alt, node.poster].filter(
        (value): value is string => value !== undefined,
      );
    case "field":
      return [node.name, node.label, node.placeholder, ...(node.options ?? [])].filter(
        (value): value is string => value !== undefined,
      );
    case "button":
      return [node.label];
    case "section":
      return [node.title, node.eyebrow, node.body].filter(
        (value): value is string => value !== undefined,
      );
    case "card":
      return [node.title, node.body].filter((value): value is string => value !== undefined);
    case "tabs":
    case "nav":
      return node.items.flatMap((item) => [item.label, item.to]);
    case "table":
      return [
        node.caption,
        ...node.columns.map((column) => column.label),
        ...node.rows.flatMap((row) =>
          Object.values(row).filter((value): value is string => typeof value === "string"),
        ),
      ].filter((value): value is string => value !== undefined);
    case "chart":
      return [
        node.title,
        ...(node.labels ?? []),
        ...node.series.map((series) => series.label),
      ].filter((value): value is string => value !== undefined);
    case "metric":
    case "stat":
      return [node.label, node.value, node.delta].filter(
        (value): value is string => value !== undefined,
      );
    case "keyValue":
      return node.items.flatMap((item) =>
        [item.key, item.label, item.value].filter((value): value is string => value !== undefined),
      );
    case "badge":
      return [node.label];
    case "progress":
      return [node.label].filter((value): value is string => value !== undefined);
    case "alert":
      return [node.title, node.body].filter((value): value is string => value !== undefined);
    case "list":
      return node.items.flatMap((item) =>
        [item.title, item.body].filter((value): value is string => value !== undefined),
      );
    case "divider":
      return [node.label].filter((value): value is string => value !== undefined);
    case "form":
      return [node.title, node.body, node.submitLabel].filter(
        (value): value is string => value !== undefined,
      );
    case "search":
      return [node.name, node.label, node.placeholder, node.value, node.submitLabel].filter(
        (value): value is string => value !== undefined,
      );
    case "filterBar":
      return node.filters.flatMap((filter) => [
        filter.name,
        filter.label,
        ...(filter.options ?? []),
        ...(typeof filter.value === "string" ? [filter.value] : []),
      ]);
    case "emptyState":
      return [node.title, node.body, node.actionLabel].filter(
        (value): value is string => value !== undefined,
      );
    case "loading":
      return [node.label].filter((value): value is string => value !== undefined);
  }
}

function mintIds(
  oldIds: readonly NodeId[],
  existingIds: ReadonlySet<NodeId>,
  mintId: (() => string) | undefined,
  issues: IssueSink,
): Record<NodeId, NodeId> | undefined {
  const used = new Set(existingIds);
  // Null-prototype: remapAction indexes this map with author-supplied action
  // targets, so a plain object would resolve Object.prototype members.
  const ids: Record<NodeId, NodeId> = nullMap();
  const mint = mintId ?? defaultMintId;
  let attempts = 0;
  for (const oldId of oldIds) {
    let fresh: string | undefined;
    while (attempts < MAX_MINT_ATTEMPTS) {
      attempts += 1;
      let candidate: unknown;
      try {
        candidate = mint();
      } catch (error) {
        issues.push(`composition expansion mintId failed: ${caughtErrorDetail(error)}`);
        return undefined;
      }
      if (
        typeof candidate === "string" &&
        candidate.length > 0 &&
        !isForbiddenKey(candidate) &&
        !used.has(candidate)
      ) {
        fresh = candidate;
        break;
      }
    }
    if (fresh === undefined) {
      issues.push(
        `composition expansion could not mint a fresh id for "${printableKey(oldId)}" within the ${MAX_MINT_ATTEMPTS}-attempt cap`,
      );
      return undefined;
    }
    ids[oldId] = fresh;
    used.add(fresh);
  }
  return ids;
}

function defaultMintId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `composition-${Math.random().toString(36).slice(2)}`;
}

function remapNodes(
  nodes: Readonly<Record<NodeId, FacetNode>>,
  ids: Readonly<Record<NodeId, NodeId>>,
): Record<NodeId, FacetNode> {
  const remapped: Record<NodeId, FacetNode> = {};
  for (const [oldId, node] of Object.entries(nodes)) {
    const id = ids[oldId];
    if (id === undefined) continue;
    remapped[id] = remapNode(node, id, ids);
  }
  return remapped;
}

interface MutablePressActions {
  onPress?: FacetAction;
  onHold?: FacetAction;
}

function remapPressActions(
  next: MutablePressActions,
  source: Readonly<MutablePressActions>,
  ids: Readonly<Record<NodeId, NodeId>>,
): void {
  const onPress = source.onPress === undefined ? undefined : remapAction(source.onPress, ids);
  if (onPress !== undefined) next.onPress = onPress;
  else delete next.onPress;
  const onHold = source.onHold === undefined ? undefined : remapAction(source.onHold, ids);
  if (onHold !== undefined) next.onHold = onHold;
  else delete next.onHold;
}

function remapNode(node: FacetNode, id: NodeId, ids: Readonly<Record<NodeId, NodeId>>): FacetNode {
  switch (node.type) {
    case "box": {
      const next: {
        id: NodeId;
        type: "box";
        style?: typeof node.style;
        onPress?: FacetAction;
        onHold?: FacetAction;
        hidden?: boolean;
        children: NodeId[];
      } = {
        ...node,
        id,
        children: node.children
          .map((child) => ids[child])
          .filter((child): child is string => child !== undefined),
      };
      remapPressActions(next, node, ids);
      return next;
    }
    case "text":
      return { ...node, id };
    case "media":
      return { ...node, id };
    case "field":
      return { ...node, id };
    case "button": {
      const next = { ...node, id };
      remapPressActions(next, node, ids);
      return next;
    }
    case "section":
      return {
        ...node,
        id,
        children: node.children
          .map((child) => ids[child])
          .filter((child): child is string => child !== undefined),
      };
    case "card": {
      const next = {
        ...node,
        id,
        children: node.children
          .map((child) => ids[child])
          .filter((child): child is string => child !== undefined),
      };
      remapPressActions(next, node, ids);
      return next;
    }
    case "form": {
      const next = {
        ...node,
        id,
        children: node.children
          .map((child) => ids[child])
          .filter((child): child is string => child !== undefined),
      };
      const onSubmit = node.onSubmit === undefined ? undefined : remapAction(node.onSubmit, ids);
      if (onSubmit !== undefined) next.onSubmit = onSubmit;
      else delete next.onSubmit;
      return next;
    }
    case "search": {
      const next = { ...node, id };
      const onSubmit = node.onSubmit === undefined ? undefined : remapAction(node.onSubmit, ids);
      if (onSubmit !== undefined) next.onSubmit = onSubmit;
      else delete next.onSubmit;
      return next;
    }
    case "filterBar": {
      const next = { ...node, id };
      const onChange = node.onChange === undefined ? undefined : remapAction(node.onChange, ids);
      if (onChange !== undefined) next.onChange = onChange;
      else delete next.onChange;
      return next;
    }
    case "emptyState": {
      const next = { ...node, id };
      const onPress = node.onPress === undefined ? undefined : remapAction(node.onPress, ids);
      if (onPress !== undefined) next.onPress = onPress;
      else delete next.onPress;
      return next;
    }
    default:
      return { ...node, id };
  }
}

function remapAction(
  action: FacetAction,
  ids: Readonly<Record<NodeId, NodeId>>,
): FacetAction | undefined {
  if (action.kind === "toggle") {
    // Own-property guard: an inherited lookup could splice a non-string in.
    const target = Object.prototype.hasOwnProperty.call(ids, action.target)
      ? ids[action.target]
      : undefined;
    return typeof target === "string" ? { ...action, target } : undefined;
  }
  if (action.kind === "navigate") return action;
  if (action.collect !== undefined) {
    const collect = Object.prototype.hasOwnProperty.call(ids, action.collect)
      ? ids[action.collect]
      : undefined;
    if (typeof collect === "string") return { ...action, collect };
    const { collect: droppedCollect, ...rest } = action;
    void droppedCollect;
    return rest;
  }
  return action;
}

function remapSlots(
  slotSources: ReadonlyMap<string, NodeId>,
  ids: Readonly<Record<NodeId, NodeId>>,
  nodes: Readonly<Record<NodeId, FacetNode>>,
): Record<string, NodeId> {
  const slots: Record<string, NodeId> = {};
  for (const [name, oldId] of slotSources) {
    const id = ids[oldId];
    if (id !== undefined && nodes[id] !== undefined) slots[name] = id;
  }
  return slots;
}
