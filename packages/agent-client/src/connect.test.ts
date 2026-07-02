import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEventFrame, ClientEvent, FacetAgent, ServerMessage } from "@facet/core";
import { connectAgent, parseSseFrames } from "./connect.js";

describe("parseSseFrames", () => {
  it("extracts a single complete frame and leaves no rest", () => {
    const { data, rest } = parseSseFrames('data: {"a":1}\n\n');
    expect(data).toEqual(['{"a":1}']);
    expect(rest).toBe("");
  });

  it("returns multiple frames in one buffer", () => {
    const { data } = parseSseFrames("data: one\n\ndata: two\n\n");
    expect(data).toEqual(["one", "two"]);
  });

  it("keeps an incomplete trailing frame as rest", () => {
    const { data, rest } = parseSseFrames("data: done\n\ndata: partial");
    expect(data).toEqual(["done"]);
    expect(rest).toBe("data: partial");
  });

  it("reassembles a frame split across two chunks", () => {
    const first = parseSseFrames("data: hel");
    expect(first.data).toEqual([]);
    const second = parseSseFrames(first.rest + "lo\n\n");
    expect(second.data).toEqual(["hello"]);
  });

  it("ignores non-data lines (comments / heartbeats) without losing following frames", () => {
    const { data } = parseSseFrames(": keep-alive\n\ndata: real\n\n");
    expect(data).toEqual(["real"]);
  });
});

// --- connectAgent (reconnect loop + event routing) ------------------------

/** Wait for the background loop's microtasks/timers to settle. */
const tick = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Uses performance.now (a real monotonic clock) so it keeps working when a test
// mocks Date.now to fast-forward the 409 budget.
/** Poll until the reconnect loop stops dialing (fetch count stable) or a cap elapses. */
async function settle(fetchMock: { mock: { calls: unknown[] } }, capMs = 600): Promise<void> {
  const start = performance.now();
  let prev = -1;
  while (performance.now() - start < capMs) {
    await tick(10);
    const now = fetchMock.mock.calls.length;
    if (now === prev) return;
    prev = now;
  }
}

/** A stub `fetch` stream response whose body replays the given SSE chunks then ends. */
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

const sseFrame = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

/** A stub non-stream response (control / heartbeat POST ack, or a status refusal). */
const stubResponse = (ok: boolean, status: number): Response =>
  ({ ok, status, body: null }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("connectAgent — terminal statuses", () => {
  it("stops reconnecting after a terminal 403", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(stubResponse(false, 403)));
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "a/1",
      agent: () => [],
      reconnectMs: 1,
    });

    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const afterFirst = fetchMock.mock.calls.length;
    await tick(); // the loop must NOT dial again
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("403");

    connection.close();
  });

  // Fast-forwards the wall clock a fixed step on each Date.now read, so the
  // time-based 409 budget (60s) elapses in a handful of reconnectMs:1 iterations.
  // Restored by restoreAllMocks in afterEach.
  const mockClock = (stepMs: number): void => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += stepMs;
      return now;
    });
  };

  it("retries 409 while the server slot clears, then stays connected", async () => {
    // A 409 is usually the agent's own ghost stream lingering until the server
    // reaper clears it. The slot frees after a few attempts → the redial gets a
    // live stream and the bridge stays up (it must NOT give up on the first 409).
    mockClock(1_000); // 3 conflicts span ~3s — well inside the 60s budget
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      if (calls <= 3) return Promise.resolve(stubResponse(false, 409));
      return Promise.resolve(sseStreamResponse([])); // slot cleared — ok stream
    });
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "a/1",
      agent: () => [],
      reconnectMs: 1,
    });

    await tick();
    // Dialed past the three 409s to a successful connection, and never gave up.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(3);
    expect(errorSpy).not.toHaveBeenCalled();

    connection.close();
  });

  it("gives up once sustained 409s outlast the wall-clock budget", async () => {
    // The budget is time-based, so even a tiny reconnectMs can't burn it early:
    // termination is driven by elapsed virtual time, not attempt count.
    mockClock(10_000); // 10s per attempt → budget elapses after ~6 attempts
    const fetchMock = vi.fn(() => Promise.resolve(stubResponse(false, 409)));
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "a/1",
      agent: () => [],
      reconnectMs: 1,
    });

    await settle(fetchMock);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("409");
    const afterGiveUp = fetchMock.mock.calls.length;
    await tick(); // the loop must NOT dial again
    expect(fetchMock.mock.calls.length).toBe(afterGiveUp);

    connection.close();
  });

  it("terminates a 409/network-error flap once the budget elapses", async () => {
    // Flap defense: a network error must NOT reset the 409 streak clock, else an
    // alternating 409/flap sequence would retry forever.
    mockClock(10_000);
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      return calls % 2 === 1
        ? Promise.resolve(stubResponse(false, 409))
        : Promise.reject(new Error("flap"));
    });
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "a/1",
      agent: () => [],
      reconnectMs: 1,
    });

    await settle(fetchMock);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("409");
    const afterGiveUp = fetchMock.mock.calls.length;
    await tick();
    expect(fetchMock.mock.calls.length).toBe(afterGiveUp);

    connection.close();
  });

  it("keeps reconnecting after a non-terminal 500", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(stubResponse(false, 500)));
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "a/1",
      agent: () => [],
      reconnectMs: 1,
    });

    await tick();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    connection.close();
  });

  it("keeps reconnecting after a network error", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("connection refused")));
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "a/1",
      agent: () => [],
      reconnectMs: 1,
    });

    await tick();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    connection.close();
  });
});

