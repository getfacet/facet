import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { VisitorEvent, ConversationMessage, ServerFrame } from "@facet/core";

import { LocalTransport } from "./local-transport.js";

const sessionKey = "session1";

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

describe("LocalTransport", () => {
  it("delivers structural ServerFrame results from a runtime-like object", async () => {
    const frames: readonly ServerFrame[] = [
      Object.freeze({
        kind: "patch" as const,
        stageRevision: 1,
        ops: Object.freeze([{ op: "add" as const, path: "/data/ready", value: true }]),
      }),
      conversation(),
    ];
    const runtime = {
      handle: vi.fn(() => Promise.resolve({ frames })),
    };
    const transport = new LocalTransport(runtime, sessionKey);
    const received: ServerFrame[] = [];
    transport.subscribe((frame) => received.push(frame));

    await transport.send(event());

    expect(runtime.handle).toHaveBeenCalledWith({ sessionKey, event: event() });
    expect(received).toEqual(frames);
  });

  it("collapses duplicate conversation frames and fans out to subscribers", async () => {
    const runtime = {
      handle: () => Promise.resolve({ frames: [conversation(), conversation({ text: "again" })] }),
    };
    const transport = new LocalTransport(runtime, sessionKey);
    const first: ServerFrame[] = [];
    const second: ServerFrame[] = [];
    transport.subscribe((frame) => first.push(frame));
    transport.subscribe((frame) => second.push(frame));

    await transport.send(event());

    expect(first).toEqual([conversation()]);
    expect(second).toEqual([conversation()]);
  });

  it("stops delivering after unsubscribe and turns runtime failure into a conversation frame", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = {
      handle: () => Promise.reject(new Error("boom")),
    };
    const transport = new LocalTransport(runtime, sessionKey);
    const received: ServerFrame[] = [];
    const unsubscribe = transport.subscribe((frame) => received.push(frame));
    unsubscribe();
    await expect(transport.send(event())).rejects.toThrow("boom");

    expect(received).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith("[facet] local transport failed:", expect.any(Error));
    errorSpy.mockRestore();
  });

  it("keeps @facet/runtime out of production code", () => {
    expect(readFileSync("packages/adapters/client/src/local-transport.ts", "utf8")).not.toContain(
      "@facet/runtime",
    );
    expect(readFileSync("packages/adapters/client/src/sse-transport.ts", "utf8")).not.toContain(
      "@facet/runtime",
    );
  });
});
