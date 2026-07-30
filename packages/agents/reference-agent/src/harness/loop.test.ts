import { describe, expect, it } from "vitest";
import type {
  AgentEvent,
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

const EVENT: AgentEvent = {
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

  it("emits the bounded safe fallback as the single conversation on provider failure", async () => {
    const result = await collect({ provider: providerOf(new TypeError("fetch failed")) });

    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.conversation?.text).toBe(REFERENCE_AGENT_FALLBACK_TEXT);
    expect(result.summary).toMatchObject({
      stopReason: "provider_error",
      stepCount: 0,
      toolCallCount: 0,
      finalTextChars: REFERENCE_AGENT_FALLBACK_TEXT.length,
    });
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
