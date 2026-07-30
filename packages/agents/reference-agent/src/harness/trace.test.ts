import {
  deriveMessageId,
  type AgentEvent,
  type ConversationMessage,
  type FacetToolSession,
} from "@facet/core";
import type { Sink, SummaryStore } from "@facet/runtime";
import { describe, expect, it } from "vitest";

import { DEFAULT_CATALOG } from "../../../../core/assets/src/index.js";
import type { TurnMessage } from "../provider.js";
import { runBackgroundCompaction } from "./background-compaction.js";
import { normalizeBudget, type ReferenceAgentBudget } from "./budget.js";
import { assembleProviderContext } from "./context.js";
import type { ConversationSummary, SummarizerRequest } from "./summary.js";
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
        toolNames: ["read_screen", "render_page"],
      },
      {
        type: "tool_result",
        toolName: "read_screen",
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
        estimatedChars: 1200,
        budgetChars: 24_000,
      },
      {
        type: "compaction_done",
        site: "cross_turn",
        generation: 2,
        coveredThrough: 8,
        beforeChars: 30_000,
        afterChars: 12_000,
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
      beforeChars: 1.9,
      afterChars: 10,
    } as unknown as ReferenceAgentTraceEvent);

    expect(sanitized).toEqual({
      type: "compaction_done",
      site: "cross_turn",
      generation: 0,
      coveredThrough: 0,
      beforeChars: 1,
      afterChars: 10,
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

  it("persists messageIdCoverage that the reader replays from a whole-turn boundary", async () => {
    const history = conversationHistory(4);
    const store = writableSummaryStore();
    const requests: SummarizerRequest[] = [];
    const traces: ReferenceAgentTraceEvent[] = [];
    const budget = traceBudget();

    await runBackgroundCompaction({
      system: "System prompt.",
      budget,
      event: agentEvent(),
      session: emptySession(),
      sink: sinkWith(history),
      historyKey: "quickstart:v1",
      summaryStore: store,
      summarizer: async (request) => {
        requests.push(request);
        return summaryOf({
          visitor: "summary includes turn-0 visitor and turn-1 visitor",
          pageDecisions: "summary includes turn-0 assistant and turn-1 assistant",
        });
      },
      trace: (event) => {
        traces.push(event);
      },
      contextWindowChars: TRACE_CONTEXT_CHARS,
    });

    const stored = await store.read("quickstart:v1");
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(stored)).toContain("messageIdCoverage");
    expect(JSON.stringify(stored)).toContain(deriveMessageId("turn-1", "assistant"));
    expect(JSON.stringify(stored)).toContain(deriveMessageId("turn-2", "visitor"));
    expect(traces).toContainEqual(
      expect.objectContaining({
        type: "compaction_done",
        generation: 1,
        coveredThrough: 4,
      }),
    );

    const first = await assembleProviderContext({
      system: "System prompt.",
      event: agentEvent(),
      session: emptySession(),
      sink: sinkWith(history),
      historyKey: "quickstart:v1",
      summaryStore: store,
      budget,
      contextWindowChars: TRACE_CONTEXT_CHARS,
    });
    const second = await assembleProviderContext({
      system: "System prompt.",
      event: agentEvent(),
      session: emptySession(),
      sink: sinkWith(history),
      historyKey: "quickstart:v1",
      summaryStore: store,
      budget,
      contextWindowChars: TRACE_CONTEXT_CHARS,
    });

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    if (first.status !== "ready" || second.status !== "ready") return;

    expect(first.turn.messages).toEqual(second.turn.messages);
    expect(first.stats.summaryInjected).toBe(true);
    expect(first.stats.summaryCoveredThrough).toBe(4);

    const text = allText(first.turn.messages);
    expect(text).toContain("CONVERSATION SUMMARY");
    expect(text).toContain("summary includes turn-0 visitor");
    expect(text).not.toContain("turn-0 visitor text");
    expect(text).not.toContain("turn-1 assistant text");
    expect(text).toContain("turn-2 visitor text");
    expect(text).toContain("turn-2 assistant text");
    expect(text).toContain("turn-3 visitor text");
    expect(text).toContain("turn-3 assistant text");
  });

  it("ignores hostile stored summary payloads without breaking deterministic assembly", async () => {
    const history = conversationHistory(3);
    const hostile = Object.defineProperty(
      {
        coveredThrough: 2,
        generation: 1,
      },
      "payload",
      {
        enumerable: true,
        get() {
          throw new Error("hostile summary payload");
        },
      },
    );
    const budget = traceBudget();
    const store = readableSummaryStore(hostile);

    const first = await assembleProviderContext({
      system: "System prompt.",
      event: agentEvent(),
      session: emptySession(),
      sink: sinkWith(history),
      historyKey: "quickstart:v1",
      summaryStore: store,
      budget,
      contextWindowChars: TRACE_CONTEXT_CHARS,
    });
    const second = await assembleProviderContext({
      system: "System prompt.",
      event: agentEvent(),
      session: emptySession(),
      sink: sinkWith(history),
      historyKey: "quickstart:v1",
      summaryStore: store,
      budget,
      contextWindowChars: TRACE_CONTEXT_CHARS,
    });

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    if (first.status !== "ready" || second.status !== "ready") return;

    expect(first.stats.summaryInjected).toBe(false);
    expect(first.stats.summaryDiscarded).toBe("invalid");
    expect(first.turn.messages).toEqual(second.turn.messages);
    expect(allText(first.turn.messages)).not.toContain("CONVERSATION SUMMARY");
    expect(allText(first.turn.messages)).toContain("turn-2 visitor text");
    expect(allText(first.turn.messages)).toContain("turn-2 assistant text");
  });
});

