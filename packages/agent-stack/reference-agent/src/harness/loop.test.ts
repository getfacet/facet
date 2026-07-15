import { describe, expect, it } from "vitest";
import {
  EMPTY_TREE,
  type ClientEvent,
  type FacetNode,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
} from "@facet/core";
import type { Sink, StoredEvent, SummaryStore } from "@facet/runtime";
import type { StageToolBuffer, StageToolBufferOutcome, ToolSpec } from "@facet/agent-tools";

import { normalizeBudget, type ReferenceAgentBudget } from "./budget.js";
import { runReferenceAgentLoop, type ReferenceAgentLoopBufferFactory } from "./loop.js";
import type { ConversationSummary, Summarizer, SummarizerRequest } from "./summary.js";
import type { ReferenceAgentTraceEvent } from "./trace.js";
import type {
  ProviderStep,
  ProviderTurn,
  ReferenceProvider,
  ToolCall,
  TurnMessage,
} from "../provider.js";

const SESSION: FacetSession = {
  agentId: "quickstart",
  visitor: { visitorId: "visitor-1" },
  stage: EMPTY_TREE,
};

const EVENT: ClientEvent = { kind: "message", text: "update the page" };

interface MockProvider extends ReferenceProvider {
  readonly turns: ProviderTurn[];
  readonly toolsByAttempt: readonly ToolSpec[][];
}

interface FakeStageToolBuffer extends StageToolBuffer {
  readonly runCalls: readonly ToolCall[];
  readonly resetCount: number;
}

interface RunLoopOptions {
  readonly provider: ReferenceProvider;
  readonly budget?: ReferenceAgentBudget;
  readonly bufferFactory?: ReferenceAgentLoopBufferFactory;
  readonly event?: ClientEvent;
  readonly session?: FacetSession;
  readonly sink?: Sink;
  readonly system?: string;
  readonly tools?: readonly ToolSpec[];
  readonly summarizer?: Summarizer;
  readonly contextWindowTokens?: number;
  readonly summaryStore?: Pick<SummaryStore, "get">;
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
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    ...(options.summarizer !== undefined ? { summarizer: options.summarizer } : {}),
    ...(options.contextWindowTokens !== undefined
      ? { contextWindowTokens: options.contextWindowTokens }
      : {}),
    ...(options.summaryStore !== undefined ? { summaryStore: options.summaryStore } : {}),
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

  it("preserves complete get_composition results for the next provider turn", async () => {
    const composition = {
      name: "large-reference",
      metadata: { description: "Large exact reference" },
      root: "root",
      nodes: { root: { id: "root", type: "text", value: "x".repeat(5_000) } },
    };
    const exactObservation = JSON.stringify({
      status: "ok",
      data: { data: JSON.stringify(composition) },
    });
    const buffer = bufferWith([outcomeWith(exactObservation)]);
    const provider = providerOf(
      toolStep(call("composition-1", "get_composition", { name: composition.name })),
      textStep("done"),
    );

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(buffer),
      budget: testBudget({ maxObservationChars: 4_000, maxContextChars: 20_000 }),
      tools: [],
    });

    expect(exactObservation.length).toBeGreaterThan(4_000);
    expect(provider.turns).toHaveLength(2);
    const exactResult = provider.turns[1]?.messages.at(-1);
    expect(exactResult).toEqual({
      role: "tool_result",
      callId: "composition-1",
      content: exactObservation,
    });
    if (exactResult?.role !== "tool_result") throw new Error("expected exact tool_result");
    expect(JSON.parse(exactResult.content)).toEqual(JSON.parse(exactObservation));
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });

  it("preserves complete get_composition results by stopping before an over-budget handoff", async () => {
    const exactObservation = JSON.stringify({
      status: "ok",
      data: { data: JSON.stringify({ name: "too-large", value: "x".repeat(5_000) }) },
    });
    const buffer = bufferWith([outcomeWith(exactObservation)]);
    const provider = providerOf(
      toolStep(call("composition-1", "get_composition", { name: "too-large" })),
      textStep("must not be reached"),
    );

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(buffer),
      budget: testBudget({
        maxObservationChars: 4_000,
        maxContextChars: 3_000,
        minRecentStepsVerbatim: 1,
      }),
      tools: [],
    });

    expect(provider.turns).toHaveLength(1);
    expect(buffer.runCalls).toHaveLength(1);
    expect(stopReasons(result.traceEvents)).toEqual(["context_limit"]);
    expect(result.traceEvents).toContainEqual({
      type: "tool_result",
      toolName: "get_composition",
      callId: "composition-1",
      observationChars: exactObservation.length,
      truncated: false,
    });
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

