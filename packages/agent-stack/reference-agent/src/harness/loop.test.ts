import { describe, expect, it } from "vitest";
import { EMPTY_TREE, type ClientEvent, type FacetSession, type ServerMessage } from "@facet/core";
import type { Sink, StoredEvent } from "@facet/runtime";
import type { StageToolBuffer, StageToolBufferOutcome, ToolSpec } from "@facet/agent-tools";

import { normalizeBudget, type ReferenceAgentBudget } from "./budget.js";
import { runReferenceAgentLoop, type ReferenceAgentLoopBufferFactory } from "./loop.js";
import type { ReferenceAgentTraceEvent } from "./trace.js";
import type { ProviderStep, ProviderTurn, QuickstartProvider, ToolCall } from "../provider.js";

const SESSION: FacetSession = {
  agentId: "quickstart",
  visitor: { visitorId: "visitor-1" },
  stage: EMPTY_TREE,
};

const EVENT: ClientEvent = { kind: "message", text: "update the page" };

interface MockProvider extends QuickstartProvider {
  readonly turns: ProviderTurn[];
  readonly toolsByAttempt: readonly ToolSpec[][];
}

interface FakeStageToolBuffer extends StageToolBuffer {
  readonly runCalls: readonly ToolCall[];
  readonly resetCount: number;
}

interface RunLoopOptions {
  readonly provider: QuickstartProvider;
  readonly budget?: ReferenceAgentBudget;
  readonly bufferFactory?: ReferenceAgentLoopBufferFactory;
  readonly event?: ClientEvent;
  readonly session?: FacetSession;
  readonly sink?: Sink;
  readonly system?: string;
}

function call(id: string, name: string, input: unknown = {}): ToolCall {
  return { id, name, input };
}

function toolStep(...toolCalls: readonly ToolCall[]): ProviderStep {
  return { text: "tool step", toolCalls };
}

function textStep(text: string): ProviderStep {
  return { text, toolCalls: [] };
}

