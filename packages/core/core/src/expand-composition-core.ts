import { caughtErrorDetail, isForbiddenKey, printableKey, type IssueSink } from "./issues.js";
import { isContainer, type FacetNode, type NodeId } from "./nodes.js";
import { MAX_PATCH_OPS } from "./patch.js";
import { SLOT_MARKER_RE, validateComposition, type FacetComposition } from "./validate.js";
import type { CompositionRef } from "./composition-validation.js";
import type { BoundedIssues } from "./issues.js";
import type {
  ExpandAt,
  ExpandCompositionOptions,
  ExpandCompositionResult,
} from "./expand-composition.js";
import {
  fillComposition,
  collectSlotSources,
  nodeActionStrings,
  nodeStringLeaves,
} from "./expand-composition-fill.js";
import { mintIds, remapNodes, remapSlots } from "./expand-composition-remap.js";

const MAX_EXISTING_IDS = 5000;
const MAX_EXPANDED_NODES = MAX_PATCH_OPS - 1;

/**
 * Expand-time backstop for `{ use }` reference nesting (LOCKED at 8). The
 * PRIMARY gate is the load-time `validateCompositionGraph` pass (WU-3); this cap
 * — with the per-path visited-set below — guarantees a hand-built or mis-loaded
 * registry can never recurse without bound, degrading to a dropped reference and
 * a bounded issue rather than a throw/hang (RISK-INV-2).
 */
export const MAX_COMPOSITION_NEST_DEPTH = 8;

const EMPTY_VISITED: ReadonlySet<string> = new Set<string>();

/** A composition-reference node has a `use` and no brick `type`. */
function isCompositionRef(node: FacetNode | CompositionRef): node is CompositionRef {
  return !("type" in node);
}

function findComposition(
  compositions: readonly FacetComposition[] | undefined,
  use: string,
): FacetComposition | undefined {
  if (compositions === undefined) return undefined;
  for (const composition of compositions) {
    if (composition.name === use) return composition;
  }
  return undefined;
}