const TRANSCRIPT_MARKER = "[transcript compacted:";
const SUMMARY_MARKER = "CONVERSATION SUMMARY";

function bigObservationBuffer(chars = 200): FakeStageToolBuffer {
  return bufferWith([outcomeWith("x".repeat(chars))]);
}

function toolSteps(count: number): ProviderStep[] {
  return Array.from({ length: count }, (_, index) =>
    toolStep(call(`t-${String(index)}`, "inspect_stage")),
  );
}

/** Tool steps that each carry a provider-reported `inputTokens` usage count. */
function usageToolSteps(count: number, inputTokens: number): ProviderStep[] {
  return Array.from({ length: count }, (_, index) => ({
    text: "tool step",
    toolCalls: [call(`t-${String(index)}`, "inspect_stage")],
    usage: { inputTokens },
  }));
}

/** A box root with `nodeCount` text children — a tree large enough to render as
 * full JSON (well past a small char cap) yet summarize to a bounded block. */
function wideTree(nodeCount: number, valuePrefix: string): FacetTree {
  const childIds = Array.from({ length: nodeCount }, (_, index) => `n${String(index)}`);
  const nodes: Record<string, FacetNode> = {
    root: { id: "root", type: "box", children: childIds },
  };
  for (const id of childIds) {
    nodes[id] = { id, type: "text", value: `${valuePrefix}-${id}-node-value` };
  }
  return { root: "root", nodes };
}

function hasCompactionTriggered(traceEvents: readonly ReferenceAgentTraceEvent[]): boolean {
  return traceEvents.some((event) => event.type === "compaction_triggered");
}

function summarizerOf(
  result: ConversationSummary | undefined,
  requests: SummarizerRequest[],
): Summarizer {
  return async (request) => {
    requests.push(request);
    return result;
  };
}

function rejectingSummarizer(requests: SummarizerRequest[]): Summarizer {
  return async (request) => {
    requests.push(request);
    throw new Error("summarizer boom");
  };
}

function sampleSummary(): ConversationSummary {
  return {
    version: 1,
    visitor: "returning visitor Ada",
    pageDecisions: "built a dashboard",
    collectedData: "",
    pending: "",
    attempts: "",
    omitted: "",
  };
}

function userContentsOf(turn: ProviderTurn | undefined): readonly string[] {
  return (turn?.messages ?? []).flatMap((message) =>
    message.role === "user" ? [message.content] : [],
  );
}

function turnWith(provider: MockProvider, needle: string): ProviderTurn | undefined {
  return provider.turns.find((turn) =>
    userContentsOf(turn).some((content) => content.includes(needle)),
  );
}

/** Every `tool_result` in a sent turn must sit under an open `assistant_tools`. */
function assertTurnPairIntegrity(messages: readonly TurnMessage[]): void {
  let openToolUse = false;
  for (const message of messages) {
    if (message.role === "assistant_tools") {
      openToolUse = true;
    } else if (message.role === "tool_result") {
      expect(openToolUse).toBe(true);
    } else {
      openToolUse = false;
    }
  }
}

function compactionBudget(overrides: Partial<ReferenceAgentBudget> = {}): ReferenceAgentBudget {
  return testBudget({
    maxContextTokens: 300,
    minRecentStepsVerbatim: 2,
    compactionCooldownSteps: 50,
    ...overrides,
  });
}

