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
import { MAX_FIELDS_KEYS, MAX_FIELD_VALUE_CHARS } from "@facet/core";
import { describe, expect, it, vi } from "vitest";

import { createHttpAgUiTransport } from "./transport-http.js";
import { AgUiTransport } from "./transport.js";
import type { FacetAgUiForwardedProps } from "./transport.js";

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

function expectForwardedProps(_value: FacetAgUiForwardedProps): void {}

describe("AgUiTransport", () => {
  it("types FacetAgUiForwardedProps like the server forwarded envelope", () => {
    expectForwardedProps({
      facet: { visitor, event: { kind: "message", text: "hello", seq: 1 } },
    });
    expectForwardedProps({
      facet: { visitor, record: { kind: "tap", effect: { toggle: "panel" }, seq: 2 } },
    });
    // @ts-expect-error record envelopes only carry local tap records.
    expectForwardedProps({ facet: { visitor, record: { kind: "message", text: "x", seq: 3 } } });
    expectForwardedProps({
      // @ts-expect-error event and record are mutually exclusive at the AG-UI boundary.
      facet: {
        visitor,
        event: { kind: "message", text: "hello", seq: 4 },
        record: { kind: "tap", effect: { toggle: "panel" }, seq: 4 },
      },
    });

    expect(true).toBe(true);
  });

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

  it("drops queued submissions over maxQueue before opening another AG-UI run", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    const gate = deferred();
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              await gate.promise;
              return { done: true as const, value: undefined };
            },
          }),
        };
      },
      { visitor, maxQueue: 1 },
    );

    try {
      transport.send({ kind: "message", text: "first" });
      transport.send({ kind: "message", text: "dropped" });

      await waitForCondition(() => calls.length === 1);
      gate.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls).toHaveLength(1);
      expect(facetForwarded(calls[0]!).event).toEqual({
        kind: "message",
        text: "first",
        seq: 1,
      });
      expect(
        errorSpy.mock.calls.some(([message]) => String(message).includes("queue limit reached")),
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs AG-UI run failures without raw error details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = new AgUiTransport(
      () => {
        throw new Error("secret-token");
      },
      { visitor },
    );

    try {
      transport.send({ kind: "message", text: "hello" });

      await waitForCondition(() => errorSpy.mock.calls.length > 0);
      expect(errorSpy.mock.calls).toEqual([["[facet/ag-ui] event run failed"]]);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("secret-token");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("drops unsupported record events before opening an AG-UI run", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    const messages: ServerMessage[] = [];
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        return [
          {
            type: EventType.RUN_ERROR,
            message: "record rejected",
            code: "BAD_REQUEST",
          },
        ];
      },
      { visitor },
    );

    try {
      transport.subscribe((message) => messages.push(message));
      transport.record({ kind: "message", text: "log-only" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls).toEqual([]);
      expect(messages).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps valid local record runs silent even if AG-UI returns output", async () => {
    const calls: RunAgentInput[] = [];
    const messages: ServerMessage[] = [];
    let completed = false;
    const transport = new AgUiTransport(
      async function* run(input): AsyncIterable<BaseEvent> {
        calls.push(input);
        yield { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" };
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "hidden" };
        yield { type: EventType.TEXT_MESSAGE_END, messageId: "m1" };
        yield {
          type: EventType.RUN_ERROR,
          message: "record output should stay silent",
          code: "RUNTIME_ERROR",
        };
        completed = true;
      },
      { visitor },
    );

    transport.subscribe((message) => messages.push(message));
    transport.record({ kind: "tap", target: "panel", effect: { toggle: "panel" } });

    await waitForCondition(() => completed);
    expect(facetForwarded(calls[0]!).record).toEqual({
      kind: "tap",
      target: "panel",
      effect: { toggle: "panel" },
      seq: 1,
    });
    expect(messages).toEqual([]);
  });

  it("rejects invalid local tap records before opening an AG-UI run", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    const long = "x".repeat(MAX_FIELD_VALUE_CHARS + 1);
    const tooManyFields = Object.fromEntries(
      Array.from({ length: MAX_FIELDS_KEYS + 1 }, (_, index) => [
        `field-${String(index)}`,
        "value",
      ]),
    );
    const hostileRecord = {};
    Object.defineProperty(hostileRecord, "kind", {
      get: () => {
        throw new Error("kind getter exploded");
      },
    });
    const asCollected = (value: unknown): CollectedEvent => value as CollectedEvent;
    const invalidRecords: readonly CollectedEvent[] = [
      asCollected(hostileRecord),
      { kind: "tap", action: { name: "agent" }, effect: { toggle: "panel" } },
      { kind: "tap", target: "panel" },
      { kind: "tap", target: long, effect: { toggle: "panel" } },
      asCollected({ kind: "tap", target: "panel", effect: "nope" }),
      asCollected({ kind: "tap", target: "panel", effect: {} }),
      asCollected({ kind: "tap", target: "panel", effect: { navigate: 123 } }),
      { kind: "tap", target: "panel", effect: { navigate: long } },
      { kind: "tap", target: "panel", effect: { toggle: long } },
      { kind: "tap", target: "panel", effect: { navigate: "screen", toggle: "panel" } },
      { kind: "tap", target: "panel", effect: { toggle: "panel" }, fields: tooManyFields },
      asCollected({ kind: "tap", target: "panel", effect: { toggle: "panel" }, fields: [] }),
      { kind: "tap", target: "panel", effect: { toggle: "panel" }, fields: { [long]: "ok" } },
      { kind: "tap", target: "panel", effect: { toggle: "panel" }, fields: { ok: long } },
      asCollected({ kind: "tap", target: "panel", effect: { toggle: "panel" }, fields: { ok: 1 } }),
      { kind: "tap", target: "panel", effect: { toggle: "panel" }, seq: Number.POSITIVE_INFINITY },
    ];
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        return [];
      },
      { visitor },
    );

    try {
      for (const record of invalidRecords) transport.record(record);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
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

  it("emits overlapping AG-UI text messages in start order, not completion order", async () => {
    const messages: ServerMessage[] = [];
    const transport = new AgUiTransport(
      () => [
        { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_START, messageId: "m2", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m2", delta: "second" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m2" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "first" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m1" },
      ],
      { visitor },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "go" });

    await waitForCondition(() => messages.length === 2);
    expect(messages).toEqual([
      { kind: "say", text: "first" },
      { kind: "say", text: "second" },
    ]);
  });

  it("buffers AG-UI TEXT_MESSAGE_CHUNK deltas by message id until the run ends", async () => {
    const messages: ServerMessage[] = [];
    const transport = new AgUiTransport(
      () => [
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m1", role: "assistant", delta: "Hel" },
        { type: EventType.TEXT_MESSAGE_CHUNK, role: "assistant", delta: "lo" },
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m2", role: "assistant", delta: "Again" },
      ],
      { visitor },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "go" });

    await waitForCondition(() => messages.length === 2);
    expect(messages).toEqual([
      { kind: "say", text: "Hello" },
      { kind: "say", text: "Again" },
    ]);
  });

  it("does not let chunk-only messages block later framed text messages", async () => {
    const messages: ServerMessage[] = [];
    const transport = new AgUiTransport(
      () => [
        {
          type: EventType.TEXT_MESSAGE_CHUNK,
          messageId: "chunk",
          role: "assistant",
          delta: "chunk",
        },
        { type: EventType.TEXT_MESSAGE_START, messageId: "framed", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "framed", delta: "framed" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "framed" },
      ],
      { visitor },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "go" });

    await waitForCondition(() => messages.length === 2);
    expect(messages).toEqual([
      { kind: "say", text: "chunk" },
      { kind: "say", text: "framed" },
    ]);
  });

  it("clears unterminated text buffers when a run ends", async () => {
    const messages: ServerMessage[] = [];
    let runs = 0;
    const transport = new AgUiTransport(
      () => {
        runs += 1;
        return runs === 1
          ? [
              { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
              { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "stale" },
              { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
            ]
          : [{ type: EventType.TEXT_MESSAGE_END, messageId: "m1" }];
      },
      { visitor },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "first" });
    await waitForCondition(() => runs === 1);
    transport.send({ kind: "message", text: "second" });
    await waitForCondition(() => runs === 2);

    expect(messages).toEqual([]);
  });

  it("surfaces AG-UI run errors as safe Facet say messages", async () => {
    const messages: ServerMessage[] = [];
    const transport = new AgUiTransport(
      () => [
        {
          type: EventType.RUN_ERROR,
          message: "postgres://secret@internal/path",
          code: "RUNTIME_ERROR",
        },
      ],
      { visitor },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "fail" });

    await waitForCondition(() => messages.length === 1);
    expect(messages).toEqual([{ kind: "say", text: "(the agent hit an error - try again)" }]);
  });

  it("stops delivering messages to unsubscribed listeners", async () => {
    const first: ServerMessage[] = [];
    const second: ServerMessage[] = [];
    const transport = new AgUiTransport(
      () => [
        { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "visible" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m1" },
      ],
      { visitor },
    );

    const unsubscribe = transport.subscribe((message) => first.push(message));
    transport.subscribe((message) => second.push(message));
    unsubscribe();
    transport.send({ kind: "message", text: "go" });

    await waitForCondition(() => second.length === 1);
    expect(first).toEqual([]);
    expect(second).toEqual([{ kind: "say", text: "visible" }]);
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

  it("unsubscribes observable runs on timeout and advances the queue", async () => {
    const calls: RunAgentInput[] = [];
    let unsubscribed = false;
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            subscribe: () => ({
              unsubscribe: () => {
                unsubscribed = true;
              },
            }),
          };
        }
        return [];
      },
      { visitor, runTimeoutMs: 5 },
    );

    transport.send({ kind: "message", text: "first" });
    transport.send({ kind: "message", text: "second" });

    await waitForCondition(() => calls.length === 2 && unsubscribed);
    expect(facetForwarded(calls[1]!).event).toEqual({
      kind: "message",
      text: "second",
      seq: 2,
    });
  });

  it("contains throwing observable unsubscribe during timeout and advances the queue", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            subscribe: () => ({
              unsubscribe: () => {
                throw new Error("unsubscribe failed");
              },
            }),
          };
        }
        return [];
      },
      { visitor, runTimeoutMs: 5 },
    );

    try {
      transport.send({ kind: "message", text: "first" });
      transport.send({ kind: "message", text: "second" });

      await waitForCondition(() => calls.length === 2);
      expect(facetForwarded(calls[1]!).event).toEqual({
        kind: "message",
        text: "second",
        seq: 2,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("times out a hung async iterable run and advances later submissions", async () => {
    const calls: RunAgentInput[] = [];
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return (async function* stream(): AsyncIterable<BaseEvent> {
            await new Promise(() => {});
            yield* [] as BaseEvent[];
          })();
        }
        return [];
      },
      { visitor, runTimeoutMs: 5 },
    );

    transport.send({ kind: "message", text: "first" });
    transport.send({ kind: "message", text: "second" });

    await waitForCondition(() => calls.length === 2);
    expect(facetForwarded(calls[1]!).event).toEqual({
      kind: "message",
      text: "second",
      seq: 2,
    });
  });

  it("times out long synchronous iterable runs and advances later submissions", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    let secondRunStartedAt = Number.POSITIVE_INFINITY;
    const startedAt = Date.now();
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return (function* stream(): Iterable<BaseEvent> {
            const blockUntil = Date.now() + 200;
            while (Date.now() < blockUntil) {
              yield { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "stale", delta: "x" };
            }
          })();
        }
        secondRunStartedAt = Date.now();
        return [];
      },
      { visitor, runTimeoutMs: 5 },
    );

    try {
      transport.send({ kind: "message", text: "first" });
      transport.send({ kind: "message", text: "second" });

      await waitForCondition(() => calls.length === 2);
      expect(secondRunStartedAt - startedAt).toBeLessThan(120);
      expect(facetForwarded(calls[1]!).event).toEqual({
        kind: "message",
        text: "second",
        seq: 2,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not time out a long run when runTimeoutMs is disabled", async () => {
    const calls: RunAgentInput[] = [];
    const gate = deferred();
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            [Symbol.asyncIterator]: () => ({
              next: async () => {
                await gate.promise;
                return { done: true as const, value: undefined };
              },
            }),
          };
        }
        return [];
      },
      { visitor, runTimeoutMs: false },
    );

    transport.send({ kind: "message", text: "first" });
    transport.send({ kind: "message", text: "second" });

    await waitForCondition(() => calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);

    gate.resolve();
    await waitForCondition(() => calls.length === 2);
    expect(facetForwarded(calls[1]!).event).toEqual({
      kind: "message",
      text: "second",
      seq: 2,
    });
  });

  it("aborts an abortable AG-UI agent when the run result does not arrive before timeout", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    let aborts = 0;
    const transport = new AgUiTransport(
      {
        run: (input) => {
          calls.push(input);
          if (calls.length === 1) return new Promise<AsyncIterable<BaseEvent>>(() => {});
          return [];
        },
        abortRun: () => {
          aborts += 1;
        },
      },
      { visitor, runTimeoutMs: 5 },
    );

    try {
      transport.send({ kind: "message", text: "first" });
      transport.send({ kind: "message", text: "second" });

      await waitForCondition(() => calls.length === 2);
      expect(aborts).toBe(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("runs async iterable timeout cleanup once", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    let returns = 0;
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            [Symbol.asyncIterator]: () => ({
              next: async () => new Promise<IteratorResult<BaseEvent>>(() => {}),
              return: async () => {
                returns += 1;
                return { done: true as const, value: undefined };
              },
            }),
          };
        }
        return [];
      },
      { visitor, runTimeoutMs: 5 },
    );

    try {
      transport.send({ kind: "message", text: "first" });
      transport.send({ kind: "message", text: "second" });

      await waitForCondition(() => calls.length === 2);
      expect(returns).toBe(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("contains rejected async iterator cleanup during timeout and advances the queue", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    let returns = 0;
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            [Symbol.asyncIterator]: () => ({
              next: async () => new Promise<IteratorResult<BaseEvent>>(() => {}),
              return: async () => {
                returns += 1;
                throw new Error("return failed");
              },
            }),
          };
        }
        return [];
      },
      { visitor, runTimeoutMs: 5 },
    );

    try {
      transport.send({ kind: "message", text: "first" });
      transport.send({ kind: "message", text: "second" });

      await waitForCondition(() => calls.length === 2);
      expect(returns).toBe(1);
      expect(
        errorSpy.mock.calls.some(([message]) => String(message).includes("run cleanup failed")),
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not pull a synchronous iterator again after timeout fires during a yield", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    let nextCalls = 0;
    let returned = false;
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            [Symbol.iterator]: () => ({
              next: () => {
                nextCalls += 1;
                if (nextCalls === 64) {
                  const blockUntil = Date.now() + 10;
                  while (Date.now() < blockUntil) {
                    // Ensure the configured timeout is due before the chunk yield resumes.
                  }
                }
                return {
                  done: false as const,
                  value: { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "stale", delta: "x" },
                };
              },
              return: () => {
                returned = true;
                return { done: true as const, value: undefined };
              },
            }),
          };
        }
        return [];
      },
      { visitor, runTimeoutMs: 5 },
    );

    try {
      transport.send({ kind: "message", text: "first" });
      transport.send({ kind: "message", text: "second" });

      await waitForCondition(() => calls.length === 2);
      expect(nextCalls).toBeLessThan(65);
      expect(returned).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("contains throwing sync iterator cleanup during timeout and advances the queue", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    let nextCalls = 0;
    let returns = 0;
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            [Symbol.iterator]: () => ({
              next: () => {
                nextCalls += 1;
                const blockUntil = Date.now() + 20;
                while (Date.now() < blockUntil) {
                  // Block past runTimeoutMs before returning a deliverable event.
                }
                return {
                  done: false as const,
                  value: { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "stale", delta: "x" },
                };
              },
              return: () => {
                returns += 1;
                throw new Error("return failed");
              },
            }),
          };
        }
        return [];
      },
      { visitor, runTimeoutMs: 5 },
    );

    try {
      transport.send({ kind: "message", text: "first" });
      transport.send({ kind: "message", text: "second" });

      await waitForCondition(() => calls.length === 2);
      expect(nextCalls).toBe(1);
      expect(returns).toBe(1);
      expect(
        errorSpy.mock.calls.some(([message]) => String(message).includes("run cleanup failed")),
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("contains throwing sync iterator next failures and still calls cleanup", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    let nextCalls = 0;
    let returns = 0;
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            [Symbol.iterator]: () => ({
              next: () => {
                nextCalls += 1;
                throw new Error("next failed");
              },
              return: () => {
                returns += 1;
                return { done: true as const, value: undefined };
              },
            }),
          };
        }
        return [];
      },
      { visitor },
    );

    try {
      transport.send({ kind: "message", text: "first" });
      transport.send({ kind: "message", text: "second" });

      await waitForCondition(() => calls.length === 2);
      expect(nextCalls).toBe(1);
      expect(returns).toBe(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not emit an event returned by a blocking synchronous iterator after timeout", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: RunAgentInput[] = [];
    const messages: ServerMessage[] = [];
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            [Symbol.iterator]: () => ({
              next: () => {
                const blockUntil = Date.now() + 20;
                while (Date.now() < blockUntil) {
                  // Block past runTimeoutMs before returning a deliverable event.
                }
                return {
                  done: false as const,
                  value: {
                    type: EventType.RUN_ERROR,
                    message: "stale timeout error",
                    code: "RUNTIME_ERROR",
                  },
                };
              },
              return: () => ({ done: true as const, value: undefined }),
            }),
          };
        }
        return [
          { type: EventType.TEXT_MESSAGE_START, messageId: "fresh", role: "assistant" },
          { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "fresh", delta: "fresh" },
          { type: EventType.TEXT_MESSAGE_END, messageId: "fresh" },
        ];
      },
      { visitor, runTimeoutMs: 5 },
    );

    try {
      transport.subscribe((message) => messages.push(message));
      transport.send({ kind: "message", text: "first" });
      transport.send({ kind: "message", text: "second" });

      await waitForCondition(() => messages.length === 1);
      expect(messages).toEqual([{ kind: "say", text: "fresh" }]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("ignores async iterable events that resolve after their run timed out", async () => {
    const messages: ServerMessage[] = [];
    const calls: RunAgentInput[] = [];
    let releaseLate: (result: IteratorResult<BaseEvent>) => void = () => {};
    const lateEvent = new Promise<IteratorResult<BaseEvent>>((resolve) => {
      releaseLate = resolve;
    });
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => lateEvent,
              return: async () => ({ done: true as const, value: undefined }),
            }),
          };
        }
        return [
          { type: EventType.TEXT_MESSAGE_START, messageId: "fresh", role: "assistant" },
          { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "fresh", delta: "fresh" },
          { type: EventType.TEXT_MESSAGE_END, messageId: "fresh" },
        ];
      },
      { visitor, runTimeoutMs: 5 },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "first" });
    transport.send({ kind: "message", text: "second" });

    await waitForCondition(() => messages.length === 1);
    releaseLate({
      done: false,
      value: { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "stale", delta: "stale" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messages).toEqual([{ kind: "say", text: "fresh" }]);
  });

  it("discards buffered partial text when a run times out", async () => {
    const messages: ServerMessage[] = [];
    const calls: RunAgentInput[] = [];
    let releaseLate: (result: IteratorResult<BaseEvent>) => void = () => {};
    const lateEvent = new Promise<IteratorResult<BaseEvent>>((resolve) => {
      releaseLate = resolve;
    });
    const transport = new AgUiTransport(
      (input) => {
        calls.push(input);
        if (calls.length === 1) {
          let emitted = false;
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => {
                if (!emitted) {
                  emitted = true;
                  return Promise.resolve({
                    done: false as const,
                    value: {
                      type: EventType.TEXT_MESSAGE_START,
                      messageId: "partial",
                      role: "assistant",
                    },
                  });
                }
                return lateEvent;
              },
              return: async () => ({ done: true as const, value: undefined }),
            }),
          };
        }
        return [];
      },
      { visitor, runTimeoutMs: 5 },
    );

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "first" });
    transport.send({ kind: "message", text: "second" });

    await waitForCondition(() => calls.length === 2);
    releaseLate({
      done: false,
      value: { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "partial", delta: "stale" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messages).toEqual([]);
  });

  it("ignores malformed, unknown, lifecycle, tool, reasoning, and activity events", async () => {
    const messages: ServerMessage[] = [];
    let completed = false;
    const transport = new AgUiTransport(
      async function* run(): AsyncIterable<BaseEvent> {
        yield null as unknown as BaseEvent;
        yield {} as BaseEvent;
        yield { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" };
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "missing-start", delta: "drop" };
        yield {
          type: EventType.TEXT_MESSAGE_START,
          messageId: 123,
          role: "assistant",
        } as unknown as BaseEvent;
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

  it("uses the official AG-UI HttpAgent and keeps the transport source browser-safe", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const messages: ServerMessage[] = [];
    const transport = createHttpAgUiTransport("https://example.test/ag-ui", {
      visitor,
      headers: { Authorization: "Bearer test" },
      fetch: async (url, requestInit) => {
        capturedUrl = url;
        capturedInit = requestInit;
        return new Response(
          [
            `data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" })}`,
            "",
            `data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "http" })}`,
            "",
            `data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_END, messageId: "m1" })}`,
            "",
            `data: ${JSON.stringify({ type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" })}`,
            "",
          ].join("\n"),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "via http" });

    await waitForCondition(() => messages.length === 1);
    expect(capturedUrl).toBe("https://example.test/ag-ui");
    expect(capturedInit?.headers).toMatchObject({
      Authorization: "Bearer test",
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    });
    expect(capturedInit?.method).toBe("POST");
    expect(messages).toEqual([{ kind: "say", text: "http" }]);
    expect(transport).toBeInstanceOf(AgUiTransport);

    const source = readFileSync(new URL("./transport-http.ts", import.meta.url), "utf8");
    expect(source).toContain('from "@ag-ui/client"');
    expect(source).toContain("new HttpAgent");
    expect(source).not.toMatch(
      /from\s+["'](?:node:)?(?:fs|path|http|https|net|tls|stream|buffer|crypto|url|events|util|os|process|zlib|child_process|worker_threads)["']/,
    );
  });

  it("uses a fresh HTTP agent after aborting a timed-out AG-UI run", async () => {
    const messages: ServerMessage[] = [];
    let requests = 0;
    const encoder = new TextEncoder();
    const transport = createHttpAgUiTransport("https://example.test/ag-ui", {
      visitor,
      runTimeoutMs: 5,
      fetch: async (_url, requestInit) => {
        requests += 1;
        if (requests === 1) {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" })}\n\n`,
                  ),
                );
                (requestInit.signal as AbortSignal | undefined)?.addEventListener("abort", () => {
                  controller.close();
                });
              },
            }),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          );
        }
        return new Response(
          [
            `data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_START, messageId: "m2", role: "assistant" })}`,
            "",
            `data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m2", delta: "after abort" })}`,
            "",
            `data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_END, messageId: "m2" })}`,
            "",
            `data: ${JSON.stringify({ type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-2" })}`,
            "",
          ].join("\n"),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "timeout" });
    await waitForCondition(() => requests === 1);
    transport.send({ kind: "message", text: "second" });

    await waitForCondition(() => messages.length === 1);
    expect(requests).toBe(2);
    expect(messages).toEqual([{ kind: "say", text: "after abort" }]);
  });

  it("surfaces non-2xx AG-UI RUN_ERROR SSE responses from the HTTP transport", async () => {
    const messages: ServerMessage[] = [];
    const transport = createHttpAgUiTransport("https://example.test/ag-ui", {
      visitor,
      fetch: async () =>
        new Response(
          `data: ${JSON.stringify({
            type: EventType.RUN_ERROR,
            message: "AG-UI visitor resolver required",
            code: "FORBIDDEN",
          })}\n\n`,
          { status: 403, headers: { "Content-Type": "text/event-stream" } },
        ),
    });

    transport.subscribe((message) => messages.push(message));
    transport.send({ kind: "message", text: "forbidden" });

    await waitForCondition(() => messages.length === 1);
    expect(messages).toEqual([{ kind: "say", text: "(the agent hit an error - try again)" }]);
  });
});
