import {
  BOUNDS,
  deriveMessageId,
  validateCatalog,
  type AgentEvent,
  type AuthorValidationResult,
  type ComponentDocument,
  type ConversationMessage,
  type DataModel,
  type FacetCatalog,
  type FacetTargetedMutationInput,
  type FacetTargetedMutationResult,
  type FacetToolSession,
  type PayloadEvaluation,
} from "@facet/core";
import { MemorySink, MemorySummaryStore } from "@facet/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  createReferenceAgent,
  createReferenceAgentWithDependencies,
  type ReferenceAgentOptions,
} from "./agent.js";
import { REFERENCE_AGENT_FALLBACK_TEXT } from "./harness/loop.js";
import type {
  ProviderStep,
  ProviderTurn,
  ReferenceProvider,
  ToolCall,
  ToolSpec,
} from "./provider.js";

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
  readonly sessionKey: string | undefined;
  document: ComponentDocument | null = null;
  data: DataModel = {};
  stageRevision = 0;
  readonly authoredMarkup: string[] = [];

  constructor(options: { readonly sessionKey?: string } = {}) {
    this.sessionKey = options.sessionKey;
  }

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
    contextWindowTokens: 8_000,
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

function makeAgent(
  options: Partial<ReferenceAgentOptions> & { readonly provider: ReferenceProvider },
) {
  return createReferenceAgent({
    sink: new MemorySink(),
    agentId: "quickstart",
    ...options,
  });
}

describe("createReferenceAgent", () => {
  it("returns a run-only in-process agent and leaves conversation framing to the runtime", async () => {
    const session = new MutableSession();
    const provider = providerOf(
      step("tool", [
        call("c1", "render_page", {
          markup: '<Screen name="home"><Text value="Hello" /></Screen>',
        }),
      ]),
      step("Done."),
    );
    const agent = makeAgent({ provider });

    expect("run" in agent).toBe(true);
    expect("handleEvent" in agent).toBe(false);

    const result = await agent.run({ event: EVENT, session });

    expect(result).toEqual({ text: "Done." });
    expect(session.authoredMarkup).toEqual(['<Screen name="home"><Text value="Hello" /></Screen>']);
    expect(result).not.toHaveProperty("patches");
    expect(result).not.toHaveProperty("conversation");
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

  it("accepts a zero-message provider stop as no runtime conversation", async () => {
    const agent = makeAgent({ provider: providerOf(step("")) });

    await expect(agent.run({ event: EVENT, session: new MutableSession() })).resolves.toEqual({
      text: null,
    });
  });

  it("returns the bounded safe fallback on provider failure without leaking provider detail", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const agent = makeAgent({ provider: providerOf(new Error("sk-secret provider exploded")) });

      const result = await agent.run({ event: EVENT, session: new MutableSession() });

      expect(result).toEqual({ text: REFERENCE_AGENT_FALLBACK_TEXT });
      expect(result.text).not.toContain("sk-secret");
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("sk-secret");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("deterministically truncates an over-bound assistant response before returning text", async () => {
    const long = "x".repeat(BOUNDS.conversationMessageChars + 10);
    const agent = makeAgent({ provider: providerOf(step(long)) });

    const result = await agent.run({ event: EVENT, session: new MutableSession() });

    expect(result.text).toHaveLength(BOUNDS.conversationMessageChars);
    expect(result.text?.endsWith("…")).toBe(true);
  });
});

describe("createReferenceAgentWithDependencies", () => {
  it("feeds persisted conversation history into the live provider turn", async () => {
    const sink = new MemorySink();
    await sink.record("quickstart:v1", message("turn-0", "visitor", "previous visitor context"));
    await sink.record(
      "quickstart:v1",
      message("turn-0", "assistant", "previous assistant context"),
    );
    const provider = providerOf(step("Done."));
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      budget: {
        maxHistoryTurns: 10,
        maxHistoryChars: 10_000,
        maxContextChars: 20_000,
      },
    });

    await expect(
      agent.run({ event: EVENT, session: new MutableSession({ sessionKey: "quickstart:v1" }) }),
    ).resolves.toEqual({ text: "Done." });

    const text = providerMessagesText(provider.turns[0]?.messages ?? []);
    expect(text).toContain("previous visitor context");
    expect(text).toContain("previous assistant context");
    expect(text).toContain("CURRENT FACET OBSERVATION");
  });

  it("runs detached summary maintenance with the same runtime conversation key", async () => {
    const sink = new MemorySink();
    for (const record of conversationHistory(4)) {
      await sink.record("quickstart:v1", record);
    }
    const summaryStore = new MemorySummaryStore();
    const backgroundTasks: Promise<void>[] = [];
    const summarizer = vi.fn(async () => ({
      version: 1 as const,
      visitor: "summarized visitor",
      pageDecisions: "summarized page",
      collectedData: "none",
      pending: "none",
      attempts: "none",
      omitted: "older turns",
    }));
    const agent = createReferenceAgentWithDependencies(
      {
        provider: providerOf(step("Done.")),
        sink,
        agentId: "quickstart",
        summaryStore,
        budget: {
          maxContextChars: 4_000,
          maxHistoryTurns: 2,
          maxHistoryChars: 10_000,
          compactionTriggerRatio: 0.01,
          compactionTargetRatio: 0.005,
          minRecentTurnsVerbatim: 2,
          maxSummarizerInputChars: 10_000,
          maxSummaryChars: 2_000,
        },
      },
      {
        summarizerFactory: () => summarizer,
        onBackgroundTask: (task) => {
          backgroundTasks.push(task);
        },
      },
    );

    await expect(
      agent.run({ event: EVENT, session: new MutableSession({ sessionKey: "quickstart:v1" }) }),
    ).resolves.toEqual({ text: "Done." });
    await Promise.all(backgroundTasks);

    const stored = await summaryStore.read("quickstart:v1");
    expect(summarizer).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(stored)).toContain("messageIdCoverage");
    expect(JSON.stringify(stored)).toContain(deriveMessageId("turn-2", "visitor"));
  });
});

function providerMessagesText(messages: readonly ProviderTurn["messages"][number][]): string {
  return messages
    .map((entry) => ("content" in entry ? entry.content : JSON.stringify(entry)))
    .join("\n");
}

function conversationHistory(turnCount: number): readonly ConversationMessage[] {
  const history: ConversationMessage[] = [];
  for (let index = 0; index < turnCount; index += 1) {
    const turnId = `turn-${String(index)}`;
    history.push(
      message(turnId, "visitor", `turn-${String(index)} visitor text ${"x".repeat(120)}`),
      message(turnId, "assistant", `turn-${String(index)} assistant text ${"y".repeat(120)}`),
    );
  }
  return history;
}

function message(
  turnId: string,
  role: ConversationMessage["role"],
  text: string,
): ConversationMessage {
  return {
    kind: "conversation",
    turnId,
    messageId: deriveMessageId(turnId, role),
    role,
    text,
    at: 0,
  };
}

function document(): ComponentDocument {
  return {
    entry: "home",
    screens: ["s-home"],
    nodes: {
      "s-home": {
        tag: "Screen",
        props: { name: { kind: "scalar", value: "home" } },
        children: [],
      },
    },
  };
}

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
          value: { type: "string", required: true, guidance: "Text value." },
        },
        acceptsChildren: false,
      },
    ],
  });
  if (!result.ok) throw new Error(`invalid test catalog: ${result.code}`);
  return result.catalog;
}
