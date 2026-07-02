import { describe, expect, it } from "vitest";
import type { FacetAgent, ServerMessage } from "@facet/core";
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
