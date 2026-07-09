import {
  COMPONENT_NODE_TYPES,
  EMPTY_TREE,
  MAX_PATCH_OPS,
  MEDIA_KINDS,
  PRIMITIVE_BRICK_TYPES,
  expandStamp,
  isContainer,
  isSafeMediaSrc,
  isTreeShaped,
  isValidThemeName,
  treeHasContent,
  validateTree,
  type FacetCatalog,
  type FacetNode,
  type FacetStamp,
  type FacetTree,
  type JsonPatchOperation,
  type NodeId,
  type ServerMessage,
} from "@facet/core";
import { FACET_STAGE_TOOL_NAMES } from "./specs.js";
import { foldStageShadow, summarizeStageTree } from "./stage-shadow.js";
import { formatAgentToolObservation, isVisitorVisibleStageChange } from "./observation.js";
import type {
  AgentToolOutcome,
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
const PRIMITIVE_NODE_TYPES = new Set<FacetNode["type"]>(PRIMITIVE_BRICK_TYPES);
const FACET_NODE_TYPES_TEXT = [...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES]
  .map((type) => `"${type}"`)
  .join(", ");
const CHART_KINDS = new Set(["bar", "line", "donut"]);

const TOOL_NAMES = FACET_STAGE_TOOL_NAMES.join(", ");

/** Execute one provider-neutral Facet stage tool call against a local stage shadow. */
export function executeStageTool(call: unknown, context: StageToolContext): StageToolResult {
  const shadow = isTreeShaped(context.shadow) ? context.shadow : EMPTY_TREE;
  const parsed = parseToolCall(call);
  if ("error" in parsed) {
    return errorResult(
      "unknown",
      "invalid_input",
      parsed.error,
      shadow,
      [],
      "Call one Facet stage tool with an object containing a non-empty tool name.",
    );
  }
  if (!isFacetStageToolName(parsed.name)) {
    return errorResult(
      parsed.name,
      "unknown_tool",
      `error: unknown tool "${parsed.name}". Available tools: ${TOOL_NAMES}`,
      shadow,
      [],
      `Call one of these tools instead: ${TOOL_NAMES}.`,
    );
  }

  const input = isRecord(parsed.input) ? parsed.input : {};
  const catalog = context.assets?.catalog;
  switch (parsed.name) {
    case "render_page":
      return executeRenderPage(input, shadow, catalog);
    case "append_node":
      return executeAppendNode(input, shadow, catalog);
    case "use_stamp":
      return executeUseStamp(input, shadow, context.assets?.stamps ?? [], catalog);
    case "set_node":
      return executeSetNode(input, shadow, catalog);
    case "remove_node":
      return executeRemoveNode(input, shadow);
    case "say":
      return executeSay(input, shadow);
    case "set_theme":
      return executeSetTheme(input, shadow, catalog);
    case "inspect_stage":
      return executeInspectStage(input, shadow);
    case "inspect_node":
      return executeInspectNode(input, shadow);
  }
}

function executeRenderPage(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  catalog: FacetCatalog | undefined,
) {
  const validated = validateTree(input["tree"]);
  const issues = validated.issues;
  const tree = preserveCatalogTheme(validated.tree, catalog, shadow);
  if (!isRenderable(tree)) {
    const hint = issueHint(issues);
    return errorResult(
      "render_page",
      "invalid_tree",
      `error: render_page needs a full tree { root, nodes } whose entry screen (or root) has renderable content. ${
        hint.length > 0
          ? `Fix these and retry: ${hint}`
          : "Provide a root or entry screen with visible text, fields, media, controls, or data-backed bricks and retry."
      }`,
      shadow,
      issues,
      "Provide a root or entry screen with renderable content, then retry render_page.",
    );
  }
  const catalogViolation = treeCatalogViolation(tree, catalog, shadow);
  if (catalogViolation !== undefined) {
    return errorResult(
      "render_page",
      "invalid_input",
      catalogViolation.message,
      shadow,
      [],
      catalogViolation.nextAction,
    );
  }

  const note = issues.length > 0 ? ` note: dropped invalid node(s): ${issueHint(issues)}` : "";
  return okPatchResult(
    "render_page",
    `Page replaced.${note}`,
    shadow,
    [{ op: "replace", path: "", value: tree }],
    issues,
  );
}

function executeAppendNode(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  catalog: FacetCatalog | undefined,
) {
  const parentId = input["parentId"];
  if (typeof parentId !== "string" || parentId.length === 0) {
    return errorResult(
      "append_node",
      "invalid_input",
      'error: append_node needs a non-empty string "parentId" (the container to append into)',
      shadow,
      [],
      "Pass parentId as an existing box, section, or card node id. Use inspect_stage if you need to find one.",
    );
  }

  const parent = shadow.nodes[parentId];
  if (parent === undefined) {
    return errorResult(
      "append_node",
      "invalid_parent",
      `error: append_node — parent "${parentId}" does not exist yet. Create it first with render_page or set_node, or append into an existing node.`,
      shadow,
      [],
      "Inspect the stage and append under an existing visible box, or create the parent first.",
    );
  }
  if (!isContainer(parent)) {
    return errorResult(
      "append_node",
      "invalid_parent",
      `error: append_node — parent "${parentId}" is not a container`,
      shadow,
      [],
      "Choose an existing box, section, or card node as parentId.",
    );
  }

  const node = parseNodeInput(input["node"], "append_node", shadow);
  if ("error" in node)
    return errorResult("append_node", "invalid_input", node.error, shadow, [], node.nextAction);
  const catalogViolation = nodeCatalogViolation(node.facetNode, catalog);
  if (catalogViolation !== undefined) {
    return errorResult(
      "append_node",
      "invalid_input",
      catalogViolation.message,
      shadow,
      [],
      catalogViolation.nextAction,
    );
  }

  return okPatchResult(
    "append_node",
    `Appended "${node.facetNode.id}" under "${parentId}".`,
    shadow,
    [
      { op: "add", path: nodePath(node.facetNode.id), value: node.facetNode },
      { op: "add", path: childrenPath(parentId), value: node.facetNode.id },
    ],
    node.issues,
  );
}

function executeUseStamp(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  stamps: readonly FacetStamp[],
  catalog: FacetCatalog | undefined,
) {
  const name = input["name"];
  if (typeof name !== "string" || name.length === 0) {
    return errorResult(
      "use_stamp",
      "invalid_input",
      'error: use_stamp needs a non-empty string "name" from the STAMPS list',
      shadow,
      [],
      "Pick a stamp name from the STAMPS list and pass it as name.",
    );
  }

  const at = input["at"];
  if (!isRecord(at) || typeof at["parent"] !== "string" || at["parent"].length === 0) {
    return errorResult(
      "use_stamp",
      "invalid_input",
      'error: use_stamp needs at={ "parent": "<container node id>" }',
      shadow,
      [],
      'Pass at={ "parent": "<existing box, section, or card node id>" }.',
    );
  }

  const parent = at["parent"];
  const parentNode = shadow.nodes[parent];
  if (parentNode === undefined) {
    return errorResult(
      "use_stamp",
      "invalid_parent",
      `error: use_stamp — parent "${parent}" does not exist yet`,
      shadow,
      [],
      "Inspect the stage and choose an existing container parent before using a stamp.",
    );
  }
  if (!isContainer(parentNode)) {
    return errorResult(
      "use_stamp",
      "invalid_parent",
      `error: use_stamp — parent "${parent}" is not a container`,
      shadow,
      [],
      "Choose an existing box, section, or card node as at.parent.",
    );
  }

  const stampViolation = stampCatalogViolation(name, catalog);
  if (stampViolation !== undefined) {
    return errorResult(
      "use_stamp",
      "invalid_stamp",
      stampViolation.message,
      shadow,
      [],
      stampViolation.nextAction,
    );
  }

  const stamp = stamps.find((candidate) => candidate.name === name);
  if (stamp === undefined) {
    return errorResult(
      "use_stamp",
      "invalid_stamp",
      `error: use_stamp — unknown stamp "${name}". Pick a name from STAMPS.`,
      shadow,
      [],
      "Pick one of the advertised STAMPS names.",
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
      "use_stamp",
      "invalid_stamp",
      `error: use_stamp — could not expand "${name}"${hint.length > 0 ? `: ${hint}` : ""}`,
      shadow,
      expanded.issues,
      "Fix the stamp params or choose another stamp, then retry use_stamp.",
    );
  }

  const catalogViolation = nodesCatalogViolation(Object.values(expanded.nodes), catalog);
  if (catalogViolation !== undefined) {
    return errorResult(
      "use_stamp",
      "invalid_stamp",
      catalogViolation.message,
      shadow,
      expanded.issues,
      catalogViolation.nextAction,
    );
  }

  const expansionPatchOps = Object.keys(expanded.nodes).length + 1;
  if (expansionPatchOps > MAX_PATCH_OPS) {
    return errorResult(
      "use_stamp",
      "patch_limit",
      `error: use_stamp — expanded "${name}" would exceed the patch op cap (${String(MAX_PATCH_OPS)}) for this streamed batch`,
      shadow,
      expanded.issues,
      "Split the page change into smaller edits or use a smaller stamp.",
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
    "use_stamp",
    `Used stamp "${name}".${note} ${metadata}`,
    shadow,
    patches,
    expanded.issues,
  );
}

function executeSetNode(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  catalog: FacetCatalog | undefined,
) {
  const node = parseNodeInput(input["node"], "set_node", shadow);
  if ("error" in node)
    return errorResult("set_node", "invalid_input", node.error, shadow, [], node.nextAction);
  if (node.facetNode.id === shadow.root) {
    return errorResult(
      "set_node",
      "invalid_input",
      `error: set_node — cannot replace the stage root "${shadow.root}". Use render_page for root-level restructures.`,
      shadow,
      [],
      "Use render_page for root-level restructures.",
    );
  }
  const catalogViolation = nodeCatalogViolation(node.facetNode, catalog);
  if (catalogViolation !== undefined) {
    return errorResult(
      "set_node",
      "invalid_input",
      catalogViolation.message,
      shadow,
      [],
      catalogViolation.nextAction,
    );
  }
  return okPatchResult(
    "set_node",
    `Set "${node.facetNode.id}".`,
    shadow,
    [{ op: "add", path: nodePath(node.facetNode.id), value: node.facetNode }],
    node.issues,
    { visibilityNodeIds: [node.facetNode.id] },
  );
}

function executeRemoveNode(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const nodeId = input["nodeId"];
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    return errorResult(
      "remove_node",
      "invalid_input",
      'error: remove_node needs a non-empty string "nodeId"',
      shadow,
      [],
      "Pass nodeId as a non-empty string. Use inspect_stage if you need to find one.",
    );
  }
  if (FORBIDDEN_NODE_IDS.has(nodeId)) {
    return errorResult(
      "remove_node",
      "invalid_input",
      `error: remove_node — node id "${nodeId}" is forbidden`,
      shadow,
      [],
      "Choose a normal stage node id.",
    );
  }
  if (nodeId === shadow.root) {
    return errorResult(
      "remove_node",
      "invalid_input",
      `error: remove_node — cannot remove the stage root "${shadow.root}". Use render_page for root-level restructures.`,
      shadow,
      [],
      "Use render_page for root-level restructures.",
    );
  }
  if (shadow.nodes[nodeId] === undefined) {
    return errorResult(
      "remove_node",
      "invalid_input",
      `error: remove_node — node "${nodeId}" does not exist`,
      shadow,
      [],
      "Inspect the stage and remove an existing non-root node.",
    );
  }
  return okPatchResult(
    "remove_node",
    `Removed "${nodeId}".`,
    shadow,
    [{ op: "remove", path: nodePath(nodeId) }],
    [],
    { visibilityNodeIds: [nodeId] },
  );
}

function executeSay(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const text = input["text"];
  if (typeof text !== "string" || text.length === 0) {
    return errorResult(
      "say",
      "invalid_input",
      'error: say needs a non-empty string "text"',
      shadow,
      [],
      'Pass a non-empty string "text".',
    );
  }
  return okMessageResult("say", "Sent chat message.", shadow, [{ kind: "say", text }]);
}

function executeSetTheme(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  catalog: FacetCatalog | undefined,
) {
  const name = input["name"];
  if (typeof name !== "string" || name.length === 0) {
    return errorResult(
      "set_theme",
      "invalid_input",
      'error: set_theme needs a non-empty string "name" (a theme from the THEMES list — a name only, never a CSS value)',
      shadow,
      [],
      "Pick a theme name from the THEMES list. Do not pass CSS values.",
    );
  }
  if (!isValidThemeName(name)) {
    return errorResult(
      "set_theme",
      "invalid_input",
      `error: "${name}" is not a valid theme name (letters/digits/_/-, max 64) — pick a name from the THEMES list`,
      shadow,
      [],
      "Pick a valid theme name from the THEMES list.",
    );
  }
  const catalogViolation = themeCatalogViolation(name, catalog, shadow.theme);
  if (catalogViolation !== undefined) {
    return errorResult(
      "set_theme",
      "invalid_input",
      catalogViolation.message,
      shadow,
      [],
      catalogViolation.nextAction,
    );
  }
  return okPatchResult("set_theme", `Theme set to "${name}".`, shadow, [
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
    "inspect_stage",
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
      "inspect_node",
      "invalid_input",
      'error: inspect_node needs a non-empty string "nodeId"',
      shadow,
      [],
      "Pass nodeId as a non-empty string. Use inspect_stage to find node ids.",
    );
  }
  if (shadow.nodes[nodeId] === undefined) {
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

function okPatchResult(
  toolName: string,
  observation: string,
  shadow: FacetTree,
  patches: readonly JsonPatchOperation[],
  issues: readonly string[] = [],
  options: { readonly nextAction?: string; readonly visibilityNodeIds?: readonly NodeId[] } = {},
): StageToolResult {
  if (patches.length > MAX_PATCH_OPS) {
    return errorResult(
      toolName,
      "patch_limit",
      `error: patch batch would exceed the patch op cap (${String(MAX_PATCH_OPS)})`,
      shadow,
      issues,
      "Split the change into smaller edits.",
    );
  }
  return okMessageResult(toolName, observation, shadow, [{ kind: "patch", patches }], issues, {
    ...options,
  });
}

function okMessageResult(
  toolName: string,
  observation: string,
  shadow: FacetTree,
  messages: readonly ServerMessage[],
  extraIssues: readonly string[] = [],
  options: { readonly nextAction?: string; readonly visibilityNodeIds?: readonly NodeId[] } = {},
): StageToolOkResult {
  const folded = foldStageShadow(shadow, messages);
  const issues = [...extraIssues, ...folded.issues];
  const stageChanged = folded.patchCount > 0 && folded.summary !== "no stage changes";
  const visibleToVisitor = stageChanged
    ? isVisitorVisibleStageChange(
        shadow,
        folded.shadow,
        options.visibilityNodeIds ?? folded.changedNodeIds,
      )
    : false;
  const outcome = okOutcome(stageChanged, visibleToVisitor, issues);
  return {
    status: "ok",
    observation: formatAgentToolObservation({
      tool: toolName,
      status: "ok",
      outcome,
      message: observation,
      applied: stageChanged,
      stageChanged,
      visibleToVisitor,
      patchCount: folded.patchCount,
      changedNodeIds: folded.changedNodeIds,
      warnings: issues,
      nextAction: options.nextAction ?? nextActionForOutcome(outcome),
      summary: folded.summary,
    }),
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
  toolName: string,
  code: StageToolErrorCode,
  observation: string,
  shadow: FacetTree,
  issues: readonly string[] = [],
  nextAction = "Fix the tool input and retry.",
): StageToolErrorResult {
  return {
    status: "error",
    code,
    observation: formatAgentToolObservation({
      tool: toolName,
      status: "error",
      outcome: "rejected",
      code,
      message: observation,
      applied: false,
      stageChanged: false,
      visibleToVisitor: false,
      patchCount: 0,
      warnings: issues,
      nextAction,
      summary: "no stage changes",
    }),
    messages: [],
    patches: [],
    changedNodeIds: [],
    patchCount: 0,
    summary: "no stage changes",
    shadow,
    issues,
  };
}

interface CatalogPolicyViolation {
  readonly message: string;
  readonly nextAction: string;
}

function treeCatalogViolation(
  tree: FacetTree,
  catalog: FacetCatalog | undefined,
  shadow: FacetTree,
): CatalogPolicyViolation | undefined {
  const nodeViolation = nodesCatalogViolation(Object.values(tree.nodes), catalog);
  if (nodeViolation !== undefined) return nodeViolation;
  return tree.theme === undefined
    ? undefined
    : themeCatalogViolation(tree.theme, catalog, shadow.theme);
}

function preserveCatalogTheme(
  tree: FacetTree,
  catalog: FacetCatalog | undefined,
  shadow: FacetTree,
): FacetTree {
  if (tree.theme !== undefined) return tree;
  if (catalog?.theme.switchPolicy !== "locked") return tree;
  const theme = catalog.theme.active ?? shadow.theme;
  if (theme === undefined) return tree;
  if (themeCatalogViolation(theme, catalog, shadow.theme) !== undefined) return tree;
  return { ...tree, theme };
}

function nodesCatalogViolation(
  nodes: readonly FacetNode[],
  catalog: FacetCatalog | undefined,
): CatalogPolicyViolation | undefined {
  for (const node of nodes) {
    const violation = nodeCatalogViolation(node, catalog);
    if (violation !== undefined) return violation;
  }
  return undefined;
}

function nodeCatalogViolation(
  node: FacetNode,
  catalog: FacetCatalog | undefined,
): CatalogPolicyViolation | undefined {
  if (catalog === undefined) return undefined;
  const brick = catalog.bricks.find((candidate) => candidate.type === node.type);
  if (brick === undefined) {
    if (PRIMITIVE_NODE_TYPES.has(node.type) && catalog.primitiveFallback === "allowed") {
      return undefined;
    }
    return {
      message: `error: catalog policy rejected node type "${node.type}". Allowed node types: ${catalogAllowedNodeTypes(catalog)}.`,
      nextAction: "Use an allowed catalog brick, stamp, or permitted primitive fallback.",
    };
  }

  const variant = nodeVariant(node);
  if (variant !== undefined && brick.variants !== undefined && !brick.variants.includes(variant)) {
    return {
      message: `error: catalog policy rejected variant "${variant}" for node type "${node.type}". Allowed variants: ${brick.variants.join(", ")}.`,
      nextAction: `Use an allowed "${node.type}" variant or omit variant for the default recipe.`,
    };
  }
  const tone = nodeTone(node);
  if (
    variant === undefined &&
    tone !== undefined &&
    brick.variants !== undefined &&
    !brick.variants.includes(tone)
  ) {
    return {
      message: `error: catalog policy rejected tone "${tone}" as a recipe selector for node type "${node.type}". Allowed variants: ${brick.variants.join(", ")}.`,
      nextAction: `Use an allowed "${node.type}" variant, or omit tone when the catalog does not advertise that recipe.`,
    };
  }
  return undefined;
}

function stampCatalogViolation(
  name: string,
  catalog: FacetCatalog | undefined,
): CatalogPolicyViolation | undefined {
  if (catalog === undefined || catalog.stamps.mode === "all") return undefined;
  if (catalog.stamps.names.includes(name)) return undefined;
  return {
    message: `error: catalog policy rejected stamp "${name}". Allowed stamps: ${catalog.stamps.names.join(", ")}.`,
    nextAction:
      "Pick a stamp allowed by the active catalog, or compose the UI from allowed bricks.",
  };
}

function themeCatalogViolation(
  name: string,
  catalog: FacetCatalog | undefined,
  currentTheme: string | undefined,
): CatalogPolicyViolation | undefined {
  if (catalog === undefined) return undefined;
  const activeTheme = catalog.theme.active;
  if (catalog.theme.switchPolicy === "locked") {
    if (name === activeTheme || (activeTheme === undefined && name === currentTheme)) {
      return undefined;
    }
    return {
      message: `error: catalog policy locked theme${activeTheme === undefined ? "" : ` to "${activeTheme}"`}; rejected theme "${name}".`,
      nextAction:
        "Keep the active catalog theme; do not call set_theme unless the catalog allows theme switching.",
    };
  }
  if (catalog.theme.allowed !== undefined && !catalog.theme.allowed.includes(name)) {
    return {
      message: `error: catalog policy rejected theme "${name}". Allowed themes: ${catalog.theme.allowed.join(", ")}.`,
      nextAction: "Pick a theme allowed by the active catalog.",
    };
  }
  return undefined;
}

function nodeVariant(node: FacetNode): string | undefined {
  return "variant" in node && typeof node.variant === "string" ? node.variant : undefined;
}

function nodeTone(node: FacetNode): string | undefined {
  return "tone" in node && typeof node.tone === "string" ? node.tone : undefined;
}

function catalogAllowedNodeTypes(catalog: FacetCatalog): string {
  const allowed = new Set(catalog.bricks.map((brick) => brick.type));
  if (catalog.primitiveFallback === "allowed") {
    for (const type of PRIMITIVE_NODE_TYPES) allowed.add(type);
  }
  return Array.from(allowed).join(", ");
}

function parseToolCall(
  call: unknown,
): { readonly name: string; readonly input: unknown } | { readonly error: string } {
  if (!isRecord(call)) return { error: "error: tool call must be an object" };
  try {
    const name = call["name"];
    if (typeof name !== "string" || name.length === 0) {
      return { error: 'error: tool call needs a non-empty string "name"' };
    }
    return { name, input: call["input"] };
  } catch {
    return { error: "error: tool call could not be read safely" };
  }
}

function parseNodeInput(
  value: unknown,
  toolName: "append_node" | "set_node",
  shadow: FacetTree,
):
  | { readonly facetNode: FacetNode; readonly issues: readonly string[] }
  | { readonly error: string; readonly nextAction: string } {
  const result = asNode(value);
  if ("error" in result)
    return { error: `error: ${toolName} — ${result.error}`, nextAction: result.nextAction };
  const missing = missingChildRefs(result.facetNode, shadow);
  if (missing.length > 0) {
    return {
      error: `error: ${toolName} — node "${result.facetNode.id}" references missing child node(s): ${summarizeIds(missing)}`,
      nextAction: "Define the missing child nodes first, or remove those child references.",
    };
  }
  return sanitizeToolNode(result.facetNode, toolName, shadow);
}

function sanitizeToolNode(
  facetNode: FacetNode,
  toolName: "append_node" | "set_node",
  shadow: FacetTree,
):
  | { readonly facetNode: FacetNode; readonly issues: readonly string[] }
  | { readonly error: string; readonly nextAction: string } {
  const sanitizeRoot = toolSanitizeRootId(shadow, facetNode.id);
  const validated = validateTree({
    root: sanitizeRoot,
    nodes: {
      ...shadow.nodes,
      [facetNode.id]: facetNode,
      [sanitizeRoot]: { id: sanitizeRoot, type: "box", children: [facetNode.id] },
    },
  });
  const sanitized = validated.tree.nodes[facetNode.id];
  if (sanitized === undefined) {
    return {
      error: `error: ${toolName} — node "${facetNode.id}" was removed by validation`,
      nextAction: "Fix the node shape and retry with a valid Facet node.",
    };
  }
  return { facetNode: sanitized, issues: validated.issues };
}

function toolSanitizeRootId(shadow: FacetTree, nodeId: string): string {
  let id = "__facet_tool_sanitize_root__";
  while (id === nodeId || shadow.nodes[id] !== undefined) id = `_${id}`;
  return id;
}

function asNode(
  value: unknown,
): { readonly facetNode: FacetNode } | { readonly error: string; readonly nextAction: string } {
  if (!isRecord(value))
    return {
      error: 'the "node" argument must be an object',
      nextAction: "Pass node as an object.",
    };
  if (typeof value["id"] !== "string" || value["id"].length === 0) {
    return {
      error: 'the node needs a non-empty string "id"',
      nextAction: 'Add a non-empty string "id" to the node.',
    };
  }
  if (FORBIDDEN_NODE_IDS.has(value["id"])) {
    return {
      error: `node id "${value["id"]}" is forbidden`,
      nextAction: "Choose a normal node id.",
    };
  }

  switch (value["type"]) {
    case "box":
      if (
        value["children"] !== undefined &&
        (!Array.isArray(value["children"]) ||
          !value["children"].every((child): child is string => typeof child === "string"))
      ) {
        return {
          error: 'a "box" node needs "children" as an array of string ids',
          nextAction: 'Use "children": [] or an array of existing child node ids.',
        };
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
        return {
          error: 'a "text" node needs a string "value"',
          nextAction: 'Pass a string "value" for text nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "media":
      if (typeof value["src"] !== "string") {
        return {
          error: 'a "media" node needs string "src"',
          nextAction: 'Pass a safe static string "src" for media nodes.',
        };
      }
      if (!isSafeMediaSrc(value["src"])) {
        return {
          error: 'a "media" node needs a safe static "src"',
          nextAction: "Use a safe static media src.",
        };
      }
      if (
        value["kind"] !== undefined &&
        (typeof value["kind"] !== "string" ||
          !(MEDIA_KINDS as readonly string[]).includes(value["kind"]))
      ) {
        return {
          error: 'a "media" node kind must be "image" or "video"',
          nextAction: 'Use kind "image" or "video".',
        };
      }
      return {
        facetNode: {
          ...value,
          kind: value["kind"] ?? "image",
        } as unknown as FacetNode,
      };
    case "field":
      if (typeof value["name"] !== "string") {
        return {
          error: 'a "field" node needs a string "name"',
          nextAction: 'Pass a string "name" for field nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "button":
      if (typeof value["label"] !== "string") {
        return {
          error: 'a "button" node needs a string "label"',
          nextAction: 'Pass a string "label" for button nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "section": {
      const children = parseContainerChildren(value["children"], "section");
      if ("error" in children) return children;
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "section",
          children: children.children,
        } as unknown as FacetNode,
      };
    }
    case "card": {
      const children = parseContainerChildren(value["children"], "card");
      if ("error" in children) return children;
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "card",
          children: children.children,
        } as unknown as FacetNode,
      };
    }
    case "tabs":
      if (!Array.isArray(value["items"])) {
        return {
          error: 'a "tabs" node needs "items" as an array',
          nextAction: 'Pass "items": [] or an array of tab items.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "nav":
      if (!Array.isArray(value["items"])) {
        return {
          error: 'a "nav" node needs "items" as an array',
          nextAction: 'Pass "items": [] or an array of nav items.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "table":
      if (value["columns"] !== undefined && !Array.isArray(value["columns"])) {
        return {
          error: 'a "table" node needs "columns" as an array',
          nextAction: 'Pass "columns": [] or an array of table columns.',
        };
      }
      if (value["rows"] !== undefined && !Array.isArray(value["rows"])) {
        return {
          error: 'a "table" node needs "rows" as an array',
          nextAction: 'Pass "rows": [] or an array of table rows.',
        };
      }
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "table",
          columns: value["columns"] ?? [],
          rows: value["rows"] ?? [],
        } as unknown as FacetNode,
      };
    case "chart":
      if (
        value["kind"] !== undefined &&
        (typeof value["kind"] !== "string" || !CHART_KINDS.has(value["kind"]))
      ) {
        return {
          error: 'a "chart" node kind must be "bar", "line", or "donut"',
          nextAction: 'Use kind "bar", "line", or "donut".',
        };
      }
      if (value["series"] !== undefined && !Array.isArray(value["series"])) {
        return {
          error: 'a "chart" node needs "series" as an array',
          nextAction: 'Pass "series": [] or an array of chart series.',
        };
      }
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "chart",
          kind: value["kind"] ?? "bar",
          series: value["series"] ?? [],
        } as unknown as FacetNode,
      };
    case "metric":
    case "stat":
      if (typeof value["label"] !== "string" || typeof value["value"] !== "string") {
        return {
          error: `a "${value["type"]}" node needs string "label" and "value"`,
          nextAction: `Pass string "label" and "value" for ${String(value["type"])} nodes.`,
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "keyValue":
      if (!Array.isArray(value["items"])) {
        return {
          error: 'a "keyValue" node needs "items" as an array',
          nextAction: 'Pass "items": [] or an array of key/value items.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "badge":
      if (typeof value["label"] !== "string") {
        return {
          error: 'a "badge" node needs a string "label"',
          nextAction: 'Pass a string "label" for badge nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "progress":
      if (typeof value["value"] !== "number" || !Number.isFinite(value["value"])) {
        return {
          error: 'a "progress" node needs a finite number "value"',
          nextAction: 'Pass a finite number "value" from 0 to 100 for progress nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "alert":
      if (typeof value["body"] !== "string") {
        return {
          error: 'an "alert" node needs a string "body"',
          nextAction: 'Pass a string "body" for alert nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "list":
      if (!Array.isArray(value["items"])) {
        return {
          error: 'a "list" node needs "items" as an array',
          nextAction: 'Pass "items": [] or an array of list items.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "divider":
      return { facetNode: value as unknown as FacetNode };
    case "form": {
      const children = parseContainerChildren(value["children"], "form");
      if ("error" in children) return children;
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "form",
          children: children.children,
        } as unknown as FacetNode,
      };
    }
    case "search":
      if (typeof value["name"] !== "string") {
        return {
          error: 'a "search" node needs a string "name"',
          nextAction: 'Pass a string "name" for search nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "filterBar":
      if (!Array.isArray(value["filters"])) {
        return {
          error: 'a "filterBar" node needs "filters" as an array',
          nextAction: 'Pass "filters": [] or an array of filter controls.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    case "emptyState":
    case "loading":
      return { facetNode: value as unknown as FacetNode };
    default:
      return {
        error: `"type" must be one of the Facet v1 node types: ${FACET_NODE_TYPES_TEXT}`,
        nextAction: "Use one allowed Facet v1 node type.",
      };
  }
}

function parseContainerChildren(
  value: unknown,
  nodeType: "section" | "card" | "form",
):
  | { readonly children: readonly string[] }
  | { readonly error: string; readonly nextAction: string } {
  if (
    value !== undefined &&
    (!Array.isArray(value) || !value.every((child): child is string => typeof child === "string"))
  ) {
    return {
      error: `a "${nodeType}" node needs "children" as an array of string ids`,
      nextAction: 'Use "children": [] or an array of existing child node ids.',
    };
  }
  return { children: value ?? [] };
}

function okOutcome(
  stageChanged: boolean,
  visibleToVisitor: boolean,
  issues: readonly string[],
): AgentToolOutcome {
  if (!stageChanged) return "no_stage_change";
  if (issues.length > 0) return "applied_with_warnings";
  return visibleToVisitor ? "applied_visible" : "applied_not_visible";
}

function nextActionForOutcome(outcome: AgentToolOutcome): string {
  switch (outcome) {
    case "applied_visible":
    case "no_stage_change":
      return "";
    case "applied_not_visible":
      return "Attach the changed node to a visible box with append_node, or inspect_stage to find a visible parent.";
    case "applied_with_warnings":
      return "Inspect the affected stage area and retry if the warning affects the requested page change.";
    case "pending":
      return "Define the missing child nodes before claiming the page change is complete.";
    case "rejected":
      return "Fix the tool input and retry.";
  }
}

function missingChildRefs(facetNode: FacetNode, shadow: FacetTree): readonly NodeId[] {
  if (!isContainer(facetNode)) return [];
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

function isRenderable(tree: FacetTree): boolean {
  return treeHasContent(tree);
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

function summarizeIds(ids: readonly NodeId[]): string {
  const shown = ids.slice(0, MAX_ID_LIST_PREVIEW);
  const suffix = ids.length > shown.length ? `, +${String(ids.length - shown.length)} more` : "";
  return `${shown.join(", ")}${suffix}`;
}
