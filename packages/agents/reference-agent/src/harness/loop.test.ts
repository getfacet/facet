import { describe, expect, it } from "vitest";
import type {
  VisitorEvent,
  AuthorValidationResult,
  ComponentDocument,
  DataModel,
  FacetCatalog,
  FacetTargetedMutationInput,
  FacetTargetedMutationResult,
  FacetToolSession,
  PayloadEvaluation,
  TurnOutcome,
} from "@facet/core";
import { validateCatalog } from "@facet/core";

import { TOOLS } from "../prompt.js";
import type {
  ProviderStep,
  ProviderTurn,
  ReferenceProvider,
  ToolCall,
  ToolSpec,
} from "../provider.js";
import { normalizeBudget, type ReferenceAgentBudget } from "./budget.js";
import {
  REFERENCE_AGENT_FALLBACK_TEXT,
  runReferenceAgentLoop,
  type ReferenceAgentLoopSummary,
} from "./loop.js";
import type { Summarizer } from "./summary.js";
import type { ReferenceAgentTraceEvent } from "./trace.js";

const EVENT: VisitorEvent = {
  eventId: "turn1",
  eventName: "submit",
  sourceNodeId: "cta",
  screen: "home",
  stageRevision: 0,
  collect: {},
};

class MutableSession implements FacetToolSession {
  readonly catalog = catalog();
  document: ComponentDocument | null = null;
  data: DataModel = {};
  stageRevision = 0;
  readonly authoredMarkup: string[] = [];

  async applyAuthorMutation(markup: string): Promise<AuthorValidationResult> {
    this.authoredMarkup.push(markup);
    this.stageRevision += 1;
    this.document = document();
    return { ok: true, document: this.document };
  }

  async applyTargetedMutation(
    input: FacetTargetedMutationInput,
  ): Promise<FacetTargetedMutationResult> {
    const markup = input.kind === "remove_subtree" ? "" : input.markup;
    this.authoredMarkup.push(markup);
    this.stageRevision += 1;
    this.document = document();
    return { ok: true, document: this.document };
  }

  async publishData(path: readonly string[], value: unknown): Promise<PayloadEvaluation> {
    this.stageRevision += 1;
    this.data = { ...this.data, [path.join(".")]: value };
    return { ok: true, chars: JSON.stringify(value).length };
  }
}

class ThrowingSession extends MutableSession {
  override async applyAuthorMutation(): Promise<AuthorValidationResult> {
    throw new Error("store missing row");
  }
}

interface MockProvider extends ReferenceProvider {
  readonly turns: ProviderTurn[];
  readonly toolsByAttempt: readonly ToolSpec[][];
}

function step(text: string, toolCalls: readonly ToolCall[] = []): ProviderStep {
  return { text, toolCalls };
}

function call(id: string, name: string, input: unknown): ToolCall {
  return { id, name, input };
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
      const current = steps[Math.min(next, steps.length - 1)];
      next += 1;
      if (current === undefined) throw new Error("missing scripted step");
      if (current instanceof Error) throw current;
      return current;
    },
  };
}

async function collect(options: {
  readonly provider: ReferenceProvider;
  readonly session?: MutableSession;
  readonly budget?: ReferenceAgentBudget;
  readonly trace?: (event: ReferenceAgentTraceEvent) => void;
  readonly summarizer?: Summarizer;
}): Promise<{
  readonly fragments: readonly TurnOutcome[];
  readonly summary: ReferenceAgentLoopSummary;
  readonly session: MutableSession;
}> {
  const session = options.session ?? new MutableSession();
  const fragments: TurnOutcome[] = [];
  const iterator = runReferenceAgentLoop({
    provider: options.provider,
    system: "system prompt",
    event: EVENT,
    session,
    budget: options.budget ?? normalizeBudget({ budget: { retryBackoffMs: 0 } }),
    ...(options.trace === undefined ? {} : { trace: options.trace }),
    ...(options.summarizer === undefined ? {} : { summarizer: options.summarizer }),
    now: () => 1_234,
  });
  while (true) {
    const next = await iterator.next();
    if (next.done) return { fragments, summary: next.value, session };
    fragments.push(...next.value);
  }
}

