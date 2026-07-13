import {
  CHART_KINDS,
  COMPONENT_NODE_TYPES,
  MEDIA_KINDS,
  PRIMITIVE_BRICK_TYPES,
  isContainer,
  isSafeMediaSrc,
  validateTree,
  type FacetNode,
  type FacetTree,
  type NodeId,
} from "@facet/core";
import { FACET_STAGE_TOOL_NAMES } from "./specs.js";
import { isForbiddenNodeId } from "./executor-paths.js";
import type { FacetStageToolName } from "./types.js";

const MAX_ID_LIST_PREVIEW = 20;
const FACET_NODE_TYPES_TEXT = [...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES]
  .map((type) => `"${type}"`)
  .join(", ");
const CHART_KIND_SET = new Set<string>(CHART_KINDS);
const CHART_KINDS_TEXT = CHART_KINDS.map((kind) => `"${kind}"`).join(", ");

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
        (typeof value["kind"] !== "string" || !CHART_KIND_SET.has(value["kind"]))
      ) {
        return {
          error: `a "chart" node kind must be one of ${CHART_KINDS_TEXT}`,
          nextAction: `Use one of the core chart kinds: ${CHART_KINDS_TEXT}.`,
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
