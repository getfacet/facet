import type {
  FacetNode,
  FacetCatalog,
  FacetComposition,
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
  | "use_composition"
  | "set_node"
  | "remove_node"
  | "say"
  | "set_theme"
  | "inspect_stage"
  | "inspect_node";

export interface RenderPageToolInput {
  readonly tree: FacetTree;
}

export interface AppendNodeToolInput {
  readonly parentId: NodeId;
  readonly ["node"]: FacetNode;
}

export interface UseCompositionToolInput {
  readonly name: string;
  readonly params: Readonly<Record<string, string>>;
  readonly at: {
    readonly parent: NodeId;
  };
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

export interface SetThemeToolInput {
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
  readonly use_composition: UseCompositionToolInput;
  readonly ["set_node"]: SetNodeToolInput;
  readonly ["remove_node"]: RemoveNodeToolInput;
  readonly say: SayToolInput;
  readonly set_theme: SetThemeToolInput;
  readonly inspect_stage: InspectStageToolInput;
  readonly ["inspect_node"]: InspectNodeToolInput;
}

export interface StageToolAssets {
  readonly themes?: readonly FacetTheme[];
  readonly compositions?: readonly FacetComposition[];
  readonly catalog?: FacetCatalog;
}

export interface StageToolContext {
  /** The executor's local view of the stage for this provider turn. */
  readonly shadow: FacetTree;
  readonly assets?: StageToolAssets;
}

export type StageToolStatus = "ok" | "error";

export type StageToolErrorCode =
  | "unknown_tool"
  | "invalid_input"
  | "invalid_tree"
  | "invalid_parent"
  | "invalid_composition"
  | "patch_limit"
  | "fold_error";

export type AgentToolObservationStatus = StageToolStatus | "pending";

export type AgentToolOutcome =
  | "applied_visible"
  | "applied_not_visible"
  | "applied_with_warnings"
  | "pending"
  | "rejected"
  | "no_stage_change";

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
  /** Bounded, always-valid JSON payload for machine-readable tool metadata (e.g. minted composition ids). */
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
