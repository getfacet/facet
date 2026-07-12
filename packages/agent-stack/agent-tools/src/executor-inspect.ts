import { isContainer, type FacetNode, type FacetTree, type NodeId } from "@facet/core";
import { nodeVariant } from "./executor-policy.js";
import { errorResult, okMessageResult } from "./executor-result.js";
import { summarizeStageTree } from "./stage-shadow.js";

const DEFAULT_INSPECT_STAGE_NODES = 40;
const MAX_INSPECT_STAGE_NODES = 200;
const DEFAULT_INSPECT_NODE_DEPTH = 2;
const MAX_INSPECT_NODE_DEPTH = 5;
const MAX_TEXT_PREVIEW_CHARS = 80;

export function executeInspectStage(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const maxNodes = boundedInteger(
    input["maxNodes"],
    DEFAULT_INSPECT_STAGE_NODES,
    1,
    MAX_INSPECT_STAGE_NODES,
  );
  const entries = Object.entries(shadow.nodes).slice(0, maxNodes);
  const summary = summarizeStageTree(shadow);
  const nodeLines = entries.map(([, node]) => `- ${describeNode(node)}`).join("\n");
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
  lines.push(`${"  ".repeat(depth)}- ${describeNode(node)}`);
  if (lines.length >= maxLines) return true;
  if (!isContainer(node) || depth >= maxDepth) return false;
  for (const childId of node.children) {
    if (collectNodeLines(tree, childId, depth + 1, maxDepth, seen, lines, maxLines)) {
      return true;
    }
  }
  return false;
}

function describeNode(facetNode: FacetNode): string {
  switch (facetNode.type) {
    case "box":
      return `${facetNode.id} box children=${String(facetNode.children.length)}${facetNode.hidden === true ? " hidden" : ""}`;
    case "text":
      return `${facetNode.id} text value="${preview(facetNode.value)}"`;
    case "media":
      return `${facetNode.id} media kind=${facetNode.kind} src="${preview(facetNode.src)}"`;
    case "field":
      return `${facetNode.id} field name="${preview(facetNode.name)}"`;
    case "button":
      return `${facetNode.id} button label="${preview(facetNode.label)}"${variantSuffix(facetNode)}`;
    case "section":
      return `${facetNode.id} section children=${String(facetNode.children.length)}${facetNode.title === undefined ? "" : ` title="${preview(facetNode.title)}"`}${variantSuffix(facetNode)}`;
    case "card":
      return `${facetNode.id} card children=${String(facetNode.children.length)}${facetNode.title === undefined ? "" : ` title="${preview(facetNode.title)}"`}${variantSuffix(facetNode)}`;
    case "tabs":
      return `${facetNode.id} tabs items=${String(facetNode.items.length)}${variantSuffix(facetNode)}`;
    case "nav":
      return `${facetNode.id} nav items=${String(facetNode.items.length)}${variantSuffix(facetNode)}`;
    case "table":
      return `${facetNode.id} table columns=${String(facetNode.columns.length)} rows=${String(facetNode.rows.length)}${variantSuffix(facetNode)}`;
    case "chart":
      return `${facetNode.id} chart kind=${facetNode.kind} series=${String(facetNode.series.length)}${variantSuffix(facetNode)}`;
    case "metric":
      return `${facetNode.id} metric label="${preview(facetNode.label)}" value="${preview(facetNode.value)}"${variantSuffix(facetNode)}`;
    case "stat":
      return `${facetNode.id} stat label="${preview(facetNode.label)}" value="${preview(facetNode.value)}"${variantSuffix(facetNode)}`;
    case "keyValue":
      return `${facetNode.id} keyValue items=${String(facetNode.items.length)}${variantSuffix(facetNode)}`;
    case "badge":
      return `${facetNode.id} badge label="${preview(facetNode.label)}"${variantSuffix(facetNode)}`;
    case "progress":
      return `${facetNode.id} progress value=${String(facetNode.value)}${variantSuffix(facetNode)}`;
    case "alert":
      return `${facetNode.id} alert body="${preview(facetNode.body)}"${variantSuffix(facetNode)}`;
    case "list":
      return `${facetNode.id} list items=${String(facetNode.items.length)}${variantSuffix(facetNode)}`;
    case "divider":
      return `${facetNode.id} divider${facetNode.label === undefined ? "" : ` label="${preview(facetNode.label)}"`}${variantSuffix(facetNode)}`;
    case "form":
      return `${facetNode.id} form children=${String(facetNode.children.length)}${facetNode.title === undefined ? "" : ` title="${preview(facetNode.title)}"`}${variantSuffix(facetNode)}`;
    case "search":
      return `${facetNode.id} search name="${preview(facetNode.name)}"${variantSuffix(facetNode)}`;
    case "filterBar":
      return `${facetNode.id} filterBar filters=${String(facetNode.filters.length)}${variantSuffix(facetNode)}`;
    case "emptyState":
      return `${facetNode.id} emptyState${facetNode.title === undefined ? "" : ` title="${preview(facetNode.title)}"`}${variantSuffix(facetNode)}`;
    case "loading":
      return `${facetNode.id} loading${facetNode.label === undefined ? "" : ` label="${preview(facetNode.label)}"`}${variantSuffix(facetNode)}`;
  }
  const exhaustive: never = facetNode;
  return exhaustive;
}

function variantSuffix(node: FacetNode): string {
  const variant = nodeVariant(node);
  return variant === undefined ? "" : ` variant=${variant}`;
}

function preview(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_TEXT_PREVIEW_CHARS
    ? `${collapsed.slice(0, MAX_TEXT_PREVIEW_CHARS)}...`
    : collapsed;
}
