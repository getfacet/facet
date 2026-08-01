import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_REFERENCE_AGENT_BUDGET_PRESET,
  MIN_REFERENCE_AGENT_OBSERVATION_CHARS,
  REFERENCE_AGENT_BUDGET_PRESETS,
  REFERENCE_AGENT_STOP_REASONS,
  classifyProviderFailure,
  effectiveCharBudget,
  normalizeBudget,
  type ReferenceAgentBudget,
  type ReferenceAgentStopReason,
} from "./budget.js";
import { measureChars } from "./measure.js";
import * as budgetModule from "./budget.js";

const COMPACTION_POLICY = {
  compactionTriggerRatio: 0.75,
  compactionTargetRatio: 0.5,
  minRecentTurnsVerbatim: 4,
  minRecentStepsVerbatim: 4,
  maxSummaryChars: 4_800,
  summarizerTimeoutMs: 30_000,
  summarizerRetries: 1,
  compactionCooldownSteps: 4,
  contextWindowCharsDefault: 400_000,
} as const;

const QUICKSTART_BUDGET = {
  maxSteps: 50,
  maxToolCallsPerStep: 32,
  maxContextChars: 96_000,
  maxHistoryTurns: 20,
  maxHistoryChars: 24_000,
  maxStageJsonChars: 48_000,
  maxStageSummaryNodes: 80,
  maxObservationChars: 4_000,
  maxFinalTextChars: 4_000,
  maxProviderRetries: 1,
  retryBackoffMs: 250,
  maxSummarizerInputChars: 48_000,
  ...COMPACTION_POLICY,
} satisfies ReferenceAgentBudget;

const HOSTED_BUDGET = {
  maxSteps: 120,
  maxToolCallsPerStep: 32,
  maxContextChars: 160_000,
  maxHistoryTurns: 40,
  maxHistoryChars: 48_000,
  maxStageJsonChars: 80_000,
  maxStageSummaryNodes: 160,
  maxObservationChars: 8_000,
  maxFinalTextChars: 8_000,
  maxProviderRetries: 2,
  retryBackoffMs: 500,
  maxSummarizerInputChars: 80_000,
  ...COMPACTION_POLICY,
} satisfies ReferenceAgentBudget;

const LOCAL_DEV_BUDGET = {
  maxSteps: 240,
  maxToolCallsPerStep: 64,
  maxContextChars: 240_000,
  maxHistoryTurns: 80,
  maxHistoryChars: 96_000,
  maxStageJsonChars: 120_000,
  maxStageSummaryNodes: 320,
  maxObservationChars: 12_000,
  maxFinalTextChars: 12_000,
  maxProviderRetries: 2,
  retryBackoffMs: 0,
  maxSummarizerInputChars: 120_000,
  ...COMPACTION_POLICY,
} satisfies ReferenceAgentBudget;

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function httpError(status: number): Error {
  return new Error(`openai request failed: HTTP ${status}`);
}

