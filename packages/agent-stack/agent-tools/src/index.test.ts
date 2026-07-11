import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  FACET_AGENT_ROLE_PROMPT,
  FACET_ASSET_PRIVACY_PROMPT,
  FACET_PAGE_BRIEF_HEADING,
  FACET_PAGE_EXPERIENCE_PROMPT,
  FACET_STAGE_TOOL_NAMES,
  FACET_STATE_EDITING_PROMPT,
  FACET_TOOL_PLAYBOOK_PROMPT,
  FACET_TOOL_RESULT_CONTRACT_PROMPT,
  buildFacetAgentSystemPrompt,
  formatAgentToolObservation,
  parseAgentToolObservation,
} from "./index.js";
import type {
  FacetAgentSystemPromptOptions,
  FacetPromptAssets,
  StageToolAssets,
  UseCompositionToolInput,
} from "./index.js";

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacyNaming = new RegExp(["st", "amp"].join(""), "i");
const legacyTool = ["use_", "st", "amp"].join("");

describe("agent-tools barrel exports", () => {
  it("exports the canonical composition tool surface with no legacy re-export names", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain("UseCompositionToolInput");
    expect(source).not.toMatch(legacyNaming);

    expect(FACET_STAGE_TOOL_NAMES).toContain("use_composition");
    expect(FACET_STAGE_TOOL_NAMES).not.toContain(legacyTool);
  });

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
    expect(FACET_TOOL_PLAYBOOK_PROMPT).toContain("use_composition");
    expect(FACET_TOOL_PLAYBOOK_PROMPT).not.toMatch(legacyNaming);
    expectTypeOf<FacetPromptAssets>().toEqualTypeOf<StageToolAssets>();
    expectTypeOf<FacetPromptAssets>().toMatchTypeOf<{
      readonly themes?: readonly unknown[];
      readonly compositions?: readonly unknown[];
    }>();
    expectTypeOf<FacetAgentSystemPromptOptions>().toMatchTypeOf<{
      readonly pageBrief: string;
      readonly assets?: FacetPromptAssets;
    }>();
    expectTypeOf<UseCompositionToolInput>().toMatchTypeOf<{
      readonly name: string;
      readonly params: Readonly<Record<string, string>>;
      readonly at: { readonly parent: string };
    }>();
  });
});
