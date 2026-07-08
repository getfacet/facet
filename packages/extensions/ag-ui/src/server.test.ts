import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

import { EventType } from "@ag-ui/core";
import type { AGUIEvent, RunAgentInput, StateSnapshotEvent } from "@ag-ui/core";
import type { ClientEvent, CollectedEvent, FacetTree, ServerMessage, VisitorContext } from "@facet/core";
import { describe, expect, it } from "vitest";

import { handleAgUiRequest, runFacetAsAgUi } from "./server.js";

const visitor: VisitorContext = {
  visitorId: "visitor-1",
  locale: "en-US",
};

const stage: FacetTree = {
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "box",
      children: ["headline"],
    },
    headline: {
      id: "headline",
      type: "text",
      value: "Server snapshot",
    },
  },
};

const hostileStateStage: FacetTree = {
  root: "hostile",
  nodes: {
    hostile: {
      id: "hostile",
      type: "text",
      value: "client-supplied state must not become authority",
    },
  },
};

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

interface TurnResult {
  readonly messages: readonly ServerMessage[];
  readonly agentMutated: boolean;
}

type FrameSink = (messages: readonly ServerMessage[]) => void;

class MemoryRuntime {
  readonly handled: Array<{ readonly visitor: VisitorContext; readonly event: ClientEvent }> = [];
  readonly recorded: Array<{ readonly visitor: VisitorContext; readonly event: CollectedEvent }> = [];

  constructor(
    private readonly handleImpl: (
      visitor: VisitorContext,
      event: ClientEvent,
      onFrame?: FrameSink,
    ) => Promise<TurnResult> | TurnResult = () => ({ messages: [], agentMutated: false }),
    private readonly snapshot?: FacetTree,
  ) {}

  async stageFor(visitorId: string): Promise<FacetTree | undefined> {
    expect(visitorId).toBe(visitor.visitorId);
    return this.snapshot;
  }

  async handle(visitor: VisitorContext, event: ClientEvent, onFrame?: FrameSink): Promise<TurnResult> {
    this.handled.push({ visitor, event });
    return this.handleImpl(visitor, event, onFrame);
  }

  async record(visitor: VisitorContext, event: CollectedEvent): Promise<void> {
    this.recorded.push({ visitor, event });
  }
}

function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function runInput(facet: unknown, overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: { facet },
    ...overrides,
  };
}

function eventTypes(events: readonly AGUIEvent[]): readonly EventType[] {
  return events.map((event) => event.type);
}

function requestWithBody(body: string): IncomingMessage {
  const req = Readable.from([body]);
  Object.assign(req, {
    method: "POST",
    url: "/ag-ui",
    headers: { "content-type": "application/json" },
  });
  return req as unknown as IncomingMessage;
}

type HeaderValue = number | string | readonly string[];

class FakeResponse {
  statusCode = 0;
  headersSent = false;
  ended = false;
  readonly headers: Record<string, HeaderValue> = {};
  private readonly chunks: string[] = [];

  writeHead(statusCode: number, headers: Record<string, HeaderValue> = {}): this {
    this.statusCode = statusCode;
    this.headersSent = true;
    for (const [name, value] of Object.entries(headers)) {
      this.headers[name] = value;
    }
    return this;
  }

  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }

  end(chunk?: string | Uint8Array): this {
    if (chunk !== undefined) this.write(chunk);
    this.ended = true;
    return this;
  }

  body(): string {
    return this.chunks.join("");
  }
}

function parseSseEvents(body: string): readonly AGUIEvent[] {
  if (body.trim() === "") return [];
  return body
    .trim()
    .split("\n\n")
    .map((frame) => {
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine === undefined) throw new Error(`missing data line in frame: ${frame}`);
      return JSON.parse(dataLine.slice("data: ".length)) as AGUIEvent;
    });
}

