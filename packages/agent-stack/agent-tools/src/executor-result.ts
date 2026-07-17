import {
  MAX_PATCH_OPS,
  type FacetTree,
  type JsonPatchOperation,
  type NodeId,
  type ServerMessage,
} from "@facet/core";
import { formatAgentToolObservation, isVisitorVisibleStageChange } from "./observation.js";
import type { AgentToolObservationInput } from "./observation.js";
import { foldStageShadow } from "./stage-shadow.js";
import type {
  AgentToolOutcome,
  StageToolErrorCode,
  StageToolErrorResult,
  StageToolOkResult,
  StageToolResult,
} from "./types.js";

export interface OkResultOptions {
  readonly nextAction?: string;
  readonly visibilityNodeIds?: readonly NodeId[];
  readonly data?: string;
}

export function okPatchResult(
  toolName: string,
  observation: string,
  shadow: FacetTree,
  patches: readonly JsonPatchOperation[],
  issues: readonly string[] = [],
  options: OkResultOptions = {},
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

export function okMessageResult(
  toolName: string,
  observation: string,
  shadow: FacetTree,
  messages: readonly ServerMessage[],
  extraIssues: readonly string[] = [],
  options: OkResultOptions = {},
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
  const observationInput: AgentToolObservationInput = {
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
  };
  const formattedObservation = formatAgentToolObservation({
    ...observationInput,
    ...(options.data !== undefined ? { data: options.data } : {}),
  });
  return {
    status: "ok",
    observation: formattedObservation,
    messages,
    patches: folded.patches,
    changedNodeIds: folded.changedNodeIds,
    patchCount: folded.patchCount,
    summary: folded.summary,
    shadow: folded.shadow,
    issues,
  };
}

export function errorResult(
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
