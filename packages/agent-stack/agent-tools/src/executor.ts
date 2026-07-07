import {
  EMPTY_TREE,
  MAX_PATCH_OPS,
  MEDIA_KINDS,
  expandStamp,
  isSafeMediaSrc,
  isTreeShaped,
  isValidThemeName,
  validateTree,
  type FacetNode,
  type FacetStamp,
  type FacetTree,
  type JsonPatchOperation,
  type NodeId,
  type ServerMessage,
} from "@facet/core";
import { FACET_STAGE_TOOL_NAMES } from "./specs.js";
import { foldStageShadow, summarizeStageTree } from "./stage-shadow.js";
import type {
  FacetStageToolName,
  StageToolContext,
  StageToolErrorCode,
  StageToolErrorResult,
  StageToolOkResult,
  StageToolResult,
} from "./types.js";

const DEFAULT_INSPECT_STAGE_NODES = 40;
const MAX_INSPECT_STAGE_NODES = 200;
const DEFAULT_INSPECT_NODE_DEPTH = 2;
const MAX_INSPECT_NODE_DEPTH = 5;
const MAX_TEXT_PREVIEW_CHARS = 80;
const MAX_ID_LIST_PREVIEW = 20;
const FORBIDDEN_NODE_IDS = new Set(["__proto__", "prototype", "constructor"]);

const TOOL_NAMES = FACET_STAGE_TOOL_NAMES.join(", ");

/** Execute one provider-neutral Facet stage tool call against a local stage shadow. */
export function executeStageTool(call: unknown, context: StageToolContext): StageToolResult {
  const shadow = isTreeShaped(context.shadow) ? context.shadow : EMPTY_TREE;
  const parsed = parseToolCall(call);
  if ("error" in parsed) {
    return errorResult("invalid_input", parsed.error, shadow);
  }
  if (!isFacetStageToolName(parsed.name)) {
    return errorResult(
      "unknown_tool",
      `error: unknown tool "${parsed.name}". Available tools: ${TOOL_NAMES}`,
      shadow,
    );
  }

  const input = isRecord(parsed.input) ? parsed.input : {};
  switch (parsed.name) {
    case "render_page":
      return executeRenderPage(input, shadow);
    case "append_node":
      return executeAppendNode(input, shadow);
    case "use_stamp":
      return executeUseStamp(input, shadow, context.assets?.stamps ?? []);
    case "set_node":
      return executeSetNode(input, shadow);
    case "remove_node":
      return executeRemoveNode(input, shadow);
    case "say":
      return executeSay(input, shadow);
    case "set_theme":
      return executeSetTheme(input, shadow);
    case "inspect_stage":
      return executeInspectStage(input, shadow);
    case "inspect_node":
      return executeInspectNode(input, shadow);
  }
}

function executeRenderPage(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const { tree, issues } = validateTree(input["tree"]);
  if (!isRenderable(tree)) {
    const hint = issueHint(issues);
    return errorResult(
      "invalid_tree",
      `error: render_page needs a full tree { root, nodes } whose entry screen (or root) is a box with at least one child. ${
        hint.length > 0
          ? `Fix these and retry: ${hint}`
          : "Provide a non-empty root/entry box and retry."
      }`,
      shadow,
      issues,
    );
  }

  const note = issues.length > 0 ? ` note: dropped invalid node(s): ${issueHint(issues)}` : "";
  return okPatchResult(
    `ok: page replaced${note}`,
    shadow,
    [{ op: "replace", path: "", value: tree }],
    issues,
  );
}

function executeAppendNode(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const parentId = input["parentId"];
  if (typeof parentId !== "string" || parentId.length === 0) {
    return errorResult(
      "invalid_input",
      'error: append_node needs a non-empty string "parentId" (the box to append into)',
      shadow,
    );
  }

  const parent = shadow.nodes[parentId];
  if (parent === undefined) {
    return errorResult(
      "invalid_parent",
      `error: append_node — parent "${parentId}" does not exist yet. Create it first with render_page or set_node, or append into an existing node.`,
      shadow,
    );
  }
  if (parent.type !== "box") {
    return errorResult(
      "invalid_parent",
      `error: append_node — parent "${parentId}" is not a box`,
      shadow,
    );
  }

  const node = parseNodeInput(input["node"], "append_node", shadow);
  if ("error" in node) return errorResult("invalid_input", node.error, shadow);

  return okPatchResult(`ok: appended "${node.facetNode.id}" under "${parentId}"`, shadow, [
    { op: "add", path: nodePath(node.facetNode.id), value: node.facetNode },
    { op: "add", path: childrenPath(parentId), value: node.facetNode.id },
  ]);
}