function traceBudget(): ReferenceAgentBudget {
  return normalizeBudget({
    budget: {
      maxContextChars: TRACE_CONTEXT_CHARS,
      maxHistoryTurns: 2,
      maxHistoryChars: 10_000,
      maxStageJsonChars: 1_000,
      maxStageSummaryNodes: 20,
      compactionTriggerRatio: 0.01,
      compactionTargetRatio: 0.005,
      minRecentTurnsVerbatim: 2,
      maxSummaryChars: 2_000,
      maxSummarizerInputChars: 10_000,
      compactionCooldownSteps: 1,
      contextWindowCharsDefault: TRACE_CONTEXT_CHARS,
    },
  });
}

const TRACE_CONTEXT_CHARS = 5_000;

function summaryOf(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    version: 1,
    visitor: "returning visitor",
    pageDecisions: "home screen exists",
    collectedData: "nothing collected",
    pending: "nothing pending",
    attempts: "no failed attempts",
    omitted: "nothing omitted",
    ...overrides,
  };
}

function conversationHistory(turnCount: number): readonly ConversationMessage[] {
  const history: ConversationMessage[] = [];
  for (let index = 0; index < turnCount; index += 1) {
    const turnId = `turn-${String(index)}`;
    history.push(
      message(turnId, "visitor", `turn-${String(index)} visitor text ${"x".repeat(120)}`),
      message(turnId, "assistant", `turn-${String(index)} assistant text ${"y".repeat(120)}`),
    );
  }
  return history;
}

function message(
  turnId: string,
  role: ConversationMessage["role"],
  text: string,
): ConversationMessage {
  return {
    kind: "conversation",
    turnId,
    messageId: deriveMessageId(turnId, role),
    role,
    text,
    at: 0,
  };
}

function sinkWith(history: readonly ConversationMessage[]): Pick<Sink, "history"> {
  return {
    async history(key: string, limit: number) {
      expect(key).toBe("quickstart:v1");
      return history.slice(-Math.max(0, limit));
    },
  };
}

function readableSummaryStore(payload: unknown): Pick<SummaryStore, "read"> {
  return {
    async read(key: string) {
      expect(key).toBe("quickstart:v1");
      return payload;
    },
  };
}

function writableSummaryStore(): SummaryStore {
  let payload: unknown = null;
  return {
    async read(key: string) {
      expect(key).toBe("quickstart:v1");
      return payload;
    },
    async write(key: string, next: unknown) {
      expect(key).toBe("quickstart:v1");
      payload = next;
      return { ok: true };
    },
  };
}

function emptySession(): FacetToolSession {
  return {
    catalog: DEFAULT_CATALOG,
    document: null,
    data: {},
    stageRevision: 0,
    async applyAuthorMutation() {
      throw new Error("unused test session mutation");
    },
    async applyTargetedMutation() {
      throw new Error("unused test session targeted mutation");
    },
    async publishData() {
      return { ok: true, chars: 0 };
    },
  };
}

function agentEvent(): AgentEvent {
  return {
    eventId: "evt-1",
    eventName: "submit",
    sourceNodeId: "button",
    screen: "home",
    stageRevision: 0,
    collect: {},
  };
}

function allText(messages: readonly TurnMessage[]): string {
  return messages.map(messageText).join("\n");
}

function messageText(message: TurnMessage | undefined): string {
  if (message === undefined) return "";
  return "content" in message ? message.content : message.text;
}
