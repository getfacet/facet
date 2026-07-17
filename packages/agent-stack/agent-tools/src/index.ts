export {
  FACET_STAGE_TOOL_NAMES,
  FACET_STAGE_TOOL_SPECS,
  TOOLS,
  getStageToolSpec,
} from "./specs.js";
export type { FacetStageToolSpec } from "./specs.js";
export { createStageToolAssetSnapshot } from "./asset-snapshot.js";
export { selectPatternReference } from "./pattern-references.js";
export {
  FACET_AGENT_ROLE_PROMPT,
  FACET_ASSET_PRIVACY_PROMPT,
  FACET_DATA_BINDING_PROMPT,
  FACET_PAGE_BRIEF_HEADING,
  FACET_PAGE_EXPERIENCE_PROMPT,
  FACET_POLISHED_BRICK_GUIDANCE_PROMPT,
  FACET_STATE_EDITING_PROMPT,
  FACET_TOOL_PLAYBOOK_PROMPT,
  FACET_TOOL_RESULT_CONTRACT_PROMPT,
  buildFacetAgentSystemPrompt,
} from "./prompt-kit.js";
export type { FacetAgentSystemPromptOptions, FacetPromptAssets } from "./prompt-kit.js";
export {
  changedNodeIdsBetween,
  foldStageShadow,
  summarizeStageChange,
  summarizeStageTree,
} from "./stage-shadow.js";
export {
  formatAgentToolObservation,
  isVisitorVisibleStageChange,
  parseAgentToolObservation,
  visibleStageNodeIds,
} from "./observation.js";
export { createStageToolBuffer } from "./buffer.js";
export type { StageToolBuffer, StageToolBufferOutcome } from "./buffer.js";
export { executeStageTool } from "./executor.js";
export type {
  StageChangeSummaryOptions,
  StageShadowFoldResult,
  StageTreeSummary,
} from "./stage-shadow.js";
export type {
  AppendNodeToolInput,
  AgentToolObservationData,
  AgentToolObservationStatus,
  AgentToolOutcome,
  BrickIndexEntry,
  FacetStageToolName,
  GetBrickSpecToolInput,
  GetPatternToolInput,
  GetPresetToolInput,
  GetStyleChoicesToolInput,
  InspectNodeToolInput,
  InspectStageToolInput,
  PatternIndexEntry,
  PresetIndexEntry,
  RemoveNodeToolInput,
  RenderPageToolInput,
  SayToolInput,
  SetNodeToolInput,
  StageToolAssetSource,
  StageToolAssets,
  StageToolAuthorIssue,
  StageToolContext,
  StageToolErrorCode,
  StageToolErrorResult,
  StageToolObservation,
  StageToolOkResult,
  StageToolResult,
  StageToolStatus,
  ToolCall,
  ToolInputByName,
  ToolSpec,
} from "./types.js";
