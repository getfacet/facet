import { describe, expect, it, vi } from "vitest";
import type { CollectedEvent, FacetAgent, ServerMessage, VisitorContext } from "@facet/core";
import { FacetRuntime } from "@facet/runtime";
import { LocalTransport } from "./local-transport.js";

const visitor = { visitorId: "v" };
const agentOf =
  (...messages: ServerMessage[]): FacetAgent =>
  () =>
    Promise.resolve(messages);

/** send() is fire-and-forget; deliveries land on later microtasks. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("LocalTransport", () => {
  it("delivers the runtime's messages to a subscriber", async () => {
    const runtime = new FacetRuntime({ agentId: "a", agent: agentOf({ kind: "say", text: "hi" }) });
    const transport = new LocalTransport(runtime, visitor);
    const received: ServerMessage[] = [];
    transport.subscribe((message) => received.push(message));

    transport.send({ kind: "message", text: "hello" });
    await flush();

    expect(received).toEqual([{ kind: "say", text: "hi" }]);
  });

  it("fans out to every subscriber", async () => {
    const runtime = new FacetRuntime({ agentId: "a", agent: agentOf({ kind: "say", text: "hi" }) });
    const transport = new LocalTransport(runtime, visitor);
    const a: ServerMessage[] = [];
    const b: ServerMessage[] = [];
    transport.subscribe((message) => a.push(message));
    transport.subscribe((message) => b.push(message));

    transport.send({ kind: "visit", visitor });
    await flush();

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("turns an agent throw into a chat notice instead of an unhandled rejection", async () => {
    const throwingAgent: FacetAgent = () => {
      throw new Error("boom");
    };
    const runtime = new FacetRuntime({ agentId: "a", agent: throwingAgent });
    const transport = new LocalTransport(runtime, visitor);
    const received: ServerMessage[] = [];
    transport.subscribe((message) => received.push(message));

    transport.send({ kind: "message", text: "hello" });
    await flush();

    expect(received).toEqual([{ kind: "say", text: "(the agent hit an error)" }]);
  });

  it("routes record() to runtime.record and is best-effort on throw", () => {
    const recorded: Array<[VisitorContext, CollectedEvent]> = [];
    const runtime = {
      handle: () => Promise.resolve({ messages: [] as ServerMessage[] }),
      record: (v: VisitorContext, e: CollectedEvent) => {
        recorded.push([v, e]);
        return Promise.resolve();
      },
    };
    const transport = new LocalTransport(runtime, visitor);
    const tap: CollectedEvent = { kind: "tap", target: "n1", effect: { navigate: "home" } };

    transport.record(tap);
    expect(recorded).toEqual([[visitor, tap]]);

    // A runtime whose record throws synchronously must not propagate.
    const throwing = {
      handle: () => Promise.resolve({ messages: [] as ServerMessage[] }),
      record: () => {
        throw new Error("boom");
      },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t2 = new LocalTransport(throwing, visitor);
    expect(() => t2.record(tap)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith("[facet] record failed:", expect.any(Error));
    errorSpy.mockRestore();

    // A runtime without record() at all is a safe no-op.
    const bare = { handle: () => Promise.resolve({ messages: [] as ServerMessage[] }) };
    expect(() => new LocalTransport(bare, visitor).record(tap)).not.toThrow();
  });

  it("stops delivering after unsubscribe", async () => {
    const runtime = new FacetRuntime({ agentId: "a", agent: agentOf({ kind: "say", text: "hi" }) });
    const transport = new LocalTransport(runtime, visitor);
    const received: ServerMessage[] = [];
    const unsubscribe = transport.subscribe((message) => received.push(message));

    transport.send({ kind: "visit", visitor });
    await flush();
    unsubscribe();
    transport.send({ kind: "visit", visitor });
    await flush();

    expect(received).toHaveLength(1);
  });
});
