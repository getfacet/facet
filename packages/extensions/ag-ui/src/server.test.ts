import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

import { EventType } from "@ag-ui/core";
import type { AGUIEvent, RunAgentInput, StateSnapshotEvent } from "@ag-ui/core";
import { MAX_VIEW_TOGGLED_KEYS } from "@facet/core";
import type {
  ClientEvent,
  CollectedEvent,
  FacetTree,
  JsonPatchOperation,
  ServerMessage,
  VisitorContext,
} from "@facet/core";
import type { RuntimeFrameContext } from "@facet/runtime";
import { describe, expect, it, vi } from "vitest";

import { handleAgUiRequest, runFacetAsAgUi, writeAgUiSseEvent } from "./server.js";
import * as serverExports from "./server.js";

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

function stageWithHeadline(value: string): FacetTree {
  return {
    ...stage,
    nodes: {
      ...stage.nodes,
      headline: {
        id: "headline",
        type: "text",
        value,
      },
    },
  };
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

interface TurnResult {
  readonly messages: readonly ServerMessage[];
  readonly agentMutated: boolean;
}

type FrameSink = (messages: readonly ServerMessage[], context?: RuntimeFrameContext) => void;

class MemoryRuntime {
  readonly handled: Array<{ readonly visitor: VisitorContext; readonly event: ClientEvent }> = [];
  readonly recorded: Array<{ readonly visitor: VisitorContext; readonly event: CollectedEvent }> =
    [];

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

  async handle(
    visitor: VisitorContext,
    event: ClientEvent,
    onFrame?: FrameSink,
  ): Promise<TurnResult> {
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

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(predicate()).toBe(true);
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

function runTrusted(
  runtime: Parameters<typeof runFacetAsAgUi>[0],
  input: unknown,
  options: Parameters<typeof runFacetAsAgUi>[2] = {},
): Promise<readonly AGUIEvent[]> {
  return runFacetAsAgUi(runtime, input, { allowForwardedVisitor: true, ...options });
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

function requestWithMethod(method: string, body = ""): IncomingMessage {
  const req = requestWithBody(body);
  Object.assign(req, { method });
  return req;
}

type HeaderValue = number | string | readonly string[];

class FakeResponse extends EventEmitter {
  statusCode = 0;
  headersSent = false;
  ended = false;
  destroyed = false;
  writableEnded = false;
  writeResult = true;
  throwOnWrite = false;
  emitCloseOnDestroy = true;
  readonly headers: Record<string, HeaderValue> = {};
  private readonly chunks: string[] = [];

  constructor() {
    super();
  }

  writeHead(statusCode: number, headers: Record<string, HeaderValue> = {}): this {
    this.statusCode = statusCode;
    this.headersSent = true;
    for (const [name, value] of Object.entries(headers)) {
      this.headers[name] = value;
    }
    return this;
  }

  write(chunk: string | Uint8Array): boolean {
    if (this.throwOnWrite) throw new Error("write failed");
    this.chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return this.writeResult;
  }

  end(chunk?: string | Uint8Array): this {
    if (chunk !== undefined) this.write(chunk);
    this.ended = true;
    this.writableEnded = true;
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    this.writableEnded = true;
    if (this.emitCloseOnDestroy) this.emit("close");
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
  it("keeps the exact Node server runtime export surface", () => {
    expect(Object.keys(serverExports).sort()).toEqual([
      "facetInputFromRunAgentInput",
      "handleAgUiRequest",
      "runFacetAsAgUi",
      "writeAgUiSseEvent",
    ]);
  });

  it("writes a safe SSE error for non-JSON AG-UI event payloads", () => {
    const res = new FakeResponse();

    expect(() =>
      writeAgUiSseEvent(
        res as unknown as ServerResponse,
        { type: EventType.CUSTOM, name: "unsafe", value: 1n } as unknown as AGUIEvent,
      ),
    ).not.toThrow();

    const events = parseSseEvents(res.body());
    expect(eventTypes(events)).toEqual([EventType.RUN_ERROR]);
    expect(events[0]).toMatchObject({
      code: "BAD_REQUEST",
      message: "Malformed AG-UI SSE event",
    });
  });

  it("forwards RunAgentInput.forwardedProps.facet.event to FacetRuntime.handle", async () => {
    const runtime = new MemoryRuntime((_visitor, event, onFrame) => {
      onFrame?.([{ kind: "say", text: `handled:${event.kind}` }]);
      return { messages: [], agentMutated: false };
    });

    const events = await runTrusted(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "hello", seq: 7 } }),
    );

    expect(runtime.handled).toEqual([
      { visitor, event: { kind: "message", text: "hello", seq: 7 } },
    ]);
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

    const events = await runTrusted(runtime, runInput({ visitor, record }));

    expect(runtime.handled).toEqual([]);
    expect(runtime.recorded).toEqual([{ visitor, event: record }]);
    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
  });

  it("does not wait for slow record persistence before finishing a record run", async () => {
    const gate = deferred();
    const recorded: Array<{ readonly visitor: VisitorContext; readonly event: CollectedEvent }> =
      [];
    const runtime = {
      stageFor: async () => undefined,
      handle: async () => ({ messages: [], agentMutated: false }),
      record: async (visitor: VisitorContext, event: CollectedEvent) => {
        recorded.push({ visitor, event });
        await gate.promise;
      },
    };
    const record: CollectedEvent = {
      kind: "tap",
      target: "panel",
      effect: { toggle: "panel" },
      seq: 3,
    };

    const events = await runTrusted(runtime, runInput({ visitor, record }));

    expect(recorded).toEqual([{ visitor, event: record }]);
    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
    gate.resolve();
  });

  it("rejects non-local records on the AG-UI record path", async () => {
    const runtime = new MemoryRuntime(() => {
      throw new Error("handle should not be invoked for record input");
    });
    const records: readonly CollectedEvent[] = [
      { kind: "visit", visitor: { visitorId: "event-visitor", locale: "ko-KR" }, seq: 1 },
      { kind: "message", text: "log-only", seq: 2 },
      { kind: "tap", target: "panel", seq: 3 },
      { kind: "tap", action: { kind: "navigate", to: "settings" }, seq: 4 },
      {
        kind: "tap",
        action: { kind: "agent", name: "choose", payload: { id: 1 }, collect: "form" },
        fields: { agree: true },
        seq: 5,
      },
    ];

    for (const record of records) {
      const events = await runTrusted(runtime, runInput({ visitor, record }));
      expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    }

    expect(runtime.handled).toEqual([]);
    expect(runtime.recorded).toEqual([]);
  });

  it("ignores RunAgentInput.state as stage authority and emits fresh runtime snapshots when requested", async () => {
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "say", text: "from-runtime" }]);
      return { messages: [], agentMutated: false };
    }, stage);

    const events = await runTrusted(
      runtime,
      runInput(
        { visitor, event: { kind: "message", text: "snapshot" } },
        { state: { facet: { stage: hostileStateStage } } },
      ),
      { includeSnapshot: true },
    );
    const snapshot = events.find(
      (event): event is StateSnapshotEvent => event.type === EventType.STATE_SNAPSHOT,
    );

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

    const events = await runTrusted(
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

  it("converts non-streaming returned runtime messages when no frame callback fires", async () => {
    const runtime = new MemoryRuntime(() => ({
      messages: [
        { kind: "say", text: "returned" },
        { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] },
      ],
      agentMutated: true,
    }));

    const events = await runTrusted(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "return" } }),
    );

    expect(eventTypes(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.STATE_DELTA,
      EventType.RUN_FINISHED,
    ]);
    expect(events[2]).toMatchObject({ delta: "returned" });
    expect(events[4]).toMatchObject({
      delta: [{ op: "replace", path: "/facet/stage", value: stage }],
    });
  });

  it("emits a runtime snapshot fallback when an outbound patch cannot be converted", async () => {
    const malformedPatch = {
      op: "replace",
      path: "/nodes/headline/value",
    } as unknown as JsonPatchOperation;
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "patch", patches: [malformedPatch] }], { stage });
      return { messages: [], agentMutated: true };
    });

    const events = await runTrusted(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "patch" } }),
    );
    const snapshot = events.find(
      (event): event is StateSnapshotEvent => event.type === EventType.STATE_SNAPSHOT,
    );

    expect(eventTypes(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.RUN_FINISHED,
    ]);
    expect(snapshot?.snapshot).toEqual({ facet: { stage } });
  });

  it("uses the runtime frame stage for fallback snapshots instead of rereading future state", async () => {
    const frameStage = stageWithHeadline("Frame stage");
    const futureStage = stageWithHeadline("Future stage");
    const malformedPatch = {
      op: "replace",
      path: "/nodes/headline/value",
    } as unknown as JsonPatchOperation;
    let stageReads = 0;
    const runtime = {
      stageFor: async () => {
        stageReads += 1;
        return futureStage;
      },
      record: async () => undefined,
      handle: async (
        _visitor: VisitorContext,
        _event: ClientEvent,
        onFrame?: FrameSink,
      ): Promise<TurnResult> => {
        onFrame?.([{ kind: "patch", patches: [malformedPatch] }], { stage: frameStage });
        return { messages: [], agentMutated: true };
      },
    };

    const events = await runTrusted(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "patch" } }),
    );
    const snapshot = events.find(
      (event): event is StateSnapshotEvent => event.type === EventType.STATE_SNAPSHOT,
    );

    expect(stageReads).toBe(0);
    expect(snapshot?.snapshot).toEqual({ facet: { stage: frameStage } });
  });

  it("normalizes valid agent tap events with payload, collect, fields, and seq", async () => {
    const runtime = new MemoryRuntime();
    const event: ClientEvent = {
      kind: "tap",
      action: { kind: "agent", name: "submit", payload: { id: 1, ok: true }, collect: "form" },
      fields: { email: "a@example.com", agree: true },
      seq: 9,
    };

    const events = await runTrusted(runtime, runInput({ visitor, event }));

    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
    expect(runtime.handled).toEqual([{ visitor, event }]);
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
      { visitor, event: { kind: "message", text: "bad seq", seq: Number.POSITIVE_INFINITY } },
      { visitor, event: { kind: "message", text: "bad seq", seq: Number.NaN } },
      { visitor, event: { kind: "tap", action: { name: "choose", payload: ["bad"] } } },
      { visitor, event: { kind: "tap", action: { name: "choose", payload: { nested: {} } } } },
      {
        visitor,
        event: {
          kind: "tap",
          action: { name: "choose", payload: { score: Number.POSITIVE_INFINITY } },
        },
      },
      {
        visitor,
        record: { kind: "tap", effect: { toggle: "panel" }, seq: Number.POSITIVE_INFINITY },
      },
      { visitor, record: { kind: "tap", target: long, effect: { toggle: "panel" } } },
      { visitor, record: { kind: "tap", effect: { toggle: long } } },
      { visitor, record: { kind: "tap", effect: { toggle: "panel" }, fields: tooManyFields } },
      {
        visitor,
        record: { kind: "tap", effect: { toggle: "panel" }, fields: { [long]: "value" } },
      },
      { visitor, record: { kind: "tap", effect: { toggle: "panel" }, fields: { ok: long } } },
      { visitor, record: { kind: "visit", visitor } },
      { visitor, record: { kind: "message", text: "log-only" } },
      { visitor, record: { kind: "tap" } },
      { visitor, record: { kind: "tap", target: "panel" } },
      { visitor, record: { kind: "tap", fields: { ok: true } } },
      { visitor, record: { kind: "tap", action: { name: "choose" } } },
    ];

    for (const facet of cases) {
      const events = await runTrusted(runtime, runInput(facet));
      expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    }
    expect(runtime.handled).toEqual([]);
    expect(runtime.recorded).toEqual([]);
  });

  it("turns runtime failures into terminal RUN_ERROR events without leaking internals", async () => {
    const runtime = new MemoryRuntime(() => {
      throw new Error("postgres://secret@internal/path");
    });

    const events = await runTrusted(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "fail" } }),
    );

    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      threadId: "thread-1",
      runId: "run-1",
      message: "Facet runtime failed",
    });
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("requires visitor authorization for the exported runFacetAsAgUi helper", async () => {
    const runtime = new MemoryRuntime();

    const events = await runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "unauthorized" } }),
    );

    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    expect(events[1]).toMatchObject({ code: "FORBIDDEN" });
    expect(runtime.handled).toEqual([]);
  });

  it("rewrites direct authorized visit events to the server-authorized visitor", async () => {
    const claimedVisitor: VisitorContext = { visitorId: "claimed-victim", locale: "en-US" };
    const authorizedVisitor: VisitorContext = { visitorId: "server-visitor", locale: "ko-KR" };
    const runtime = new MemoryRuntime();

    const events = await runFacetAsAgUi(
      runtime,
      runInput({ visitor: claimedVisitor, event: { kind: "visit", visitor: claimedVisitor } }),
      { authorizedVisitor },
    );

    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
    expect(runtime.handled).toEqual([
      { visitor: authorizedVisitor, event: { kind: "visit", visitor: authorizedVisitor } },
    ]);
  });

  it("keeps authorized malformed forwardedProps classified as BAD_REQUEST", async () => {
    const runtime = new MemoryRuntime();
    const authorizedVisitor: VisitorContext = { visitorId: "server-visitor" };
    const facet = { visitor };
    Object.defineProperty(facet, "event", {
      get: () => {
        throw new Error("event getter exploded");
      },
    });

    const events = await runFacetAsAgUi(runtime, runInput(facet), { authorizedVisitor });

    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    expect(events[1]).toMatchObject({
      code: "BAD_REQUEST",
      message: "Malformed Facet forwardedProps",
    });
    expect(runtime.handled).toEqual([]);
  });

  it("uses the direct visitor resolver and rewrites nested visit events", async () => {
    const claimedVisitor: VisitorContext = { visitorId: "claimed-victim", locale: "en-US" };
    const authorizedVisitor: VisitorContext = { visitorId: "server-visitor", locale: "ko-KR" };
    const runtime = new MemoryRuntime();

    const events = await runFacetAsAgUi(
      runtime,
      runInput(
        { visitor: claimedVisitor, event: { kind: "visit", visitor: claimedVisitor } },
        { runId: "run-resolve", threadId: "thread-resolve", parentRunId: "parent-1" },
      ),
      {
        resolveVisitor: ({ threadId, runId, parentRunId, forwardedVisitor }) => {
          expect({ threadId, runId, parentRunId, forwardedVisitor }).toEqual({
            threadId: "thread-resolve",
            runId: "run-resolve",
            parentRunId: "parent-1",
            forwardedVisitor: claimedVisitor,
          });
          return authorizedVisitor;
        },
      },
    );

    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
    expect(runtime.handled).toEqual([
      { visitor: authorizedVisitor, event: { kind: "visit", visitor: authorizedVisitor } },
    ]);
  });

  it("serializes slow direct visitor resolution before runtime execution", async () => {
    const firstGate = deferred();
    const resolverCalls: string[] = [];
    const handled: string[] = [];
    const runtime = new MemoryRuntime((_visitor, event) => {
      handled.push(event.kind === "message" ? event.text : event.kind);
      return { messages: [], agentMutated: false };
    });
    const options = {
      resolveVisitor: async ({ runId }: { readonly runId: string }) => {
        resolverCalls.push(runId);
        if (runId === "run-1") await firstGate.promise;
        return visitor;
      },
    };

    const first = runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolverCalls).toEqual(["run-1"]);
    expect(handled).toEqual([]);
    firstGate.resolve();
    await Promise.all([first, second]);

    expect(resolverCalls).toEqual(["run-1", "run-2"]);
    expect(handled).toEqual(["first", "second"]);
  });

  it("does not hold direct authorization while different resolved visitors run", async () => {
    const firstGate = deferred();
    const visitorA: VisitorContext = { visitorId: "visitor-a" };
    const visitorB: VisitorContext = { visitorId: "visitor-b" };
    const started: string[] = [];
    const finished: string[] = [];
    const runtime = new MemoryRuntime(async (_visitor, event) => {
      const label = event.kind === "message" ? event.text : event.kind;
      started.push(label);
      if (label === "first") await firstGate.promise;
      finished.push(label);
      return { messages: [], agentMutated: false };
    });
    const options = {
      resolveVisitor: ({ runId }: { readonly runId: string }) =>
        runId === "run-1" ? visitorA : visitorB,
    };

    const first = runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
      options,
    );
    await waitForCondition(() => started.includes("first"));

    const second = runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
      options,
    );
    await waitForCondition(() => finished.includes("second"));

    expect(started).toEqual(["first", "second"]);
    expect(finished).toEqual(["second"]);
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(finished).toEqual(["second", "first"]);
  });

  it("serializes direct visitor resolution by arrival before the resolved visitor is known", async () => {
    const firstGate = deferred();
    const claimedA: VisitorContext = { visitorId: "claimed-a", locale: "en-US" };
    const claimedB: VisitorContext = { visitorId: "claimed-b", locale: "en-US" };
    const resolverCalls: string[] = [];
    const handled: string[] = [];
    const runtime = new MemoryRuntime((_visitor, event) => {
      handled.push(event.kind === "message" ? event.text : event.kind);
      return { messages: [], agentMutated: false };
    });
    const options = {
      resolveVisitor: async ({ runId }: { readonly runId: string }) => {
        resolverCalls.push(runId);
        if (runId === "run-1") await firstGate.promise;
        return visitor;
      },
    };

    const first = runFacetAsAgUi(
      runtime,
      runInput(
        { visitor: claimedA, event: { kind: "message", text: "first" } },
        { runId: "run-1" },
      ),
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = runFacetAsAgUi(
      runtime,
      runInput(
        { visitor: claimedB, event: { kind: "message", text: "second" } },
        { runId: "run-2" },
      ),
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolverCalls).toEqual(["run-1"]);
    expect(handled).toEqual([]);
    firstGate.resolve();
    await Promise.all([first, second]);

    expect(resolverCalls).toEqual(["run-1", "run-2"]);
    expect(handled).toEqual(["first", "second"]);
  });

  it("rejects direct runs when the visitor resolver denies access", async () => {
    const runtime = new MemoryRuntime();

    const events = await runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "denied" } }),
      { resolveVisitor: () => undefined },
    );

    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    expect(events[1]).toMatchObject({ code: "FORBIDDEN" });
    expect(runtime.handled).toEqual([]);
  });

  it("reports throwing direct visitor resolvers as runtime errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = new MemoryRuntime();

    try {
      const events = await runFacetAsAgUi(
        runtime,
        runInput({ visitor, event: { kind: "message", text: "resolver throws" } }),
        {
          resolveVisitor: () => {
            throw new Error("resolver failed");
          },
        },
      );

      expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
      expect(events[1]).toMatchObject({ code: "RUNTIME_ERROR", message: "Facet runtime failed" });
      expect(runtime.handled).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("returns BAD_REQUEST when forwardedProps access throws", async () => {
    const runtime = new MemoryRuntime();
    const forwardedProps = {};
    Object.defineProperty(forwardedProps, "facet", {
      get: () => {
        throw new Error("getter exploded");
      },
    });

    const events = await runTrusted(runtime, {
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps,
    });

    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    expect(events[1]).toMatchObject({ code: "BAD_REQUEST" });
    expect(runtime.handled).toEqual([]);
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

    const first = runTrusted(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
    );
    const second = runTrusted(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["first"]);
    gates[0]?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["first", "second"]);
    gates[1]?.resolve();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("rejects public HTTP runs unless the server authorizes the visitor", async () => {
    const runtime = new MemoryRuntime();
    const res = new FakeResponse();

    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "http" } })),
      ),
      res as unknown as ServerResponse,
      runtime,
    );

    const events = parseSseEvents(res.body());
    expect(res.statusCode).toBe(403);
    expect(eventTypes(events)).toEqual([EventType.RUN_ERROR]);
    expect(events[0]).toMatchObject({ code: "FORBIDDEN" });
    expect(runtime.handled).toEqual([]);
  });

  it("uses a server-resolved visitor instead of trusting forwardedProps.facet.visitor", async () => {
    const claimedVisitor: VisitorContext = { visitorId: "claimed-victim", locale: "en-US" };
    const authorizedVisitor: VisitorContext = { visitorId: "server-visitor", locale: "ko-KR" };
    const runtime = new MemoryRuntime();
    const res = new FakeResponse();

    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor: claimedVisitor, event: { kind: "message", text: "http" } }),
        ),
      ),
      res as unknown as ServerResponse,
      runtime,
      {
        resolveVisitor: (_req, { forwardedVisitor }) => {
          expect(forwardedVisitor).toEqual(claimedVisitor);
          return authorizedVisitor;
        },
      },
    );

    expect(res.statusCode).toBe(200);
    expect(runtime.handled).toEqual([
      { visitor: authorizedVisitor, event: { kind: "message", text: "http" } },
    ]);
  });

  it("serializes slow HTTP visitor resolution before runtime execution", async () => {
    const firstGate = deferred();
    const resolverCalls: string[] = [];
    const handled: string[] = [];
    const runtime = new MemoryRuntime((_visitor, event) => {
      handled.push(event.kind === "message" ? event.text : event.kind);
      return { messages: [], agentMutated: false };
    });
    const options = {
      resolveVisitor: async (_req: IncomingMessage, { runId }: { readonly runId: string }) => {
        resolverCalls.push(runId);
        if (runId === "run-1") await firstGate.promise;
        return visitor;
      },
    };

    const firstRes = new FakeResponse();
    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondRes = new FakeResponse();
    const second = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
        ),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolverCalls).toEqual(["run-1"]);
    expect(handled).toEqual([]);
    firstGate.resolve();
    await Promise.all([first, second]);

    expect(resolverCalls).toEqual(["run-1", "run-2"]);
    expect(handled).toEqual(["first", "second"]);
  });

  it("does not hold HTTP authorization while different resolved visitors run", async () => {
    const firstGate = deferred();
    const visitorA: VisitorContext = { visitorId: "visitor-a" };
    const visitorB: VisitorContext = { visitorId: "visitor-b" };
    const started: string[] = [];
    const finished: string[] = [];
    const runtime = new MemoryRuntime(async (_visitor, event) => {
      const label = event.kind === "message" ? event.text : event.kind;
      started.push(label);
      if (label === "first") await firstGate.promise;
      finished.push(label);
      return { messages: [], agentMutated: false };
    });
    const options = {
      resolveVisitor: (_req: IncomingMessage, { runId }: { readonly runId: string }) =>
        runId === "run-1" ? visitorA : visitorB,
    };

    const firstRes = new FakeResponse();
    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await waitForCondition(() => started.includes("first"));

    const secondRes = new FakeResponse();
    const second = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
        ),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await waitForCondition(() => finished.includes("second"));

    expect(started).toEqual(["first", "second"]);
    expect(finished).toEqual(["second"]);
    expect(eventTypes(parseSseEvents(secondRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);

    firstGate.resolve();
    await Promise.all([first, second]);
    expect(finished).toEqual(["second", "first"]);
  });

  it("serializes HTTP visitor resolution by arrival before the resolved visitor is known", async () => {
    const firstGate = deferred();
    const claimedA: VisitorContext = { visitorId: "claimed-a", locale: "en-US" };
    const claimedB: VisitorContext = { visitorId: "claimed-b", locale: "en-US" };
    const resolverCalls: string[] = [];
    const handled: string[] = [];
    const runtime = new MemoryRuntime((_visitor, event) => {
      handled.push(event.kind === "message" ? event.text : event.kind);
      return { messages: [], agentMutated: false };
    });
    const options = {
      resolveVisitor: async (_req: IncomingMessage, { runId }: { readonly runId: string }) => {
        resolverCalls.push(runId);
        if (runId === "run-1") await firstGate.promise;
        return visitor;
      },
    };

    const firstRes = new FakeResponse();
    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput(
            { visitor: claimedA, event: { kind: "message", text: "first" } },
            { runId: "run-1" },
          ),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondRes = new FakeResponse();
    const second = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput(
            { visitor: claimedB, event: { kind: "message", text: "second" } },
            { runId: "run-2" },
          ),
        ),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolverCalls).toEqual(["run-1"]);
    expect(handled).toEqual([]);
    firstGate.resolve();
    await Promise.all([first, second]);

    expect(resolverCalls).toEqual(["run-1", "run-2"]);
    expect(handled).toEqual(["first", "second"]);
  });

  it("counts slow HTTP visitor resolution against the in-flight cap", async () => {
    const resolverGate = deferred();
    let resolverCalls = 0;
    const runtime = new MemoryRuntime();
    const options = {
      maxInFlightRuns: 1,
      resolveVisitor: async () => {
        resolverCalls += 1;
        await resolverGate.promise;
        return visitor;
      },
    } as const;

    const firstRes = new FakeResponse();
    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolverCalls).toBe(1);

    const secondRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
        ),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      options,
    );

    const secondEvents = parseSseEvents(secondRes.body());
    expect(secondRes.statusCode).toBe(429);
    expect(eventTypes(secondEvents)).toEqual([EventType.RUN_ERROR]);
    expect(secondEvents[0]).toMatchObject({ code: "TOO_MANY_RUNS" });
    expect(resolverCalls).toBe(1);

    resolverGate.resolve();
    await first;
  });

  it("releases an in-flight slot when HTTP closes during visitor authorization", async () => {
    const resolverGate = deferred();
    const resolverCalls: string[] = [];
    const runtime = new MemoryRuntime();
    const options = {
      maxInFlightRuns: 1,
      resolveVisitor: async (_req: IncomingMessage, { runId }: { readonly runId: string }) => {
        resolverCalls.push(runId);
        if (runId === "run-1") await resolverGate.promise;
        return visitor;
      },
    } as const;

    const firstRes = new FakeResponse();
    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolverCalls).toEqual(["run-1"]);

    firstRes.destroy();
    await first;

    const secondRes = new FakeResponse();
    const second = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
        ),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await second;

    expect(eventTypes(parseSseEvents(secondRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);

    resolverGate.resolve();
  });

  it("does not let closed HTTP authorization wedge later visitor resolution", async () => {
    const firstGate = deferred();
    const resolverCalls: string[] = [];
    const runtime = new MemoryRuntime();
    const options = {
      maxInFlightRuns: 1,
      resolveVisitor: async (_req: IncomingMessage, { runId }: { readonly runId: string }) => {
        resolverCalls.push(runId);
        if (runId === "run-1") await firstGate.promise;
        return visitor;
      },
    } as const;

    const firstRes = new FakeResponse();
    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await waitForCondition(() => resolverCalls.includes("run-1"));

    firstRes.destroy();
    await first;

    const secondRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
        ),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      options,
    );

    expect(resolverCalls).toEqual(["run-1", "run-2"]);
    expect(eventTypes(parseSseEvents(secondRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);

    firstGate.resolve();
  });

  it("rewrites HTTP visit events to the server-resolved visitor", async () => {
    const claimedVisitor: VisitorContext = { visitorId: "claimed-victim", locale: "en-US" };
    const authorizedVisitor: VisitorContext = { visitorId: "server-visitor", locale: "ko-KR" };
    const runtime = new MemoryRuntime();
    const res = new FakeResponse();

    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor: claimedVisitor, event: { kind: "visit", visitor: claimedVisitor } }),
        ),
      ),
      res as unknown as ServerResponse,
      runtime,
      {
        resolveVisitor: () => authorizedVisitor,
      },
    );

    expect(res.statusCode).toBe(200);
    expect(runtime.handled).toEqual([
      { visitor: authorizedVisitor, event: { kind: "visit", visitor: authorizedVisitor } },
    ]);
  });

  it("writes valid AG-UI runs as SSE without requiring a real server", async () => {
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "say", text: "over-sse" }]);
      return { messages: [], agentMutated: false };
    });
    const res = new FakeResponse();

    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "http" } })),
      ),
      res as unknown as ServerResponse,
      runtime,
      { allowForwardedVisitor: true },
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

  it("serializes includeSnapshot reads with same-visitor runtime runs", async () => {
    const beforeStage = stageWithHeadline("Before first run");
    const afterStage = stageWithHeadline("After first run");
    let currentStage = beforeStage;
    const snapshotValues: string[] = [];
    const firstGate = deferred();
    const runtime = {
      stageFor: async () => {
        const headline = currentStage.nodes["headline"];
        snapshotValues.push(headline?.type === "text" ? headline.value : "");
        return currentStage;
      },
      record: async () => undefined,
      handle: async (
        _visitor: VisitorContext,
        event: ClientEvent,
        onFrame?: FrameSink,
      ): Promise<TurnResult> => {
        if (event.kind === "message" && event.text === "first") {
          await firstGate.promise;
          currentStage = afterStage;
          onFrame?.([{ kind: "say", text: "first done" }], { stage: currentStage });
          return { messages: [], agentMutated: true };
        }
        onFrame?.([{ kind: "say", text: "second done" }], { stage: currentStage });
        return { messages: [], agentMutated: false };
      },
    };
    const firstRes = new FakeResponse();

    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      { allowForwardedVisitor: true, includeSnapshot: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshotValues).toEqual(["Before first run"]);

    const secondRes = new FakeResponse();
    const second = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
        ),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      { allowForwardedVisitor: true, includeSnapshot: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshotValues).toEqual(["Before first run"]);

    firstGate.resolve();
    await Promise.all([first, second]);

    const secondSnapshot = parseSseEvents(secondRes.body()).find(
      (event): event is StateSnapshotEvent => event.type === EventType.STATE_SNAPSHOT,
    );
    expect(snapshotValues).toEqual(["Before first run", "After first run"]);
    expect(secondSnapshot?.snapshot).toEqual({ facet: { stage: afterStage } });
  });

  it("keeps runtime runs open so late persisted frames are delivered in order", async () => {
    const gate = deferred();
    const runtime = new MemoryRuntime(async (_visitor, _event, onFrame) => {
      await gate.promise;
      onFrame?.([{ kind: "say", text: "late" }]);
      return { messages: [], agentMutated: false };
    });
    const res = new FakeResponse();

    const pending = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "slow" } })),
      ),
      res as unknown as ServerResponse,
      runtime,
      { allowForwardedVisitor: true, snapshotTimeoutMs: 5 },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(res.ended).toBe(false);
    expect(parseSseEvents(res.body()).map((event) => event.type)).toEqual([EventType.RUN_STARTED]);

    gate.resolve();
    await pending;

    const events = parseSseEvents(res.body());
    expect(eventTypes(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    expect(events[2]).toMatchObject({ delta: "late" });
  });

  it("waits for snapshot reads when snapshotTimeoutMs is disabled", async () => {
    const gate = deferred();
    let settled = false;
    const runtime = {
      stageFor: async () => {
        await gate.promise;
        return stage;
      },
      handle: async () => {
        settled = true;
        return { messages: [], agentMutated: false };
      },
      record: async () => undefined,
    };
    const res = new FakeResponse();

    const pending = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "snapshot" } })),
      ),
      res as unknown as ServerResponse,
      runtime,
      { allowForwardedVisitor: true, includeSnapshot: true, snapshotTimeoutMs: false },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(res.ended).toBe(false);
    expect(settled).toBe(false);

    gate.resolve();
    await pending;

    const events = parseSseEvents(res.body());
    expect(eventTypes(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.RUN_FINISHED,
    ]);
    expect(settled).toBe(true);
  });

  it("keeps timed-out snapshot work counted until the snapshot read settles", async () => {
    const gate = deferred();
    let snapshotReads = 0;
    const runtime = {
      stageFor: async () => {
        snapshotReads += 1;
        await gate.promise;
        return undefined;
      },
      handle: async () => ({ messages: [], agentMutated: false }),
      record: async () => undefined,
    };
    const options = {
      allowForwardedVisitor: true,
      includeSnapshot: true,
      snapshotTimeoutMs: 5,
      maxInFlightRuns: 1,
    } as const;

    const timedOutRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "timeout" } })),
      ),
      timedOutRes as unknown as ServerResponse,
      runtime,
      options,
    );
    expect(parseSseEvents(timedOutRes.body())[1]).toMatchObject({ code: "RUNTIME_TIMEOUT" });

    const cappedRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "capped" } })),
      ),
      cappedRes as unknown as ServerResponse,
      runtime,
      options,
    );
    expect(parseSseEvents(cappedRes.body())[0]).toMatchObject({ code: "TOO_MANY_RUNS" });
    expect(snapshotReads).toBe(1);

    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const afterSettleRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "after" } })),
      ),
      afterSettleRes as unknown as ServerResponse,
      runtime,
      options,
    );
    expect(eventTypes(parseSseEvents(afterSettleRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    expect(snapshotReads).toBe(2);
  });

  it("returns direct RUNTIME_TIMEOUT while keeping snapshot work counted until settle", async () => {
    const gate = deferred();
    let snapshotReads = 0;
    const runtime = {
      stageFor: async () => {
        snapshotReads += 1;
        await gate.promise;
        return undefined;
      },
      handle: async () => ({ messages: [], agentMutated: false }),
      record: async () => undefined,
    };
    const options = {
      allowForwardedVisitor: true,
      includeSnapshot: true,
      snapshotTimeoutMs: 5,
      maxInFlightRuns: 1,
    } as const;

    const timedOut = await runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "timeout" } }),
      options,
    );
    expect(timedOut[1]).toMatchObject({ type: EventType.RUN_ERROR, code: "RUNTIME_TIMEOUT" });

    const capped = await runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "capped" } }),
      options,
    );
    expect(capped[1]).toMatchObject({ type: EventType.RUN_ERROR, code: "TOO_MANY_RUNS" });
    expect(snapshotReads).toBe(1);

    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const afterSettle = await runFacetAsAgUi(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "after" } }),
      options,
    );
    expect(eventTypes(afterSettle)).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
    expect(snapshotReads).toBe(2);
  });

  it("caps concurrent HTTP runtime runs per runtime instance", async () => {
    const otherVisitor: VisitorContext = { visitorId: "visitor-2", locale: "en-US" };
    const gate = deferred();
    const runtime = new MemoryRuntime(async () => {
      await gate.promise;
      return { messages: [], agentMutated: false };
    });
    const firstRes = new FakeResponse();
    const options = {
      allowForwardedVisitor: true,
      maxInFlightRuns: 1,
    } as const;

    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.handled).toHaveLength(1);

    const secondRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput(
            { visitor: otherVisitor, event: { kind: "message", text: "second" } },
            { runId: "run-2" },
          ),
        ),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      options,
    );

    const secondEvents = parseSseEvents(secondRes.body());
    expect(eventTypes(secondEvents)).toEqual([EventType.RUN_ERROR]);
    expect(secondEvents[0]).toMatchObject({ code: "TOO_MANY_RUNS" });

    gate.resolve();
    await first;
  });

  it("allows uncapped active and queued HTTP runs when maxInFlightRuns is false", async () => {
    const gate = deferred();
    const handled: string[] = [];
    const runtime = new MemoryRuntime(async (_visitor, event) => {
      const label = event.kind === "message" ? event.text : event.kind;
      handled.push(label);
      if (label === "first") await gate.promise;
      return { messages: [], agentMutated: false };
    });
    const options = { allowForwardedVisitor: true, maxInFlightRuns: false } as const;
    const firstRes = new FakeResponse();

    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await waitForCondition(() => handled.includes("first"));

    const secondRes = new FakeResponse();
    const second = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
        ),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(parseSseEvents(secondRes.body())).toEqual([
      expect.objectContaining({ type: EventType.RUN_STARTED }),
    ]);

    gate.resolve();
    await Promise.all([first, second]);

    expect(handled).toEqual(["first", "second"]);
    expect(eventTypes(parseSseEvents(secondRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
  });

  it("counts same-visitor queued HTTP runs against the in-flight cap", async () => {
    const gate = deferred();
    const runtime = new MemoryRuntime(async () => {
      await gate.promise;
      return { messages: [], agentMutated: false };
    });
    const options = { allowForwardedVisitor: true, maxInFlightRuns: 1 } as const;
    const firstRes = new FakeResponse();

    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "second" } }, { runId: "run-2" }),
        ),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      options,
    );

    const secondEvents = parseSseEvents(secondRes.body());
    expect(eventTypes(secondEvents)).toEqual([EventType.RUN_ERROR]);
    expect(secondEvents[0]).toMatchObject({ code: "TOO_MANY_RUNS" });

    gate.resolve();
    await first;
  });

  it("counts queued record runs against the in-flight cap too", async () => {
    const gate = deferred();
    const runtime = new MemoryRuntime(async () => {
      await gate.promise;
      return { messages: [], agentMutated: false };
    });
    const options = { allowForwardedVisitor: true, maxInFlightRuns: 1 } as const;
    const firstRes = new FakeResponse();

    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const recordRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput(
            { visitor, record: { kind: "tap", target: "panel", effect: { toggle: "panel" } } },
            { runId: "run-2" },
          ),
        ),
      ),
      recordRes as unknown as ServerResponse,
      runtime,
      options,
    );

    const recordEvents = parseSseEvents(recordRes.body());
    expect(eventTypes(recordEvents)).toEqual([EventType.RUN_ERROR]);
    expect(recordEvents[0]).toMatchObject({ code: "TOO_MANY_RUNS" });
    expect(runtime.recorded).toEqual([]);

    gate.resolve();
    await first;
  });

  it("keeps slow record persistence counted without waiting for the response", async () => {
    const gate = deferred();
    let recordCalls = 0;
    const runtime = {
      stageFor: async () => undefined,
      handle: async () => ({ messages: [], agentMutated: false }),
      record: async () => {
        recordCalls += 1;
        await gate.promise;
      },
    };
    const options = { allowForwardedVisitor: true, maxInFlightRuns: 1 } as const;
    const recordInput = runInput({
      visitor,
      record: { kind: "tap", target: "panel", effect: { toggle: "panel" } },
    });

    const firstRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(JSON.stringify(recordInput)),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    expect(eventTypes(parseSseEvents(firstRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    expect(recordCalls).toBe(1);

    const cappedRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(JSON.stringify(recordInput)),
      cappedRes as unknown as ServerResponse,
      runtime,
      options,
    );
    expect(parseSseEvents(cappedRes.body())[0]).toMatchObject({ code: "TOO_MANY_RUNS" });
    expect(recordCalls).toBe(1);

    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const afterSettleRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(JSON.stringify(recordInput)),
      afterSettleRes as unknown as ServerResponse,
      runtime,
      options,
    );
    expect(eventTypes(parseSseEvents(afterSettleRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    expect(recordCalls).toBe(2);
  });

  it("releases an in-flight slot when a queued HTTP run closes before starting", async () => {
    const otherVisitor: VisitorContext = { visitorId: "visitor-2", locale: "en-US" };
    const gate = deferred();
    const runtime = new MemoryRuntime(async () => {
      await gate.promise;
      return { messages: [], agentMutated: false };
    });
    const options = { allowForwardedVisitor: true, maxInFlightRuns: 2 } as const;
    const firstRes = new FakeResponse();

    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const queuedRes = new FakeResponse();
    const queued = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "queued" } }, { runId: "run-2" }),
        ),
      ),
      queuedRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    queuedRes.destroy();
    await queued;

    const recordRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput(
            {
              visitor: otherVisitor,
              record: { kind: "tap", target: "panel", effect: { toggle: "panel" } },
            },
            { runId: "run-3" },
          ),
        ),
      ),
      recordRes as unknown as ServerResponse,
      runtime,
      options,
    );

    expect(eventTypes(parseSseEvents(recordRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    expect(runtime.recorded).toEqual([
      {
        visitor: otherVisitor,
        event: { kind: "tap", target: "panel", effect: { toggle: "panel" } },
      },
    ]);

    gate.resolve();
    await first;
  });

  it("does not acquire an in-flight slot for an already closed queued HTTP response", async () => {
    const otherVisitor: VisitorContext = { visitorId: "visitor-2", locale: "en-US" };
    const gate = deferred();
    const runtime = new MemoryRuntime(async () => {
      await gate.promise;
      return { messages: [], agentMutated: false };
    });
    const options = { allowForwardedVisitor: true, maxInFlightRuns: 2 } as const;
    const firstRes = new FakeResponse();

    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const closedRes = new FakeResponse();
    closedRes.destroy();
    const alreadyClosed = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "closed" } }, { runId: "run-2" }),
        ),
      ),
      closedRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const recordRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput(
            {
              visitor: otherVisitor,
              record: { kind: "tap", target: "panel", effect: { toggle: "panel" } },
            },
            { runId: "run-3" },
          ),
        ),
      ),
      recordRes as unknown as ServerResponse,
      runtime,
      options,
    );

    expect(eventTypes(parseSseEvents(recordRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);

    gate.resolve();
    await first;
    await alreadyClosed;
  });

  it("bounds closed same-visitor queued runs while allowing other visitors through", async () => {
    const otherVisitor: VisitorContext = { visitorId: "visitor-2", locale: "en-US" };
    const gate = deferred();
    const runtime = new MemoryRuntime(async () => {
      await gate.promise;
      return { messages: [], agentMutated: false };
    });
    const options = { allowForwardedVisitor: true, maxInFlightRuns: 2 } as const;
    const firstRes = new FakeResponse();

    const first = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "first" } }, { runId: "run-1" }),
        ),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const runId of ["run-2", "run-3"]) {
      const closedRes = new FakeResponse();
      const closed = handleAgUiRequest(
        requestWithBody(
          JSON.stringify(
            runInput({ visitor, event: { kind: "message", text: "closed" } }, { runId }),
          ),
        ),
        closedRes as unknown as ServerResponse,
        runtime,
        options,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      closedRes.destroy();
      await closed;
    }

    const queuedRes = new FakeResponse();
    const queued = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput({ visitor, event: { kind: "message", text: "queued" } }, { runId: "run-4" }),
        ),
      ),
      queuedRes as unknown as ServerResponse,
      runtime,
      options,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    queuedRes.destroy();
    await queued;

    const otherRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(
          runInput(
            {
              visitor: otherVisitor,
              record: { kind: "tap", target: "panel", effect: { toggle: "panel" } },
            },
            { runId: "run-5" },
          ),
        ),
      ),
      otherRes as unknown as ServerResponse,
      runtime,
      options,
    );
    expect(eventTypes(parseSseEvents(otherRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);

    gate.resolve();
    await first;
  });

  it("releases the in-flight slot when runtime.handle throws synchronously", async () => {
    let calls = 0;
    const runtime = {
      stageFor: async () => undefined,
      record: async () => undefined,
      handle: () => {
        calls += 1;
        if (calls === 1) throw new Error("sync boom");
        return Promise.resolve({ messages: [], agentMutated: false });
      },
    };
    const options = { allowForwardedVisitor: true, maxInFlightRuns: 1 } as const;

    const firstRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "first" } })),
      ),
      firstRes as unknown as ServerResponse,
      runtime,
      options,
    );
    expect(parseSseEvents(firstRes.body())[1]).toMatchObject({ code: "RUNTIME_ERROR" });

    const secondRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "second" } })),
      ),
      secondRes as unknown as ServerResponse,
      runtime,
      options,
    );

    expect(eventTypes(parseSseEvents(secondRes.body()))).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
  });

  it("resolves SSE backpressure waits when the client closes before drain", async () => {
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "say", text: "over-sse" }]);
      return { messages: [], agentMutated: false };
    });
    const res = new FakeResponse();
    res.writeResult = false;

    const pending = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "http" } })),
      ),
      res as unknown as ServerResponse,
      runtime,
      { allowForwardedVisitor: true },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(res.body()).toContain("RUN_STARTED");
    res.destroyed = true;
    res.emit("close");

    await expect(pending).resolves.toBeUndefined();
    expect(res.ended).toBe(false);
  });

  it("contains synchronous SSE write failures without leaking a pump rejection", async () => {
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "say", text: "over-sse" }]);
      return { messages: [], agentMutated: false };
    });
    const res = new FakeResponse();
    res.throwOnWrite = true;

    await expect(
      handleAgUiRequest(
        requestWithBody(
          JSON.stringify(runInput({ visitor, event: { kind: "message", text: "http" } })),
        ),
        res as unknown as ServerResponse,
        runtime,
        { allowForwardedVisitor: true },
      ),
    ).resolves.toBeUndefined();

    expect(res.destroyed).toBe(true);
    expect(runtime.handled).toEqual([]);
  });

  it("contains immediate SSE error write failures without rejecting the handler", async () => {
    const runtime = new MemoryRuntime();
    const res = new FakeResponse();
    res.throwOnWrite = true;

    await expect(
      handleAgUiRequest(
        requestWithBody(JSON.stringify({ not: "run input" })),
        res as unknown as ServerResponse,
        runtime,
        { allowForwardedVisitor: true },
      ),
    ).resolves.toBeUndefined();

    expect(res.destroyed).toBe(true);
    expect(runtime.handled).toEqual([]);
  });

  it("clears queued SSE events when a post-backpressure write fails without close", async () => {
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "say", text: "first" }]);
      onFrame?.([{ kind: "say", text: "second" }]);
      return { messages: [], agentMutated: false };
    });
    const res = new FakeResponse();
    res.writeResult = false;
    res.emitCloseOnDestroy = false;

    const pending = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "http" } })),
      ),
      res as unknown as ServerResponse,
      runtime,
      { allowForwardedVisitor: true },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(res.body()).toContain("RUN_STARTED");
    res.throwOnWrite = true;
    res.writeResult = true;
    res.emit("drain");

    await expect(pending).resolves.toBeUndefined();
    expect(res.destroyed).toBe(true);
  });

  it("bounds buffered SSE writes and closes a slow response on overflow", async () => {
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "say", text: "first" }]);
      onFrame?.([{ kind: "say", text: "second" }]);
      return { messages: [], agentMutated: false };
    });
    const res = new FakeResponse();
    res.writeResult = false;

    await expect(
      handleAgUiRequest(
        requestWithBody(
          JSON.stringify(runInput({ visitor, event: { kind: "message", text: "slow" } })),
        ),
        res as unknown as ServerResponse,
        runtime,
        { allowForwardedVisitor: true, maxBufferedSseEvents: 1 },
      ),
    ).resolves.toBeUndefined();

    expect(res.destroyed).toBe(true);
  });

  it("does not close a slow response when the SSE buffer cap is disabled", async () => {
    const runtime = new MemoryRuntime((_visitor, _event, onFrame) => {
      onFrame?.([{ kind: "say", text: "first" }]);
      onFrame?.([{ kind: "say", text: "second" }]);
      return { messages: [], agentMutated: false };
    });
    const res = new FakeResponse();
    res.writeResult = false;

    const pending = handleAgUiRequest(
      requestWithBody(
        JSON.stringify(runInput({ visitor, event: { kind: "message", text: "slow" } })),
      ),
      res as unknown as ServerResponse,
      runtime,
      { allowForwardedVisitor: true, maxBufferedSseEvents: false },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.destroyed).toBe(false);
    res.destroy();
    await expect(pending).resolves.toBeUndefined();
  });

  it("does not treat immediate terminal errors as buffered SSE overflow", async () => {
    const runtime = new MemoryRuntime();
    const res = new FakeResponse();

    await expect(
      handleAgUiRequest(
        requestWithBody(JSON.stringify(runInput({ visitor }))),
        res as unknown as ServerResponse,
        runtime,
        { allowForwardedVisitor: true, maxBufferedSseEvents: 1 },
      ),
    ).resolves.toBeUndefined();

    const events = parseSseEvents(res.body());
    expect(res.destroyed).toBe(false);
    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    expect(events[1]).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("normalizes a zero buffered SSE cap without dropping terminal errors", async () => {
    const runtime = new MemoryRuntime();
    const res = new FakeResponse();
    res.writeResult = false;

    const pending = handleAgUiRequest(
      requestWithBody(JSON.stringify(runInput({ visitor }))),
      res as unknown as ServerResponse,
      runtime,
      { allowForwardedVisitor: true, maxBufferedSseEvents: 0 },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    res.writeResult = true;
    res.emit("drain");
    await expect(pending).resolves.toBeUndefined();

    const events = parseSseEvents(res.body());
    expect(res.destroyed).toBe(false);
    expect(eventTypes(events)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    expect(events[1]).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("responds HTTP 400 for malformed handler input without throwing past the handler", async () => {
    const runtime = new MemoryRuntime();
    const res = new FakeResponse();

    await expect(
      handleAgUiRequest(
        requestWithBody(JSON.stringify({ threadId: "thread-1" })),
        res as unknown as ServerResponse,
        runtime,
      ),
    ).resolves.toBeUndefined();

    const events = parseSseEvents(res.body());
    expect(res.statusCode).toBe(400);
    expect(eventTypes(events)).toEqual([EventType.RUN_ERROR]);
    expect(events[0]).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("responds with AG-UI errors for non-POST, malformed JSON, and over-large bodies", async () => {
    const runtime = new MemoryRuntime();

    const methodRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithMethod("GET"),
      methodRes as unknown as ServerResponse,
      runtime,
    );
    expect(methodRes.statusCode).toBe(405);
    expect(parseSseEvents(methodRes.body())[0]).toMatchObject({ code: "METHOD_NOT_ALLOWED" });

    const jsonRes = new FakeResponse();
    await handleAgUiRequest(requestWithBody("{"), jsonRes as unknown as ServerResponse, runtime);
    expect(jsonRes.statusCode).toBe(400);
    expect(parseSseEvents(jsonRes.body())[0]).toMatchObject({ code: "BAD_REQUEST" });

    const largeRes = new FakeResponse();
    await handleAgUiRequest(
      requestWithBody(JSON.stringify(runInput({ visitor, event: { kind: "message", text: "x" } }))),
      largeRes as unknown as ServerResponse,
      runtime,
      { maxBodyBytes: 1 },
    );
    expect(largeRes.statusCode).toBe(413);
    expect(parseSseEvents(largeRes.body())[0]).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("passes a clamped view through to FacetRuntime.handle for a message event (view DC-001)", async () => {
    const runtime = new MemoryRuntime();

    await runTrusted(
      runtime,
      runInput({
        visitor,
        event: {
          kind: "message",
          text: "hello",
          seq: 4,
          view: {
            screen: "checkout",
            viewport: "gigantic", // outside the closed enum → dropped
            colorMode: "dark", // kept
            toggled: {
              "panel-a": "shown", // kept
              "panel-b": "sideways", // not "shown"/"hidden" → dropped
            },
            extra: "ignored", // unknown field → dropped
          },
        },
      }),
    );

    expect(runtime.handled).toEqual([
      {
        visitor,
        event: {
          kind: "message",
          text: "hello",
          seq: 4,
          view: { screen: "checkout", colorMode: "dark", toggled: { "panel-a": "shown" } },
        },
      },
    ]);
  });

  it("clamps an over-cap toggled view to the newest entries via core semantics (view DC-001)", async () => {
    const runtime = new MemoryRuntime();
    const overCap = MAX_VIEW_TOGGLED_KEYS + 50;
    const toggled: Record<string, "shown" | "hidden"> = {};
    for (let i = 0; i < overCap; i++) toggled[`node-${i}`] = "shown";

    await runTrusted(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "hi", view: { toggled } } }),
    );

    const handledView = runtime.handled[0]?.event.view;
    expect(handledView).toBeDefined();
    const keys = Object.keys(handledView?.toggled ?? {});
    expect(keys).toHaveLength(MAX_VIEW_TOGGLED_KEYS);
    // drop-oldest: the very first entries are gone, the newest are kept.
    expect(keys).not.toContain("node-0");
    expect(keys).toContain(`node-${overCap - 1}`);
  });

  it("passes a clamped view through to FacetRuntime.record for a collected tap event (view DC-001)", async () => {
    const runtime = new MemoryRuntime();

    await runTrusted(
      runtime,
      runInput({
        visitor,
        record: {
          kind: "tap",
          target: "panel",
          effect: { toggle: "panel" },
          seq: 3,
          view: {
            screen: "settings",
            colorMode: "bogus", // outside the closed enum → dropped
            viewport: "narrow", // kept
          },
        },
      }),
    );

    expect(runtime.recorded).toEqual([
      {
        visitor,
        event: {
          kind: "tap",
          target: "panel",
          effect: { toggle: "panel" },
          seq: 3,
          view: { screen: "settings", viewport: "narrow" },
        },
      },
    ]);
  });

  it("normalizes a message event without a view identically to today (no view key added) (view DC-007)", async () => {
    const runtime = new MemoryRuntime();

    await runTrusted(
      runtime,
      runInput({ visitor, event: { kind: "message", text: "hello", seq: 7 } }),
    );

    expect(runtime.handled).toEqual([
      { visitor, event: { kind: "message", text: "hello", seq: 7 } },
    ]);
    expect(runtime.handled[0]?.event).not.toHaveProperty("view");
  });

  it("normalizes a collected event without a view identically to today (no view key added) (view DC-007)", async () => {
    const runtime = new MemoryRuntime();
    const record: CollectedEvent = {
      kind: "tap",
      target: "panel",
      effect: { toggle: "panel" },
      seq: 3,
    };

    await runTrusted(runtime, runInput({ visitor, record }));

    expect(runtime.recorded).toEqual([{ visitor, event: record }]);
    expect(runtime.recorded[0]?.event).not.toHaveProperty("view");
  });
});
