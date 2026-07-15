import { describe, expect, it } from "vitest";
import { EMPTY_TREE } from "@facet/core";
import type { StageToolBuffer } from "@facet/agent-tools";
import type { Sink } from "@facet/runtime";

import { normalizeBudget } from "./budget.js";
import { compactInTurnTranscript } from "./in-turn-compaction.js";
import { runReferenceAgentLoop } from "./loop.js";
import type { ReferenceAgentTraceEvent } from "./trace.js";
import type { ProviderTurn, ReferenceProvider, TurnMessage } from "../provider.js";

const INITIAL_CONTEXT: readonly TurnMessage[] = [
  { role: "user", content: "Visitor said: show me a dashboard\n\nCURRENT STAGE\n(empty)" },
];

function compositionReadGroup(content: string): readonly TurnMessage[] {
  return [
    {
      role: "assistant_tools",
      text: "",
      toolCalls: [{ id: "read-1", name: "get_composition", input: { name: "dashboard" } }],
    },
    { role: "tool_result", callId: "read-1", content },
  ];
}

function ordinaryToolGroup(content: string): readonly TurnMessage[] {
  return [
    {
      role: "assistant_tools",
      text: "",
      toolCalls: [{ id: "inspect-1", name: "inspect_stage", input: {} }],
    },
    { role: "tool_result", callId: "inspect-1", content },
  ];
}

describe("in-turn composition read compaction", () => {
  it("keeps the newest composition read verbatim when min recent is zero", async () => {
    const exact = JSON.stringify({
      name: "dashboard",
      metadata: { description: "A complete dashboard reference" },
      nodes: { root: { id: "root", type: "box", children: [] } },
      padding: "x".repeat(5_000),
    });
    const messages = [...INITIAL_CONTEXT, ...compositionReadGroup(exact)];
    const budget = normalizeBudget({
      budget: { minRecentStepsVerbatim: 0, maxSummaryTokens: 1 },
    });

    const result = await compactInTurnTranscript({
      messages,
      initialContextLength: INITIAL_CONTEXT.length,
      event: { kind: "message", text: "show me a dashboard" },
      shadow: EMPTY_TREE,
      budget,
      summarizer: undefined,
      generation: 1,
      targetChars: 0,
      fixedChars: 0,
    });

    expect(result.messages).toContainEqual({
      role: "tool_result",
      callId: "read-1",
      content: exact,
    });
    expect(result.compactedGroupCount).toBe(0);
  });

  it("may compact a composition read after a later step group exists", async () => {
    const exact = JSON.stringify({ name: "dashboard", padding: "x".repeat(5_000) });
    const later = "newer ordinary observation";
    const messages = [
      ...INITIAL_CONTEXT,
      ...compositionReadGroup(exact),
      ...ordinaryToolGroup(later),
    ];

    const result = await compactInTurnTranscript({
      messages,
      initialContextLength: INITIAL_CONTEXT.length,
      event: { kind: "message", text: "show me a dashboard" },
      shadow: EMPTY_TREE,
      budget: normalizeBudget({
        budget: { minRecentStepsVerbatim: 0, maxSummaryTokens: 1 },
      }),
      summarizer: undefined,
      generation: 2,
      targetChars: 1_000,
      fixedChars: 0,
    });

    expect(result.compactedGroupCount).toBe(1);
    expect(result.messages).not.toContainEqual({
      role: "tool_result",
      callId: "read-1",
      content: exact,
    });
    expect(result.messages).toContainEqual({
      role: "tool_result",
      callId: "inspect-1",
      content: later,
    });
  });

  it("stops at context_limit instead of summarizing a newest composition read that cannot fit", async () => {
    const exact = JSON.stringify({ name: "dashboard", padding: "x".repeat(5_000) });
    const turns: ProviderTurn[] = [];
    const provider: ReferenceProvider = {
      name: "openai",
      model: "mock-model",
      async run(turn) {
        turns.push({ system: turn.system, messages: [...turn.messages] });
        return {
          text: "",
          toolCalls: [{ id: "read-1", name: "get_composition", input: { name: "dashboard" } }],
        };
      },
    };
    const buffer: StageToolBuffer = {
      run() {
        return {
          observation: exact,
          messages: [],
          mutated: false,
          said: false,
          shadow: EMPTY_TREE,
        };
      },
      resetEmittedPatchOps() {},
      drainUnresolved() {
        return [];
      },
      shadow: EMPTY_TREE,
    };
    const sink: Sink = {
      async record() {},
      async history() {
        return [];
      },
    };
    const trace: ReferenceAgentTraceEvent[] = [];
    const loop = runReferenceAgentLoop({
      provider,
      system: "system",
      event: { kind: "message", text: "show me a dashboard" },
      session: {
        agentId: "quickstart",
        visitor: { visitorId: "visitor-1" },
        stage: EMPTY_TREE,
      },
      sink,
      agentId: "quickstart",
      bufferFactory: () => buffer,
      tools: [],
      budget: normalizeBudget({
        budget: {
          maxContextChars: 800,
          maxContextTokens: 800,
          minRecentStepsVerbatim: 0,
          maxSummaryTokens: 1,
          compactionCooldownSteps: 0,
        },
      }),
      contextWindowTokens: 800,
      trace: (event) => {
        trace.push(event);
      },
    });

    let stopReason: string | undefined;
    for (;;) {
      const next = await loop.next();
      if (next.done) {
        stopReason = next.value.stopReason;
        break;
      }
    }

    expect(stopReason).toBe("context_limit");
    expect(turns).toHaveLength(1);
    expect(trace).not.toContainEqual(expect.objectContaining({ type: "compaction_done" }));
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        toolName: "get_composition",
        observationChars: exact.length,
        truncated: false,
      }),
    );
  });
});