function executeUseStamp(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  stamps: readonly FacetStamp[],
) {
  const name = input["name"];
  if (typeof name !== "string" || name.length === 0) {
    return errorResult(
      "invalid_input",
      'error: use_stamp needs a non-empty string "name" from the STAMPS list',
      shadow,
    );
  }

  const at = input["at"];
  if (!isRecord(at) || typeof at["parent"] !== "string" || at["parent"].length === 0) {
    return errorResult(
      "invalid_input",
      'error: use_stamp needs at={ "parent": "<box node id>" }',
      shadow,
    );
  }

  const parent = at["parent"];
  const parentNode = shadow.nodes[parent];
  if (parentNode === undefined) {
    return errorResult(
      "invalid_parent",
      `error: use_stamp — parent "${parent}" does not exist yet`,
      shadow,
    );
  }
  if (parentNode.type !== "box") {
    return errorResult(
      "invalid_parent",
      `error: use_stamp — parent "${parent}" is not a box`,
      shadow,
    );
  }

  const stamp = stamps.find((candidate) => candidate.name === name);
  if (stamp === undefined) {
    return errorResult(
      "invalid_stamp",
      `error: use_stamp — unknown stamp "${name}". Pick a name from STAMPS.`,
      shadow,
    );
  }

  const expanded = expandStamp(
    stamp,
    input["params"] ?? {},
    { parent },
    {
      existingIds: Object.keys(shadow.nodes),
    },
  );
  if (expanded.root === undefined) {
    const hint = issueHint(expanded.issues);
    return errorResult(
      "invalid_stamp",
      `error: use_stamp — could not expand "${name}"${hint.length > 0 ? `: ${hint}` : ""}`,
      shadow,
      expanded.issues,
    );
  }

  const expansionPatchOps = Object.keys(expanded.nodes).length + 1;
  if (expansionPatchOps > MAX_PATCH_OPS) {
    return errorResult(
      "patch_limit",
      `error: use_stamp — expanded "${name}" would exceed the patch op cap (${String(MAX_PATCH_OPS)}) for this streamed batch`,
      shadow,
      expanded.issues,
    );
  }

  const patches: JsonPatchOperation[] = Object.values(expanded.nodes).map((node) => ({
    op: "add",
    path: nodePath(node.id),
    value: node,
  }));
  patches.push({ op: "add", path: childrenPath(parent), value: expanded.root });

  const note = expanded.issues.length > 0 ? ` note: ${issueHint(expanded.issues)}` : "";
  const metadata = JSON.stringify({
    root: expanded.root,
    slots: expanded.slots,
    ids: expanded.ids,
  });
  return okPatchResult(
    `ok: used stamp "${name}"${note} ${metadata}`,
    shadow,
    patches,
    expanded.issues,
  );
}

function executeSetNode(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const node = parseNodeInput(input["node"], "set_node", shadow);
  if ("error" in node) return errorResult("invalid_input", node.error, shadow);
  if (node.facetNode.id === shadow.root) {
    return errorResult(
      "invalid_input",
      `error: set_node — cannot replace the stage root "${shadow.root}". Use render_page for root-level restructures.`,
      shadow,
    );
  }
  return okPatchResult(`ok: set "${node.facetNode.id}"`, shadow, [
    { op: "add", path: nodePath(node.facetNode.id), value: node.facetNode },
  ]);
}

function executeRemoveNode(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const nodeId = input["nodeId"];
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    return errorResult(
      "invalid_input",
      'error: remove_node needs a non-empty string "nodeId"',
      shadow,
    );
  }
  if (FORBIDDEN_NODE_IDS.has(nodeId)) {
    return errorResult(
      "invalid_input",
      `error: remove_node — node id "${nodeId}" is forbidden`,
      shadow,
    );
  }
  if (nodeId === shadow.root) {
    return errorResult(
      "invalid_input",
      `error: remove_node — cannot remove the stage root "${shadow.root}". Use render_page for root-level restructures.`,
      shadow,
    );
  }
  if (shadow.nodes[nodeId] === undefined) {
    return errorResult(
      "invalid_input",
      `error: remove_node — node "${nodeId}" does not exist`,
      shadow,
    );
  }
  return okPatchResult(`ok: removed "${nodeId}"`, shadow, [
    { op: "remove", path: nodePath(nodeId) },
  ]);
}