function providerOf(...steps: ReadonlyArray<ProviderStep | Error>): MockProvider {
  const turns: ProviderTurn[] = [];
  const toolsByAttempt: ToolSpec[][] = [];
  let next = 0;
  return {
    name: "openai",
    model: "mock-model",
    turns,
    toolsByAttempt,
    async run(turn, tools) {
      turns.push({ system: turn.system, messages: [...turn.messages] });
      toolsByAttempt.push([...tools]);
      const step = steps[Math.min(next, steps.length - 1)];
      next += 1;
      if (step === undefined) throw new Error("no scripted step");
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

function sinkWith(history: readonly StoredEvent[] = []): Sink {
  return {
    async record() {},
    async history(agentId, visitorId) {
      expect(agentId).toBe("quickstart");
      expect(visitorId).toBe("visitor-1");
      return history;
    },
  };
}

function throwingSink(error: unknown): Sink {
  return {
    async record() {},
    async history() {
      throw error;
    },
  };
}

function testBudget(overrides: Partial<ReferenceAgentBudget> = {}): ReferenceAgentBudget {
  return normalizeBudget({
    budget: {
      retryBackoffMs: 0,
      ...overrides,
    },
  });
}

async function runLoop(options: RunLoopOptions): Promise<{
  readonly batches: readonly (readonly ServerMessage[])[];
  readonly messages: readonly ServerMessage[];
  readonly traceEvents: readonly ReferenceAgentTraceEvent[];
}> {
  const traceEvents: ReferenceAgentTraceEvent[] = [];
  const batches: ServerMessage[][] = [];
  for await (const batch of runReferenceAgentLoop({
    provider: options.provider,
    system: options.system ?? "system prompt",
    event: options.event ?? EVENT,
    session: options.session ?? SESSION,
    sink: options.sink ?? sinkWith(),
    agentId: "quickstart",
    budget: options.budget ?? testBudget(),
    bufferFactory: options.bufferFactory ?? (() => bufferWith()),
    trace: (event) => {
      traceEvents.push(event);
    },
  })) {
    batches.push([...batch]);
  }
  return { batches, messages: batches.flat(), traceEvents };
}

function bufferFactoryFor(buffer: StageToolBuffer): ReferenceAgentLoopBufferFactory {
  return () => buffer;
}

function bufferWith(
  outcomes: readonly StageToolBufferOutcome[] = [],
  unresolved: readonly string[] = [],
): FakeStageToolBuffer {
  let next = 0;
  let resetCount = 0;
  const runCalls: ToolCall[] = [];
  return {
    run(callToRun) {
      runCalls.push(callToRun);
      const outcome = outcomes[Math.min(next, Math.max(0, outcomes.length - 1))];
      next += 1;
      return outcome ?? outcomeWith(`ok: ${callToRun.name}`);
    },
    resetEmittedPatchOps() {
      resetCount += 1;
    },
    drainUnresolved() {
      return unresolved;
    },
    get shadow() {
      return EMPTY_TREE;
    },
    get runCalls() {
      return runCalls;
    },
    get resetCount() {
      return resetCount;
    },
  };
}

function outcomeWith(
  observation: string,
  messages: readonly ServerMessage[] = [],
): StageToolBufferOutcome {
  return {
    observation,
    messages,
    mutated: messages.some((message) => message.kind === "patch" && message.patches.length > 0),
    said: messages.some((message) => message.kind === "say"),
    shadow: EMPTY_TREE,
  };
}

function patchOutcome(observation = "ok: patched"): StageToolBufferOutcome {
  return outcomeWith(observation, [
    {
      kind: "patch",
      patches: [{ op: "replace", path: "/root", value: "root" }],
    },
  ]);
}

function saysOf(messages: readonly ServerMessage[]): readonly string[] {
  return messages.flatMap((message) => (message.kind === "say" ? [message.text] : []));
}

function patchMessagesOf(messages: readonly ServerMessage[]): readonly ServerMessage[] {
  return messages.filter((message) => message.kind === "patch");
}

function stopReasons(traceEvents: readonly ReferenceAgentTraceEvent[]): readonly string[] {
  return traceEvents.flatMap((event) => (event.type === "stop" ? [event.reason] : []));
}

function retryEvents(
  traceEvents: readonly ReferenceAgentTraceEvent[],
): readonly ReferenceAgentTraceEvent[] {
  return traceEvents.filter((event) => event.type === "provider_retry");
}

function providerStepEvents(
  traceEvents: readonly ReferenceAgentTraceEvent[],
): readonly Extract<ReferenceAgentTraceEvent, { readonly type: "provider_step" }>[] {
  return traceEvents.filter(
    (event): event is Extract<ReferenceAgentTraceEvent, { readonly type: "provider_step" }> =>
      event.type === "provider_step",
  );
}

function turnErrorEvents(
  traceEvents: readonly ReferenceAgentTraceEvent[],
): readonly Extract<ReferenceAgentTraceEvent, { readonly type: "turn_error" }>[] {
  return traceEvents.filter(
    (event): event is Extract<ReferenceAgentTraceEvent, { readonly type: "turn_error" }> =>
      event.type === "turn_error",
  );
}

describe("runReferenceAgentLoop", () => {
  it("appends bounded tool results before the next provider call", async () => {
    const longObservation = `inspection ${"x".repeat(120)}`;
    const buffer = bufferWith([outcomeWith(longObservation)]);
    const provider = providerOf(
      toolStep(call("inspect-1", "inspect_stage", { maxNodes: 2 })),
      textStep("done"),
    );

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(buffer),
      budget: testBudget({ maxObservationChars: 56 }),
    });

    expect(provider.turns).toHaveLength(2);
    const secondMessages = provider.turns[1]?.messages ?? [];
    expect(secondMessages.at(-2)).toMatchObject({
      role: "assistant_tools",
      toolCalls: [call("inspect-1", "inspect_stage", { maxNodes: 2 })],
    });
    const observed = secondMessages.at(-1);
    expect(observed).toMatchObject({ role: "tool_result", callId: "inspect-1" });
    if (observed?.role !== "tool_result") throw new Error("expected tool_result");
    expect(observed.content).toHaveLength(56);
    expect(observed.content).toMatch(/\[truncated: \d+ chars omitted\]$/);
    expect(saysOf(result.messages)).toEqual(["done"]);
  });

  it("resets the stage tool buffer after yielding a patch batch", async () => {
    const buffer = bufferWith([patchOutcome()]);
    const provider = providerOf(
      toolStep(call("set-1", "set_node", { node: { id: "root", type: "box", children: [] } })),
      textStep(""),
    );

    const result = await runLoop({ provider, bufferFactory: bufferFactoryFor(buffer) });

    expect(result.batches).toHaveLength(1);
    expect(patchMessagesOf(result.messages)).toHaveLength(1);
    expect(buffer.resetCount).toBe(1);
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });

  it("retries retryable provider failures before any tool execution", async () => {
    const provider = providerOf(new TypeError("fetch failed"), textStep("recovered"));

    const result = await runLoop({
      provider,
      budget: testBudget({ maxProviderRetries: 1 }),
    });

    expect(provider.turns).toHaveLength(2);
    expect(retryEvents(result.traceEvents)).toHaveLength(1);
    expect(saysOf(result.messages)).toEqual(["recovered"]);
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });

  it("retries a later provider failure without replaying prior emitted edits", async () => {
    const buffer = bufferWith([patchOutcome()]);
    const provider = providerOf(
      toolStep(call("set-1", "set_node", { node: { id: "root", type: "box", children: [] } })),
      new TypeError("fetch failed"),
      textStep("recovered"),
    );

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(buffer),
      budget: testBudget({ maxProviderRetries: 2 }),
    });

    expect(provider.turns).toHaveLength(3);
    expect(buffer.runCalls).toHaveLength(1);
    expect(retryEvents(result.traceEvents)).toHaveLength(1);
    expect(patchMessagesOf(result.messages)).toHaveLength(1);
    expect(saysOf(result.messages)).toEqual(["recovered"]);
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });

  it("stops non-retryable provider failures without retrying", async () => {
    const provider = providerOf(new Error("openai request failed: HTTP 400 token=secret"));

    const result = await runLoop({
      provider,
      budget: testBudget({ maxProviderRetries: 2 }),
    });

    expect(provider.turns).toHaveLength(1);
    expect(retryEvents(result.traceEvents)).toHaveLength(0);
    expect(saysOf(result.messages)).toHaveLength(1);
    expect(stopReasons(result.traceEvents)).toEqual(["provider_error"]);
    expect(turnErrorEvents(result.traceEvents)).toEqual([
      { type: "turn_error", reason: "http_status", retryable: false, httpStatus: 400 },
    ]);
    expect(JSON.stringify(turnErrorEvents(result.traceEvents))).not.toContain("token=secret");
  });

  it("preserves prior emitted edits when later provider retries are exhausted", async () => {
    const buffer = bufferWith([patchOutcome()]);
    const provider = providerOf(
      toolStep(call("set-1", "set_node", { node: { id: "root", type: "box", children: [] } })),
      new Error("openai request failed: HTTP 503"),
      new Error("openai request failed: HTTP 503"),
      new Error("openai request failed: HTTP 503"),
    );

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(buffer),
      budget: testBudget({ maxProviderRetries: 2 }),
    });

    expect(provider.turns).toHaveLength(4);
    expect(retryEvents(result.traceEvents)).toHaveLength(2);
    expect(patchMessagesOf(result.messages)).toHaveLength(1);
    expect(saysOf(result.messages)).toEqual([]);
    expect(stopReasons(result.traceEvents)).toEqual(["retry_exhausted"]);
  });

  it("stops at max_steps after executing the configured number of provider tool steps", async () => {
    const buffer = bufferWith([outcomeWith("ok: inspect 1"), outcomeWith("ok: inspect 2")]);
    const provider = providerOf(
      toolStep(call("inspect-1", "inspect_stage")),
      toolStep(call("inspect-2", "inspect_stage")),
      textStep("should not be reached"),
    );

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(buffer),
      budget: testBudget({ maxSteps: 2 }),
    });

    expect(provider.turns).toHaveLength(2);
    expect(buffer.runCalls.map((toolCall) => toolCall.id)).toEqual(["inspect-1", "inspect-2"]);
    expect(saysOf(result.messages)).toHaveLength(1);
    expect(stopReasons(result.traceEvents)).toEqual(["max_steps"]);
  });

  it("executes no tools from a provider step that exceeds maxToolCallsPerStep", async () => {
    const buffer = bufferWith();
    const provider = providerOf(
      toolStep(call("inspect-1", "inspect_stage"), call("inspect-2", "inspect_stage")),
      textStep("should not be reached"),
    );

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(buffer),
      budget: testBudget({ maxToolCallsPerStep: 1 }),
    });

    expect(provider.turns).toHaveLength(1);
    expect(buffer.runCalls).toHaveLength(0);
    expect(saysOf(result.messages)).toHaveLength(1);
    expect(stopReasons(result.traceEvents)).toEqual(["tool_call_limit"]);
  });

  it("bounds provider_step trace tool names before stopping an oversized provider step", async () => {
    const toolCalls = Array.from({ length: 30 }, (_, index) =>
      call(`inspect-${String(index)}`, `inspect_${String(index)}`),
    );
    const provider = providerOf({ text: "tool step", toolCalls });

    const result = await runLoop({
      provider,
      budget: testBudget({ maxToolCallsPerStep: 1 }),
    });

    expect(providerStepEvents(result.traceEvents)).toEqual([
      {
        type: "provider_step",
        provider: "openai",
        model: "mock-model",
        step: 1,
        textChars: "tool step".length,
        toolCallCount: 30,
        toolNames: toolCalls.slice(0, 16).map((toolCall) => toolCall.name),
      },
    ]);
    expect(stopReasons(result.traceEvents)).toEqual(["tool_call_limit"]);
  });

  it("does not inspect oversized tool names when trace is omitted", async () => {
    const explosiveCall = {
      id: "inspect-1",
      input: {},
      get name(): string {
        throw new Error("tool name should not be read");
      },
    } as ToolCall;
    const provider = providerOf({
      text: "tool step",
      toolCalls: [explosiveCall, explosiveCall],
    });
    const batches: ServerMessage[][] = [];

    for await (const batch of runReferenceAgentLoop({
      provider,
      system: "system prompt",
      event: EVENT,
      session: SESSION,
      sink: sinkWith(),
      agentId: "quickstart",
      budget: testBudget({ maxToolCallsPerStep: 1 }),
      bufferFactory: () => bufferWith(),
    })) {
      batches.push([...batch]);
    }

    expect(provider.turns).toHaveLength(1);
    expect(saysOf(batches.flat())).toHaveLength(1);
  });

  it("stops with context_limit before provider.run when context cannot fit", async () => {
    const provider = providerOf(textStep("should not be reached"));

    const result = await runLoop({
      provider,
      event: { kind: "message", text: "x".repeat(500) },
      system: "s",
      budget: testBudget({
        maxContextChars: 120,
        maxHistoryChars: 10,
        maxStageJsonChars: 1,
        maxStageSummaryNodes: 0,
      }),
    });

    expect(provider.turns).toHaveLength(0);
    expect(saysOf(result.messages)).toHaveLength(1);
    expect(stopReasons(result.traceEvents)).toEqual(["context_limit"]);
  });

  it("stops with sink_error when sink history cannot be read", async () => {
    const provider = providerOf(textStep("should not be reached"));

    const result = await runLoop({
      provider,
      sink: throwingSink(new Error("sink offline token=secret")),
    });

    expect(provider.turns).toHaveLength(0);
    expect(saysOf(result.messages)).toHaveLength(1);
    expect(stopReasons(result.traceEvents)).toEqual(["sink_error"]);
    expect(turnErrorEvents(result.traceEvents)).toEqual([
      { type: "turn_error", reason: "sink_error", retryable: false },
    ]);
    expect(JSON.stringify(turnErrorEvents(result.traceEvents))).not.toContain("token=secret");
  });

  it("emits fallback at most once when failure and unresolved buffer both require fallback", async () => {
    const buffer = bufferWith([], ["pending child"]);
    const provider = providerOf(new Error("openai request failed: HTTP 400"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(buffer),
    });

    expect(saysOf(result.messages)).toHaveLength(1);
    expect(stopReasons(result.traceEvents)).toEqual(["unresolved_buffer"]);
  });

  it("emits unresolved-buffer fallback instead of clean final prose", async () => {
    const buffer = bufferWith(
      [outcomeWith('queued: "root" waits for child node(s): child')],
      ['"root" still waits for child node(s): child'],
    );
    const provider = providerOf(
      toolStep(
        call("set-1", "set_node", {
          node: { id: "root", type: "box", children: ["child"] },
        }),
      ),
      textStep("clean final prose"),
    );

    const result = await runLoop({ provider, bufferFactory: bufferFactoryFor(buffer) });

    expect(saysOf(result.messages)).toHaveLength(1);
    expect(saysOf(result.messages)[0]).not.toBe("clean final prose");
    expect(stopReasons(result.traceEvents)).toEqual(["unresolved_buffer"]);
  });

  it("bounds clean provider stop text before surfacing it as final prose", async () => {
    const provider = providerOf(textStep(`  ${"final ".repeat(30)}  `));

    const result = await runLoop({
      provider,
      budget: testBudget({ maxFinalTextChars: 24 }),
    });

    expect(saysOf(result.messages)).toEqual(["final final final final "]);
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });
});
