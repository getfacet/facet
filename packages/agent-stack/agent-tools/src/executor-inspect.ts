import { isContainer, type FacetTree, type NodeId } from "@facet/core";
import { describeNode } from "./executor-registry.js";
import { errorResult, okMessageResult } from "./executor-result.js";
import { summarizeStageTree } from "./stage-shadow.js";

const DEFAULT_INSPECT_STAGE_NODES = 40;
const MAX_INSPECT_STAGE_NODES = 200;
const DEFAULT_INSPECT_NODE_DEPTH = 2;
const MAX_INSPECT_NODE_DEPTH = 5;

export function executeInspectStage(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const maxNodes = boundedInteger(
    input["maxNodes"],
    DEFAULT_INSPECT_STAGE_NODES,
    1,
    MAX_INSPECT_STAGE_NODES,
  );
  const entries = Object.entries(shadow.nodes).slice(0, maxNodes);
  const summary = summarizeStageTree(shadow);
  const nodeLines = entries.map(([, node]) => `- ${describeNode(node, shadow.data)}`).join("\n");
  const hiddenCount = Math.max(0, summary.nodeCount - entries.length);
  const suffix = hiddenCount > 0 ? `\n... ${String(hiddenCount)} more node(s)` : "";
  return okMessageResult(
    "inspect_stage",
    `ok: stage root "${summary.root}"; ${String(summary.nodeCount)} nodes; ${String(
      summary.screenCount,
    )} screens; showing ${String(entries.length)}/${String(summary.nodeCount)} nodes${summary.theme === undefined ? "" : `; theme "${summary.theme}"`}\n${nodeLines}${suffix}`,
    shadow,
    [],
  );
}

export function executeInspectNode(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const nodeId = input["nodeId"];
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    return errorResult(
      "inspect_node",
      "invalid_input",
      'error: inspect_node needs a non-empty string "nodeId"',
      shadow,
      [],
      "Pass nodeId as a non-empty string. Use inspect_stage to find node ids.",
    );
  }
  if (!Object.hasOwn(shadow.nodes, nodeId)) {
    return errorResult(
      "inspect_node",
      "invalid_input",
      `error: inspect_node — node "${nodeId}" does not exist`,
      shadow,
      [],
      "Call inspect_stage to find an existing node id.",
    );
  }

  const depth = boundedInteger(
    input["depth"],
    DEFAULT_INSPECT_NODE_DEPTH,
    0,
    MAX_INSPECT_NODE_DEPTH,
  );
  const lines: string[] = [];
  const seen = new Set<NodeId>();
  const truncated = collectNodeLines(
    shadow,
    nodeId,
    0,
    depth,
    seen,
    lines,
    MAX_INSPECT_STAGE_NODES,
  );
  return okMessageResult(
    "inspect_node",
    `ok: node "${nodeId}" depth ${String(depth)}; showing ${String(lines.length)} node(s)${truncated ? " (truncated)" : ""}\n${lines.join("\n")}`,
    shadow,
    [],
  );
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value as number));
}

function collectNodeLines(
  tree: FacetTree,
  nodeId: NodeId,
  depth: number,
  maxDepth: number,
  seen: Set<NodeId>,
  lines: string[],
  maxLines: number,
): boolean {
  if (lines.length >= maxLines) return true;
  if (seen.has(nodeId)) {
    lines.push(`${"  ".repeat(depth)}- ${nodeId} already shown`);
    return lines.length >= maxLines;
  }
  const node = tree.nodes[nodeId];
  if (node === undefined) {
    lines.push(`${"  ".repeat(depth)}- ${nodeId} missing`);
    return lines.length >= maxLines;
  }
  seen.add(nodeId);
  lines.push(`${"  ".repeat(depth)}- ${describeNode(node, tree.data)}`);
  if (lines.length >= maxLines) return true;
  if (!isContainer(node) || depth >= maxDepth) return false;
  for (const childId of node.children) {
    if (collectNodeLines(tree, childId, depth + 1, maxDepth, seen, lines, maxLines)) {
      return true;
    }
  }
  return false;
}
