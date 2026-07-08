import { describe, expect, expectTypeOf, it } from "vitest";
import {
  FACET_AGENT_ROLE_PROMPT,
  FACET_ASSET_PRIVACY_PROMPT,
  FACET_PAGE_BRIEF_HEADING,
  FACET_PAGE_EXPERIENCE_PROMPT,
  FACET_STATE_EDITING_PROMPT,
  FACET_TOOL_PLAYBOOK_PROMPT,
  FACET_TOOL_RESULT_CONTRACT_PROMPT,
  buildFacetAgentSystemPrompt,
  formatAgentToolObservation,
  parseAgentToolObservation,
} from "./index.js";
import type { FacetAgentSystemPromptOptions, FacetPromptAssets } from "./index.js";

describe("agent-tools barrel exports", () => {
  it("exports the agent tool observation helpers", () => {
    const observation = formatAgentToolObservation({
      tool: "say",
      status: "ok",
      outcome: "no_stage_change",
      message: "Sent a chat message.",
    });

    expect(parseAgentToolObservation(observation.text)).toMatchObject({
      tool: "say",
      outcome: "no_stage_change",
      applied: false,
    });
  });

  it("exports the prompt-kit runtime surface and types", () => {
    const prompt = buildFacetAgentSystemPrompt({
      pageBrief: "# Agent page\n\nBuild the visible page.",
    });

    expect(prompt).toContain(FACET_AGENT_ROLE_PROMPT);
    expect(prompt).toContain(FACET_PAGE_EXPERIENCE_PROMPT);
    expect(prompt).toContain(FACET_STATE_EDITING_PROMPT);
    expect(prompt).toContain(FACET_TOOL_PLAYBOOK_PROMPT);
    expect(prompt).toContain(FACET_TOOL_RESULT_CONTRACT_PROMPT);
    expect(prompt).toContain(FACET_ASSET_PRIVACY_PROMPT);
    expect(prompt).toContain(FACET_PAGE_BRIEF_HEADING);
    expectTypeOf<FacetPromptAssets>().toMatchTypeOf<{
      readonly themes?: readonly unknown[];
      readonly stamps?: readonly unknown[];
    }>();
    expectTypeOf<FacetAgentSystemPromptOptions>().toMatchTypeOf<{
      readonly pageBrief: string;
      readonly assets?: FacetPromptAssets;
    }>();
  });
});
