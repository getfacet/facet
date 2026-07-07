import { describe, expect, it } from "vitest";

import {
  DEFAULT_REFERENCE_AGENT_BUDGET_PRESET,
  MIN_REFERENCE_AGENT_OBSERVATION_CHARS,
  REFERENCE_AGENT_BUDGET_PRESETS,
  REFERENCE_AGENT_STOP_REASONS,
  classifyProviderFailure,
  normalizeBudget,
  type ReferenceAgentBudget,
  type ReferenceAgentStopReason,
} from "./budget.js";
import * as budgetModule from "./budget.js";

const QUICKSTART_BUDGET = {
  maxSteps: 50,
  maxToolCallsPerStep: 16,
  maxContextChars: 96_000,
  maxHistoryTurns: 20,
  maxHistoryChars: 24_000,
  maxStageJsonChars: 48_000,
  maxStageSummaryNodes: 80,
  maxObservationChars: 4_000,
  maxFinalTextChars: 4_000,
  maxProviderRetries: 1,
  retryBackoffMs: 250,
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
} satisfies ReferenceAgentBudget;

function httpError(status: number): Error {
  return new Error(`openai request failed: HTTP ${status}`);
}

describe("reference-agent budget presets", () => {
  it("matches the Budget Profile Contract table exactly", () => {
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
    for (const value of Object.values(budget)) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
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
      "unresolved_buffer",
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
      unresolved_buffer: true,
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
      new SyntaxError("Unexpected token < in JSON"),
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

describe("provider fallback policy", () => {
  it("does not expose cross-provider fallback helpers or behavior", () => {
    const providerFallbackExports = Object.keys(budgetModule).filter(
      (name) => /provider/i.test(name) && /fallback/i.test(name),
    );

    expect(providerFallbackExports).toEqual([]);
  });
});