function executeSay(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const text = input["text"];
  if (typeof text !== "string" || text.length === 0) {
    return errorResult("invalid_input", 'error: say needs a non-empty string "text"', shadow);
  }
  return okMessageResult("ok: said", shadow, [{ kind: "say", text }]);
}

function executeSetTheme(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const name = input["name"];
  if (typeof name !== "string" || name.length === 0) {
    return errorResult(
      "invalid_input",
      'error: set_theme needs a non-empty string "name" (a theme from the THEMES list — a name only, never a CSS value)',
      shadow,
    );
  }
  if (!isValidThemeName(name)) {
    return errorResult(
      "invalid_input",
      `error: "${name}" is not a valid theme name (letters/digits/_/-, max 64) — pick a name from the THEMES list`,
      shadow,
    );
  }
  return okPatchResult(`ok: theme set to "${name}"`, shadow, [
    { op: "add", path: "/theme", value: name },
  ]);
}

function executeInspectStage(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
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
    `ok: stage root "${summary.root}"; ${String(summary.nodeCount)} nodes; ${String(
      summary.screenCount,
    )} screens; showing ${String(entries.length)}/${String(summary.nodeCount)} nodes${summary.theme === undefined ? "" : `; theme "${summary.theme}"`}\n${nodeLines}${suffix}`,
    shadow,
    [],
  );
}

function executeInspectNode(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const nodeId = input["nodeId"];
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    return errorResult(
      "invalid_input",
      'error: inspect_node needs a non-empty string "nodeId"',
      shadow,
    );
  }
  if (shadow.nodes[nodeId] === undefined) {
    return errorResult(
      "invalid_input",
      `error: inspect_node — node "${nodeId}" does not exist`,
      shadow,
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
    `ok: node "${nodeId}" depth ${String(depth)}; showing ${String(lines.length)} node(s)${truncated ? " (truncated)" : ""}\n${lines.join("\n")}`,
    shadow,
    [],
  );
}

function okPatchResult(
  observation: string,
  shadow: FacetTree,
  patches: readonly JsonPatchOperation[],
  issues: readonly string[] = [],
): StageToolResult {
  if (patches.length > MAX_PATCH_OPS) {
    return errorResult(
      "patch_limit",
      `error: patch batch would exceed the patch op cap (${String(MAX_PATCH_OPS)})`,
      shadow,
      issues,
    );
  }
  return okMessageResult(observation, shadow, [{ kind: "patch", patches }], issues);
}

function okMessageResult(
  observation: string,
  shadow: FacetTree,
  messages: readonly ServerMessage[],
  extraIssues: readonly string[] = [],
): StageToolOkResult {
  const folded = foldStageShadow(shadow, messages);
  const issues = [...extraIssues, ...folded.issues];
  return {
    status: "ok",
    observation: { status: "ok", text: observation },
    messages,
    patches: folded.patches,
    changedNodeIds: folded.changedNodeIds,
    patchCount: folded.patchCount,
    summary: folded.summary,
    shadow: folded.shadow,
    issues,
  };
}

function errorResult(
  code: StageToolErrorCode,
  observation: string,
  shadow: FacetTree,
  issues: readonly string[] = [],
): StageToolErrorResult {
  return {
    status: "error",
    code,
    observation: { status: "error", text: observation },
    messages: [],
    patches: [],
    changedNodeIds: [],
    patchCount: 0,
    summary: "no stage changes",
    shadow,
    issues,
  };
}

function parseToolCall(
  call: unknown,
): { readonly name: string; readonly input: unknown } | { readonly error: string } {
  if (!isRecord(call)) return { error: "error: tool call must be an object" };
  const name = call["name"];
  if (typeof name !== "string" || name.length === 0) {
    return { error: 'error: tool call needs a non-empty string "name"' };
  }
  return { name, input: call["input"] };
}

function parseNodeInput(
  value: unknown,
  toolName: "append_node" | "set_node",
  shadow: FacetTree,
): { readonly facetNode: FacetNode } | { readonly error: string } {
  const result = asNode(value);
  if ("error" in result) return { error: `error: ${toolName} — ${result.error}` };
  const missing = missingChildRefs(result.facetNode, shadow);
  if (missing.length > 0) {
    return {
      error: `error: ${toolName} — node "${result.facetNode.id}" references missing child node(s): ${summarizeIds(missing)}`,
    };
  }
  return result;
}

