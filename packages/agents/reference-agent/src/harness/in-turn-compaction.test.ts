import { describe, expect, it } from "vitest";
import type {
  VisitorEvent,
  AuthorValidationResult,
  ComponentDocument,
  FacetCatalog,
  FacetToolSession,
  PayloadEvaluation,
} from "@facet/core";
import { validateCatalog } from "@facet/core";

import { normalizeBudget } from "./budget.js";
import { compactInTurnTranscript, shouldCompactInTurn } from "./in-turn-compaction.js";
import type { TurnMessage } from "../provider.js";

const EVENT: VisitorEvent = {
  eventId: "turn1",
  eventName: "submit",
  sourceNodeId: "cta",
  screen: "home",
  stageRevision: 0,
  collect: {},
};

const INITIAL_CONTEXT: readonly TurnMessage[] = [
  { role: "user", content: "Visitor asked for a dashboard\n\nCURRENT FACET OBSERVATION\nold" },
];

function toolGroup(id: string, content: string): readonly TurnMessage[] {
  return [
    {
      role: "assistant_tools",
      text: "",
      toolCalls: [{ id: `call-${id}`, name: "read_screen", input: { screen: "home" } }],
    },
    { role: "tool_result", callId: `call-${id}`, content },
  ];
}

describe("shouldCompactInTurn", () => {
  it("triggers from character thresholds without a token estimator", () => {
    const budget = normalizeBudget({
      budget: {
        maxContextChars: 100,
        compactionTriggerRatio: 0.5,
        compactionTargetRatio: 0.25,
        minRecentStepsVerbatim: 1,
        compactionCooldownSteps: 0,
      },
    });
    const messages = [...INITIAL_CONTEXT, ...toolGroup("1", "x"), ...toolGroup("2", "y")];

    expect(
      shouldCompactInTurn({ budget }, messages, INITIAL_CONTEXT.length, 51, 2, undefined),
    ).toBe(true);
    expect(
      shouldCompactInTurn({ budget }, messages, INITIAL_CONTEXT.length, 49, 2, undefined),
    ).toBe(false);
  });
});

describe("compactInTurnTranscript", () => {
  it("summarizes the oldest step groups and refreshes the current observation", async () => {
    const budget = normalizeBudget({
      budget: {
        minRecentStepsVerbatim: 1,
        maxSummaryChars: 80,
        maxStageJsonChars: 1_000,
      },
    });
    const messages = [
      ...INITIAL_CONTEXT,
      ...toolGroup("1", "old observation".repeat(30)),
      ...toolGroup("2", "latest observation"),
    ];

    const result = await compactInTurnTranscript({
      messages,
      initialContextLength: INITIAL_CONTEXT.length,
      event: EVENT,
      session: session(),
      budget,
      summarizer: undefined,
      generation: 1,
      targetChars: 400,
      fixedChars: 0,
    });

    const rendered = result.messages
      .map((message) => ("content" in message ? message.content : message.text))
      .join("\n");
    expect(result.compactedGroupCount).toBe(1);
    expect(result.summarized).toBe(false);
    expect(rendered).toContain("[transcript compacted:");
    expect(rendered).toContain("CURRENT FACET OBSERVATION");
    expect(rendered).toContain("latest observation");
    expect(rendered).not.toContain("old observationold observation");
  });
});

function session(): FacetToolSession {
  return {
    catalog: catalog(),
    document: document(),
    data: {},
    stageRevision: 1,
    async applyAuthorMutation(): Promise<AuthorValidationResult> {
      return { ok: true, document: document() };
    },
    async applyTargetedMutation() {
      return {
        ok: false as const,
        code: "not_used",
        at: "kind",
        detail: "not used",
      };
    },
    async publishData(): Promise<PayloadEvaluation> {
      return { ok: true, chars: 0 };
    },
  };
}

function catalog(): FacetCatalog {
  const result = validateCatalog({
    components: [
      {
        tag: "Screen",
        whenToUse: "Root screen container.",
        authoring: {
          role: "display",
          informationTypes: ["test_content"],
          visualEmphasis: "supporting",
        } as const,
        props: {
          name: { type: "string", required: true, guidance: "Screen name." },
        },
        acceptsChildren: true,
      },
      {
        tag: "Text",
        whenToUse: "Text content.",
        authoring: {
          role: "display",
          informationTypes: ["test_content"],
          visualEmphasis: "supporting",
        } as const,
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
  return {
    entry: "home",
    screens: ["s-home"],
    nodes: {
      "s-home": {
        tag: "Screen",
        props: { name: scalar("home") },
        children: ["n1"],
      },
      n1: {
        tag: "Text",
        props: { value: scalar("Visible") },
        children: [],
      },
    },
  };
}
