import { describe, expect, it } from "vitest";

import {
  REFERENCE_AGENT_TRACE_EVENT_TYPES,
  emitReferenceAgentTrace,
  sanitizeReferenceAgentTraceEvent,
  type ReferenceAgentTraceEvent,
  type ReferenceAgentTraceEventType,
} from "./trace.js";

describe("reference-agent trace contract", () => {
  it("exports the closed trace event-name union", () => {
    const expected = [
      "turn_start",
      "context_compacted",
      "provider_attempt",
      "provider_retry",
      "provider_step",
      "tool_result",
      "batch_yield",
      "stop",
      "turn_error",
      "compaction_triggered",
      "compaction_done",
      "compaction_failed",
    ] as const satisfies readonly ReferenceAgentTraceEventType[];

    const exactMap = {
      turn_start: true,
      context_compacted: true,
      provider_attempt: true,
      provider_retry: true,
      provider_step: true,
      tool_result: true,
      batch_yield: true,
      stop: true,
      turn_error: true,
      compaction_triggered: true,
      compaction_done: true,
      compaction_failed: true,
    } satisfies Record<ReferenceAgentTraceEventType, true>;

    expect(REFERENCE_AGENT_TRACE_EVENT_TYPES).toEqual(expected);
    expect(Object.keys(exactMap).sort()).toEqual([...expected].sort());
  });

  it("is optional, defaults to no-op behavior, and ignores callback failures", async () => {
    const stopEvent = {
      type: "stop",
      reason: "provider_stop",
      stepCount: 1,
      toolCallCount: 0,
      finalTextChars: 12,
    } satisfies ReferenceAgentTraceEvent;
    const seen: ReferenceAgentTraceEvent[] = [];

    expect(() => emitReferenceAgentTrace(undefined, stopEvent)).not.toThrow();
    expect(() =>
      emitReferenceAgentTrace((event) => {
        seen.push(event);
        throw new Error("trace callback failed");
      }, stopEvent),
    ).not.toThrow();
    emitReferenceAgentTrace(async () => {
      throw new Error("async trace callback failed");
    }, stopEvent);
    await Promise.resolve();

    expect(seen).toEqual([stopEvent]);
  });

  it("serializes async callbacks for the same trace sink", async () => {
    const seen: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const trace = async (event: ReferenceAgentTraceEvent) => {
      seen.push(event.type);
      if (event.type === "turn_start") await firstDone;
    };

    emitReferenceAgentTrace(trace, { type: "turn_start", eventKind: "message" });
    emitReferenceAgentTrace(trace, {
      type: "stop",
      reason: "provider_stop",
      stepCount: 1,
      toolCallCount: 0,
    });

    expect(seen).toEqual(["turn_start"]);
    await Promise.resolve();
    expect(seen).toEqual(["turn_start"]);

    releaseFirst?.();
    await firstDone;
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual(["turn_start", "stop"]);
  });

  it("bounds queued async trace events when a trace sink stalls", async () => {
    const seen: ReferenceAgentTraceEvent[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const trace = async (event: ReferenceAgentTraceEvent) => {
      seen.push(event);
      if (event.type === "turn_start") await firstDone;
    };

    emitReferenceAgentTrace(trace, { type: "turn_start", eventKind: "message" });
    for (let attempt = 1; attempt <= 70; attempt += 1) {
      emitReferenceAgentTrace(trace, {
        type: "provider_attempt",
        attempt,
        messageCount: 1,
        toolCount: 1,
      });
    }

    expect(seen.map((event) => event.type)).toEqual(["turn_start"]);

    releaseFirst?.();
    await firstDone;
    for (let tick = 0; tick < 80; tick += 1) await Promise.resolve();

    const attempts = seen.filter((event) => event.type === "provider_attempt");
    expect(seen).toHaveLength(65);
    expect(attempts).toHaveLength(64);
    expect(attempts.at(-1)).toMatchObject({ type: "provider_attempt", attempt: 64 });
  });

  it("keeps terminal trace events when a stalled trace queue is full", async () => {
    const seen: ReferenceAgentTraceEvent[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const trace = async (event: ReferenceAgentTraceEvent) => {
      seen.push(event);
      if (event.type === "turn_start") await firstDone;
    };

    emitReferenceAgentTrace(trace, { type: "turn_start", eventKind: "message" });
    for (let attempt = 1; attempt <= 70; attempt += 1) {
      emitReferenceAgentTrace(trace, {
        type: "provider_attempt",
        attempt,
        messageCount: 1,
        toolCount: 1,
      });
    }
    emitReferenceAgentTrace(trace, {
      type: "stop",
      reason: "provider_stop",
      stepCount: 70,
      toolCallCount: 0,
    });

    releaseFirst?.();
    await firstDone;
    for (let tick = 0; tick < 80; tick += 1) await Promise.resolve();

    expect(seen).toHaveLength(65);
    expect(seen.at(-1)).toMatchObject({ type: "stop", reason: "provider_stop" });
  });

  it("keeps terminal turn_error trace events when a stalled trace queue is full", async () => {
    const seen: ReferenceAgentTraceEvent[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const trace = async (event: ReferenceAgentTraceEvent) => {
      seen.push(event);
      if (event.type === "turn_start") await firstDone;
    };

    emitReferenceAgentTrace(trace, { type: "turn_start", eventKind: "message" });
    for (let attempt = 1; attempt <= 70; attempt += 1) {
      emitReferenceAgentTrace(trace, {
        type: "provider_attempt",
        attempt,
        messageCount: 1,
        toolCount: 1,
      });
    }
    emitReferenceAgentTrace(trace, {
      type: "turn_error",
      reason: "malformed_response",
      retryable: false,
    });

    releaseFirst?.();
    await firstDone;
    for (let tick = 0; tick < 80; tick += 1) await Promise.resolve();

    expect(seen).toHaveLength(65);
    expect(seen.at(-1)).toMatchObject({ type: "turn_error", reason: "malformed_response" });
  });

  it("keeps turn_error and stop when both terminal events arrive on a full queue", async () => {
    const seen: ReferenceAgentTraceEvent[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const trace = async (event: ReferenceAgentTraceEvent) => {
      seen.push(event);
      if (event.type === "turn_start") await firstDone;
    };

    emitReferenceAgentTrace(trace, { type: "turn_start", eventKind: "message" });
    for (let attempt = 1; attempt <= 70; attempt += 1) {
      emitReferenceAgentTrace(trace, {
        type: "provider_attempt",
        attempt,
        messageCount: 1,
        toolCount: 1,
      });
    }
    emitReferenceAgentTrace(trace, {
      type: "turn_error",
      reason: "malformed_response",
      retryable: false,
    });
    emitReferenceAgentTrace(trace, {
      type: "stop",
      reason: "provider_error",
      stepCount: 1,
      toolCallCount: 0,
    });

    releaseFirst?.();
    await firstDone;
    for (let tick = 0; tick < 80; tick += 1) await Promise.resolve();

    expect(seen).toHaveLength(65);
    expect(seen.at(-2)).toMatchObject({ type: "turn_error", reason: "malformed_response" });
    expect(seen.at(-1)).toMatchObject({ type: "stop", reason: "provider_error" });
  });

  it("passes only bounded metadata for context, provider, tool result, stop, and error events", () => {
    const events = [
      {
        type: "context_compacted",
        originalHistoryTurns: 9,
        includedHistoryTurns: 4,
        droppedHistoryTurns: 5,
        originalChars: 12_000,
        includedChars: 4_000,
        stageMode: "summary",
        stageNodeCount: 80,
      },
      {
        type: "provider_step",
        provider: "openai",
        model: "gpt-test",
        step: 2,
        textChars: 55,
        toolCallCount: 2,
        toolNames: ["inspect_stage", "say"],
      },
      {
        type: "tool_result",
        toolName: "inspect_stage",
        callId: "call_1",
        observationChars: 72,
        truncated: true,
        omittedChars: 188,
      },
      {
        type: "stop",
        reason: "provider_stop",
        stepCount: 3,
        toolCallCount: 4,
        finalTextChars: 42,
      },
      {
        type: "turn_error",
        reason: "retry_exhausted",
        retryable: false,
        httpStatus: 429,
      },
    ] as const satisfies readonly ReferenceAgentTraceEvent[];

    expect(events.map(sanitizeReferenceAgentTraceEvent)).toEqual(events);
  });

  it("passes bounded metadata for the compaction trace events", () => {
    const events = [
      {
        type: "compaction_triggered",
        site: "cross_turn",
        estimatedTokens: 1200,
        budgetTokens: 24_000,
      },
      {
        type: "compaction_done",
        site: "cross_turn",
        generation: 2,
        coveredThrough: 8,
        beforeTokens: 30_000,
        afterTokens: 12_000,
      },
      {
        type: "compaction_failed",
        site: "in_turn",
        reason: "summarizer_failed",
      },
    ] as const satisfies readonly ReferenceAgentTraceEvent[];

    expect(events.map(sanitizeReferenceAgentTraceEvent)).toEqual(events);
  });

  it("bounds and normalizes malformed compaction trace fields", () => {
    const sanitized = sanitizeReferenceAgentTraceEvent({
      type: "compaction_done",
      site: "bogus",
      generation: -5,
      coveredThrough: Number.POSITIVE_INFINITY,
      beforeTokens: 1.9,
      afterTokens: 10,
    } as unknown as ReferenceAgentTraceEvent);

    expect(sanitized).toEqual({
      type: "compaction_done",
      site: "cross_turn",
      generation: 0,
      coveredThrough: 0,
      beforeTokens: 1,
      afterTokens: 10,
    });
  });

  it("redacts visitor ids, keys, full prompts, full stage JSON, and raw provider bodies", () => {
    const eventWithForbiddenExtras = {
      type: "provider_attempt",
      provider: "openai",
      model: "gpt-test",
      attempt: 1,
      messageCount: 3,
      toolCount: 9,
      estimatedContextChars: 1234,
      apiKey: "sk-secret",
      visitorId: "visitor-secret",
      prompt: "full prompt secret",
      system: "full system prompt secret",
      stageJson: { nodes: { root: { secret: "stage secret" } } },
      providerBody: { authorization: "Bearer raw-body-secret" },
    } as unknown as ReferenceAgentTraceEvent;

    const sanitized = sanitizeReferenceAgentTraceEvent(eventWithForbiddenExtras);
    const serialized = JSON.stringify(sanitized);

    expect(sanitized).toEqual({
      type: "provider_attempt",
      provider: "openai",
      model: "gpt-test",
      attempt: 1,
      messageCount: 3,
      toolCount: 9,
      estimatedContextChars: 1234,
    });
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("visitor-secret");
    expect(serialized).not.toContain("full prompt secret");
    expect(serialized).not.toContain("stage secret");
    expect(serialized).not.toContain("raw-body-secret");

    const acceptedStringFields = sanitizeReferenceAgentTraceEvent({
      type: "turn_error",
      reason: "Authorization: Bearer raw-body-secret; api_key=sk-secret",
      retryable: false,
    });

    expect(JSON.stringify(acceptedStringFields)).not.toContain("raw-body-secret");
    expect(JSON.stringify(acceptedStringFields)).not.toContain("sk-secret");
  });

  it("sanitizes through the public trace emitter before invoking callbacks", () => {
    const seen: ReferenceAgentTraceEvent[] = [];
    const eventWithForbiddenExtras = {
      type: "provider_attempt",
      provider: "openai",
      model: "gpt-test",
      attempt: 1,
      messageCount: 3,
      toolCount: 9,
      estimatedContextChars: 1234,
      apiKey: "sk-secret",
      visitorId: "visitor-secret",
      prompt: "full prompt secret",
      system: "full system prompt secret",
      stageJson: { nodes: { root: { secret: "stage secret" } } },
      providerBody: { authorization: "Bearer raw-body-secret" },
    } as unknown as ReferenceAgentTraceEvent;

    emitReferenceAgentTrace((event) => {
      seen.push(event);
    }, eventWithForbiddenExtras);

    expect(seen).toEqual([
      {
        type: "provider_attempt",
        provider: "openai",
        model: "gpt-test",
        attempt: 1,
        messageCount: 3,
        toolCount: 9,
        estimatedContextChars: 1234,
      },
    ]);
    expect(JSON.stringify(seen)).not.toContain("sk-secret");
    expect(JSON.stringify(seen)).not.toContain("visitor-secret");
    expect(JSON.stringify(seen)).not.toContain("full prompt secret");
    expect(JSON.stringify(seen)).not.toContain("stage secret");
    expect(JSON.stringify(seen)).not.toContain("raw-body-secret");
  });
});
