import type {
  AuthorIssue,
  BrickType,
  FacetNode,
  FacetPattern,
  FacetTheme,
  FacetTree,
  JsonPatchOperation,
  NodeId,
  ServerMessage,
} from "@facet/core";

/** A provider-neutral JSON Schema object offered to a model as a callable tool. */
export interface ToolSpec<Name extends string = string> {
  readonly name: Name;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** One parsed tool call from any model/provider adapter. */
export interface ToolCall<Name extends string = string, Input = unknown> {
  readonly id: string;
  readonly name: Name;
  readonly input: Input;
}

export type FacetStageToolName =
  | "render_page"
  | "append_node"
  | "set_node"
  | "remove_node"
  | "say"
  | "get_brick_spec"
  | "get_style_choices"
  | "get_preset"
  | "get_pattern"
  | "inspect_stage"
  | "inspect_node";

export interface RenderPageToolInput {
  readonly tree: FacetTree;
}

export interface AppendNodeToolInput {
  readonly parentId: NodeId;
  readonly ["node"]: FacetNode;
}

export interface SetNodeToolInput {
  readonly ["node"]: FacetNode;
}

export interface RemoveNodeToolInput {
  readonly nodeId: NodeId;
}

export interface SayToolInput {
  readonly text: string;
}

export interface GetBrickSpecToolInput {
  readonly type: BrickType;
}

export interface GetStyleChoicesToolInput {
  readonly brick: BrickType;
  readonly target: string;
  readonly property: string;
}

export interface GetPresetToolInput {
  readonly brick: BrickType;
  readonly name: string;
}

export interface GetPatternToolInput {
  readonly name: string;
}

export interface InspectStageToolInput {
  readonly maxNodes?: number;
}

export interface InspectNodeToolInput {
  readonly nodeId: NodeId;
  readonly depth?: number;
}

export interface ToolInputByName {
  readonly render_page: RenderPageToolInput;
  readonly ["append_node"]: AppendNodeToolInput;
  readonly ["set_node"]: SetNodeToolInput;
  readonly ["remove_node"]: RemoveNodeToolInput;
  readonly say: SayToolInput;
  readonly ["get_brick_spec"]: GetBrickSpecToolInput;
  readonly ["get_style_choices"]: GetStyleChoicesToolInput;
  readonly ["get_preset"]: GetPresetToolInput;
  readonly ["get_pattern"]: GetPatternToolInput;
  readonly inspect_stage: InspectStageToolInput;
  readonly ["inspect_node"]: InspectNodeToolInput;
}

/** Validated asset data offered by a static or per-turn dynamic host source. */
export interface StageToolAssetSource {
  readonly theme: FacetTheme;
  readonly patterns: readonly FacetPattern[];
}

export interface BrickIndexEntry {
  readonly type: BrickType;
  readonly description: string;
  readonly useWhen: string;
}

export interface PresetIndexEntry {
  readonly brick: BrickType;
  readonly name: string;
  readonly description: string;
  readonly useWhen: string;
}

export interface PatternIndexEntry {
  readonly name: string;
  readonly description: string;
  readonly useWhen: string;
}

/** One exact, immutable Theme/Preset/Pattern view shared for a provider turn. */
export interface StageToolAssets extends StageToolAssetSource {
  readonly brickIndex: readonly BrickIndexEntry[];
  readonly presetIndex: readonly PresetIndexEntry[];
  readonly patternIndex: readonly PatternIndexEntry[];
}

export interface StageToolContext {
  /** The executor's local view of the stage for this provider turn. */
  readonly shadow: FacetTree;
  readonly assets?: StageToolAssets;
}

export const STAGE_TOOL_STATUSES = ["ok", "error"] as const;
export type StageToolStatus = (typeof STAGE_TOOL_STATUSES)[number];

export const STAGE_TOOL_ERROR_CODES = [
  "unknown_tool",
  "invalid_input",
  "invalid_tree",
  "invalid_parent",
  "invalid_authoring",
  "not_available",
  "patch_limit",
  "fold_error",
] as const;
export type StageToolErrorCode = (typeof STAGE_TOOL_ERROR_CODES)[number];

/** Public structured repair item returned for strict authoring failures. */
export type StageToolAuthorIssue = AuthorIssue;

export const AGENT_TOOL_OBSERVATION_STATUSES = [...STAGE_TOOL_STATUSES, "pending"] as const;
export type AgentToolObservationStatus = (typeof AGENT_TOOL_OBSERVATION_STATUSES)[number];

export const AGENT_TOOL_OUTCOMES = [
  "applied_visible",
  "applied_not_visible",
  "applied_with_warnings",
  "pending",
  "rejected",
  "no_stage_change",
] as const;
export type AgentToolOutcome = (typeof AGENT_TOOL_OUTCOMES)[number];

export const AGENT_TOOL_OBSERVATION_ERROR_CODES = [...STAGE_TOOL_ERROR_CODES, "pending"] as const;

export interface AgentToolObservationData {
  readonly version: 1;
  readonly tool: string;
  readonly status: AgentToolObservationStatus;
  readonly outcome: AgentToolOutcome;
  readonly applied: boolean;
  readonly stage_changed: boolean;
  readonly visible_to_visitor: boolean;
  readonly patch_count: number;
  readonly changed_node_ids: readonly NodeId[];
  readonly omitted_changed_node_count: number;
  readonly warnings: readonly string[];
  readonly omitted_warning_count: number;
  readonly message: string;
  readonly next_action: string;
  readonly summary: string;
  readonly code?: StageToolErrorCode | "pending";
  readonly errors?: readonly StageToolAuthorIssue[];
  readonly omitted_error_count?: number;
  /**
   * Always-valid JSON payload for machine-readable tool metadata. Generic tool
   * observations keep this bounded; exact asset reads carry their selected
   * unresolved data through package-private formatters.
   */
  readonly data?: string;
}

export interface StageToolObservation {
  readonly status: AgentToolObservationStatus;
  readonly text: string;
  readonly data?: AgentToolObservationData;
}

export interface StageToolOkResult {
  readonly status: "ok";
  readonly observation: StageToolObservation;
  readonly messages: readonly ServerMessage[];
  readonly patches: readonly JsonPatchOperation[];
  readonly changedNodeIds: readonly NodeId[];
  readonly patchCount: number;
  readonly summary: string;
  readonly shadow: FacetTree;
  readonly issues: readonly string[];
}

export interface StageToolErrorResult {
  readonly status: "error";
  readonly code: StageToolErrorCode;
  readonly observation: StageToolObservation;
  readonly messages: readonly ServerMessage[];
  readonly patches: readonly JsonPatchOperation[];
  readonly changedNodeIds: readonly NodeId[];
  readonly patchCount: 0;
  readonly summary: string;
  readonly shadow: FacetTree;
  readonly issues: readonly string[];
}

export type StageToolResult = StageToolOkResult | StageToolErrorResult;
