import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveMessageId } from "@facet/core";
import type {
  AgentControlFrame,
  VisitorEvent,
  VisitorEventFrame,
  FacetAgent,
  TurnOutcome,
} from "@facet/core";

import { connectAgent, parseSseFrames } from "./connect.js";

const GENERIC_AGENT_FAILURE_TEXT = "The agent could not complete this turn.";
const BUSY_AGENT_FAILURE_TEXT = "The agent is busy. Please try again shortly.";
const EXPIRED_AGENT_FAILURE_TEXT = "The agent could not complete this turn before the deadline.";

describe("parseSseFrames", () => {
  it("extracts complete data frames and leaves a partial trailing frame", () => {
    const first = parseSseFrames('data: {"a":1}\n\ndata: par');
    expect(first.data).toEqual(['{"a":1}']);
    expect(first.rest).toBe("data: par");
    expect(parseSseFrames(`${first.rest}tial\n\n`).data).toEqual(["partial"]);
  });

  it("ignores comments without losing following frames", () => {
    expect(parseSseFrames(": keep-alive\n\ndata: real\n\n").data).toEqual(["real"]);
  });
});

const tick = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function flushMicrotasks(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}
const sseFrame = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;
const stubResponse = (ok: boolean, status: number): Response =>
  ({ ok, status, body: null }) as unknown as Response;

