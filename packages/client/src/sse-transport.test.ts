import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@facet/core";
import { SseTransport } from "./sse-transport.js";

/** Minimal EventSource stand-in: captures the URL and exposes the handlers so a
 * test can fire open/message itself. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emit(data: string): void {
    this.onmessage?.({ data } as MessageEvent<string>);
  }
}

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));

beforeEach(() => {
  FakeEventSource.instances = [];
  fetchMock.mockClear();
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const visitor = { visitorId: "v/1" };
const sentEvents = (): unknown[] =>
  fetchMock.mock.calls.map((call) => {
    const [, init] = call as unknown as [string, { body: string }];
    return (JSON.parse(init.body) as { event: unknown }).event;
  });

describe("SseTransport", () => {
  it("queues events sent before the stream opens and flushes them in order", () => {
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    transport.send({ kind: "visit", visitor });
    transport.send({ kind: "message", text: "first" });
    expect(fetchMock).not.toHaveBeenCalled();

    FakeEventSource.instances[0]?.onopen?.();

    expect(sentEvents()).toEqual([
      { kind: "visit", visitor },
      { kind: "message", text: "first" },
    ]);
  });

  it("sends immediately once open, with the visitor in the body", () => {
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    FakeEventSource.instances[0]?.onopen?.();
    transport.send({ kind: "message", text: "hi" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("http://s/event");
    expect(JSON.parse(init.body)).toEqual({
      visitor,
      event: { kind: "message", text: "hi" },
    });
  });

  it("escapes the visitorId in the stream URL", () => {
    new SseTransport("http://s", visitor).subscribe(() => {});
    expect(FakeEventSource.instances[0]?.url).toBe(
      `http://s/stream?visitorId=${encodeURIComponent("v/1")}`,
    );
  });

  it("delivers parsed frames and ignores malformed ones", () => {
    const received: ServerMessage[] = [];
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe((message) => received.push(message));
    const source = FakeEventSource.instances[0];

    source?.emit("not json");
    source?.emit(JSON.stringify({ kind: "say", text: "ok" }));

    expect(received).toEqual([{ kind: "say", text: "ok" }]);
  });

  it("closes the stream and stops direct sends on unsubscribe", () => {
    const transport = new SseTransport("http://s", visitor);
    const unsubscribe = transport.subscribe(() => {});
    const source = FakeEventSource.instances[0];
    source?.onopen?.();
    unsubscribe();

    expect(source?.closed).toBe(true);
    transport.send({ kind: "message", text: "late" });
    expect(fetchMock).not.toHaveBeenCalled(); // queued for a future re-subscribe, not sent
  });

  it("bounds the pre-connect queue by dropping the oldest events", () => {
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    for (let i = 0; i < 150; i += 1) {
      transport.send({ kind: "message", text: `m${i}` });
    }
    FakeEventSource.instances[0]?.onopen?.();

    const events = sentEvents() as { text: string }[];
    expect(events).toHaveLength(100);
    expect(events[0]?.text).toBe("m50"); // oldest 50 dropped
    expect(events[99]?.text).toBe("m149");
  });

  it("spares a leading visit when the queue overflows", () => {
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    transport.send({ kind: "visit", visitor });
    for (let i = 0; i < 150; i += 1) {
      transport.send({ kind: "message", text: `m${i}` });
    }
    FakeEventSource.instances[0]?.onopen?.();

    const events = sentEvents() as { kind: string; text?: string }[];
    expect(events).toHaveLength(100);
    expect(events[0]).toEqual({ kind: "visit", visitor }); // still first
    expect(events[99]?.text).toBe("m149");
  });
});
