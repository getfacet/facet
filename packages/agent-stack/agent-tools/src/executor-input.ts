import {
  COMPONENT_NODE_TYPES,
  PRIMITIVE_BRICK_TYPES,
  isContainer,
  validateTree,
  type FacetNode,
  type FacetTree,
  type NodeId,
} from "@facet/core";
import { FACET_STAGE_TOOL_NAMES } from "./specs.js";
import { EXECUTOR_REGISTRY } from "./executor-registry.js";
import { isForbiddenNodeId } from "./executor-paths.js";
import type { FacetStageToolName } from "./types.js";

const MAX_ID_LIST_PREVIEW = 20;
const FACET_NODE_TYPES_TEXT = [...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES]
  .map((type) => `"${type}"`)
  .join(", ");

export function parseToolCall(
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

export function parseNodeInput(
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
  while (id === nodeId || Object.hasOwn(shadow.nodes, id)) id = `_${id}`;
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
  if (isForbiddenNodeId(value["id"])) {
    return {
      error: `node id "${value["id"]}" is forbidden`,
      nextAction: "Choose a normal node id.",
    };
  }

  const type = value["type"];
  const entry =
    typeof type === "string" && Object.hasOwn(EXECUTOR_REGISTRY, type)
      ? EXECUTOR_REGISTRY[type as FacetNode["type"]]
      : undefined;
  if (entry === undefined) {
    return {
      error: `"type" must be one of the Facet v1 node types: ${FACET_NODE_TYPES_TEXT}`,
      nextAction: "Use one allowed Facet v1 node type.",
    };
  }
  return entry.asNode(value);
}

function missingChildRefs(facetNode: FacetNode, shadow: FacetTree): readonly NodeId[] {
  if (!isContainer(facetNode)) return [];
  return facetNode.children.filter((id) => !Object.hasOwn(shadow.nodes, id));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFacetStageToolName(value: string): value is FacetStageToolName {
  return (FACET_STAGE_TOOL_NAMES as readonly string[]).includes(value);
}

function summarizeIds(ids: readonly NodeId[]): string {
  const shown = ids.slice(0, MAX_ID_LIST_PREVIEW);
  const suffix = ids.length > shown.length ? `, +${String(ids.length - shown.length)} more` : "";
  return `${shown.join(", ")}${suffix}`;
}
