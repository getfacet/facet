// @facet/reference-agent: provider adapters, prompt policy, the bounded
// harness loop, and the deterministic test fixture.
export * from "./provider.js";
export {
  DEFAULT_GUIDE,
  DEFAULT_STAGE_JSON_CHAR_LIMIT,
  DEFAULT_STAGE_SUMMARY_NODE_LIMIT,
  HISTORY_TURNS,
  TOOLS,
  buildInitialMessages,
  buildSystem,
  describeEvent,
  formatCurrentStageForPrompt,
  summarizeStageForPrompt,
} from "./prompt.js";
export type {
  FacetStageToolName,
  FacetStageToolSpec,
  PromptAssets,
  StageSummaryOptions,
  ToolInputByName,
} from "./prompt.js";
export { createReferenceAgent } from "./agent.js";
export type { ReferenceAgentAssetSource, ReferenceAgentOptions } from "./agent.js";
export * from "./stub.js";
export * from "./harness/budget.js";
export * from "./harness/trace.js";
export {
  createProviderSummarizer,
  summaryBlockMessage,
  validateSummary,
} from "./harness/summary.js";
export type { ConversationSummary, Summarizer, SummarizerRequest } from "./harness/summary.js";
export {
  CHARS_PER_TOKEN_DEFAULT,
  createTokenEstimator,
  estimateTurnChars,
} from "./harness/estimate.js";
export type { TokenEstimator } from "./harness/estimate.js";
export { REFERENCE_AGENT_FAILURE_SAY } from "./harness/loop.js";
export type { ReferenceAgentLoopSummary } from "./harness/loop.js";
export {
  FACET_STAGE_TOOL_NAMES,
  FACET_STAGE_TOOL_SPECS,
  getStageToolSpec,
} from "@facet/agent-tools";
