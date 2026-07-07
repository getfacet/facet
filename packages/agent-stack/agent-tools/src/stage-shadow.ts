import { foldPatchIntoStage } from "@facet/core";
import type { FacetTree, JsonPatchOperation, NodeId, ServerMessage } from "@facet/core";

export interface StageTreeSummary {
  readonly root: NodeId;
  readonly nodeCount: number;
  readonly screenCount: number;
  readonly entry?: string;
  readonly theme?: string;
}

export interface StageShadowFoldResult {
  readonly shadow: FacetTree;
  readonly patches: readonly JsonPatchOperation[];
  readonly patchCount: number;
  readonly changedNodeIds: readonly NodeId[];
  readonly summary: string;
  readonly issues: readonly string[];
}

export interface StageChangeSummaryOptions {
  readonly patchCount?: number;
  readonly changedNodeIds?: readonly NodeId[];
  readonly issues?: readonly string[];
}

const MAX_CHANGED_IDS_IN_SUMMARY = 8;

export function summarizeStageTree(tree: FacetTree): StageTreeSummary {
  const summary: {
    root: NodeId;
    nodeCount: number;
    screenCount: number;
    entry?: string;
    theme?: string;
  } = {
    root: tree.root,
    nodeCount: Object.keys(tree.nodes).length,
    screenCount: tree.screens === undefined ? 0 : Object.keys(tree.screens).length,
  };
  if (tree.entry !== undefined) summary.entry = tree.entry;
  if (tree.theme !== undefined) summary.theme = tree.theme;
  return summary;
}

export function changedNodeIdsBetween(before: FacetTree, after: FacetTree): readonly NodeId[] {
  const ids = new Set<NodeId>([...Object.keys(before.nodes), ...Object.keys(after.nodes)]);
  return Array.from(ids)
    .filter((id) => stableJson(before.nodes[id]) !== stableJson(after.nodes[id]))
    .sort();
}

export function summarizeStageChange(
  before: FacetTree,
  after: FacetTree,
  options?: StageChangeSummaryOptions,
): string {
  const changedNodeIds = options?.changedNodeIds ?? changedNodeIdsBetween(before, after);
  const patchCount = options?.patchCount ?? 0;
  const issues = options?.issues ?? [];
  if (
    patchCount === 0 &&
    changedNodeIds.length === 0 &&
    !stageMetadataChanged(before, after) &&
    issues.length === 0
  ) {
    return "no stage changes";
  }

  const parts: string[] = [];
  parts.push(`${String(patchCount)} patch ${patchCount === 1 ? "op" : "ops"}`);
  if (changedNodeIds.length === 0) {
    parts.push("no node changes");
  } else {
    parts.push(
      `changed ${String(changedNodeIds.length)} ${changedNodeIds.length === 1 ? "node" : "nodes"}: ${summarizeNodeIds(changedNodeIds)}`,
    );
  }

  const metadata = metadataChanges(before, after);
  if (metadata.length > 0) parts.push(metadata.join(", "));
  if (issues.length > 0) parts.push(`${String(issues.length)} fold issue(s)`);
  return parts.join("; ");
}

export function foldStageShadow(
  shadow: FacetTree,
  messages: readonly ServerMessage[],
): StageShadowFoldResult {
  let current = shadow;
  const patches: JsonPatchOperation[] = [];
  const issues: string[] = [];

  for (const message of messages) {
    if (message.kind !== "patch") continue;
    patches.push(...message.patches);
    const result = foldPatchIntoStage(current, message.patches);
    current = result.tree;
    issues.push(...result.issues);
  }

  const changedNodeIds = changedNodeIdsBetween(shadow, current);
  return {
    shadow: current,
    patches,
    patchCount: patches.length,
    changedNodeIds,
    summary: summarizeStageChange(shadow, current, {
      patchCount: patches.length,
      changedNodeIds,
      issues,
    }),
    issues,
  };
}

function summarizeNodeIds(ids: readonly NodeId[]): string {
  const visible = ids.slice(0, MAX_CHANGED_IDS_IN_SUMMARY);
  const suffix =
    ids.length > visible.length ? `, +${String(ids.length - visible.length)} more` : "";
  return `${visible.join(", ")}${suffix}`;
}

function stageMetadataChanged(before: FacetTree, after: FacetTree): boolean {
  return metadataChanges(before, after).length > 0;
}

function metadataChanges(before: FacetTree, after: FacetTree): readonly string[] {
  const changes: string[] = [];
  if (before.root !== after.root) changes.push(`root ${before.root} -> ${after.root}`);
  if (stableJson(before.screens) !== stableJson(after.screens)) changes.push("screens changed");
  if (before.entry !== after.entry) changes.push("entry changed");
  if (before.theme !== after.theme) changes.push("theme changed");
  const beforeCount = Object.keys(before.nodes).length;
  const afterCount = Object.keys(after.nodes).length;
  if (beforeCount !== afterCount)
    changes.push(`node count ${String(beforeCount)} -> ${String(afterCount)}`);
  return changes;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
