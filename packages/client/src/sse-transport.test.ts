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
const eventsOf = (mock: { mock: { calls: unknown[] } }): unknown[] =>
  mock.mock.calls.map((call) => {
    const [, init] = call as [string, { body: string }];
    return (JSON.parse(init.body) as { event: unknown }).event;
  });
const sentEvents = (): unknown[] => eventsOf(fetchMock);

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
      { kind: "visit", visitor, seq: 1 },
      { kind: "message", text: "first", seq: 2 },
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
      event: { kind: "message", text: "hi", seq: 1 },
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
    expect(events[0]).toEqual({ kind: "visit", visitor, seq: 1 }); // still first
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

  it("aborts a black-holed POST and sends the next queued event", async () => {
    // The production POST carries `signal: AbortSignal.timeout(...)`. Stub the
    // factory to hand back a signal we control (avoids faking Node's timers),
    // and a fetch that hangs until that signal aborts.
    const controllers: AbortController[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    });
    const blackHoleFetch = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", blackHoleFetch);

    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    FakeEventSource.instances[0]?.onopen?.();

    transport.send({ kind: "message", text: "a" });
    transport.send({ kind: "message", text: "b" });

    await flush();
    // First POST is black-holed; the second waits behind it.
    expect(blackHoleFetch).toHaveBeenCalledTimes(1);

    // Fire the timeout abort on the first POST's signal.
    controllers[0]?.abort();
    await flush();

    // The abort frees the chain head → the next queued event is issued.
    expect(blackHoleFetch).toHaveBeenCalledTimes(2);
    expect(eventsOf(blackHoleFetch)).toEqual([
      { kind: "message", text: "a", seq: 1 },
      { kind: "message", text: "b", seq: 2 },
    ]);

    errorSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  it("passes an abort signal on the POST", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    FakeEventSource.instances[0]?.onopen?.();
    transport.send({ kind: "message", text: "hi" });
    await flush();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { signal: unknown }];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    timeoutSpy.mockRestore();
  });

  it("does not synthesize a reset on reopen — the server owns that decision", () => {
    const messages: ServerMessage[] = [];
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe((message) => messages.push(message));
    const source = FakeEventSource.instances[0];

    source?.onopen?.(); // first open
    source?.onopen?.(); // re-open: the client no longer decides reset
    expect(messages).toEqual([]); // zero synthesized messages
  });

  it("passes a server-sent reset frame through to the handler untouched", () => {
    const received: ServerMessage[] = [];
    const transport = new SseTransport("http://s", visitor);
    transport.subscribe((message) => received.push(message));
    const source = FakeEventSource.instances[0];

    source?.emit(JSON.stringify({ kind: "reset" }));

    expect(received).toEqual([{ kind: "reset" }]);
  });

  it("record rides the shared chain with a monotonic seq and drops on failure", async () => {
    // A fetch that records each (url, event) and rejects ONLY the /record POST,
    // so we can prove the record path is best-effort without wedging the chain.
    const calls: Array<{ url: string; event: { kind: string; seq?: number } }> = [];
    const recordingFetch = vi.fn((url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { event: { kind: string; seq?: number } };
      calls.push({ url, event: body.event });
      return url.endsWith("/record")
        ? Promise.reject(new Error("record boom"))
        : Promise.resolve(new Response(null, { status: 202 }));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", recordingFetch);

    const transport = new SseTransport("http://s", visitor);
    transport.subscribe(() => {});
    FakeEventSource.instances[0]?.onopen?.();

    // A forwarded event over /event, then a locally-resolved tap over /record.
    transport.send({ kind: "message", text: "hi" });
    expect(() =>
      transport.record({ kind: "tap", target: "n1", effect: { navigate: "home" } }),
    ).not.toThrow();

    await flush();
    await flush();

    // Both POST on the SHARED chain, in send order; record targets ONLY the
    // reference /record path (never an arbitrary/domain URL).
    expect(calls.map((c) => c.url)).toEqual(["http://s/event", "http://s/record"]);
    expect(calls[1]?.url).toBe("http://s/record");

    // seq is stamped once at the single serialization point, strictly increasing
    // across the /event send and the /record record.
    const seqs = calls.map((c) => c.event.seq);
    expect(seqs).toEqual([1, 2]);
    expect((seqs[0] as number) < (seqs[1] as number)).toBe(true);

    // The rejected /record logged + dropped (no throw, no retry) and left the
    // chain intact: a following send still fires with the next monotonic seq.
    expect(errorSpy).toHaveBeenCalled();
    transport.send({ kind: "message", text: "after" });
    await flush();
    expect(calls[2]?.url).toBe("http://s/event");
    expect(calls[2]?.event.seq).toBe(3);

    errorSpy.mockRestore();
  });
});
