import { readFileSync } from "node:fs";

import { EventType } from "@ag-ui/core";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import type {
  ClientEvent,
  CollectedEvent,
  FacetTree,
  ServerMessage,
  VisitorContext,
} from "@facet/core";
import { describe, expect, it } from "vitest";

import { AgUiTransport, createHttpAgUiTransport } from "./transport.js";

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
      value: "Hello",
    },
  },
};

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
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

function facetForwarded(input: RunAgentInput): {
  readonly visitor?: VisitorContext;
  readonly event?: ClientEvent;
  readonly record?: CollectedEvent;
} {
  return (input.forwardedProps as { readonly facet?: unknown } | undefined)?.facet as {
    readonly visitor?: VisitorContext;
    readonly event?: ClientEvent;
    readonly record?: CollectedEvent;
  };
}

describe("AgUiTransport", () => {
  it("serializes send and record through one run chain with monotonic Facet seq", async () => {
    const calls: RunAgentInput[] = [];
    const releases: Array<() => void> = [];
    const run = (input: RunAgentInput): AsyncIterable<BaseEvent> => {
      calls.push(input);
      const gate = deferred();
      releases.push(gate.resolve);
      return (async function* stream(): AsyncIterable<BaseEvent> {
        await gate.promise;
        yield* [] as BaseEvent[];
      })();
    };
    const transport = new AgUiTransport({ run }, { visitor });

    transport.send({ kind: "message", text: "first" });
    transport.send({ kind: "tap", action: { name: "choose" } });
    transport.record({ kind: "tap", target: "panel", effect: { toggle: "panel" } });

    await waitForCondition(() => calls.length === 1);
    expect(calls).toHaveLength(1);
    expect(facetForwarded(calls[0]!).event).toEqual({ kind: "message", text: "first", seq: 1 });
    expect(calls[0]!.state).toEqual({});

    releases[0]!();
    await waitForCondition(() => calls.length === 2);
    expect(facetForwarded(calls[1]!).event).toEqual({
      kind: "tap",
      action: { name: "choose" },
      seq: 2,
    });
    expect(calls[1]!.state).toEqual({});

    releases[1]!();
    await waitForCondition(() => calls.length === 3);
    expect(facetForwarded(calls[2]!).record).toEqual({
      kind: "tap",
      target: "panel",
      effect: { toggle: "panel" },
      seq: 3,
    });
    expect(facetForwarded(calls[2]!).visitor).toEqual(visitor);
    expect(calls[2]!.state).toEqual({});

    releases[2]!();
  });

  it("buffers AG-UI text message chunks into ordered native Facet say messages", async () => {
    const messages: ServerMessage[] = [];
    const transport = new AgUiTransport(
      () => [
        { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" },
        { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Hel" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "lo" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m1" },
        {
          type: EventType.STATE_DELTA,
          delta: [{ op: "replace", path: "/facet/stage/nodes/headline/value", value: "Updated" }],
        },
        { type: EventType.TEXT_MESSAGE_START, messageId: "m2", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m2", delta: "Again" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m2" },
        { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
      ],
      { visitor },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "go" });

    await waitForCondition(() => messages.length === 3);
    expect(messages).toEqual([
      { kind: "say", text: "Hello" },
      {
        kind: "patch",
        patches: [{ op: "replace", path: "/nodes/headline/value", value: "Updated" }],
      },
      { kind: "say", text: "Again" },
    ]);
  });

  it("converts duplicate AG-UI state snapshots to root patches without duplicating chat", async () => {
    const messages: ServerMessage[] = [];
    const transport = new AgUiTransport(
      () => [
        { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Only once" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m1" },
        { type: EventType.STATE_SNAPSHOT, snapshot: { facet: { stage } } },
        { type: EventType.STATE_SNAPSHOT, snapshot: { facet: { stage } } },
      ],
      { visitor },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "snapshot" });

    await waitForCondition(() => messages.length === 3);
    expect(messages.filter((message) => message.kind === "say")).toEqual([
      { kind: "say", text: "Only once" },
    ]);
    expect(messages.filter((message) => message.kind === "patch")).toEqual([
      { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] },
      { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] },
    ]);
  });

  it("consumes observable-like AG-UI agent run streams", async () => {
    const messages: ServerMessage[] = [];
    const transport = new AgUiTransport(
      {
        run: () => ({
          subscribe: (observer) => {
            observer.next?.({
              type: EventType.TEXT_MESSAGE_START,
              messageId: "m1",
              role: "assistant",
            });
            observer.next?.({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId: "m1",
              delta: "Observable",
            });
            observer.next?.({ type: EventType.TEXT_MESSAGE_END, messageId: "m1" });
            observer.complete?.();
            return { unsubscribe: () => {} };
          },
        }),
      },
      { visitor },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "go" });

    await waitForCondition(() => messages.length === 1);
    expect(messages).toEqual([{ kind: "say", text: "Observable" }]);
  });

  it("ignores malformed, unknown, lifecycle, tool, reasoning, and activity events", async () => {
    const messages: ServerMessage[] = [];
    let completed = false;
    const transport = new AgUiTransport(
      async function* run(): AsyncIterable<unknown> {
        yield null;
        yield {};
        yield { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" };
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "missing-start", delta: "drop" };
        yield { type: EventType.TEXT_MESSAGE_START, messageId: 123, role: "assistant" };
        yield { type: EventType.TEXT_MESSAGE_START, messageId: "never-ended", role: "assistant" };
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "never-ended", delta: "drop" };
        yield { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "search" };
        yield { type: EventType.TOOL_CALL_ARGS, toolCallId: "tool-1", delta: "{}" };
        yield { type: EventType.TOOL_CALL_END, toolCallId: "tool-1" };
        yield { type: EventType.REASONING_START, messageId: "reasoning-1" };
        yield {
          type: EventType.REASONING_MESSAGE_CONTENT,
          messageId: "reasoning-1",
          delta: "hidden",
        };
        yield {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: "activity-1",
          activityType: "task",
          content: {},
        };
        yield { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" };
        completed = true;
      },
      { visitor },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "ignore" });

    await waitForCondition(() => completed);
    expect(messages).toEqual([]);
  });

  it("uses the official AG-UI HttpAgent and keeps the transport source browser-safe", () => {
    expect(
      createHttpAgUiTransport("https://example.test/ag-ui", {
        visitor,
        headers: { Authorization: "Bearer test" },
        fetch: async () => new Response(null),
      }),
    ).toBeInstanceOf(AgUiTransport);

    const source = readFileSync(new URL("./transport.ts", import.meta.url), "utf8");
    expect(source).toContain('from "@ag-ui/client"');
    expect(source).toContain("new HttpAgent");
    expect(source).not.toMatch(
      /from\s+["'](?:node:)?(?:fs|path|http|https|net|tls|stream|buffer|crypto|url|events|util|os|process|zlib|child_process|worker_threads)["']/,
    );
  });
});
