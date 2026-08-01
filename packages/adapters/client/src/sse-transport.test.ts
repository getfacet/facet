import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyPatch } from "@facet/core";
import type {
  VisitorEvent,
  ConversationMessage,
  FacetStage,
  PatchFrame,
  ServerFrame,
} from "@facet/core";

import { SseTransport } from "./sse-transport.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emit(data: string, lastEventId = ""): void {
    this.onmessage?.({ data, lastEventId } as MessageEvent<string>);
  }
}

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function event(overrides: Partial<VisitorEvent> = {}): VisitorEvent {
  return Object.freeze({
    eventId: "event1",
    eventName: "submit",
    sourceNodeId: "n1",
    screen: "home",
    stageRevision: 0,
    collect: Object.freeze({}),
    ...overrides,
  });
}

function conversation(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return Object.freeze({
    kind: "conversation" as const,
    messageId: "event1:assistant",
    turnId: "event1",
    role: "assistant" as const,
    text: "ok",
    at: 1,
    ...overrides,
  });
}

function stage(data: FacetStage["data"] = {}): FacetStage {
  return Object.freeze({
    document: Object.freeze({
      entry: "home",
      screens: Object.freeze(["screen"]),
      nodes: Object.freeze({
        screen: Object.freeze({
          tag: "Screen",
          props: Object.freeze({ name: Object.freeze({ kind: "scalar" as const, value: "home" }) }),
          children: Object.freeze([]),
        }),
      }),
    }),
    data,
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  fetchMock.mockClear();
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SseTransport", () => {
  it("subscribes to the session stream and posts VisitorEvent without a visitor wrapper", async () => {
    const transport = new SseTransport("http://s", "session/a");
    transport.subscribe(() => {});
    transport.send(event());
    expect(fetchMock).not.toHaveBeenCalled();

    FakeEventSource.instances[0]?.onopen?.();
    await flush();

    expect(FakeEventSource.instances[0]?.url).toBe(
      `http://s/stream?sessionKey=${encodeURIComponent("session/a")}`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("http://s/event");
    expect(JSON.parse(init.body)).toEqual({ sessionKey: "session/a", event: event() });
  });

  it("posts visitor messages through the same ordered send queue as events", async () => {
    const transport = new SseTransport("http://s", "session/a");
    transport.subscribe(() => {});
    const eventSent = transport.send(event({ eventId: "visit" }));
    const messageSent = transport.sendMessage({
      messageId: "msg-1",
      text: "hello",
      screen: "home",
      stageRevision: 0,
    });

    FakeEventSource.instances[0]?.onopen?.();
    await expect(Promise.all([eventSent, messageSent])).resolves.toEqual([undefined, undefined]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const second = fetchMock.mock.calls[1] as unknown as [string, { body: string }];
    expect(first[0]).toBe("http://s/event");
    expect(JSON.parse(first[1].body)).toEqual({
      sessionKey: "session/a",
      event: event({ eventId: "visit" }),
    });
    expect(second[0]).toBe("http://s/message");
    expect(JSON.parse(second[1].body)).toEqual({
      sessionKey: "session/a",
      messageId: "msg-1",
      text: "hello",
      screen: "home",
      stageRevision: 0,
    });
  });

  it("rejects the oldest queued send on overflow and flushes the bounded queue in order", async () => {
    const transport = new SseTransport("http://s", "session/a");
    transport.subscribe(() => {});
    const firstSend = transport.send(event({ eventId: "event0" }));
    const firstRejected = expect(firstSend).rejects.toThrow("send queue full");
    const sends = [
      firstSend,
      ...Array.from({ length: 100 }, (_unused, index) =>
        transport.send(event({ eventId: `event${index + 1}` })),
      ),
    ];

    await firstRejected;
    FakeEventSource.instances[0]?.onopen?.();
    await expect(Promise.all(sends.slice(1))).resolves.toEqual(
      Array.from({ length: 100 }, () => undefined),
    );

    expect(fetchMock).toHaveBeenCalledTimes(100);
    const sentEventIds = fetchMock.mock.calls.map((call) => {
      const [, init] = call as unknown as [string, { readonly body: string }];
      return (JSON.parse(init.body) as { readonly event: VisitorEvent }).event.eventId;
    });
    expect(sentEventIds).toEqual(
      Array.from({ length: 100 }, (_unused, index) => `event${index + 1}`),
    );
  });

  it("rejects queued sends when the stream disconnects before opening", async () => {
    const transport = new SseTransport("http://s", "session/a");
    const unsubscribe = transport.subscribe(() => {});
    const pending = transport.send(event());

    FakeEventSource.instances[0]?.onerror?.();

    await expect(pending).rejects.toThrow("transport disconnected");
    expect(fetchMock).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("rejects queued sends when the stream never opens", async () => {
    vi.useFakeTimers();
    const transport = new SseTransport("http://s", "session/a");
    transport.subscribe(() => {});
    const pending = transport.send(event());
    const rejected = expect(pending).rejects.toThrow("transport open timed out");

    await vi.advanceTimersByTimeAsync(10_000);

    await rejected;
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a failed POST and continues later queued sends in order", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const transport = new SseTransport("http://s", "session/a");
    transport.subscribe(() => {});
    FakeEventSource.instances[0]?.onopen?.();

    const failed = transport.send(event({ eventId: "event1" }));
    const recovered = transport.send(event({ eventId: "event2" }));

    await expect(failed).rejects.toThrow("POST /event failed: 500");
    await expect(recovered).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sentEventIds = fetchMock.mock.calls.map((call) => {
      const [, init] = call as unknown as [string, { readonly body: string }];
      return (JSON.parse(init.body) as { readonly event: VisitorEvent }).event.eventId;
    });
    expect(sentEventIds).toEqual(["event1", "event2"]);
  });

  it("collapses duplicate conversation frames by messageId while preserving patch frames", () => {
    const received: ServerFrame[] = [];
    const transport = new SseTransport("http://s", "session1");
    transport.subscribe((frame) => received.push(frame));
    const source = FakeEventSource.instances[0];
    const patch: PatchFrame = Object.freeze({
      kind: "patch" as const,
      stageRevision: 1,
      ops: Object.freeze([{ op: "add" as const, path: "/data/ready", value: true }]),
    });

    source?.emit(JSON.stringify(patch), "era:1");
    source?.emit(JSON.stringify(conversation()), "era:2");
    source?.emit(JSON.stringify(conversation({ text: "redelivered" })), "era:2");

    expect(received).toEqual([patch, conversation()]);
  });

  it("reconnects from the last stream id and does not synthesize a root replace in-window", () => {
    const received: ServerFrame[] = [];
    const transport = new SseTransport("http://s", "session1");
    const unsubscribe = transport.subscribe((frame) => received.push(frame));
    FakeEventSource.instances[0]?.emit(JSON.stringify(conversation()), "era:7");
    unsubscribe();

    transport.subscribe((frame) => received.push(frame));

    expect(FakeEventSource.instances[1]?.url).toBe(
      "http://s/stream?sessionKey=session1&lastEventId=era%3A7",
    );
    expect(received).toEqual([conversation()]);
    expect(
      received.some(
        (frame) =>
          frame.kind === "patch" &&
          frame.ops.some((operation) => operation.op === "replace" && operation.path === ""),
      ),
    ).toBe(false);
  });

  it("surfaces out-of-window root resync before collapsed conversation, with both stage halves", () => {
    const received: ServerFrame[] = [];
    const transport = new SseTransport("http://s", "session1");
    transport.subscribe((frame) => received.push(frame));
    const serverStage = stage({ sales: [{ revenue: 42 }] });
    const resync: PatchFrame = Object.freeze({
      kind: "patch" as const,
      stageRevision: 12,
      ops: Object.freeze([{ op: "replace" as const, path: "", value: serverStage }]),
    });

    FakeEventSource.instances[0]?.emit(JSON.stringify(resync), "era:0");
    FakeEventSource.instances[0]?.emit(JSON.stringify(conversation()), "era:1");
    FakeEventSource.instances[0]?.emit(
      JSON.stringify(conversation({ text: "duplicate" })),
      "era:1",
    );

    expect(received).toEqual([resync, conversation()]);
    expect(
      applyPatch(stage({ stale: true }), received[0]?.kind === "patch" ? received[0].ops : []),
    ).toEqual(serverStage);
  });

  it("ignores malformed frames and rejects direct sends on unsubscribe", async () => {
    const received: ServerFrame[] = [];
    const transport = new SseTransport("http://s", "session1");
    const unsubscribe = transport.subscribe((frame) => received.push(frame));
    FakeEventSource.instances[0]?.onopen?.();
    FakeEventSource.instances[0]?.emit("not-json");
    unsubscribe();

    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    expect(received).toEqual([]);
    await expect(transport.send(event({ eventId: "late" }))).rejects.toThrow(
      "transport disconnected",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
