import { EMPTY_TREE, isTreeShaped, type FacetTree } from "@facet/core";
import {
  executeGetBrickSpec,
  executeGetPattern,
  executeGetPreset,
  executeGetStyleChoices,
} from "./executor-assets.js";
import { executeInspectNode, executeInspectStage } from "./executor-inspect.js";
import { isFacetStageToolName, isRecord, parseToolCall } from "./executor-input.js";
import {
  executeAppendNode,
  executeRemoveNode,
  executeSay,
  executeSetNode,
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
  const assets = context.assets;
  switch (parsed.name) {
    case "render_page":
      return assets === undefined
        ? unavailableSnapshot(parsed.name, shadow)
        : executeRenderPage(input, shadow, assets.theme);
    case "append_node":
      return assets === undefined
        ? unavailableSnapshot(parsed.name, shadow)
        : executeAppendNode(input, shadow, assets.theme);
    case "set_node":
      return assets === undefined
        ? unavailableSnapshot(parsed.name, shadow)
        : executeSetNode(input, shadow, assets.theme);
    case "remove_node":
      return executeRemoveNode(input, shadow);
    case "say":
      return executeSay(input, shadow);
    case "get_brick_spec":
      return assets === undefined
        ? unavailableSnapshot(parsed.name, shadow)
        : executeGetBrickSpec(input, shadow, assets);
    case "get_style_choices":
      return assets === undefined
        ? unavailableSnapshot(parsed.name, shadow)
        : executeGetStyleChoices(input, shadow, assets);
    case "get_preset":
      return assets === undefined
        ? unavailableSnapshot(parsed.name, shadow)
        : executeGetPreset(input, shadow, assets);
    case "get_pattern":
      return assets === undefined
        ? unavailableSnapshot(parsed.name, shadow)
        : executeGetPattern(input, shadow, assets);
    case "inspect_stage":
      return executeInspectStage(input, shadow);
    case "inspect_node":
      return executeInspectNode(input, shadow);
  }
}

function unavailableSnapshot(tool: string, shadow: FacetTree): StageToolResult {
  return errorResult(
    tool,
    "not_available",
    "The active asset snapshot is unavailable.",
    shadow,
    [],
    "Retry after the host provides one validated Theme and Pattern snapshot.",
  );
}
