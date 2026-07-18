import { MAX_AUTHOR_ISSUES, treeRenderableNodeIds, type FacetTree, type NodeId } from "@facet/core";
import {
  AGENT_TOOL_OBSERVATION_ERROR_CODES,
  AGENT_TOOL_OBSERVATION_STATUSES,
  AGENT_TOOL_OUTCOMES,
  type AgentToolObservationData,
  type AgentToolObservationStatus,
  type AgentToolOutcome,
  type StageToolAuthorIssue,
  type StageToolErrorCode,
  type StageToolObservation,
} from "./types.js";
import { stableJson } from "./stable-json.js";

const CONTRACT_VERSION = 1;
const MAX_TOOL_CHARS = 80;
const MAX_CHANGED_NODE_IDS = 12;
const MAX_CHANGED_NODE_ID_CHARS = 96;
const MAX_WARNINGS = 3;
const MAX_WARNING_CHARS = 240;
const MAX_MESSAGE_CHARS = 500;
const MAX_NEXT_ACTION_CHARS = 300;
const MAX_SUMMARY_CHARS = 500;
const MAX_DATA_CHARS = 2048;
const MAX_AUTHOR_PATH_CHARS = 240;
const MAX_AUTHOR_MESSAGE_CHARS = 240;
const MAX_AUTHOR_ALLOWED_VALUES = 32;
const MAX_AUTHOR_ALLOWED_CHARS = 80;
const OBSERVATION_STATUSES = new Set<string>(AGENT_TOOL_OBSERVATION_STATUSES);
const OBSERVATION_OUTCOMES = new Set<string>(AGENT_TOOL_OUTCOMES);
const OBSERVATION_ERROR_CODES = new Set<string>(AGENT_TOOL_OBSERVATION_ERROR_CODES);

export interface AgentToolObservationInput {
  readonly tool: string;
  readonly status: AgentToolObservationStatus;
  readonly outcome: AgentToolOutcome;
  readonly message: string;
  readonly applied?: boolean;
  readonly stageChanged?: boolean;
  readonly visibleToVisitor?: boolean;
  readonly patchCount?: number;
  readonly changedNodeIds?: readonly NodeId[];
  readonly warnings?: readonly string[];
  readonly nextAction?: string;
  readonly summary?: string;
  readonly code?: StageToolErrorCode | "pending";
  readonly errors?: readonly StageToolAuthorIssue[];
  readonly omittedErrorCount?: number;
  /** Generic observation data is always capped; this API exposes no bypass. */
  readonly data?: string;
}

export function formatAgentToolObservation(input: AgentToolObservationInput): StageToolObservation {
  const changedNodeIds = boundedNodeIds(input.changedNodeIds ?? []);
  const warnings = boundedList(input.warnings ?? [], MAX_WARNINGS);
  const facts = outcomeFacts(input);
  const status = statusForOutcome(input.outcome);
  const code = codeForOutcome(input.outcome, input.code);
  const dataField = boundedData(input.data);
  const authorErrors = boundedAuthorErrors(input.errors, input.omittedErrorCount);
  const data: AgentToolObservationData = {
    version: CONTRACT_VERSION,
    tool: truncate(input.tool, MAX_TOOL_CHARS),
    status,
    outcome: input.outcome,
    applied: facts.applied,
    stage_changed: facts.stageChanged,
    visible_to_visitor: facts.visibleToVisitor,
    patch_count: facts.patchCount,
    changed_node_ids: changedNodeIds.items,
    omitted_changed_node_count: changedNodeIds.omitted,
    warnings: warnings.items.map((warning) => truncate(warning, MAX_WARNING_CHARS)),
    omitted_warning_count: warnings.omitted,
    message: truncate(input.message, MAX_MESSAGE_CHARS),
    next_action: truncate(input.nextAction ?? "", MAX_NEXT_ACTION_CHARS),
    summary: truncate(input.summary ?? "", MAX_SUMMARY_CHARS),
    ...(code !== undefined ? { code } : {}),
    ...(authorErrors === undefined
      ? {}
      : {
          errors: authorErrors.items,
          omitted_error_count: authorErrors.omitted,
        }),
    ...(dataField !== undefined ? { data: dataField } : {}),
  };
  return { status: data.status, text: JSON.stringify(data), data };
}