describe("in-turn compaction", () => {
  it("compacts the oldest step groups mid-turn and finishes with provider_stop, not context_limit", async () => {
    const provider = providerOf(...toolSteps(4), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget(),
      contextWindowTokens: 300,
      tools: [],
    });

    const compactedTurn = turnWith(provider, TRANSCRIPT_MARKER);
    expect(compactedTurn).toBeDefined();
    // Exactly one injected marker replaces the compacted groups.
    expect(
      userContentsOf(compactedTurn).filter((content) => content.includes(TRANSCRIPT_MARKER)),
    ).toHaveLength(1);
    // The most recent step groups survive verbatim as real tool_result messages.
    expect((compactedTurn?.messages ?? []).some((m) => m.role === "tool_result")).toBe(true);
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
    expect(saysOf(result.messages)).toEqual(["done"]);
  });

  it("calls a summarizer with kind 'transcript' and injects the returned summary block", async () => {
    const requests: SummarizerRequest[] = [];
    const provider = providerOf(...toolSteps(4), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget(),
      contextWindowTokens: 300,
      tools: [],
      summarizer: summarizerOf(sampleSummary(), requests),
    });

    expect(requests).not.toHaveLength(0);
    expect(requests[0]?.kind).toBe("transcript");
    expect(requests[0]?.content).toContain("inspect_stage");

    const summaryTurn = turnWith(provider, SUMMARY_MARKER);
    expect(summaryTurn).toBeDefined();
    expect(userContentsOf(summaryTurn).join("\n")).toContain("returning visitor Ada");
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });

  it("falls back to a deterministic marker when the summarizer returns undefined", async () => {
    const requests: SummarizerRequest[] = [];
    const provider = providerOf(...toolSteps(4), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget(),
      contextWindowTokens: 300,
      tools: [],
      summarizer: summarizerOf(undefined, requests),
    });

    expect(requests).not.toHaveLength(0);
    expect(turnWith(provider, TRANSCRIPT_MARKER)).toBeDefined();
    expect(turnWith(provider, SUMMARY_MARKER)).toBeUndefined();
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });

  it("falls back to a deterministic marker when the summarizer rejects", async () => {
    const requests: SummarizerRequest[] = [];
    const provider = providerOf(...toolSteps(4), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget(),
      contextWindowTokens: 300,
      tools: [],
      summarizer: rejectingSummarizer(requests),
    });

    expect(requests).not.toHaveLength(0);
    expect(turnWith(provider, TRANSCRIPT_MARKER)).toBeDefined();
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });

  it("leaves the post-compaction transcript pair-safe (no orphan tool_result)", async () => {
    const provider = providerOf(...toolSteps(4), textStep("done"));

    await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget(),
      contextWindowTokens: 300,
      tools: [],
    });

    const compactedTurn = turnWith(provider, TRANSCRIPT_MARKER);
    expect(compactedTurn).toBeDefined();
    const messages = compactedTurn?.messages ?? [];
    // The first tool_result in the sent turn is never dangling.
    assertTurnPairIntegrity(messages);
  });

  it("emits compaction_triggered and compaction_done trace events for the in-turn site", async () => {
    const provider = providerOf(...toolSteps(4), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget(),
      contextWindowTokens: 300,
      tools: [],
      summarizer: summarizerOf(sampleSummary(), []),
    });

    const triggered = result.traceEvents.find((event) => event.type === "compaction_triggered");
    expect(triggered).toMatchObject({ site: "in_turn" });
    if (triggered?.type === "compaction_triggered") {
      expect(triggered.estimatedTokens).toBeGreaterThan(0);
      expect(triggered.budgetTokens).toBeGreaterThan(0);
    }
    const done = result.traceEvents.find((event) => event.type === "compaction_done");
    expect(done).toMatchObject({ site: "in_turn", generation: 1 });
    if (done?.type === "compaction_done") {
      expect(done.coveredThrough).toBeGreaterThan(0);
      expect(done.afterTokens).toBeLessThan(done.beforeTokens);
    }
    expect(result.traceEvents.filter((event) => event.type === "compaction_failed")).toHaveLength(
      0,
    );
  });

  it("emits compaction_failed for the in-turn site when the summarizer yields nothing", async () => {
    const provider = providerOf(...toolSteps(4), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget(),
      contextWindowTokens: 300,
      tools: [],
      summarizer: summarizerOf(undefined, []),
    });

    const failed = result.traceEvents.find((event) => event.type === "compaction_failed");
    expect(failed).toMatchObject({ site: "in_turn", reason: "summarizer_failed" });
    expect(result.traceEvents.filter((event) => event.type === "compaction_done")).toHaveLength(0);
  });

  it("suppresses a second compaction within the cooldown window", async () => {
    const provider = providerOf(...toolSteps(8), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget({ compactionCooldownSteps: 40 }),
      contextWindowTokens: 300,
      tools: [],
    });

    expect(
      result.traceEvents.filter((event) => event.type === "compaction_triggered"),
    ).toHaveLength(1);
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });

  it("stops an over-budget composition read during the compaction cooldown", async () => {
    const exactObservation = JSON.stringify({
      status: "ok",
      data: { data: JSON.stringify({ name: "too-large", value: "x".repeat(5_000) }) },
    });
    const buffer = bufferWith([outcomeWith("x".repeat(1_000)), outcomeWith(exactObservation)]);
    const provider = providerOf(
      toolStep(call("inspect-1", "inspect_stage")),
      toolStep(call("composition-1", "get_composition", { name: "too-large" })),
      textStep("must not be reached"),
    );

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(buffer),
      budget: compactionBudget({
        compactionCooldownSteps: 40,
        maxContextChars: 20_000,
        minRecentStepsVerbatim: 0,
      }),
      contextWindowTokens: 300,
      tools: [],
    });

    expect(
      result.traceEvents.filter((event) => event.type === "compaction_triggered"),
    ).toHaveLength(1);
    expect(provider.turns).toHaveLength(2);
    expect(buffer.runCalls).toHaveLength(2);
    expect(stopReasons(result.traceEvents)).toEqual(["context_limit"]);
    expect(result.traceEvents).toContainEqual({
      type: "tool_result",
      toolName: "get_composition",
      callId: "composition-1",
      observationChars: exactObservation.length,
      truncated: false,
    });
  });

  it("compacts again once the cooldown has elapsed", async () => {
    const provider = providerOf(...toolSteps(8), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget({ compactionCooldownSteps: 0 }),
      contextWindowTokens: 300,
      tools: [],
    });

    expect(
      result.traceEvents.filter((event) => event.type === "compaction_triggered").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("traces deterministic marker compaction as compaction_done when no summarizer is configured", async () => {
    const provider = providerOf(...toolSteps(4), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget(),
      contextWindowTokens: 300,
      tools: [],
    });

    expect(result.traceEvents.some((event) => event.type === "compaction_done")).toBe(true);
    expect(result.traceEvents.filter((event) => event.type === "compaction_failed")).toHaveLength(
      0,
    );
  });

  it("refreshes the CURRENT STAGE block from the buffer's mutated shadow tree", async () => {
    const provider = providerOf(...toolSteps(4), textStep("done"));
    const shadowTree: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["beacon"] },
        beacon: { id: "beacon", type: "text", value: "shadow-beacon-value" },
      },
    };
    // The initial session stage renders as full JSON and is STRICTLY LARGER than
    // the shadow refresh, so the never-inflate guard takes the full-JSON refresh
    // path (an empty initial stage would force a summary-mode refresh). Its stale
    // beacon value must NOT survive the refresh — the current shadow does.
    const staleSession: FacetSession = {
      ...SESSION,
      stage: {
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["beacon"] },
          beacon: {
            id: "beacon",
            type: "text",
            value: "stale-beacon-value-strictly-longer-than-the-shadow-value",
          },
        },
      },
    };
    const base = bigObservationBuffer();
    const buffer: StageToolBuffer = {
      run: (callToRun) => base.run(callToRun),
      resetEmittedPatchOps: () => {
        base.resetEmittedPatchOps();
      },
      drainUnresolved: () => base.drainUnresolved(),
      get shadow() {
        return shadowTree;
      },
    };

    await runLoop({
      provider,
      session: staleSession,
      bufferFactory: bufferFactoryFor(buffer),
      budget: compactionBudget(),
      contextWindowTokens: 300,
      tools: [],
    });

    const compactedTurn = turnWith(provider, TRANSCRIPT_MARKER);
    expect(compactedTurn).toBeDefined();
    const contents = userContentsOf(compactedTurn);
    // The refreshed stage block renders the CURRENT shadow, not the stale turn-start tree...
    expect(contents.join("\n")).toContain("shadow-beacon-value");
    // ...and REPLACES the original event+stage message instead of duplicating it.
    expect(contents.filter((content) => content.includes("CURRENT STAGE")).length).toBe(1);
  });

  it("keeps more recent step groups verbatim when the landing target allows it", async () => {
    const run = async (compactionTargetRatio: number): Promise<number> => {
      const provider = providerOf(...toolSteps(7), textStep("done"));
      await runLoop({
        provider,
        bufferFactory: bufferFactoryFor(bigObservationBuffer(60)),
        budget: compactionBudget({ compactionTargetRatio, maxSummaryTokens: 25 }),
        contextWindowTokens: 300,
        tools: [],
      });
      const compactedTurn = turnWith(provider, TRANSCRIPT_MARKER);
      expect(compactedTurn).toBeDefined();
      return (compactedTurn?.messages ?? []).filter((m) => m.role === "tool_result").length;
    };

    const generous = await run(0.7);
    const tight = await run(0.05);
    expect(generous).toBeGreaterThan(tight);
  });

  it("stops with context_limit when compaction cannot bring the turn under the hard budget", async () => {
    const provider = providerOf(...toolSteps(6));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer()),
      budget: compactionBudget({ maxContextTokens: 150, minRecentStepsVerbatim: 3 }),
      contextWindowTokens: 150,
      tools: [],
    });

    expect(provider.turns).toHaveLength(4);
    expect(stopReasons(result.traceEvents)).toEqual(["context_limit"]);
  });

  // Calibration wiring: `step.usage.inputTokens` must reach the estimator as the
  // reported-tokens argument. A huge inputTokens count drives the chars/token
  // ratio to its LOW clamp, so token estimates RISE and compaction triggers;
  // a tiny count drives it HIGH, so estimates SHRINK and compaction stays away.
  // The two runs share one budget so ONLY the reported usage differs — deleting
  // the `calibrate` call (cpt frozen at the default) or swapping its arguments
  // flips at least one assertion.
  it("feeds provider inputTokens into the estimator so a LOW chars-per-token calibration triggers compaction", async () => {
    const provider = providerOf(...usageToolSteps(8, 5000), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer(150)),
      budget: compactionBudget({ maxContextTokens: 800 }),
      contextWindowTokens: 800,
      tools: [],
    });

    expect(hasCompactionTriggered(result.traceEvents)).toBe(true);
  });

  it("feeds provider inputTokens into the estimator so a HIGH chars-per-token calibration suppresses compaction", async () => {
    const provider = providerOf(...usageToolSteps(8, 1), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer(150)),
      budget: compactionBudget({ maxContextTokens: 800 }),
      contextWindowTokens: 800,
      tools: [],
    });

    expect(hasCompactionTriggered(result.traceEvents)).toBe(false);
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });

  // Never-inflate guard: the initial assembly falls back to a small stage SUMMARY
  // (full JSON of a large stage does not fit the small context cap), but the
  // buffer's mutated shadow is large. A refresh that re-rendered full JSON would
  // GROW the turn past budget; the guard downgrades the refresh to summary mode
  // so compaction only ever shrinks. The turn finishes cleanly and no
  // compaction_done reports afterTokens above beforeTokens.
  it("never inflates the turn when refreshing a summary-mode stage from a large shadow", async () => {
    const largeStage = wideTree(40, "session");
    const largerShadow = wideTree(48, "shadow");
    const base = bigObservationBuffer(200);
    const buffer: StageToolBuffer = {
      run: (callToRun) => base.run(callToRun),
      resetEmittedPatchOps: () => {
        base.resetEmittedPatchOps();
      },
      drainUnresolved: () => base.drainUnresolved(),
      get shadow() {
        return largerShadow;
      },
    };
    const provider = providerOf(...toolSteps(8), textStep("done"));

    const result = await runLoop({
      provider,
      session: { ...SESSION, stage: largeStage },
      bufferFactory: bufferFactoryFor(buffer),
      budget: testBudget({
        maxContextChars: 2000,
        maxStageJsonChars: 20000,
        maxStageSummaryNodes: 8,
        maxContextTokens: 300,
        minRecentStepsVerbatim: 2,
        compactionCooldownSteps: 0,
      }),
      contextWindowTokens: 300,
      tools: [],
    });

    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
    const doneEvents = result.traceEvents.filter((event) => event.type === "compaction_done");
    expect(doneEvents).not.toHaveLength(0);
    for (const event of doneEvents) {
      if (event.type === "compaction_done") {
        expect(event.afterTokens).toBeLessThanOrEqual(event.beforeTokens);
      }
    }
  });

  // Char-trigger path (Finding 2): the token budget is set high enough that the
  // token trigger does NOT fire as the char cap is crossed, so only the char cap
  // being exceeded mid-turn can drive the first compaction. Compaction runs (a
  // deterministic marker appears) and the loop continues to a clean stop instead
  // of hard-stopping the instant chars crossed the cap.
  it("compacts on the char cap alone when the token trigger has not fired, then continues", async () => {
    const provider = providerOf(...toolSteps(8), textStep("done"));

    const result = await runLoop({
      provider,
      bufferFactory: bufferFactoryFor(bigObservationBuffer(200)),
      budget: testBudget({
        maxContextChars: 1500,
        maxContextTokens: 600,
        maxStageSummaryNodes: 8,
        minRecentStepsVerbatim: 2,
        compactionCooldownSteps: 0,
      }),
      contextWindowTokens: 600,
      tools: [],
    });

    expect(hasCompactionTriggered(result.traceEvents)).toBe(true);
    expect(turnWith(provider, TRANSCRIPT_MARKER)).toBeDefined();
    expect(stopReasons(result.traceEvents)).toEqual(["provider_stop"]);
  });
});

