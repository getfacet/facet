import {
  isContainer,
  validateAuthorNode,
  type FacetNode,
  type FacetTheme,
  type FacetTree,
  type NodeId,
} from "@facet/core";
import { FACET_STAGE_TOOL_NAMES } from "./specs.js";
import type { FacetStageToolName } from "./types.js";

const MAX_ID_LIST_PREVIEW = 20;

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
  theme: FacetTheme,
):
  | { readonly facetNode: FacetNode; readonly issues: readonly string[] }
  | {
      readonly authorValidation: ReturnType<typeof validateAuthorNode>;
    }
  | { readonly error: string; readonly nextAction: string } {
  const authorValidation = validateAuthorNode(value, theme);
  if (authorValidation.value === undefined) return { authorValidation };
  const missing = missingChildRefs(authorValidation.value, shadow);
  if (missing.length > 0) {
    return {
      error: `error: ${toolName} — node "${authorValidation.value.id}" references missing child node(s): ${summarizeIds(missing)}`,
      nextAction: "Define the missing child nodes first, or remove those child references.",
    };
  }
  return { facetNode: authorValidation.value, issues: [] };
}

function missingChildRefs(facetNode: FacetNode, shadow: FacetTree): readonly NodeId[] {
  if (!isContainer(facetNode)) return [];
  return facetNode.children.filter((id) => !Object.hasOwn(shadow.nodes, id));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

export function isFacetStageToolName(value: string): value is FacetStageToolName {
  return (FACET_STAGE_TOOL_NAMES as readonly string[]).includes(value);
}

function summarizeIds(ids: readonly NodeId[]): string {
  const shown = ids.slice(0, MAX_ID_LIST_PREVIEW);
  const suffix = ids.length > shown.length ? `, +${String(ids.length - shown.length)} more` : "";
  return `${shown.join(", ")}${suffix}`;
}
