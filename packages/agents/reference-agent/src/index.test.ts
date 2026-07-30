import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import * as reference from "./index.js";
import type {
  ConversationSummary,
  ProviderOptions,
  ProviderRunContext,
  ProviderStep,
  ProviderTurn,
  ProviderUsage,
  ReferenceAgentBudget,
  ReferenceAgentBudgetOptions,
  ReferenceAgentBudgetOverrides,
  ReferenceAgentBudgetPreset,
  ReferenceAgentDiagnosticEvent,
  ReferenceAgentDiagnosticObserver,
  ReferenceAgentLoopSummary,
  ReferenceAgentOptions,
  ReferenceAgentProviderFailureClassification,
  ReferenceAgentProviderFailureReason,
  ReferenceAgentStopReason,
  ReferenceAgentTrace,
  ReferenceAgentTraceEvent,
  ReferenceAgentTraceEventType,
  ReferenceProvider,
  ResolveProviderFlags,
  StageSummaryOptions,
  Summarizer,
  SummarizerRequest,
  ToolCall,
  ToolInputSchema,
  ToolSpec,
  TurnMessage,
} from "./index.js";

const RUNTIME_EXPORTS = [
  "DEFAULT_ANTHROPIC_MODEL",
  "DEFAULT_GUIDE",
  "DEFAULT_OPENAI_MODEL",
  "DEFAULT_REFERENCE_AGENT_BUDGET_PRESET",
  "DEFAULT_STAGE_MARKUP_CHAR_LIMIT",
  "DEFAULT_STAGE_SUMMARY_NODE_LIMIT",
  "HISTORY_TURNS",
  "MIN_REFERENCE_AGENT_OBSERVATION_CHARS",
  "REFERENCE_AGENT_BUDGET_PRESETS",
  "REFERENCE_AGENT_FALLBACK_TEXT",
  "REFERENCE_AGENT_NON_RETRYABLE_HTTP_STATUSES",
  "REFERENCE_AGENT_RETRYABLE_HTTP_STATUSES",
  "REFERENCE_AGENT_STOP_REASONS",
  "REFERENCE_AGENT_TRACE_EVENT_TYPES",
  "STUB_MARKUP",
  "TOOLS",
  "TURN_TIMEOUT_MS",
  "buildInitialMessages",
  "buildSystem",
  "classifyProviderFailure",
  "createAnthropicProvider",
  "createOpenAiProvider",
  "createProviderSummarizer",
  "createReferenceAgent",
  "createStubAgent",
  "describeEvent",
  "effectiveCharBudget",
  "emitReferenceAgentTrace",
  "formatCurrentStageForPrompt",
  "isRetryableProviderFailure",
  "measureChars",
  "normalizeBudget",
  "resolveProvider",
  "sanitizeReferenceAgentTraceEvent",
  "summarizeStageForPrompt",
  "summaryBlockMessage",
  "validateSummary",
] as const;