export function parseAgentToolObservation(text: string): AgentToolObservationData | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isObservationData(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function visibleStageNodeIds(tree: FacetTree): ReadonlySet<NodeId> {
  return treeRenderableNodeIds(tree);
}

export function isVisitorVisibleStageChange(
  before: FacetTree,
  after: FacetTree,
  changedNodeIds: readonly NodeId[],
): boolean {
  if (stageMetadataChanged(before, after)) return true;
  if (changedNodeIds.length === 0) return false;
  const beforeVisible = visibleStageNodeIds(before);
  const afterVisible = visibleStageNodeIds(after);
  return changedNodeIds.some((id) => beforeVisible.has(id) || afterVisible.has(id));
}

function stageMetadataChanged(before: FacetTree, after: FacetTree): boolean {
  return (
    before.root !== after.root ||
    before.entry !== after.entry ||
    stableJson(before.screens) !== stableJson(after.screens)
  );
}

function boundedAuthorErrors(
  errors: readonly StageToolAuthorIssue[] | undefined,
  omittedErrorCount: number | undefined,
): { readonly items: readonly StageToolAuthorIssue[]; readonly omitted: number } | undefined {
  if (errors === undefined && omittedErrorCount === undefined) return undefined;
  const source = errors ?? [];
  const shown = source.slice(0, MAX_AUTHOR_ISSUES).map((issue): StageToolAuthorIssue => {
    const allowed = issue.allowed
      ?.slice(0, MAX_AUTHOR_ALLOWED_VALUES)
      .map((value) => safeAuthorText(value, MAX_AUTHOR_ALLOWED_CHARS));
    return {
      path: safeAuthorText(issue.path, MAX_AUTHOR_PATH_CHARS),
      message: safeAuthorText(issue.message, MAX_AUTHOR_MESSAGE_CHARS),
      ...(allowed === undefined ? {} : { allowed }),
    };
  });
  return {
    items: shown,
    omitted: nonNegativeInteger(omittedErrorCount) + Math.max(0, source.length - shown.length),
  };
}

function safeAuthorText(value: string, maxChars: number): string {
  const output: string[] = [];
  const scanLimit = Math.min(value.length, maxChars * 4);
  for (let index = 0; index < scanLimit && output.length < maxChars; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x20 && !(code >= 0x7f && code <= 0x9f)) output.push(value[index] ?? "");
  }
  return output.join("");
}

function boundedList<T>(
  items: readonly T[],
  limit: number,
): { readonly items: readonly T[]; readonly omitted: number } {
  const shown = items.slice(0, limit);
  return { items: shown, omitted: Math.max(0, items.length - shown.length) };
}

function boundedNodeIds(items: readonly NodeId[]): {
  readonly items: readonly NodeId[];
  readonly omitted: number;
} {
  const shown: NodeId[] = [];
  let omitted = 0;
  for (const id of items) {
    if (shown.length >= MAX_CHANGED_NODE_IDS || id.length > MAX_CHANGED_NODE_ID_CHARS) {
      omitted += 1;
      continue;
    }
    shown.push(id);
  }
  return { items: shown, omitted };
}

/**
 * Emit `data` only when it stays within the JSON-safe cap. The producer already
 * bounds it, so an over-cap value means a malformed payload — replace it with a
 * valid `{"truncated":true}` object rather than slicing mid-JSON.
 */
