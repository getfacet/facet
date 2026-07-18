import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import {
  EMPTY_TREE,
  applyPatch,
  collectMessages,
  type ClientEvent,
  type FacetTree,
  type ServerMessage,
} from "@facet/core";
import type { ReferenceAgentDiagnosticEvent } from "@facet/reference-agent";
import { MemorySink } from "@facet/runtime";
import { describe, expect, it } from "vitest";

import { OFFICIAL_SCENARIOS } from "../scenarios/scenarios.js";
import { MAX_PROMPT_CODE_UNITS } from "../shared/run-contract.js";
import {
  DETERMINISTIC_MODEL,
  createDeterministicReferenceAgent,
} from "./deterministic-provider.js";
import { buildRunGuide } from "./run-guide.js";

function foldMessages(stage: FacetTree, messages: readonly ServerMessage[]): FacetTree {
  let next = stage;
  for (const message of messages) {
    if (message.kind === "patch") next = applyPatch(next, message.patches);
  }
  return next;
}

describe("deterministic reference provider", () => {
  it("uses the reference loop path without exposing provider secrets", async () => {
    const scenario = OFFICIAL_SCENARIOS.find(({ id }) => id === "landing-marketing");
    if (scenario === undefined) throw new Error("Expected the marketing scenario fixture");

    const guide = buildRunGuide({
      scenario,
      prompt: "Create the deterministic marketing stage.",
      constraint: { kind: "brick", brick: "text" },
    });
    expect(guide).toContain(scenario.id);
    expect(guide).toContain("text");
    expect(() =>
      buildRunGuide({
        scenario,
        prompt: "x".repeat(MAX_PROMPT_CODE_UNITS + 1),
        constraint: null,
      }),
    ).toThrow(/prompt/i);

    const diagnostics: ReferenceAgentDiagnosticEvent[] = [];
    const deterministic = createDeterministicReferenceAgent({
      agentId: "deterministic-agent",
      assets: { theme: DEFAULT_THEME, patterns: DEFAULT_PATTERNS },
      diagnosticObserver: (event) => diagnostics.push(event),
      guide,
      scenario,
      sink: new MemorySink(),
    });

    expect(deterministic.provider.name).toBe("openai");
    expect(deterministic.provider.model).toBe(DETERMINISTIC_MODEL);
    expect(deterministic.provenance).toEqual({
      mode: "deterministic",
      provider: "openai",
      model: DETERMINISTIC_MODEL,
    });

    const visitor = { visitorId: "deterministic-visitor" };
    let stage = EMPTY_TREE;
    const events: readonly ClientEvent[] = [
      { kind: "visit", visitor },
      { kind: "tap", action: { kind: "agent", name: "explore_marketing" } },
      { kind: "message", text: "Prepare the follow-up state." },
    ];

    for (const event of events) {
      const messages = await collectMessages(
        deterministic.agent(event, {
          agentId: "deterministic-agent",
          visitor,
          stage,
        }),
      );
      expect(messages.some(({ kind }) => kind === "patch")).toBe(true);
      stage = foldMessages(stage, messages);
    }

    expect(stage.nodes["marketing-body"]).toMatchObject({
      value: "The page adapted after the primary action.",
    });
    expect(stage.nodes["marketing-title"]).toMatchObject({
      value: "Adaptive interfaces, ready for review",
    });
    expect(
      diagnostics
        .filter(({ kind }) => kind === "tool-call")
        .map((event) => (event.kind === "tool-call" ? event.name : "")),
    ).toEqual([
      "get_pattern",
      "render_page",
      "get_pattern",
      "render_page",
      "get_pattern",
      "render_page",
    ]);
    expect(diagnostics.filter(({ kind }) => kind === "provider-attempt")).toHaveLength(9);
    expect(JSON.stringify(diagnostics)).not.toContain("Authorization");
    expect(JSON.stringify(diagnostics)).not.toContain("facet-lab-scripted-key");
  });
});