const CONTRACT_KEYS = [
  "createReferenceAgent",
  "ReferenceAgentOptions",
  "REFERENCE_AGENT_FALLBACK_TEXT",
  "ReferenceAgentLoopSummary",
  "measureChars",
  "ReferenceAgentBudget",
  "ReferenceAgentBudgetOptions",
  "ReferenceAgentBudgetOverrides",
  "ReferenceAgentBudgetPreset",
  "DEFAULT_REFERENCE_AGENT_BUDGET_PRESET",
  "REFERENCE_AGENT_BUDGET_PRESETS",
  "REFERENCE_AGENT_STOP_REASONS",
  "ReferenceAgentStopReason",
  "ReferenceAgentProviderFailureReason",
  "ReferenceAgentProviderFailureClassification",
  "REFERENCE_AGENT_RETRYABLE_HTTP_STATUSES",
  "REFERENCE_AGENT_NON_RETRYABLE_HTTP_STATUSES",
  "MIN_REFERENCE_AGENT_OBSERVATION_CHARS",
  "normalizeBudget",
  "effectiveCharBudget",
  "classifyProviderFailure",
  "isRetryableProviderFailure",
  "createProviderSummarizer",
  "summaryBlockMessage",
  "validateSummary",
  "ConversationSummary",
  "Summarizer",
  "SummarizerRequest",
  "REFERENCE_AGENT_TRACE_EVENT_TYPES",
  "ReferenceAgentTraceEventType",
  "ReferenceAgentTraceStageMode",
  "ReferenceAgentCompactionSite",
  "ReferenceAgentCompactionFailReason",
  "ReferenceAgentTurnStartTraceEvent",
  "ReferenceAgentContextCompactedTraceEvent",
  "ReferenceAgentProviderAttemptTraceEvent",
  "ReferenceAgentProviderRetryTraceEvent",
  "ReferenceAgentProviderStepTraceEvent",
  "ReferenceAgentToolResultTraceEvent",
  "ReferenceAgentBatchYieldTraceEvent",
  "ReferenceAgentStopTraceEvent",
  "ReferenceAgentTurnErrorTraceEvent",
  "ReferenceAgentCompactionTriggeredTraceEvent",
  "ReferenceAgentCompactionDoneTraceEvent",
  "ReferenceAgentCompactionFailedTraceEvent",
  "ReferenceAgentTraceEvent",
  "ReferenceAgentTrace",
  "emitReferenceAgentTrace",
  "sanitizeReferenceAgentTraceEvent",
  "ReferenceAgentDiagnosticEvent",
  "ReferenceAgentDiagnosticObserver",
  "DEFAULT_GUIDE",
  "DEFAULT_STAGE_MARKUP_CHAR_LIMIT",
  "DEFAULT_STAGE_SUMMARY_NODE_LIMIT",
  "HISTORY_TURNS",
  "TOOLS",
  "buildSystem",
  "buildInitialMessages",
  "describeEvent",
  "formatCurrentStageForPrompt",
  "summarizeStageForPrompt",
  "StageSummaryOptions",
  "STUB_MARKUP",
  "createStubAgent",
  "TURN_TIMEOUT_MS",
  "ProviderOptions",
  "ProviderRunContext",
  "ProviderStep",
  "ProviderTurn",
  "ProviderUsage",
  "ReferenceProvider",
  "ToolCall",
  "ToolInputSchema",
  "ToolSpec",
  "TurnMessage",
  "DEFAULT_OPENAI_MODEL",
  "createOpenAiProvider",
  "DEFAULT_ANTHROPIC_MODEL",
  "createAnthropicProvider",
  "resolveProvider",
  "ResolveProviderFlags",
] as const;