describe("connectAgent — event routing", () => {
  it("routes a valid frame to the agent and echoes its requestId in the control POST", async () => {
    const seen: Array<{ event: ClientEvent; agentId: string; visitorId: string }> = [];
    const control: Array<{ requestId: number; messages: ServerMessage[] }> = [];
    const event: ClientEvent = { kind: "message", text: "hi" };
    const frame: AgentEventFrame = { type: "event", requestId: 42, visitorId: "v/9", event };
    const agent: FacetAgent = (received, session) => {
      seen.push({
        event: received,
        agentId: session.agentId,
        visitorId: session.visitor.visitorId,
      });
      return [{ kind: "say", text: "ok" }];
    };

    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        // A malformed frame precedes the valid one: it must be skipped without
        // killing the stream, so the following valid frame still routes.
        return Promise.resolve(sseStreamResponse(["data: not json\n\n", sseFrame(frame)]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as { requestId: number; messages: ServerMessage[] });
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "a/7",
      agent,
      reconnectMs: 1_000,
    });

    await tick();
    connection.close();

    expect(seen).toEqual([{ event, agentId: "a/7", visitorId: "v/9" }]);
    expect(control).toHaveLength(1);
    expect(control[0]?.requestId).toBe(42);
    expect(control[0]?.messages).toEqual([{ kind: "say", text: "ok" }]);
  });

  it("posts an agent-error say when the agent throws", async () => {
    const control: Array<{ requestId: number; messages: ServerMessage[] }> = [];
    const frame: AgentEventFrame = {
      type: "event",
      requestId: 7,
      visitorId: "v/1",
      event: { kind: "message", text: "hi" },
    };
    const agent: FacetAgent = () => {
      throw new Error("boom");
    };

    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/agent/stream")) {
        return Promise.resolve(sseStreamResponse([sseFrame(frame)]));
      }
      if (url.includes("/agent/control") && init?.body !== undefined) {
        control.push(JSON.parse(init.body) as { requestId: number; messages: ServerMessage[] });
      }
      return Promise.resolve(stubResponse(true, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = connectAgent({
      serverUrl: "http://s",
      agentId: "a/1",
      agent,
      reconnectMs: 1_000,
    });

    await tick();
    connection.close();

    expect(control).toHaveLength(1);
    expect(control[0]?.requestId).toBe(7);
    expect(control[0]?.messages).toEqual([{ kind: "say", text: "(agent error: boom)" }]);
  });
});