function sseStreamResponse(
  chunks: readonly string[],
  options: { readonly close?: boolean } = {},
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (options.close === true) controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

function event(overrides: Partial<VisitorEvent> = {}): VisitorEvent {
  return Object.freeze({
    eventId: "event1",
    eventName: "submit",
    sourceNodeId: "n1",
    screen: "home",
    stageRevision: 7,
    collect: Object.freeze({}),
    ...overrides,
  });
}

function eventFrame(overrides: Partial<VisitorEventFrame> = {}): VisitorEventFrame {
  return Object.freeze({
    kind: "visitor_event" as const,
    event: event(),
    ...overrides,
  });
}

function outcome(overrides: Partial<TurnOutcome> = {}): TurnOutcome {
  return Object.freeze({
    stageRevision: 8,
    patches: Object.freeze([]),
    conversation: Object.freeze({
      kind: "conversation" as const,
      messageId: deriveMessageId("event1", "assistant"),
      turnId: "event1",
      role: "assistant" as const,
      text: "ok",
      at: 1,
    }),
    ...overrides,
  });
}

function outcomeFor(frame: VisitorEventFrame, text = "ok"): TurnOutcome {
  return outcome({
    stageRevision: frame.event.stageRevision,
    conversation: Object.freeze({
      kind: "conversation" as const,
      messageId: deriveMessageId(frame.event.eventId, "assistant"),
      turnId: frame.event.eventId,
      role: "assistant" as const,
      text,
      at: 1,
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("connectAgent", () => {
  it("routes VisitorEventFrame to the agent and posts a correlated AgentControlFrame", async () => {
    const seen: VisitorEventFrame[] = [];
    const control: AgentControlFrame[] = [];
    const frame = eventFrame({ correlationId: "remote-1" });
    const agent: FacetAgent = {
      handleEvent: (frame) => {
        seen.push(frame);
        return Promise.resolve(outcome());
      },
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(
          sseStreamResponse([
            "data: not json\n\n",
            sseFrame({ kind: "visitor_event", correlationId: "", event: event() }),
            sseFrame({ kind: "visitor_event", timeoutMs: 0, event: event() }),
            sseFrame(frame),
          ]),
        );
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent/a",
      agent,
      reconnectMs: 1_000,
    });
    await tick();
    connection.close();

    expect(seen).toEqual([frame]);
    expect(control).toEqual([
      {
        kind: "agent_control",
        eventId: "event1",
        correlationId: "remote-1",
        outcome: outcome(),
      },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `http://s/agent/stream?agentId=${encodeURIComponent("agent/a")}`,
    );
  });

  it("aborts in-flight turns on close and suppresses stale control posts", async () => {
    const control: AgentControlFrame[] = [];
    let signal: AbortSignal | undefined;
    let finish: (() => void) | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const agent: FacetAgent = {
      handleEvent: (_frame, context) => {
        signal = context?.signal;
        resolveStarted?.();
        return new Promise<TurnOutcome>((resolveTurn) => {
          finish = () => resolveTurn(outcome());
        });
      },
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(eventFrame())]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent/a",
      agent,
      reconnectMs: 1_000,
    });

    await started;
    connection.close();
    expect(signal?.aborted).toBe(true);
    finish?.();
    await tick();
    expect(control).toEqual([]);
  });

  it("aborts in-flight turns when the owning SSE stream disconnects", async () => {
    const control: AgentControlFrame[] = [];
    let signal: AbortSignal | undefined;
    let finish: (() => void) | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const agent: FacetAgent = {
      handleEvent: (_frame, context) => {
        signal = context?.signal;
        resolveStarted?.();
        return new Promise<TurnOutcome>((resolveTurn) => {
          finish = () => resolveTurn(outcome());
        });
      },
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(eventFrame())], { close: true }));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent/a",
      agent,
      reconnectMs: 1_000,
    });

    await started;
    await tick();
    expect(signal?.aborted).toBe(true);
    finish?.();
    await tick();
    expect(control).toEqual([]);
    connection.close();
  });

  it("rejects a second conversation message without leaking the internal validation code", async () => {
    const control: AgentControlFrame[] = [];
    const frame = eventFrame({ event: event({ eventId: "event7", stageRevision: 9 }) });
    const invalid = {
      stageRevision: 8,
      patches: [],
      conversation: [outcome().conversation, outcome().conversation],
    } as unknown as TurnOutcome;
    const agent: FacetAgent = {
      handleEvent: () => Promise.resolve(invalid),
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(frame)]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent,
      reconnectMs: 1_000,
    });
    await tick();
    connection.close();

    expect(control).toHaveLength(1);
    expect(control[0]?.eventId).toBe("event7");
    expect(control[0]?.outcome.stageRevision).toBe(9);
    expect(control[0]?.outcome.patches).toEqual([]);
    expect(control[0]?.outcome.conversation?.messageId).toBe(
      deriveMessageId("event7", "assistant"),
    );
    expect(control[0]?.outcome.conversation?.text).toBe(GENERIC_AGENT_FAILURE_TEXT);
    expect(control[0]?.outcome.conversation?.text).not.toContain("conversation_not_singular");
  });

  it("converts non-empty patch outcomes to the generic conversation-only failure", async () => {
    const control: AgentControlFrame[] = [];
    const frame = eventFrame({ event: event({ eventId: "event8", stageRevision: 9 }) });
    const agent: FacetAgent = {
      handleEvent: () =>
        Promise.resolve(
          outcome({
            patches: Object.freeze([
              Object.freeze({ op: "replace" as const, path: "/data", value: { status: "bad" } }),
            ]),
          }),
        ),
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(frame)]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent,
      reconnectMs: 1_000,
    });
    await tick();
    connection.close();

    expect(control).toHaveLength(1);
    expect(control[0]?.eventId).toBe("event8");
    expect(control[0]?.outcome.stageRevision).toBe(9);
    expect(control[0]?.outcome.patches).toEqual([]);
    expect(control[0]?.outcome.conversation?.text).toBe(GENERIC_AGENT_FAILURE_TEXT);
  });

  it("converts conversation outcomes for a different event to the generic failure", async () => {
    const control: AgentControlFrame[] = [];
    const frame = eventFrame({ event: event({ eventId: "event9", stageRevision: 11 }) });
    const agent: FacetAgent = {
      handleEvent: () => Promise.resolve(outcome()),
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(frame)]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent,
      reconnectMs: 1_000,
    });
    await tick();
    connection.close();

    expect(control).toHaveLength(1);
    expect(control[0]?.eventId).toBe("event9");
    expect(control[0]?.outcome.stageRevision).toBe(11);
    expect(control[0]?.outcome.patches).toEqual([]);
    expect(control[0]?.outcome.conversation?.messageId).toBe(
      deriveMessageId("event9", "assistant"),
    );
    expect(control[0]?.outcome.conversation?.text).toBe(GENERIC_AGENT_FAILURE_TEXT);
  });

  it("posts a generic fallback when the agent throws without leaking secret error text", async () => {
    const control: AgentControlFrame[] = [];
    const agent: FacetAgent = {
      handleEvent: () => {
        throw new Error("provider secret sk-live-123 leaked stack");
      },
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(eventFrame())]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent,
      reconnectMs: 1_000,
    });
    await tick();
    connection.close();

    expect(control[0]?.eventId).toBe("event1");
    expect(control[0]?.outcome.conversation?.messageId).toBe(
      deriveMessageId("event1", "assistant"),
    );
    expect(control[0]?.outcome.conversation?.text).toBe(GENERIC_AGENT_FAILURE_TEXT);
    expect(control[0]?.outcome.conversation?.text).not.toContain("sk-live-123");
  });

  it("bounds concurrent turns and settles overflow without starting more provider work", async () => {
    const control: AgentControlFrame[] = [];
    const started: string[] = [];
    const finishers = new Map<string, () => void>();
    const frames = [
      eventFrame({ event: event({ eventId: "event1" }) }),
      eventFrame({ event: event({ eventId: "event2" }) }),
      eventFrame({ event: event({ eventId: "event3" }) }),
    ];
    const agent: FacetAgent = {
      handleEvent: (frame) => {
        started.push(frame.event.eventId);
        return new Promise<TurnOutcome>((resolveTurn) => {
          finishers.set(frame.event.eventId, () => resolveTurn(outcomeFor(frame)));
        });
      },
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse(frames.map((frame) => sseFrame(frame))));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent,
      maxConcurrentTurns: 1,
      maxQueuedTurns: 1,
      reconnectMs: 1_000,
    });
    await tick();

    expect(started).toEqual(["event1"]);
    expect(control).toHaveLength(1);
    expect(control[0]?.eventId).toBe("event3");
    expect(control[0]?.outcome.conversation?.text).toBe(BUSY_AGENT_FAILURE_TEXT);

    finishers.get("event1")?.();
    await tick();
    expect(started).toEqual(["event1", "event2"]);
    finishers.get("event2")?.();
    await tick();
    connection.close();

    expect(control.map((frame) => frame.eventId).sort()).toEqual(["event1", "event2", "event3"]);
    expect(started).toEqual(["event1", "event2"]);
  });

  it("aborts a turn when the server-provided timeout budget expires", async () => {
    const control: AgentControlFrame[] = [];
    let signal: AbortSignal | undefined;
    let finish: (() => void) | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const frame = eventFrame({ timeoutMs: 1 });
    const agent: FacetAgent = {
      handleEvent: (_frame, context) => {
        signal = context?.signal;
        resolveStarted?.();
        return new Promise<TurnOutcome>((resolveTurn) => {
          finish = () => resolveTurn(outcome());
        });
      },
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(frame)]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent,
      reconnectMs: 1_000,
    });

    await started;
    await tick();
    expect(signal?.aborted).toBe(true);
    finish?.();
    await tick();
    connection.close();

    expect(control).toEqual([]);
  });

  it("releases the concurrency slot when a timed-out turn never settles", async () => {
    const control: AgentControlFrame[] = [];
    const started: string[] = [];
    let firstSignal: AbortSignal | undefined;
    const first = eventFrame({ event: event({ eventId: "event1" }), timeoutMs: 1 });
    const second = eventFrame({ event: event({ eventId: "event2" }) });
    const agent: FacetAgent = {
      handleEvent: (frame, context) => {
        started.push(frame.event.eventId);
        if (frame.event.eventId === "event1") {
          firstSignal = context?.signal;
          return new Promise<TurnOutcome>(() => {});
        }
        return Promise.resolve(outcomeFor(frame, "second ok"));
      },
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(first), sseFrame(second)]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent,
      maxConcurrentTurns: 1,
      maxQueuedTurns: 1,
      reconnectMs: 1_000,
    });

    await tick();
    connection.close();

    expect(firstSignal?.aborted).toBe(true);
    expect(started).toEqual(["event1", "event2"]);
    expect(control).toHaveLength(1);
    expect(control[0]?.eventId).toBe("event2");
    expect(control[0]?.outcome.conversation?.text).toBe("second ok");
  });

  it("does not start queued turns after their server-provided deadline expired", async () => {
    const control: AgentControlFrame[] = [];
    const started: string[] = [];
    const finishers = new Map<string, () => void>();
    const first = eventFrame({ event: event({ eventId: "event1" }) });
    const second = eventFrame({ event: event({ eventId: "event2" }), timeoutMs: 1 });
    const agent: FacetAgent = {
      handleEvent: (frame) => {
        started.push(frame.event.eventId);
        return new Promise<TurnOutcome>((resolveTurn) => {
          finishers.set(frame.event.eventId, () => resolveTurn(outcomeFor(frame)));
        });
      },
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(first), sseFrame(second)]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as AgentControlFrame);
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent,
      maxConcurrentTurns: 1,
      maxQueuedTurns: 1,
      reconnectMs: 1_000,
    });

    await tick();
    expect(started).toEqual(["event1"]);
    await tick();
    finishers.get("event1")?.();
    await tick();
    connection.close();

    expect(started).toEqual(["event1"]);
    expect(control.map((frame) => frame.eventId).sort()).toEqual(["event1", "event2"]);
    expect(control.find((frame) => frame.eventId === "event2")?.outcome.conversation?.text).toBe(
      EXPIRED_AGENT_FAILURE_TEXT,
    );
  });

  it("logs rejected control posts instead of treating them as delivered", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(eventFrame())]));
      }
      if (url.includes("/agent/control")) {
        return Promise.resolve(stubResponse(false, 409));
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent: { handleEvent: (frame) => Promise.resolve(outcomeFor(frame)) },
      reconnectMs: 1_000,
    });

    await tick();
    connection.close();

    expect(errorSpy).toHaveBeenCalledWith(
      "[facet] control post failed:",
      expect.any(Error) as Error,
    );
    expect(String(errorSpy.mock.calls[0]?.[1])).toContain("POST /agent/control failed: 409");
  });

  it("releases turn slots when a control POST hangs", async () => {
    vi.useFakeTimers();
    const control: AgentControlFrame[] = [];
    const started: string[] = [];
    const first = eventFrame({ event: event({ eventId: "event1" }) });
    const second = eventFrame({ event: event({ eventId: "event2" }) });
    const agent: FacetAgent = {
      handleEvent: (frame) => {
        started.push(frame.event.eventId);
        return Promise.resolve(outcomeFor(frame, `${frame.event.eventId} ok`));
      },
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string; signal?: AbortSignal }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(first), sseFrame(second)]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        const frame = JSON.parse(init.body) as AgentControlFrame;
        control.push(frame);
        if (frame.eventId === "event1") {
          return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          });
        }
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent,
      maxConcurrentTurns: 1,
      maxQueuedTurns: 1,
      reconnectMs: 1_000,
    });

    await flushMicrotasks();
    expect(started).toEqual(["event1"]);
    await vi.advanceTimersByTimeAsync(5_000);
    await flushMicrotasks();
    connection.close();

    expect(started).toEqual(["event1", "event2"]);
    expect(control.map((frame) => frame.eventId)).toEqual(["event1", "event2"]);
  });

  it("aborts an active control POST when the connection closes", async () => {
    vi.useFakeTimers();
    let controlSignal: AbortSignal | undefined;
    let resolveControlStarted: (() => void) | undefined;
    const controlStarted = new Promise<void>((resolve) => {
      resolveControlStarted = resolve;
    });
    const fetchMock = vi.fn((url: string, init?: { body?: string; signal?: AbortSignal }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(eventFrame())]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        controlSignal = init.signal;
        resolveControlStarted?.();
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent: { handleEvent: (frame) => Promise.resolve(outcomeFor(frame)) },
      reconnectMs: 1_000,
    });

    await controlStarted;
    expect(controlSignal?.aborted).toBe(false);
    connection.close();
    expect(controlSignal?.aborted).toBe(true);
    await flushMicrotasks();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a pending reconnect timer on close", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(stubResponse(false, 500)));
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent: { handleEvent: () => Promise.resolve(outcome()) },
      reconnectMs: 60_000,
    });

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    connection.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops on terminal 403 and keeps retrying a transient 500", async () => {
    const refused = vi.fn(() => Promise.resolve(stubResponse(false, 403)));
    vi.stubGlobal("fetch", refused);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent: { handleEvent: () => Promise.resolve(outcome()) },
      reconnectMs: 1,
    });
    await tick();
    expect(refused).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[facet] agent connection refused (403: bad token) — not reconnecting",
    );
    first.close();

    vi.unstubAllGlobals();
    const transient = vi.fn(() => Promise.resolve(stubResponse(false, 500)));
    vi.stubGlobal("fetch", transient);
    const second = connectAgent({
      serverUrl: "http://s",
      agentId: "agent1",
      agent: { handleEvent: () => Promise.resolve(outcome()) },
      reconnectMs: 1,
    });
    await tick();
    expect(transient.mock.calls.length).toBeGreaterThan(1);
    second.close();
  });

  it("keeps the barrel on the exact runtime and type export contract", async () => {
    const module = await import("./index.js");
    expect(Object.keys(module).sort()).toEqual(["connectAgent", "parseSseFrames"]);
    expect(readFileSync("packages/adapters/agent-client/src/index.ts", "utf8")).toBe(
      'export { connectAgent, parseSseFrames } from "./connect.js";\n' +
        'export type { AgentConnection, ConnectOptions } from "./connect.js";\n',
    );
  });

  it("documents the external-agent protocol instead of the in-process Stage API", () => {
    const readme = readFileSync("packages/adapters/agent-client/README.md", "utf8");

    expect(readme).toContain("npm install @facet/agent-client @facet/core");
    expect(readme).toContain("type FacetAgent");
    expect(readme).toContain('agentId: "external-agent"');
    expect(readme).not.toContain("defineAgent");
    expect(readme).not.toContain('from "@facet/agent"');
  });
});