describe("reference-agent barrel", () => {
  it("exports exactly the runtime half of Barrel Export Contract list 11", () => {
    expect(Object.keys(reference).sort()).toEqual([...RUNTIME_EXPORTS].sort());
    expect(CONTRACT_KEYS).toHaveLength(81);

    for (const forbidden of [
      "REFERENCE_AGENT_FAILURE_SAY",
      "ReferenceAgentAssetSource",
      "PromptAssets",
      "FacetStageToolName",
      "FacetStageToolSpec",
      "ToolInputByName",
      "CHARS_PER_TOKEN_DEFAULT",
      "createTokenEstimator",
      "estimateTurnChars",
      "TokenEstimator",
      "FACET_STAGE_TOOL_NAMES",
      "FACET_STAGE_TOOL_SPECS",
      "getStageToolSpec",
      "STUB_TREE",
      "createReferenceAgentWithDependencies",
    ]) {
      expect(reference).not.toHaveProperty(forbidden);
    }
  });

  it("keeps index.ts as an explicit named barrel with no retired re-exports", () => {
    const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

    expect(source).not.toMatch(/export\s+\*/u);
    expect(source).not.toContain("./harness/estimate.js");
    expect(source).not.toContain("REFERENCE_AGENT_FAILURE_SAY");
    expect(source).not.toContain("FACET_STAGE_TOOL");
    expect(source).not.toContain("PromptAssets");
  });

  it("types the exported post-cut contract rows", () => {
    expectTypeOf<ReferenceAgentOptions>().toMatchTypeOf<{
      readonly provider: ReferenceProvider;
      readonly sink: { readonly history: unknown; readonly record: unknown };
      readonly agentId: string;
      readonly budgetPreset?: ReferenceAgentBudgetPreset;
      readonly budget?: ReferenceAgentBudgetOverrides;
      readonly trace?: ReferenceAgentTrace;
      readonly diagnosticObserver?: ReferenceAgentDiagnosticObserver;
    }>();
    expectTypeOf<
      "assets" extends keyof ReferenceAgentOptions ? true : false
    >().toEqualTypeOf<false>();

    expectTypeOf<ReferenceAgentBudgetOptions>().toMatchTypeOf<{
      readonly budgetPreset?: ReferenceAgentBudgetPreset;
      readonly budget?: ReferenceAgentBudgetOverrides;
      readonly maxSteps?: number;
      readonly historyTurns?: number;
    }>();
    expectTypeOf<ReferenceAgentBudget>().toMatchTypeOf<{
      readonly maxContextChars: number;
      readonly maxHistoryChars: number;
      readonly maxSummaryChars: number;
      readonly contextWindowCharsDefault: number;
    }>();
    expectTypeOf<ReferenceAgentProviderFailureReason>().toMatchTypeOf<string>();
    expectTypeOf<ReferenceAgentProviderFailureClassification>().toMatchTypeOf<{
      readonly retryable: boolean;
    }>();
    expectTypeOf<ReferenceAgentStopReason>().toEqualTypeOf<
      | "provider_stop"
      | "max_steps"
      | "tool_call_limit"
      | "context_limit"
      | "provider_error"
      | "retry_exhausted"
      | "sink_error"
      | "unresolved_buffer"
      | "empty_turn"
    >();

    expectTypeOf<ConversationSummary>().toMatchTypeOf<{ readonly version: 1 }>();
    expectTypeOf<Summarizer>().toMatchTypeOf<
      (request: SummarizerRequest) => Promise<ConversationSummary | undefined>
    >();
    expectTypeOf<SummarizerRequest>().toMatchTypeOf<{
      readonly kind: "history" | "transcript";
      readonly maxSummaryChars: number;
    }>();

    expectTypeOf<ReferenceAgentTraceEventType>().toEqualTypeOf<
      | "turn_start"
      | "context_compacted"
      | "provider_attempt"
      | "provider_retry"
      | "provider_step"
      | "tool_result"
      | "batch_yield"
      | "stop"
      | "turn_error"
      | "compaction_triggered"
      | "compaction_done"
      | "compaction_failed"
    >();
    expectTypeOf<ReferenceAgentTraceEvent>().toMatchTypeOf<{
      readonly type: ReferenceAgentTraceEventType;
    }>();
    expectTypeOf<ReferenceAgentDiagnosticEvent>().toMatchTypeOf<{ readonly kind: string }>();
    expectTypeOf<StageSummaryOptions>().toMatchTypeOf<{
      readonly maxMarkupChars?: number;
      readonly maxSummaryNodes?: number;
    }>();
    expectTypeOf<ReferenceAgentLoopSummary>().toMatchTypeOf<{
      readonly stopReason: ReferenceAgentStopReason;
      readonly stepCount: number;
      readonly toolCallCount: number;
    }>();

    expectTypeOf<ToolSpec>().toMatchTypeOf<{
      readonly name: string;
      readonly description: string;
      readonly inputSchema: ToolInputSchema;
    }>();
    expectTypeOf<ToolInputSchema>().toMatchTypeOf<{
      readonly type: "object";
      readonly properties: Readonly<Record<string, unknown>>;
    }>();
    expectTypeOf<ToolCall>().toMatchTypeOf<{
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }>();
    expectTypeOf<ProviderStep>().toMatchTypeOf<{
      readonly text: string;
      readonly toolCalls: readonly ToolCall[];
    }>();
    expectTypeOf<ProviderTurn>().toMatchTypeOf<{
      readonly system: string;
      readonly messages: readonly TurnMessage[];
    }>();
    expectTypeOf<ProviderOptions>().toMatchTypeOf<{ readonly timeoutMs?: number }>();
    expectTypeOf<ProviderRunContext>().toMatchTypeOf<{ readonly signal?: AbortSignal }>();
    expectTypeOf<ProviderUsage>().toMatchTypeOf<{
      readonly inputTokens?: number;
      readonly outputTokens?: number;
    }>();
    expectTypeOf<ResolveProviderFlags>().toMatchTypeOf<{ readonly provider?: string }>();
  });
});
