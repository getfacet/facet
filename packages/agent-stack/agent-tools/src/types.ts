import type {
  FacetNode,
  FacetStamp,
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
  | "use_stamp"
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

export interface UseStampToolInput {
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
  readonly "render_page": RenderPageToolInput;
  readonly "append_node": AppendNodeToolInput;
  readonly "use_stamp": UseStampToolInput;
  readonly "set_node": SetNodeToolInput;
  readonly "remove_node": RemoveNodeToolInput;
  readonly "say": SayToolInput;
  readonly "set_theme": SetThemeToolInput;
  readonly "inspect_stage": InspectStageToolInput;
  readonly "inspect_node": InspectNodeToolInput;
}

export interface StageToolAssets {
  readonly themes?: readonly FacetTheme[];
  readonly stamps?: readonly FacetStamp[];
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
  | "invalid_stamp"
  | "patch_limit"
  | "fold_error";

export interface StageToolObservation {
  readonly status: StageToolStatus;
  readonly text: string;
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