function asNode(value: unknown): { readonly facetNode: FacetNode } | { readonly error: string } {
  if (!isRecord(value)) return { error: 'the "node" argument must be an object' };
  if (typeof value["id"] !== "string" || value["id"].length === 0) {
    return { error: 'the node needs a non-empty string "id"' };
  }
  if (FORBIDDEN_NODE_IDS.has(value["id"])) {
    return { error: `node id "${value["id"]}" is forbidden` };
  }

  switch (value["type"]) {
    case "box":
      if (
        value["children"] !== undefined &&
        (!Array.isArray(value["children"]) ||
          !value["children"].every((child): child is string => typeof child === "string"))
      ) {
        return { error: 'a "box" node needs "children" as an array of string ids' };
      }
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "box",
          children: value["children"] ?? [],
        } as unknown as FacetNode,
      };
    case "text":
      if (typeof value["value"] !== "string") {
        return { error: 'a "text" node needs a string "value"' };
      }
      return { facetNode: value as unknown as FacetNode };
    case "media":
      if (typeof value["src"] !== "string") {
        return { error: 'a "media" node needs string "src"' };
      }
      if (!isSafeMediaSrc(value["src"])) {
        return { error: 'a "media" node needs a safe static "src"' };
      }
      if (
        value["kind"] !== undefined &&
        (typeof value["kind"] !== "string" ||
          !(MEDIA_KINDS as readonly string[]).includes(value["kind"]))
      ) {
        return { error: 'a "media" node kind must be "image" or "video"' };
      }
      return {
        facetNode: {
          ...value,
          kind: value["kind"] ?? "image",
        } as unknown as FacetNode,
      };
    case "field":
      if (typeof value["name"] !== "string") {
        return { error: 'a "field" node needs a string "name"' };
      }
      return { facetNode: value as unknown as FacetNode };
    default:
      return { error: '"type" must be one of "box" | "text" | "media" | "field"' };
  }
}

function missingChildRefs(facetNode: FacetNode, shadow: FacetTree): readonly NodeId[] {
  if (facetNode.type !== "box") return [];
  return facetNode.children.filter((id) => shadow.nodes[id] === undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFacetStageToolName(value: string): value is FacetStageToolName {
  return (FACET_STAGE_TOOL_NAMES as readonly string[]).includes(value);
}

function pointerEscape(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function nodePath(id: NodeId): string {
  return `/nodes/${pointerEscape(id)}`;
}

function childrenPath(parent: NodeId): string {
  return `${nodePath(parent)}/children/-`;
}

function isBoxWithChildren(tree: FacetTree, id: NodeId | undefined): boolean {
  if (id === undefined) return false;
  const node = tree.nodes[id];
  return node !== undefined && node.type === "box" && node.children.length > 0;
}

function renderRoot(tree: FacetTree): NodeId {
  const screens = tree.screens;
  if (screens !== undefined && Object.keys(screens).length > 0) {
    const entryRoot = typeof tree.entry === "string" ? screens[tree.entry] : undefined;
    if (entryRoot !== undefined && tree.nodes[entryRoot] !== undefined) return entryRoot;
    for (const id of Object.values(screens)) if (tree.nodes[id] !== undefined) return id;
  }
  return tree.root;
}

function isRenderable(tree: FacetTree): boolean {
  return isBoxWithChildren(tree, renderRoot(tree));
}

function issueHint(issues: readonly string[]): string {
  if (issues.length === 0) return "";
  const shown = issues.slice(0, 5).join("; ");
  return issues.length > 5 ? `${shown}; ...(+${String(issues.length - 5)} more)` : shown;
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
  if (node.type !== "box" || depth >= maxDepth) return false;
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
  }
}

function preview(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_TEXT_PREVIEW_CHARS
    ? `${collapsed.slice(0, MAX_TEXT_PREVIEW_CHARS)}...`
    : collapsed;
}

function summarizeIds(ids: readonly NodeId[]): string {
  const shown = ids.slice(0, MAX_ID_LIST_PREVIEW);
  const suffix = ids.length > shown.length ? `, +${String(ids.length - shown.length)} more` : "";
  return `${shown.join(", ")}${suffix}`;
}