describe("reference-agent budget presets", () => {
  it("matches the Budget Profile Contract table exactly in characters", () => {
    expect(REFERENCE_AGENT_BUDGET_PRESETS).toEqual({
      quickstart: QUICKSTART_BUDGET,
      hosted: HOSTED_BUDGET,
      "local-dev": LOCAL_DEV_BUDGET,
    });
  });

  it("uses quickstart by default and requires hosted/local-dev opt-in", () => {
    expect(DEFAULT_REFERENCE_AGENT_BUDGET_PRESET).toBe("quickstart");
    expect(normalizeBudget()).toEqual(QUICKSTART_BUDGET);
    expect(normalizeBudget({})).toEqual(QUICKSTART_BUDGET);
    expect(normalizeBudget({ budgetPreset: "hosted" })).toEqual(HOSTED_BUDGET);
    expect(normalizeBudget({ budgetPreset: "local-dev" })).toEqual(LOCAL_DEV_BUDGET);
  });

  it("applies budget overrides before legacy maxSteps/historyTurns before preset values", () => {
    expect(
      normalizeBudget({
        budgetPreset: "hosted",
        maxSteps: 7,
        historyTurns: 8,
        budget: {
          maxSteps: 9,
          maxHistoryTurns: 10,
          maxContextChars: 123_456,
        },
      }),
    ).toEqual({
      ...HOSTED_BUDGET,
      maxSteps: 9,
      maxHistoryTurns: 10,
      maxContextChars: 123_456,
    });

    expect(normalizeBudget({ budgetPreset: "hosted", maxSteps: 7, historyTurns: 8 })).toEqual({
      ...HOSTED_BUDGET,
      maxSteps: 7,
      maxHistoryTurns: 8,
    });
  });

  it("rejects unbounded/negative/NaN values and normalizes fractions to safe integers", () => {
    const budget = normalizeBudget({
      budgetPreset: "hosted",
      maxSteps: Number.POSITIVE_INFINITY,
      historyTurns: Number.NaN,
      budget: {
        maxSteps: -1,
        maxToolCallsPerStep: 5.9,
        maxContextChars: Number.MAX_SAFE_INTEGER,
        maxHistoryTurns: -10,
        maxHistoryChars: Number.NaN,
        maxStageJsonChars: Number.POSITIVE_INFINITY,
        maxStageSummaryNodes: 2.8,
        maxObservationChars: 0.2,
        maxFinalTextChars: -99,
        maxProviderRetries: 1.7,
        retryBackoffMs: -1,
      },
    });

    expect(budget).toEqual({
      ...HOSTED_BUDGET,
      maxToolCallsPerStep: 5,
      maxStageSummaryNodes: 2,
      maxObservationChars: MIN_REFERENCE_AGENT_OBSERVATION_CHARS,
      maxProviderRetries: 1,
    });
    const ratioFields = new Set<keyof ReferenceAgentBudget>([
      "compactionTriggerRatio",
      "compactionTargetRatio",
    ]);
    for (const [field, value] of Object.entries(budget)) {
      if (ratioFields.has(field as keyof ReferenceAgentBudget)) {
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThanOrEqual(1);
        continue;
      }
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
  });
});

describe("reference-agent character budget model", () => {
  it("uses character caps and shared compaction policy constants", () => {
    for (const preset of Object.values(REFERENCE_AGENT_BUDGET_PRESETS)) {
      expect(preset.compactionTriggerRatio).toBe(0.75);
      expect(preset.compactionTargetRatio).toBe(0.5);
      expect(preset.minRecentTurnsVerbatim).toBe(4);
      expect(preset.minRecentStepsVerbatim).toBe(4);
      expect(preset.maxSummaryChars).toBe(4_800);
      expect(preset.summarizerTimeoutMs).toBe(30_000);
      expect(preset.summarizerRetries).toBe(1);
      expect(preset.compactionCooldownSteps).toBe(4);
      expect(preset.contextWindowCharsDefault).toBe(400_000);
      expect(preset.maxSummarizerInputChars).toBe(preset.maxContextChars / 2);
      expect("maxContextTokens" in preset).toBe(false);
      expect("maxSummaryTokens" in preset).toBe(false);
      expect("contextWindowTokensDefault" in preset).toBe(false);
    }
  });

  it("accepts a valid ratio override and keeps character caps", () => {
    expect(
      normalizeBudget({ budget: { compactionTriggerRatio: 0.8, compactionTargetRatio: 0.4 } }),
    ).toEqual({
      ...QUICKSTART_BUDGET,
      compactionTriggerRatio: 0.8,
      compactionTargetRatio: 0.4,
    });
  });

  it("rejects out-of-range ratio overrides and falls back to the preset ratio", () => {
    expect(normalizeBudget({ budget: { compactionTriggerRatio: 0 } })).toEqual(QUICKSTART_BUDGET);
    expect(normalizeBudget({ budget: { compactionTriggerRatio: 1.2 } })).toEqual(QUICKSTART_BUDGET);
    expect(normalizeBudget({ budget: { compactionTargetRatio: Number.NaN } })).toEqual(
      QUICKSTART_BUDGET,
    );
    expect(normalizeBudget({ budget: { compactionTargetRatio: -0.1 } })).toEqual(QUICKSTART_BUDGET);
    expect(normalizeBudget({ budget: { compactionTargetRatio: 1 } })).toEqual(QUICKSTART_BUDGET);
  });

  it("falls back both ratios to preset when an override breaks trigger > target", () => {
    expect(
      normalizeBudget({ budget: { compactionTriggerRatio: 0.4, compactionTargetRatio: 0.6 } }),
    ).toEqual(QUICKSTART_BUDGET);
    expect(
      normalizeBudget({ budget: { compactionTriggerRatio: 0.5, compactionTargetRatio: 0.5 } }),
    ).toEqual(QUICKSTART_BUDGET);
  });

  it("normalizes the new integer character fields like the legacy fields", () => {
    const budget = normalizeBudget({
      budget: {
        maxSummaryChars: -5,
        summarizerRetries: 2.7,
        maxSummarizerInputChars: 9_876.4,
        compactionCooldownSteps: Number.POSITIVE_INFINITY,
        contextWindowCharsDefault: 50_000,
      },
    });
    expect(budget.maxSummaryChars).toBe(QUICKSTART_BUDGET.maxSummaryChars);
    expect(budget.summarizerRetries).toBe(2);
    expect(budget.maxSummarizerInputChars).toBe(9_876);
    expect(budget.compactionCooldownSteps).toBe(QUICKSTART_BUDGET.compactionCooldownSteps);
    expect(budget.contextWindowCharsDefault).toBe(50_000);
    expect(budget.compactionTriggerRatio).toBe(0.75);
  });
});

describe("measureChars", () => {
  it("measures strings directly and serializable values through JSON characters", () => {
    expect(measureChars("hello")).toBe(5);
    expect(measureChars({ a: "x", b: 2 })).toBe(JSON.stringify({ a: "x", b: 2 }).length);
  });

  it("uses a bounded fallback for unserializable values", () => {
    const circular: Record<string, unknown> = { type: "object" };
    circular["self"] = circular;

    expect(measureChars(circular)).toBe(256);
    expect(Number.isFinite(measureChars(circular))).toBe(true);
  });
});

describe("effectiveCharBudget", () => {
  it("takes the smaller of the preset character cap and the provider context window", () => {
    const quickstart = normalizeBudget();
    expect(effectiveCharBudget(quickstart)).toBe(96_000);
    expect(effectiveCharBudget(quickstart, undefined)).toBe(96_000);
    expect(effectiveCharBudget(quickstart, 200_000)).toBe(96_000);
    expect(effectiveCharBudget(quickstart, 10_000)).toBe(10_000);

    const hosted = normalizeBudget({ budgetPreset: "hosted" });
    expect(effectiveCharBudget(hosted, 128_000)).toBe(128_000);
  });
});

describe("ReferenceAgentStopReason", () => {
  it("exports the closed stop-reason union values", () => {
    const expected = [
      "provider_stop",
      "max_steps",
      "tool_call_limit",
      "context_limit",
      "provider_error",
      "retry_exhausted",
      "sink_error",
      "empty_turn",
    ] as const satisfies readonly ReferenceAgentStopReason[];

    const exactMap = {
      provider_stop: true,
      max_steps: true,
      tool_call_limit: true,
      context_limit: true,
      provider_error: true,
      retry_exhausted: true,
      sink_error: true,
      empty_turn: true,
    } satisfies Record<ReferenceAgentStopReason, true>;

    expect(REFERENCE_AGENT_STOP_REASONS).toEqual(expected);
    expect(Object.keys(exactMap).sort()).toEqual([...expected].sort());
  });
});

describe("classifyProviderFailure", () => {
  it("marks timeout, abort, fetch TypeError, and retryable HTTP statuses retryable", () => {
    const timeout = new Error("provider request timed out");
    timeout.name = "TimeoutError";
    const retryableCases: readonly unknown[] = [
      timeout,
      new DOMException("aborted", "AbortError"),
      new TypeError("fetch failed"),
      ...[408, 409, 425, 429, 500, 502, 503, 504].map(httpError),
    ];

    for (const error of retryableCases) {
      expect(classifyProviderFailure(error), String(error)).toMatchObject({ retryable: true });
    }
  });

  it("marks client/configuration/malformed provider failures non-retryable", () => {
    const nonRetryableCases: readonly unknown[] = [
      ...[400, 401, 403, 404, 422].map(httpError),
      new Error("openai response had an unexpected shape (no choices[])"),
      new Error("malformed provider response"),
      new Error("Unknown provider flag: llama"),
      new SyntaxError("Unexpected input"),
    ];

    for (const error of nonRetryableCases) {
      expect(classifyProviderFailure(error), String(error)).toMatchObject({ retryable: false });
    }
  });

  it("returns bounded classification metadata only", () => {
    expect(classifyProviderFailure(httpError(429))).toEqual({
      retryable: true,
      reason: "http_status",
      httpStatus: 429,
    });
    expect(classifyProviderFailure(new Error("malformed provider response"))).toEqual({
      retryable: false,
      reason: "malformed_response",
    });
  });
});

describe("reference-agent budget public surface", () => {
  it("has no provider fallback helper and no token-count surface in owned production files", () => {
    const providerFallbackExports = Object.keys(budgetModule).filter(
      (name) => /provider/i.test(name) && /fallback/i.test(name),
    );
    const ownedProduction = [source("./budget.ts"), source("./measure.ts")].join("\n");

    expect(providerFallbackExports).toEqual([]);
    expect(Object.keys(budgetModule)).not.toContain("effectiveTokenBudget");
    expect(ownedProduction).not.toMatch(/Token|token/u);
    expect(() => source("./estimate.ts")).toThrow();
  });
});