function boundedData(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= MAX_DATA_CHARS ? value : '{"truncated":true}';
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const suffix = "...";
  return `${value.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function nonNegativeInteger(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function isObservationData(value: unknown): value is AgentToolObservationData {
  if (!isRecord(value)) return false;
  if (
    value["version"] === CONTRACT_VERSION &&
    typeof value["tool"] === "string" &&
    isStatus(value["status"]) &&
    isOutcome(value["outcome"]) &&
    typeof value["applied"] === "boolean" &&
    typeof value["stage_changed"] === "boolean" &&
    typeof value["visible_to_visitor"] === "boolean" &&
    isNonNegativeInteger(value["patch_count"]) &&
    Array.isArray(value["changed_node_ids"]) &&
    value["changed_node_ids"].every((id): id is string => typeof id === "string") &&
    isNonNegativeInteger(value["omitted_changed_node_count"]) &&
    Array.isArray(value["warnings"]) &&
    value["warnings"].every((warning): warning is string => typeof warning === "string") &&
    isNonNegativeInteger(value["omitted_warning_count"]) &&
    typeof value["message"] === "string" &&
    typeof value["next_action"] === "string" &&
    typeof value["summary"] === "string" &&
    (value["code"] === undefined || isErrorCode(value["code"])) &&
    hasValidAuthorErrors(value) &&
    (value["data"] === undefined || typeof value["data"] === "string")
  ) {
    const observation = value as unknown as AgentToolObservationData;
    return hasCoherentOutcome(observation) && hasCoherentAuthorErrors(observation);
  }
  return false;
}

function isStatus(value: unknown): value is AgentToolObservationStatus {
  return typeof value === "string" && OBSERVATION_STATUSES.has(value);
}

function isOutcome(value: unknown): value is AgentToolOutcome {
  return typeof value === "string" && OBSERVATION_OUTCOMES.has(value);
}

function outcomeFacts(input: AgentToolObservationInput): {
  readonly applied: boolean;
  readonly stageChanged: boolean;
  readonly visibleToVisitor: boolean;
  readonly patchCount: number;
} {
  const patchCount = nonNegativeInteger(input.patchCount);
  switch (input.outcome) {
    case "applied_visible":
      return { applied: true, stageChanged: true, visibleToVisitor: true, patchCount };
    case "applied_not_visible":
      return { applied: true, stageChanged: true, visibleToVisitor: false, patchCount };
    case "applied_with_warnings":
      return {
        applied: true,
        stageChanged: true,
        visibleToVisitor: input.visibleToVisitor ?? false,
        patchCount,
      };
    case "pending":
    case "rejected":
    case "no_stage_change":
      return { applied: false, stageChanged: false, visibleToVisitor: false, patchCount: 0 };
  }
}

function statusForOutcome(outcome: AgentToolOutcome): AgentToolObservationStatus {
  switch (outcome) {
    case "pending":
      return "pending";
    case "rejected":
      return "error";
    case "applied_visible":
    case "applied_not_visible":
    case "applied_with_warnings":
    case "no_stage_change":
      return "ok";
  }
}

function codeForOutcome(
  outcome: AgentToolOutcome,
  code: StageToolErrorCode | "pending" | undefined,
): StageToolErrorCode | "pending" | undefined {
  if (outcome === "pending") return "pending";
  if (outcome === "rejected") return code === "pending" ? undefined : code;
  return undefined;
}

function hasCoherentOutcome(value: AgentToolObservationData): boolean {
  switch (value.outcome) {
    case "applied_visible":
      return (
        value.status === "ok" &&
        value.applied === true &&
        value.stage_changed === true &&
        value.visible_to_visitor === true &&
        value.code === undefined
      );
    case "applied_not_visible":
      return (
        value.status === "ok" &&
        value.applied === true &&
        value.stage_changed === true &&
        value.visible_to_visitor === false &&
        value.code === undefined
      );
    case "applied_with_warnings":
      return (
        value.status === "ok" &&
        value.applied === true &&
        value.stage_changed === true &&
        value.code === undefined
      );
    case "no_stage_change":
      return (
        value.status === "ok" &&
        value.applied === false &&
        value.stage_changed === false &&
        value.visible_to_visitor === false &&
        value.patch_count === 0 &&
        value.code === undefined
      );
    case "pending":
      return (
        value.status === "pending" &&
        value.applied === false &&
        value.stage_changed === false &&
        value.visible_to_visitor === false &&
        value.patch_count === 0 &&
        (value.code === undefined || value.code === "pending")
      );
    case "rejected":
      return (
        value.status === "error" &&
        value.applied === false &&
        value.stage_changed === false &&
        value.visible_to_visitor === false &&
        value.patch_count === 0 &&
        value.code !== "pending"
      );
  }
}

function isErrorCode(value: unknown): value is StageToolErrorCode | "pending" {
  return typeof value === "string" && OBSERVATION_ERROR_CODES.has(value);
}

function hasValidAuthorErrors(value: Record<string, unknown>): boolean {
  const errors = value["errors"];
  const omitted = value["omitted_error_count"];
  if (errors === undefined && omitted === undefined) return true;
  return (
    Array.isArray(errors) &&
    errors.length <= MAX_AUTHOR_ISSUES &&
    errors.every(isAuthorIssue) &&
    isNonNegativeInteger(omitted)
  );
}

function isAuthorIssue(value: unknown): value is StageToolAuthorIssue {
  if (!isRecord(value)) return false;
  const allowed = value["allowed"];
  return (
    typeof value["path"] === "string" &&
    value["path"].length <= MAX_AUTHOR_PATH_CHARS &&
    isControlFree(value["path"]) &&
    typeof value["message"] === "string" &&
    value["message"].length <= MAX_AUTHOR_MESSAGE_CHARS &&
    isControlFree(value["message"]) &&
    (allowed === undefined ||
      (Array.isArray(allowed) &&
        allowed.length <= MAX_AUTHOR_ALLOWED_VALUES &&
        allowed.every(
          (choice): choice is string =>
            typeof choice === "string" &&
            choice.length <= MAX_AUTHOR_ALLOWED_CHARS &&
            isControlFree(choice),
        )))
  );
}

function isControlFree(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

function hasCoherentAuthorErrors(value: AgentToolObservationData): boolean {
  const hasErrors = value.errors !== undefined || value.omitted_error_count !== undefined;
  return hasErrors
    ? value.outcome === "rejected" && value.code === "invalid_authoring"
    : value.code !== "invalid_authoring";
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