describe("AG-UI server adapter", () => {
  it("forwards RunAgentInput.forwardedProps.facet.event to FacetRuntime.handle", async () => {
    const runtime = new MemoryRuntime((_visitor, event, onFrame) => {
      onFrame?.([{ kind: "say", text: `handled:${event.kind}` }]);
      return { messages: [], agentMutated: false };
    });

    const events = await runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "hello", seq: 7 } }),
    );

    expect(runtime.handled).toEqual([{ visitor, event: { kind: "message", text: "hello", seq: 7 } }]);
    expect(eventTypes(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    expect(events[0]).toMatchObject({ threadId: "thread-1", runId: "run-1" });
    expect(events.at(-1)).toMatchObject({ threadId: "thread-1", runId: "run-1" });
    expect(events[2]).toMatchObject({ delta: "handled:message" });
  });

  it("forwards RunAgentInput.forwardedProps.facet.record to FacetRuntime.record without invoking the agent", async () => {
    const runtime = new MemoryRuntime(() => {
      throw new Error("handle should not be invoked for record input");
    });
    const record: CollectedEvent = {
      kind: "tap",
      target: "panel",
      effect: { toggle: "panel" },
      seq: 3,
    };

    const events = await runFacetAsAgUi(runtime, runInput({ visitor, record }));

    expect(runtime.handled).toEqual([]);
    expect(runtime.recorded).toEqual([{ visitor, event: record }]);
    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
  });

  it("ignores RunAgentInput.state as stage authority and emits fresh runtime snapshots when requested", async () => {
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "say", text: "from-runtime" }]);
      return { messages: [], agentMutated: false };
    }, stage);

    const events = await runFacetAsAgUi(
      runtime,
      runInput(
        { visitor, event: { kind: "message", text: "snapshot" } },
        { state: { facet: { stage: hostileStateStage } } },
      ),
      { includeSnapshot: true },
    );
    const snapshot = events.find((event): event is StateSnapshotEvent => event.type === EventType.STATE_SNAPSHOT);

    expect(runtime.handled).toEqual([{ visitor, event: { kind: "message", text: "snapshot" } }]);
    expect(snapshot?.snapshot).toEqual({ facet: { stage } });
    expect(snapshot?.snapshot).not.toEqual({ facet: { stage: hostileStateStage } });
    expect(eventTypes(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  it("preserves lifecycle, text, and state event order from runtime delivery order", async () => {
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "say", text: "first" }]);
      onFrame?.([{ kind: "patch", patches: [{ op: "replace", path: "", value: stage }] }]);
      onFrame?.([{ kind: "say", text: "second" }]);
      return { messages: [], agentMutated: true };
    });

    const events = await runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "order" } }),
    );

    expect(eventTypes(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.STATE_DELTA,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    expect(events[2]).toMatchObject({ delta: "first" });
    expect(events[6]).toMatchObject({ delta: "second" });
  });

  it("returns RUN_ERROR for malformed AG-UI input without throwing", async () => {
    const runtime = new MemoryRuntime();

    await expect(runFacetAsAgUi(runtime, { threadId: "thread-1" })).resolves.toEqual([
      expect.objectContaining({
        type: EventType.RUN_ERROR,
        code: "BAD_REQUEST",
      }),
    ]);
  });

  it("rejects local action smuggling and over-cap field records at the AG-UI boundary", async () => {
    const runtime = new MemoryRuntime();
    const long = "x".repeat(2001);
    const tooManyFields = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`field-${String(index)}`, "value"]),
    );

    const cases: readonly unknown[] = [
      { visitor, event: { kind: "tap", action: { kind: "navigate", to: "settings" } } },
      { visitor, event: { kind: "tap", action: { kind: "toggle", target: "panel" } } },
      {
        visitor,
        event: { kind: "tap", action: { name: "choose" }, effect: { toggle: "panel" } },
      },
      { visitor, record: { kind: "message", text: "not a local record" } },
      { visitor, record: { kind: "tap", action: { name: "choose" } } },
      { visitor, record: { kind: "tap", target: "panel" } },
      { visitor, record: { kind: "tap", target: long, effect: { toggle: "panel" } } },
      { visitor, record: { kind: "tap", effect: { toggle: long } } },
      { visitor, record: { kind: "tap", effect: { toggle: "panel" }, fields: tooManyFields } },
      { visitor, record: { kind: "tap", effect: { toggle: "panel" }, fields: { [long]: "value" } } },
      { visitor, record: { kind: "tap", effect: { toggle: "panel" }, fields: { ok: long } } },
    ];

    for (const facet of cases) {
      const events = await runFacetAsAgUi(runtime, runInput(facet));
      expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    }
    expect(runtime.handled).toEqual([]);
    expect(runtime.recorded).toEqual([]);
  });

  it("turns runtime failures into terminal RUN_ERROR events", async () => {
    const runtime = new MemoryRuntime(() => {
      throw new Error("runtime offline");
    });

    const events = await runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "fail" } }),
    );

    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      threadId: "thread-1",
      runId: "run-1",
      message: "runtime offline",
    });
  });

  it("routes rapid same-visitor requests to the runtime in request order", async () => {
    const calls: string[] = [];
    const gates: Deferred[] = [];
    const runtime = new MemoryRuntime(async (_visitor, event) => {
      calls.push(event.kind === "message" ? event.text : event.kind);
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      return {
        messages: [{ kind: "say", text: event.kind === "message" ? event.text : event.kind }],
        agentMutated: false,
      };
    });

    const first = runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
    );
    const second = runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
    );

    expect(calls).toEqual(["first", "second"]);
    gates[1]?.resolve();
    gates[0]?.resolve();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("writes valid AG-UI runs as SSE without requiring a real server", async () => {
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "say", text: "over-sse" }]);
      return { messages: [], agentMutated: false };
    });
    const res = new FakeResponse();

    await handleAgUiRequest(
      requestWithBody(JSON.stringify(runInput({ visitor, event: { kind: "message", text: "http" } }))),
      res as unknown as ServerResponse,
      runtime,
    );

    const events = parseSseEvents(res.body());
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect(res.ended).toBe(true);
    expect(eventTypes(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  it("responds HTTP 400 for malformed handler input without throwing past the handler", async () => {
    const runtime = new MemoryRuntime();
    const res = new FakeResponse();

    await expect(
      handleAgUiRequest(requestWithBody(JSON.stringify({ threadId: "thread-1" })), res as unknown as ServerResponse, runtime),
    ).resolves.toBeUndefined();

    const events = parseSseEvents(res.body());
    expect(res.statusCode).toBe(400);
    expect(eventTypes(events)).toEqual([EventType.RUN_ERROR]);
    expect(events[0]).toMatchObject({ code: "BAD_REQUEST" });
  });
});
