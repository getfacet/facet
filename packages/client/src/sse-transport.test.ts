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

/** Flush the microtask queue (and any settled promises) by yielding to a
 * macrotask — lets the per-instance send chain advance a step. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("SseTransport", () => {
  it("queues events sent before the stream opens and flushes them in order", async () => {
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    transport.send({ kind: "visit", visitor });
    transport.send({ kind: "message", text: "first" });
    expect(fetchMock).not.toHaveBeenCalled();

    FakeEventSource.instances[0]?.onopen?.();
    await flush();

    expect(sentEvents()).toEqual([
      { kind: "visit", visitor },
      { kind: "message", text: "first" },
    ]);
  });

  it("sends immediately once open, with the visitor in the body", async () => {
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    FakeEventSource.instances[0]?.onopen?.();
    transport.send({ kind: "message", text: "hi" });
    await flush();

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

  it("bounds the pre-connect queue by dropping the oldest events", async () => {
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    for (let i = 0; i < 150; i += 1) {
      transport.send({ kind: "message", text: `m${i}` });
    }
    FakeEventSource.instances[0]?.onopen?.();
    await flush();

    const events = sentEvents() as { text: string }[];
    expect(events).toHaveLength(100);
    expect(events[0]?.text).toBe("m50"); // oldest 50 dropped
    expect(events[99]?.text).toBe("m149");
  });

  it("spares a leading visit when the queue overflows", async () => {
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    transport.send({ kind: "visit", visitor });
    for (let i = 0; i < 150; i += 1) {
      transport.send({ kind: "message", text: `m${i}` });
    }
    FakeEventSource.instances[0]?.onopen?.();
    await flush();

    const events = sentEvents() as { kind: string; text?: string }[];
    expect(events).toHaveLength(100);
    expect(events[0]).toEqual({ kind: "visit", visitor }); // still first
    expect(events[99]?.text).toBe("m149");
  });

  it("sends events strictly in order", async () => {
    // Deferred fetch: each POST hangs until the test resolves it by hand, so we
    // can observe that the second POST is not issued until the first settles.
    const resolvers: Array<() => void> = [];
    const deferredFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(() => resolve(new Response(null, { status: 202 })));
        }),
    );
    vi.stubGlobal("fetch", deferredFetch);

    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    FakeEventSource.instances[0]?.onopen?.();

    transport.send({ kind: "message", text: "a" });
    transport.send({ kind: "message", text: "b" });

    await flush();
    // First POST in flight; the second must wait for it.
    expect(deferredFetch).toHaveBeenCalledTimes(1);

    resolvers[0]?.();
    await flush();
    // First settled → second POST now issued.
    expect(deferredFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the send chain alive after a rejected POST", async () => {
    let call = 0;
    const flakyFetch = vi.fn(() => {
      call += 1;
      return call === 1
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(new Response(null, { status: 202 }));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", flakyFetch);

    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    FakeEventSource.instances[0]?.onopen?.();

    transport.send({ kind: "message", text: "a" });
    transport.send({ kind: "message", text: "b" });

    await flush();
    // The rejected first POST does not wedge the chain: the second still fires.
    expect(flakyFetch).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith("[facet] event send failed:", expect.any(Error));

    errorSpy.mockRestore();
  });

  it("synthesizes a single reset on re-open, none on first open", () => {
    const messages: ServerMessage[] = [];
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe((message) => messages.push(message));
    const source = FakeEventSource.instances[0];

    source?.onopen?.(); // first open: no reset
    expect(messages).toEqual([]);

    source?.onopen?.(); // re-open: exactly one reset
    expect(messages).toEqual([{ kind: "reset" }]);
  });
});
