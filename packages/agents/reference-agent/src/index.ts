// @facet/reference-agent: provider adapters, prompt policy, the bounded
// harness loop, and the deterministic test fixture.

export { createReferenceAgent } from "./agent.js";
export type { ReferenceAgentOptions } from "./agent.js";

export { REFERENCE_AGENT_FALLBACK_TEXT } from "./harness/loop.js";
export type { ReferenceAgentLoopSummary } from "./harness/loop.js";

export { measureChars } from "./harness/measure.js";

export {
  DEFAULT_REFERENCE_AGENT_BUDGET_PRESET,
  MIN_REFERENCE_AGENT_OBSERVATION_CHARS,
  REFERENCE_AGENT_BUDGET_PRESETS,
  REFERENCE_AGENT_NON_RETRYABLE_HTTP_STATUSES,
  REFERENCE_AGENT_RETRYABLE_HTTP_STATUSES,
  REFERENCE_AGENT_STOP_REASONS,
  classifyProviderFailure,
  effectiveCharBudget,
  isRetryableProviderFailure,
  normalizeBudget,
} from "./harness/budget.js";
export type {
  ReferenceAgentBudget,
  ReferenceAgentBudgetOptions,
  ReferenceAgentBudgetOverrides,
  ReferenceAgentBudgetPreset,
  ReferenceAgentProviderFailureClassification,
  ReferenceAgentProviderFailureReason,
  ReferenceAgentStopReason,
} from "./harness/budget.js";

export {
  createProviderSummarizer,
  summaryBlockMessage,
  validateSummary,
} from "./harness/summary.js";
export type { ConversationSummary, Summarizer, SummarizerRequest } from "./harness/summary.js";

export {
  REFERENCE_AGENT_TRACE_EVENT_TYPES,
  emitReferenceAgentTrace,
  sanitizeReferenceAgentTraceEvent,
} from "./harness/trace.js";
export type {
  ReferenceAgentBatchYieldTraceEvent,
  ReferenceAgentCompactionDoneTraceEvent,
  ReferenceAgentCompactionFailReason,
  ReferenceAgentCompactionFailedTraceEvent,
  ReferenceAgentCompactionSite,
  ReferenceAgentCompactionTriggeredTraceEvent,
  ReferenceAgentContextCompactedTraceEvent,
  ReferenceAgentProviderAttemptTraceEvent,
  ReferenceAgentProviderRetryTraceEvent,
  ReferenceAgentProviderStepTraceEvent,
  ReferenceAgentStopTraceEvent,
  ReferenceAgentToolResultTraceEvent,
  ReferenceAgentTrace,
  ReferenceAgentTraceEvent,
  ReferenceAgentTraceEventType,
  ReferenceAgentTraceStageMode,
  ReferenceAgentTurnErrorTraceEvent,
  ReferenceAgentTurnStartTraceEvent,
} from "./harness/trace.js";

export type {
  ReferenceAgentDiagnosticEvent,
  ReferenceAgentDiagnosticObserver,
} from "./harness/diagnostic-observer.js";

export {
  DEFAULT_GUIDE,
  DEFAULT_STAGE_MARKUP_CHAR_LIMIT,
  DEFAULT_STAGE_SUMMARY_NODE_LIMIT,
  HISTORY_TURNS,
  TOOLS,
  buildInitialMessages,
  buildSystem,
  describeEvent,
  formatCurrentStageForPrompt,
  summarizeStageForPrompt,
} from "./prompt.js";
export type { StageSummaryOptions } from "./prompt.js";

export { STUB_MARKUP, createStubAgent } from "./stub.js";

export {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  TURN_TIMEOUT_MS,
  createAnthropicProvider,
  createOpenAiProvider,
  resolveProvider,
} from "./provider.js";
export type {
  ProviderOptions,
  ProviderRunContext,
  ProviderStep,
  ProviderTurn,
  ProviderUsage,
  ReferenceProvider,
  ResolveProviderFlags,
  ToolCall,
  ToolInputSchema,
  ToolSpec,
  TurnMessage,
} from "./provider.js";
