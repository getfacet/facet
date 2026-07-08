import type { FacetTree, NodeId } from "@facet/core";
import type {
  AgentToolObservationData,
  AgentToolObservationStatus,
  AgentToolOutcome,
  StageToolErrorCode,
  StageToolObservation,
} from "./types.js";

const CONTRACT_VERSION = 1;
const MAX_TOOL_CHARS = 80;
const MAX_CHANGED_NODE_IDS = 12;
const MAX_CHANGED_NODE_ID_CHARS = 96;
const MAX_WARNINGS = 3;
const MAX_WARNING_CHARS = 240;
const MAX_MESSAGE_CHARS = 500;
const MAX_NEXT_ACTION_CHARS = 300;
const MAX_SUMMARY_CHARS = 500;

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
}

export function formatAgentToolObservation(input: AgentToolObservationInput): StageToolObservation {
  const changedNodeIds = boundedNodeIds(input.changedNodeIds ?? []);
  const warnings = boundedList(input.warnings ?? [], MAX_WARNINGS);
  const facts = outcomeFacts(input);
  const status = statusForOutcome(input.outcome);
  const code = codeForOutcome(input.outcome, input.code);
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
  const visible = new Set<NodeId>();
  const root = renderRoot(tree);
  collectVisible(tree, root, visible, new Set<NodeId>());
  return visible;
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

function collectVisible(
  tree: FacetTree,
  nodeId: NodeId,
  visible: Set<NodeId>,
  seen: Set<NodeId>,
): void {
  if (seen.has(nodeId)) return;
  seen.add(nodeId);
  const node = tree.nodes[nodeId];
  if (node === undefined) return;
  if (node.type === "box" && node.hidden === true) return;
  visible.add(nodeId);
  if (node.type !== "box") return;
  for (const childId of node.children) collectVisible(tree, childId, visible, seen);
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

function stageMetadataChanged(before: FacetTree, after: FacetTree): boolean {
  return (
    before.root !== after.root ||
    before.entry !== after.entry ||
    before.theme !== after.theme ||
    stableJson(before.screens) !== stableJson(after.screens)
  );
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
    (value["code"] === undefined || isErrorCode(value["code"]))
  ) {
    return hasCoherentOutcome(value as unknown as AgentToolObservationData);
  }
  return false;
}

function isStatus(value: unknown): value is AgentToolObservationStatus {
  return value === "ok" || value === "error" || value === "pending";
}

function isOutcome(value: unknown): value is AgentToolOutcome {
  return (
    value === "applied_visible" ||
    value === "applied_not_visible" ||
    value === "applied_with_warnings" ||
    value === "pending" ||
    value === "rejected" ||
    value === "no_stage_change"
  );
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
  return (
    value === "unknown_tool" ||
    value === "invalid_input" ||
    value === "invalid_tree" ||
    value === "invalid_parent" ||
    value === "invalid_stamp" ||
    value === "patch_limit" ||
    value === "fold_error" ||
    value === "pending"
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
