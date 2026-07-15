import { EMPTY_TREE, isTreeShaped } from "@facet/core";
import { executeGetComposition } from "./executor-assets.js";
import { executeInspectNode, executeInspectStage } from "./executor-inspect.js";
import { isFacetStageToolName, isRecord, parseToolCall } from "./executor-input.js";
import {
  executeAppendNode,
  executeRemoveNode,
  executeSay,
  executeSetNode,
  executeSetTheme,
} from "./executor-node.js";
import { executeRenderPage } from "./executor-page.js";
import { errorResult } from "./executor-result.js";
import { FACET_STAGE_TOOL_NAMES } from "./specs.js";
import type { StageToolContext, StageToolResult } from "./types.js";

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
    case "get_composition":
      return executeGetComposition(input, shadow, context.assets?.compositions ?? [], catalog);
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