export function expandCompositionInner(
  composition: unknown,
  params: unknown,
  at: ExpandAt,
  options: ExpandCompositionOptions,
  issues: BoundedIssues,
  // Internal recursion state for nested-reference resolution. Public
  // `expandComposition` always starts at depth 0 with an empty visited set;
  // `expandCompositionRef` threads incremented/extended copies down.
  depth = 0,
  visited: ReadonlySet<string> = EMPTY_VISITED,
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

  // Split the map: real bricks are minted here; `{ use }` references are resolved
  // recursively below so only primitive/native nodes ever reach the output
  // (RISK-INV-2). A reference contributes no local node of its own — its subtree
  // root takes over the reference id, and any container child pointing at a
  // dropped reference is filtered by `remapNodes` (its id is never minted).
  const realNodes: Record<NodeId, FacetNode> = {};
  const refs: Array<[NodeId, CompositionRef]> = [];
  for (const id of oldIds) {
    const node = finalComposition.nodes[id];
    if (node === undefined) continue;
    if (isCompositionRef(node)) refs.push([id, node]);
    else realNodes[id] = node;
  }

  const ids = mintIds(Object.keys(realNodes), existingIds, mintId, issues);
  if (ids === undefined) return noOp(issues);

  const nodes = resolveCompositionRefs(
    refs,
    realNodes,
    ids,
    existingIds,
    at,
    options,
    issues,
    depth,
    visited,
  );

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

/**
 * Resolve every `{ use, slots }` reference in `refs` to already-minted primitive
 * nodes and merge them with the parent's real bricks, mutating `ids` so each
 * reference id maps to its resolved subtree root (so a container child pointer
 * rewires to the child root, or is filtered when the reference is dropped).
 * Never throws: an over-depth, cyclic, or unresolvable reference is skipped with
 * a bounded issue.
 */
function resolveCompositionRefs(
  refs: readonly (readonly [NodeId, CompositionRef])[],
  realNodes: Readonly<Record<NodeId, FacetNode>>,
  ids: Record<NodeId, NodeId>,
  existingIds: ReadonlySet<NodeId>,
  at: ExpandAt,
  options: ExpandCompositionOptions,
  issues: BoundedIssues,
  depth: number,
  visited: ReadonlySet<string>,
): Record<NodeId, FacetNode> {
  // `used` tracks every id already claimed (existing + parent-minted + each
  // resolved child), so recursive expansions mint disjoint ids AND the child's
  // parent (an existing id) stays known through the recursion.
  const used = new Set<NodeId>([...existingIds, ...Object.values(ids)]);
  const childMaps: Array<Record<NodeId, FacetNode>> = [];
  for (const [refId, ref] of refs) {
    const child = expandCompositionRef(ref, at, used, options, issues, depth, visited);
    if (child === undefined || child.root === undefined) continue;
    // The child subtree root takes the reference's position; the parent
    // container's child pointer now remaps `refId` → the child root's minted id.
    ids[refId] = child.root;
    for (const cid of Object.keys(child.nodes)) used.add(cid);
    childMaps.push(child.nodes as Record<NodeId, FacetNode>);
  }
  const nodes = remapNodes(realNodes, ids);
  for (const map of childMaps) Object.assign(nodes, map);
  return nodes;
}

/**
 * Expand one reference: enforce the depth cap and per-path visited-set, look the
 * target up in the registry, then recursively expand it with the reference's
 * (already outer-filled) `slots` as params, threading the SAME registry down.
 * Returns the child's already-minted result, or `undefined` (dropped) on an
 * over-depth / cyclic / unresolved / failed reference — always with a bounded
 * issue, never a throw.
 */
function expandCompositionRef(
  ref: CompositionRef,
  at: ExpandAt,
  used: ReadonlySet<NodeId>,
  options: ExpandCompositionOptions,
  issues: BoundedIssues,
  depth: number,
  visited: ReadonlySet<string>,
): ExpandCompositionResult | undefined {
  const use = ref.use;
  const key = printableKey(use);
  if (depth + 1 > MAX_COMPOSITION_NEST_DEPTH) {
    issues.push(
      `composition reference "${key}" exceeds the ${MAX_COMPOSITION_NEST_DEPTH}-level nesting cap; dropped`,
    );
    return undefined;
  }
  if (visited.has(use)) {
    issues.push(`composition reference cycle at "${key}"; dropped`);
    return undefined;
  }
  const target = findComposition(options.compositions, use);
  if (target === undefined) {
    issues.push(`composition reference "${key}" is not in the registry; dropped`);
    return undefined;
  }
  // Build in one literal (the option props are readonly) and omit undefined
  // fields so `exactOptionalPropertyTypes` stays satisfied.
  const childOptions: ExpandCompositionOptions = {
    existingIds: used,
    ...(options.mintId !== undefined ? { mintId: options.mintId } : {}),
    ...(options.compositions !== undefined ? { compositions: options.compositions } : {}),
  };
  const nextVisited = new Set(visited);
  nextVisited.add(use);
  const child = expandCompositionInner(
    target,
    ref.slots ?? {},
    at,
    childOptions,
    issues,
    depth + 1,
    nextVisited,
  );
  return child.root === undefined ? undefined : child;
}

export function noOp(issues: BoundedIssues): ExpandCompositionResult {
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
    // A CompositionRef is a childless leaf (no `type`); only containers recurse.
    if (!isCompositionRef(node) && isContainer(node)) {
      for (const child of node.children) visit(child);
    }
  };
  visit(composition.root);

  const allIds = Object.keys(composition.nodes);
  const dropped = allIds.filter((id) => !reachable.has(id));
  if (dropped.length === 0) return composition;

  const nodes: Record<NodeId, FacetNode | CompositionRef> = {};
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
    nodes: Record<NodeId, FacetNode | CompositionRef>;
  } = { name: composition.name, root: composition.root, nodes };
  if (composition.description !== undefined) next.description = composition.description;
  if (composition.metadata !== undefined) next.metadata = composition.metadata;
  if (composition.slots !== undefined) next.slots = composition.slots;
  return next;
}