describe("context_compacted trace accounting", () => {
  const historyEntries = (count: number): StoredEvent[] =>
    Array.from({ length: count }, (_, index) => ({
      at: index,
      event: { kind: "message", text: `turn ${String(index)}` },
      messages: [{ kind: "say", text: `reply ${String(index)}` }],
    }));

  it("counts included turns excluding the compaction note", async () => {
    const provider = providerOf(textStep("done"));
    const result = await runLoop({
      provider,
      sink: sinkWith(historyEntries(6)),
      budget: testBudget({ maxHistoryTurns: 3 }),
    });

    const event = result.traceEvents.find((traced) => traced.type === "context_compacted");
    expect(event).toMatchObject({
      includedHistoryTurns: 3,
      droppedHistoryTurns: 3,
      originalHistoryTurns: 6,
    });
  });

  it("counts included turns excluding the pinned summary block and the note", async () => {
    const payload = {
      version: 1,
      visitor: "v",
      pageDecisions: "d",
      collectedData: "c",
      pending: "p",
      attempts: "a",
      omitted: "o",
      anchor: "0:message",
    };
    const summaryStore: Pick<SummaryStore, "get"> = {
      get: () => Promise.resolve({ payload, coveredThrough: 4, generation: 1 }),
    };
    const provider = providerOf(textStep("done"));
    const result = await runLoop({
      provider,
      sink: sinkWith(historyEntries(8)),
      summaryStore,
      budget: testBudget({ maxHistoryTurns: 2 }),
    });

    const event = result.traceEvents.find((traced) => traced.type === "context_compacted");
    // 7 messages = summary block + note + 2 turns (4 msgs) + final event/stage:
    // exactly 2 replayed turns, never 3 (the pre-fix over-count).
    expect(event).toMatchObject({ includedHistoryTurns: 2, droppedHistoryTurns: 2 });
  });
});