describe("runReferenceAgentLoop", () => {
  it("executes complete tool calls progressively and emits one final conversation fragment", async () => {
    const session = new MutableSession();
    const provider = providerOf(
      step("tool", [
        call("c1", "render_page", {
          markup: '<Screen name="home"><Text value="First" /></Screen>',
        }),
      ]),
      step("tool", [
        call("c2", "update_node", {
          targetId: "n-visible",
          markup: '<Screen name="home"><Text value="Second" /></Screen>',
        }),
      ]),
      step("Done."),
    );

    const result = await collect({ provider, session });

    expect(session.authoredMarkup).toEqual([
      '<Screen name="home"><Text value="First" /></Screen>',
      '<Screen name="home"><Text value="Second" /></Screen>',
    ]);
    expect(result.fragments.map((fragment) => fragment.stageRevision)).toEqual([1, 2, 2]);
    expect(result.fragments.filter((fragment) => fragment.conversation !== undefined)).toHaveLength(
      1,
    );
    expect(result.fragments.at(-1)?.conversation).toMatchObject({
      kind: "conversation",
      messageId: "turn1:assistant",
      turnId: "turn1",
      role: "assistant",
      text: "Done.",
      at: 1_234,
    });
    expect(result.summary).toMatchObject({
      stopReason: "provider_stop",
      stepCount: 3,
      toolCallCount: 2,
      finalTextChars: 5,
    });
  });

  it("does not mutate a document for incomplete streamed markup outside a complete tool call", async () => {
    const session = new MutableSession();
    const result = await collect({
      provider: providerOf(step('<Screen name="home"><Text value="unfinished"')),
      session,
    });

    expect(session.authoredMarkup).toEqual([]);
    expect(session.document).toBeNull();
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.conversation?.text).toContain("unfinished");
  });

  it("offers exactly the nine markup tools and no conversation tool to the provider", async () => {
    const provider = providerOf(step("Done."));
    await collect({ provider });

    expect(provider.toolsByAttempt[0]).toEqual(TOOLS);
    expect(provider.toolsByAttempt[0]?.map((tool) => tool.name)).toEqual([
      "render_page",
      "insert_subtree",
      "replace_subtree",
      "update_node",
      "remove_subtree",
      "read_component_spec",
      "read_screen",
      "read_data",
      "publish_data",
    ]);
    expect(provider.toolsByAttempt[0]?.some((tool) => tool.name === "say")).toBe(false);
  });

  it("emits the bounded safe fallback as the single conversation on non-retryable provider failure", async () => {
    const result = await collect({ provider: providerOf(new Error("configuration failed")) });

    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.conversation?.text).toBe(REFERENCE_AGENT_FALLBACK_TEXT);
    expect(result.summary).toMatchObject({
      stopReason: "provider_error",
      stepCount: 0,
      toolCallCount: 0,
      finalTextChars: REFERENCE_AGENT_FALLBACK_TEXT.length,
    });
  });

  it("turns malformed provider steps into a safe fallback instead of throwing", async () => {
    const trace: ReferenceAgentTraceEvent[] = [];
    const provider: ReferenceProvider = {
      name: "openai",
      model: "mock-model",
      async run() {
        return { text: undefined, toolCalls: [] } as unknown as ProviderStep;
      },
    };

    const result = await collect({ provider, trace: (event) => trace.push(event) });

    expect(result.fragments.at(-1)?.conversation?.text).toBe(REFERENCE_AGENT_FALLBACK_TEXT);
    expect(result.summary).toMatchObject({
      stopReason: "provider_error",
      stepCount: 0,
      toolCallCount: 0,
    });
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: "turn_error",
        reason: "malformed_response",
        retryable: false,
      }),
    );
  });

  it("turns malformed provider tool calls into a safe fallback instead of executing them", async () => {
    const trace: ReferenceAgentTraceEvent[] = [];
    const session = new MutableSession();
    const provider: ReferenceProvider = {
      name: "openai",
      model: "mock-model",
      async run() {
        return {
          text: "tool",
          toolCalls: [{ id: "c1", name: "render_page" }],
        } as unknown as ProviderStep;
      },
    };

    const result = await collect({ provider, session, trace: (event) => trace.push(event) });

    expect(session.authoredMarkup).toEqual([]);
    expect(result.fragments.at(-1)?.conversation?.text).toBe(REFERENCE_AGENT_FALLBACK_TEXT);
    expect(result.summary).toMatchObject({
      stopReason: "provider_error",
      stepCount: 0,
      toolCallCount: 0,
    });
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: "turn_error",
        reason: "malformed_response",
        retryable: false,
      }),
    );
  });

  it("turns tool/session exceptions into a safe fallback instead of throwing", async () => {
    const session = new ThrowingSession();
    const trace: ReferenceAgentTraceEvent[] = [];

    const result = await collect({
      session,
      provider: providerOf(
        step("tool", [
          call("c1", "render_page", {
            markup: '<Screen name="home"><Text value="First" /></Screen>',
          }),
        ]),
      ),
      trace: (event) => trace.push(event),
    });

    expect(session.authoredMarkup).toEqual([]);
    expect(result.fragments.at(-1)?.conversation?.text).toBe(REFERENCE_AGENT_FALLBACK_TEXT);
    expect(result.summary).toMatchObject({
      stopReason: "provider_error",
      stepCount: 1,
      toolCallCount: 0,
    });
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: "turn_error",
        reason: "tool_execution_error",
        retryable: false,
      }),
    );
  });

  it("retries a retryable provider failure before returning the successful step", async () => {
    const trace: ReferenceAgentTraceEvent[] = [];
    const provider = providerOf(new TypeError("fetch failed"), step("Recovered."));
    const result = await collect({
      provider,
      budget: normalizeBudget({ budget: { maxProviderRetries: 1, retryBackoffMs: 0 } }),
      trace: (event) => trace.push(event),
    });

    expect(provider.turns).toHaveLength(2);
    expect(trace.map((event) => event.type)).toContain("provider_retry");
    expect(result.summary).toMatchObject({
      stopReason: "provider_stop",
      stepCount: 1,
      toolCallCount: 0,
      finalTextChars: "Recovered.".length,
    });
    expect(result.fragments.at(-1)?.conversation?.text).toBe("Recovered.");
  });

  it("returns retry_exhausted when retryable provider failures outlive the budget", async () => {
    const provider = providerOf(new TypeError("fetch failed"));
    const result = await collect({
      provider,
      budget: normalizeBudget({ budget: { maxProviderRetries: 1, retryBackoffMs: 0 } }),
    });

    expect(provider.turns).toHaveLength(2);
    expect(result.fragments.at(-1)?.conversation?.text).toBe(REFERENCE_AGENT_FALLBACK_TEXT);
    expect(result.summary).toMatchObject({
      stopReason: "retry_exhausted",
      stepCount: 0,
      toolCallCount: 0,
    });
  });

  it("rejects a provider step that exceeds the per-step tool-call budget", async () => {
    const session = new MutableSession();
    const result = await collect({
      session,
      provider: providerOf(
        step("too many", [
          call("c1", "read_screen", { screen: "home" }),
          call("c2", "read_screen", { screen: "home" }),
        ]),
      ),
      budget: normalizeBudget({ budget: { maxToolCallsPerStep: 1 } }),
    });

    expect(session.authoredMarkup).toEqual([]);
    expect(result.summary).toMatchObject({
      stopReason: "tool_call_limit",
      stepCount: 1,
      toolCallCount: 0,
    });
    expect(result.fragments.at(-1)?.conversation?.text).toBe(REFERENCE_AGENT_FALLBACK_TEXT);
  });

  it("bounds final assistant text by the reference-agent final-text budget", async () => {
    const result = await collect({
      provider: providerOf(step("abcdef")),
      budget: normalizeBudget({ budget: { maxFinalTextChars: 3 } }),
    });

    expect(result.summary).toMatchObject({
      stopReason: "provider_stop",
      finalTextChars: 3,
    });
    expect(result.fragments.at(-1)?.conversation?.text).toBe("abc");
  });

  it("turns an empty provider stop into a safe empty_turn fallback", async () => {
    const result = await collect({ provider: providerOf(step("")) });

    expect(result.summary).toMatchObject({
      stopReason: "empty_turn",
      stepCount: 1,
      toolCallCount: 0,
    });
    expect(result.fragments.at(-1)?.conversation?.text).toBe(REFERENCE_AGENT_FALLBACK_TEXT);
  });

  it("compacts older in-turn tool transcript groups before the next provider attempt", async () => {
    const trace: ReferenceAgentTraceEvent[] = [];
    const provider = providerOf(
      step("render", [
        call("c1", "render_page", {
          markup: '<Screen name="home"><Text value="First" /></Screen>',
        }),
      ]),
      step("read", [call("c2", "read_screen", { screen: "home" })]),
      step("Done."),
    );
    const result = await collect({
      provider,
      trace: (event) => trace.push(event),
      budget: normalizeBudget({
        budget: {
          maxContextChars: 600,
          compactionTriggerRatio: 0.5,
          compactionTargetRatio: 0.25,
          minRecentStepsVerbatim: 1,
          compactionCooldownSteps: 0,
          retryBackoffMs: 0,
        },
      }),
    });

    const finalAttemptText = provider.turns
      .at(-1)
      ?.messages.map((message) => ("content" in message ? message.content : message.text))
      .join("\n");
    expect(trace.map((event) => event.type)).toEqual(
      expect.arrayContaining(["compaction_triggered", "compaction_done"]),
    );
    expect(finalAttemptText).toContain("[transcript compacted:");
    expect(finalAttemptText).toContain("CURRENT FACET OBSERVATION");
    expect(result.summary.stopReason).toBe("provider_stop");
  });
});

function catalog(): FacetCatalog {
  const result = validateCatalog({
    components: [
      {
        tag: "Screen",
        whenToUse: "Root screen container.",
        props: {
          name: { type: "string", required: true, guidance: "Screen name." },
        },
        acceptsChildren: true,
      },
      {
        tag: "Text",
        whenToUse: "Text content.",
        props: {
          value: { type: "string", guidance: "Text value." },
        },
        acceptsChildren: false,
      },
    ],
  });
  if (!result.ok) throw new Error(`invalid test catalog: ${result.code}`);
  return result.catalog;
}

function scalar(value: string): { readonly kind: "scalar"; readonly value: string } {
  return Object.freeze({ kind: "scalar" as const, value });
}

function document(): ComponentDocument {
  return Object.freeze({
    entry: "home",
    screens: Object.freeze(["s-home"]),
    nodes: Object.freeze({
      "s-home": Object.freeze({
        tag: "Screen",
        props: Object.freeze({ name: scalar("home") }),
        children: Object.freeze(["n-visible"]),
      }),
      "n-visible": Object.freeze({
        tag: "Text",
        props: Object.freeze({ value: scalar("Visible") }),
        children: Object.freeze([]),
      }),
    }),
  });
}
