import type { StageToolBuffer } from "@facet/agent-tools";
import { EMPTY_TREE } from "@facet/core";
import type { ClientEvent, FacetSession, ServerMessage } from "@facet/core";
import type { Sink } from "@facet/runtime";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type {
  ReferenceAgentDiagnosticObserver as PublicDiagnosticObserver,
  ReferenceAgentOptions,
} from "../index.js";
import type { ProviderStep, ProviderTurn, ReferenceProvider } from "../provider.js";
import { normalizeBudget, type ReferenceAgentBudget } from "./budget.js";
import type {
  ReferenceAgentDiagnosticEvent,
  ReferenceAgentDiagnosticObserver,
} from "./diagnostic-observer.js";
import { runReferenceAgentLoop, type ReferenceAgentLoopSummary } from "./loop.js";
import type { ReferenceAgentTraceEvent } from "./trace.js";

const SESSION: FacetSession = {
  agentId: "quickstart",
  visitor: { visitorId: "visitor-1" },
  stage: EMPTY_TREE,
};
const EVENT: ClientEvent = { kind: "message", text: "update the page" };

afterEach(() => {
  vi.useRealTimers();
});

describe("reference-agent loop diagnostics", () => {
  it("aborts attempts and retry backoff while preserving ordered diagnostics", async () => {
    expectTypeOf<ReferenceAgentOptions>().toMatchTypeOf<{
      readonly abortSignal?: AbortSignal;
      readonly diagnosticObserver?: PublicDiagnosticObserver;
    }>();
    await expectSuccessfulDiagnosticOrder();
    await expectCurrentAttemptAbort();
    await expectRetryBackoffAbort();
  });
});

async function expectSuccessfulDiagnosticOrder(): Promise<void> {
  const events: ReferenceAgentDiagnosticEvent[] = [];
  const traceEvents: ReferenceAgentTraceEvent[] = [];
  const publicObserver: PublicDiagnosticObserver = (event) => events.push(event);
  const result = await collectLoop({
    provider: scriptedProvider(
      {
        text: "",
        toolCalls: [{ id: "call-1", name: "say", input: { text: "hello" } }],
        usage: { inputTokens: 8, outputTokens: 3 },
      },
      { text: "done", toolCalls: [] },
    ),
    diagnosticObserver: publicObserver,
    trace: (event) => traceEvents.push(event),
    buffer: bufferWith([{ kind: "say", text: "hello" }]),
  });

  expect(result.summary.stopReason).toBe("provider_stop");
  expect(events.map((event) => event.kind)).toEqual([
    "provider-attempt",
    "tool-call",
    "tool-result",
    "batch",
    "provider-attempt",
    "stop",
  ]);
  expect(events.at(-1)).toEqual({ kind: "stop", reason: "complete" });
  expect(traceEvents.some((event) => event.type === "provider_attempt")).toBe(true);
  expect(traceEvents.every((event) => !("kind" in event))).toBe(true);
}

async function expectCurrentAttemptAbort(): Promise<void> {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const events: ReferenceAgentDiagnosticEvent[] = [];
  const run = collectLoop({
    provider: {
      name: "openai",
      model: "attempt-abort",
      run(_turn, _tools, context) {
        receivedSignal = context?.signal;
        markStarted?.();
        return rejectOnAbort(context?.signal);
      },
    },
    abortSignal: controller.signal,
    diagnosticObserver: (event) => events.push(event),
    budget: testBudget({ maxProviderRetries: 0 }),
  });
  await started;
  controller.abort();
  const result = await run;

  expect(receivedSignal).toBe(controller.signal);
  expect(result.batches).toEqual([]);
  expect(events).toEqual([
    { kind: "provider-attempt", attempt: 1 },
    { kind: "stop", reason: "aborted" },
  ]);
}

