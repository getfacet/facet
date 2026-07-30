import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveMessageId } from "@facet/core";
import type {
  AgentControlFrame,
  AgentEvent,
  AgentEventFrame,
  FacetAgent,
  TurnOutcome,
} from "@facet/core";

import { connectAgent, parseSseFrames } from "./connect.js";

const GENERIC_AGENT_FAILURE_TEXT = "The agent could not complete this turn.";

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
const sseFrame = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;
const stubResponse = (ok: boolean, status: number): Response =>
  ({ ok, status, body: null }) as unknown as Response;

function sseStreamResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

function event(overrides: Partial<AgentEvent> = {}): AgentEvent {
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

function eventFrame(overrides: Partial<AgentEventFrame> = {}): AgentEventFrame {
  return Object.freeze({
    kind: "agent_event" as const,
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("connectAgent", () => {
  it("routes AgentEventFrame to the agent and posts a correlated AgentControlFrame", async () => {
    const seen: AgentEventFrame[] = [];
    const control: AgentControlFrame[] = [];
    const agent: FacetAgent = {
      handleEvent: (frame) => {
        seen.push(frame);
        return Promise.resolve(outcome());
      },
    };
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse(["data: not json\n\n", sseFrame(eventFrame())]));
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

    expect(seen).toEqual([eventFrame()]);
    expect(control).toEqual([
      {
        kind: "agent_control",
        eventId: "event1",
        outcome: outcome(),
      },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `http://s/agent/stream?agentId=${encodeURIComponent("agent/a")}`,
    );
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
