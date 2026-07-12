import { caughtErrorDetail, isForbiddenKey, printableKey, type IssueSink } from "./issues.js";
import { isContainer, type FacetNode, type NodeId } from "./nodes.js";
import { MAX_PATCH_OPS } from "./patch.js";
import { SLOT_MARKER_RE, validateComposition, type FacetComposition } from "./validate.js";
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

export function expandCompositionInner(
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