async function expectRetryBackoffAbort(): Promise<void> {
  vi.useFakeTimers();
  const controller = new AbortController();
  const events: ReferenceAgentDiagnosticEvent[] = [];
  let providerCalls = 0;
  let settled = false;
  const run = collectLoop({
    provider: {
      name: "openai",
      model: "backoff-abort",
      async run() {
        providerCalls += 1;
        throw new TypeError("fetch failed");
      },
    },
    abortSignal: controller.signal,
    diagnosticObserver: (event) => events.push(event),
    budget: testBudget({ maxProviderRetries: 2, retryBackoffMs: 1_000 }),
  }).then((result) => {
    settled = true;
    return result;
  });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  const settledOnAbort = settled;
  await vi.runAllTimersAsync();
  const result = await run;

  expect(settledOnAbort).toBe(true);
  expect(providerCalls).toBe(1);
  expect(result.batches).toEqual([]);
  expect(events).toEqual([
    { kind: "provider-attempt", attempt: 1 },
    { kind: "stop", reason: "aborted" },
  ]);
}

interface CollectLoopOptions {
  readonly provider: ReferenceProvider;
  readonly budget?: ReferenceAgentBudget;
  readonly abortSignal?: AbortSignal;
  readonly diagnosticObserver?: ReferenceAgentDiagnosticObserver;
  readonly trace?: (event: ReferenceAgentTraceEvent) => void;
  readonly buffer?: StageToolBuffer;
}

async function collectLoop(options: CollectLoopOptions): Promise<{
  readonly batches: readonly (readonly ServerMessage[])[];
  readonly summary: ReferenceAgentLoopSummary;
}> {
  const batches: ServerMessage[][] = [];
  const iterator = runReferenceAgentLoop({
    provider: options.provider,
    system: "system prompt",
    event: EVENT,
    session: SESSION,
    sink: emptySink(),
    agentId: "quickstart",
    budget: options.budget ?? testBudget(),
    bufferFactory: () => options.buffer ?? bufferWith(),
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
    ...(options.diagnosticObserver === undefined
      ? {}
      : { diagnosticObserver: options.diagnosticObserver }),
    ...(options.trace === undefined ? {} : { trace: options.trace }),
  });
  while (true) {
    const next = await iterator.next();
    if (next.done) return { batches, summary: next.value };
    batches.push([...next.value]);
  }
}

function testBudget(overrides: Partial<ReferenceAgentBudget> = {}): ReferenceAgentBudget {
  return normalizeBudget({ budget: { retryBackoffMs: 0, ...overrides } });
}

function scriptedProvider(...steps: readonly ProviderStep[]): ReferenceProvider {
  let next = 0;
  return {
    name: "openai",
    model: "scripted",
    async run(_turn: ProviderTurn) {
      const step = steps[Math.min(next, steps.length - 1)];
      next += 1;
      if (step === undefined) throw new Error("missing scripted step");
      return step;
    },
  };
}

function bufferWith(messages: readonly ServerMessage[] = []): StageToolBuffer {
  return {
    run: () => ({
      observation: "ok",
      messages,
      mutated: messages.some((message) => message.kind === "patch"),
      said: messages.some((message) => message.kind === "say"),
      shadow: EMPTY_TREE,
    }),
    resetEmittedPatchOps() {},
    drainUnresolved: () => [],
    shadow: EMPTY_TREE,
  };
}

function emptySink(): Sink {
  return {
    async record() {},
    async history() {
      return [];
    },
  };
}

function rejectOnAbort(signal: AbortSignal | undefined): Promise<ProviderStep> {
  return new Promise<ProviderStep>((_resolve, reject) => {
    const timer = setTimeout(() => finish(new TypeError("missing provider signal")), 25);
    function finish(error: Error): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", rejectAborted);
      reject(error);
    }
    function rejectAborted(): void {
      finish(new DOMException("aborted", "AbortError"));
    }
    if (signal?.aborted === true) {
      rejectAborted();
      return;
    }
    signal?.addEventListener("abort", rejectAborted, { once: true });
  });
}
