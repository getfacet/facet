import { describe, expect, expectTypeOf, it } from "vitest";

import type { FacetPattern, FacetTheme } from "@facet/core";
import * as reference from "./index.js";
import type {
  ReferenceAgentBudget,
  ReferenceAgentBudgetOptions,
  ReferenceAgentBudgetOverrides,
  ReferenceAgentBudgetPreset,
  ReferenceAgentLoopSummary,
  ProviderOptions,
  ProviderStep,
  ProviderTurn,
  PromptAssets,
  ReferenceAgentAssetSource,
  ReferenceAgentOptions,
  ReferenceAgentStopReason,
  ReferenceAgentTrace,
  ReferenceAgentTraceEvent,
  ReferenceAgentTraceEventType,
  ResolveProviderFlags,
  ToolCall,
  ToolSpec,
  TurnMessage,
} from "./index.js";

// The removed legacy option key, assembled at the type level so the token
// never appears as a contiguous source literal (see theme.test.ts).
type LegacyAssetsKey = `st${"amps"}`;
type LegacyCatalogKey = `cata${"log"}`;
type LegacyCompositionsKey = `compo${"sitions"}`;
type LegacyThemesKey = `the${"mes"}`;

describe("reference-agent barrel", () => {
  it("exports the canonical reference-agent surface without Quickstart aliases", () => {
    expect(reference).not.toHaveProperty("createQuickstartAgent");
    expect(reference).not.toHaveProperty("__resetCompactionCooldownForTests");
    expect(reference).not.toHaveProperty("resetBackgroundCompactionForTests");
    expect(reference).not.toHaveProperty("createReferenceAgentWithDependencies");

    const runtimeExports = [
      "createReferenceAgent",
      "resolveProvider",
      "DEFAULT_OPENAI_MODEL",
      "DEFAULT_ANTHROPIC_MODEL",
      "TURN_TIMEOUT_MS",
      "createOpenAiProvider",
      "createAnthropicProvider",
      "HISTORY_TURNS",
      "DEFAULT_GUIDE",
      "buildSystem",
      "TOOLS",
      "describeEvent",
      "buildInitialMessages",
      "STUB_TREE",
      "createStubAgent",
    ] as const;

    for (const name of runtimeExports) {
      expect(reference).toHaveProperty(name);
    }
  });

  it("types every canonical export row", () => {
    expectTypeOf<
      "summarizerFactory" extends keyof ReferenceAgentOptions ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "onBackgroundTask" extends keyof ReferenceAgentOptions ? true : false
    >().toEqualTypeOf<false>();

    expectTypeOf<ToolSpec>().toMatchTypeOf<{
      readonly name: string;
      readonly description: string;
      readonly parameters: Readonly<Record<string, unknown>>;
    }>();
    expectTypeOf<typeof reference.TOOLS>().toEqualTypeOf<readonly ToolSpec[]>();
    expectTypeOf<ToolCall>().toMatchTypeOf<{
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }>();
    expectTypeOf<ProviderStep>().toMatchTypeOf<{
      readonly text: string;
      readonly toolCalls: readonly ToolCall[];
    }>();
    expectTypeOf<TurnMessage>().toMatchTypeOf<
      | { readonly role: "user"; readonly content: string }
      | { readonly role: "assistant"; readonly content: string }
      | {
          readonly role: "assistant_tools";
          readonly text: string;
          readonly toolCalls: readonly ToolCall[];
        }
      | { readonly role: "tool_result"; readonly callId: string; readonly content: string }
    >();
    expectTypeOf<ProviderTurn>().toMatchTypeOf<{
      readonly system: string;
      readonly messages: readonly TurnMessage[];
    }>();
    expectTypeOf<ProviderOptions>().toMatchTypeOf<{ readonly timeoutMs?: number }>();
    expectTypeOf<ResolveProviderFlags>().toMatchTypeOf<{ readonly provider?: string }>();
    expectTypeOf<PromptAssets>().toMatchTypeOf<{
      readonly theme: FacetTheme;
      readonly patterns: readonly FacetPattern[];
    }>();
  });

  it("pins one per-turn Theme and Pattern asset surface with old options absent", () => {
    expectTypeOf<
      "assets" extends keyof ReferenceAgentOptions ? true : false
    >().toEqualTypeOf<true>();
    expectTypeOf<ReferenceAgentOptions>().toMatchTypeOf<{
      readonly assets: ReferenceAgentAssetSource;
    }>();
    expectTypeOf<PromptAssets["theme"]>().toEqualTypeOf<FacetTheme>();
    expectTypeOf<PromptAssets["patterns"]>().toEqualTypeOf<readonly FacetPattern[]>();
    expectTypeOf<ReferenceAgentAssetSource>().toEqualTypeOf<
      NonNullable<ReferenceAgentOptions["assets"]>
    >();
    expect(reference.FACET_STAGE_TOOL_NAMES).toContain("get_pattern");
    expect(reference.FACET_STAGE_TOOL_NAMES).toContain("get_preset");
    const retiredTools = [["get", "composition"].join("_"), ["set", "theme"].join("_")];
    for (const tool of retiredTools) expect(reference.FACET_STAGE_TOOL_NAMES).not.toContain(tool);

    expectTypeOf<
      LegacyAssetsKey extends keyof ReferenceAgentOptions ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      LegacyAssetsKey extends keyof PromptAssets ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      LegacyCatalogKey extends keyof ReferenceAgentOptions ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      LegacyCatalogKey extends keyof PromptAssets ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      LegacyCompositionsKey extends keyof ReferenceAgentOptions ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      LegacyCompositionsKey extends keyof PromptAssets ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      LegacyThemesKey extends keyof ReferenceAgentOptions ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      LegacyThemesKey extends keyof PromptAssets ? true : false
    >().toEqualTypeOf<false>();
  });

  it("exports the reference harness compatibility surface", () => {
    const harnessRuntimeExports = [
      "DEFAULT_REFERENCE_AGENT_BUDGET_PRESET",
      "REFERENCE_AGENT_BUDGET_PRESETS",
      "REFERENCE_AGENT_STOP_REASONS",
      "REFERENCE_AGENT_RETRYABLE_HTTP_STATUSES",
      "REFERENCE_AGENT_NON_RETRYABLE_HTTP_STATUSES",
      "normalizeBudget",
      "classifyProviderFailure",
      "isRetryableProviderFailure",
      "REFERENCE_AGENT_TRACE_EVENT_TYPES",
      "emitReferenceAgentTrace",
      "sanitizeReferenceAgentTraceEvent",
      "REFERENCE_AGENT_FAILURE_SAY",
      "FACET_STAGE_TOOL_NAMES",
      "FACET_STAGE_TOOL_SPECS",
      "getStageToolSpec",
    ] as const;

    for (const name of harnessRuntimeExports) {
      expect(reference).toHaveProperty(name);
    }

    expect(reference).not.toHaveProperty("executeStageTool");

    expectTypeOf<ReferenceAgentOptions>().toMatchTypeOf<{
      readonly budgetPreset?: ReferenceAgentBudgetPreset;
      readonly budget?: ReferenceAgentBudgetOverrides;
      readonly trace?: ReferenceAgentTrace;
    }>();
    expectTypeOf<ReferenceAgentBudgetOptions>().toMatchTypeOf<{
      readonly budgetPreset?: ReferenceAgentBudgetPreset;
      readonly budget?: ReferenceAgentBudgetOverrides;
      readonly maxSteps?: number;
      readonly historyTurns?: number;
    }>();
    expectTypeOf<ReferenceAgentBudget>().toMatchTypeOf<{
      readonly maxSteps: number;
      readonly maxToolCallsPerStep: number;
      readonly maxContextChars: number;
      readonly maxHistoryTurns: number;
      readonly maxHistoryChars: number;
      readonly maxStageJsonChars: number;
      readonly maxStageSummaryNodes: number;
      readonly maxObservationChars: number;
      readonly maxFinalTextChars: number;
      readonly maxProviderRetries: number;
      readonly retryBackoffMs: number;
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
    expectTypeOf<ReferenceAgentLoopSummary>().toMatchTypeOf<{
      readonly stopReason: ReferenceAgentStopReason;
      readonly stepCount: number;
      readonly toolCallCount: number;
    }>();
  });
});
