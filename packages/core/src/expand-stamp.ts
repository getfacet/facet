import { isForbiddenKey } from "./issues.js";
import type { FacetAction, FacetNode, NodeId } from "./nodes.js";
import { MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import { validateStamp, type FacetStamp } from "./validate.js";

export type StampParams = Readonly<Record<string, unknown>>;

export interface ExpandAt {
  readonly parent: NodeId;
}

export interface UseStampResult {
  readonly root?: NodeId;
  readonly slots: Readonly<Record<string, NodeId>>;
  readonly ids: Readonly<Record<NodeId, NodeId>>;
}

export interface ExpandStampResult extends UseStampResult {
  readonly nodes: Readonly<Record<NodeId, FacetNode>>;
  readonly issues: readonly string[];
}

export interface ExpandStampOptions {
  readonly existingIds?: Iterable<NodeId>;
  readonly mintId?: () => string;
}

const SLOT_MARKER_RE = /^\{\{([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})\}\}$/;
const MAX_MINT_ATTEMPTS_PER_NODE = 1024;

export function expandStamp(
  stamp: unknown,
  params: StampParams,
  at: ExpandAt,
  options: ExpandStampOptions = {},
): ExpandStampResult {
  const issues: string[] = [];
  try {
    return expandStampInner(stamp, params, at, options, issues);
  } catch (error) {
    issues.push(
      `stamp expansion failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return noOp(issues);
  }
}

function expandStampInner(
  stamp: unknown,
  params: StampParams,
  at: ExpandAt,
  options: ExpandStampOptions,
  issues: string[],
): ExpandStampResult {
  if (typeof at !== "object" || at === null || typeof at.parent !== "string") {
    issues.push("stamp expansion parent is missing or not a string");
    return noOp(issues);
  }

  const existingIds = existingIdSet(options.existingIds, issues);
  if (options.existingIds !== undefined && !existingIds.has(at.parent)) {
    issues.push(`stamp expansion parent "${at.parent}" is not known`);
    return noOp(issues);
  }

  const initial = validateStamp(stamp);
  issues.push(...initial.issues);
  if (initial.stamp === undefined) {
    return noOp(issues);
  }

  const safeParams = paramMap(params, issues);
  const slotSources = collectSlotSources(initial.stamp);
  const filled = fillStamp(initial.stamp, safeParams, issues);
  const sanitized = validateStamp(filled);
  issues.push(...sanitized.issues);
  if (sanitized.stamp === undefined) {
    return noOp(issues);
  }

  const ids = mintIds(Object.keys(sanitized.stamp.nodes), existingIds, options.mintId, issues);
  if (ids === undefined) return noOp(issues);

  const nodes = remapNodes(sanitized.stamp.nodes, ids);
  const root = ids[sanitized.stamp.root];
  if (root === undefined) {
    issues.push("stamp expansion root was not remapped");
    return noOp(issues);
  }

  return {
    root,
    nodes,
    slots: remapSlots(slotSources, ids, nodes),
    ids,
    issues,
  };
}

function noOp(issues: readonly string[]): ExpandStampResult {
  return { nodes: {}, slots: {}, ids: {}, issues };
}

function existingIdSet(raw: Iterable<NodeId> | undefined, issues: string[]): Set<string> {
  const ids = new Set<string>();
  if (raw === undefined) return ids;
  try {
    for (const id of raw) {
      if (typeof id === "string") ids.add(id);
    }
  } catch {
    issues.push("stamp expansion existingIds is not iterable; ignored");
  }
  return ids;
}

function paramMap(params: StampParams, issues: string[]): Readonly<Record<string, unknown>> {
  if (typeof params === "object" && params !== null && !Array.isArray(params)) return params;
  issues.push("stamp expansion params is not an object map; ignored");
  return {};
}

function fillStamp(stamp: FacetStamp, params: Readonly<Record<string, unknown>>, issues: string[]) {
  const nodes: Record<string, FacetNode> = {};
  for (const [id, node] of Object.entries(stamp.nodes)) {
    nodes[id] = fillNode(node, stamp.slots ?? {}, params, issues);
  }
  const filled: {
    name: string;
    description?: string;
    slots?: Readonly<Record<string, string>>;
    root: NodeId;
    nodes: Record<string, FacetNode>;
  } = { name: stamp.name, root: stamp.root, nodes };
  if (stamp.description !== undefined) filled.description = stamp.description;
  if (stamp.slots !== undefined) filled.slots = stamp.slots;
  return filled;
}

function fillNode(
  node: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: string[],
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
  }
}

function fillString(
  value: string,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: string[],
): string {
  const match = SLOT_MARKER_RE.exec(value);
  const name = match?.[1];
  if (name === undefined) return value;

  if (Object.prototype.hasOwnProperty.call(params, name)) {
    const raw = params[name];
    if (typeof raw !== "string") {
      issues.push(`stamp param "${name}" is not a string; using default`);
    } else if (raw.length > MAX_FIELD_VALUE_CHARS) {
      issues.push(`stamp param "${name}" truncated to ${MAX_FIELD_VALUE_CHARS} characters`);
      return raw.slice(0, MAX_FIELD_VALUE_CHARS);
    } else {
      return raw;
    }
  }
  return defaults[name] ?? "";
}

function collectSlotSources(stamp: FacetStamp): ReadonlyMap<string, NodeId> {
  const sources = new Map<string, NodeId>();
  for (const [id, node] of Object.entries(stamp.nodes)) {
    for (const value of nodeStringLeaves(node)) {
      const name = SLOT_MARKER_RE.exec(value)?.[1];
      if (name !== undefined && !sources.has(name)) sources.set(name, id);
    }
  }
  return sources;
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
  }
}

function mintIds(
  oldIds: readonly NodeId[],
  existingIds: ReadonlySet<NodeId>,
  mintId: (() => string) | undefined,
  issues: string[],
): Record<NodeId, NodeId> | undefined {
  const used = new Set(existingIds);
  const ids: Record<NodeId, NodeId> = {};
  for (const oldId of oldIds) {
    let fresh: string | undefined;
    for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS_PER_NODE; attempt += 1) {
      const candidate = tryMint(mintId, issues);
      if (candidate !== undefined && !used.has(candidate)) {
        fresh = candidate;
        break;
      }
    }
    if (fresh === undefined) {
      issues.push(`stamp expansion could not mint a fresh id for "${oldId}"`);
      return undefined;
    }
    ids[oldId] = fresh;
    used.add(fresh);
  }
  return ids;
}

function tryMint(mintId: (() => string) | undefined, issues: string[]): string | undefined {
  try {
    const id = (mintId ?? defaultMintId)();
    return typeof id === "string" && id.length > 0 && !isForbiddenKey(id) ? id : undefined;
  } catch (error) {
    issues.push(
      `stamp expansion mintId failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return undefined;
  }
}

function defaultMintId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `stamp-${Math.random().toString(36).slice(2)}`;
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
      if (node.onPress !== undefined) next.onPress = remapAction(node.onPress, ids);
      if (node.onHold !== undefined) next.onHold = remapAction(node.onHold, ids);
      return next;
    }
    case "text":
      return { ...node, id };
    case "media":
      return { ...node, id };
    case "field":
      return { ...node, id };
  }
}

function remapAction(action: FacetAction, ids: Readonly<Record<NodeId, NodeId>>): FacetAction {
  if (action.kind === "toggle") {
    const target = ids[action.target];
    return target !== undefined ? { ...action, target } : action;
  }
  if (action.kind === "navigate") return action;
  if (action.collect !== undefined) {
    const collect = ids[action.collect];
    if (collect !== undefined) return { ...action, collect };
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
