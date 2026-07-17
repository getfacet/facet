import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { FacetPattern } from "@facet/core";
import * as agentTools from "./index.js";
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
  selectPatternReference,
} from "./index.js";
import type {
  FacetAgentSystemPromptOptions,
  FacetPromptAssets,
  GetBrickSpecToolInput,
  GetPatternToolInput,
  GetPresetToolInput,
  GetStyleChoicesToolInput,
  StageToolAssets,
} from "./index.js";

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacyNaming = new RegExp(["st", "amp"].join(""), "i");
const legacyTool = ["use_", "st", "amp"].join("");
const retiredTool = ["use", "composition"].join("_");
const retiredInput = ["Use", "Composition", "ToolInput"].join("");

describe("agent-tools barrel exports", () => {
  it("exports Pattern selection and the four current asset-read tools", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain("selectPatternReference");
    expect(source).toContain("GetPatternToolInput");
    expect(source).toContain("GetPresetToolInput");
    expect(source).toContain("GetBrickSpecToolInput");
    expect(source).toContain("GetStyleChoicesToolInput");
    expect(source).not.toContain(retiredInput);
    expect(source).not.toContain("formatCompositionObservation");
    expect("selectPatternReference" in agentTools).toBe(true);
    expect("formatCompositionObservation" in agentTools).toBe(false);
    expect(FACET_STAGE_TOOL_NAMES).toContain("get_pattern");
    expect(FACET_STAGE_TOOL_NAMES).toContain("get_preset");
    expect(FACET_STAGE_TOOL_NAMES).toContain("get_brick_spec");
    expect(FACET_STAGE_TOOL_NAMES).toContain("get_style_choices");
    expect(FACET_STAGE_TOOL_NAMES).not.toContain(retiredTool);
  });

  it("keeps retired composition and legacy naming out of the public surface", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).not.toContain(retiredInput);
    expect(source).not.toMatch(legacyNaming);

    expect(FACET_STAGE_TOOL_NAMES).not.toContain(retiredTool);
    expect(FACET_STAGE_TOOL_NAMES).not.toContain(legacyTool);
    expectTypeOf(selectPatternReference).toEqualTypeOf<
      (patterns: readonly FacetPattern[], name: string) => FacetPattern | undefined
    >();
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
    expect(FACET_TOOL_PLAYBOOK_PROMPT).toContain("get_pattern");
    expect(FACET_TOOL_PLAYBOOK_PROMPT).toContain("get_preset");
    expect(FACET_TOOL_PLAYBOOK_PROMPT).toContain("get_brick_spec");
    expect(FACET_TOOL_PLAYBOOK_PROMPT).toContain("get_style_choices");
    expect(FACET_TOOL_PLAYBOOK_PROMPT).not.toContain(retiredTool);
    expect(FACET_TOOL_PLAYBOOK_PROMPT).not.toMatch(legacyNaming);
    expectTypeOf<FacetPromptAssets>().toEqualTypeOf<StageToolAssets>();
    expectTypeOf<FacetPromptAssets>().toMatchTypeOf<{
      readonly theme: unknown;
      readonly patterns: readonly unknown[];
      readonly brickIndex: readonly unknown[];
      readonly presetIndex: readonly unknown[];
      readonly patternIndex: readonly unknown[];
    }>();
    expectTypeOf<FacetAgentSystemPromptOptions>().toMatchTypeOf<{
      readonly pageBrief: string;
      readonly assets?: FacetPromptAssets;
    }>();
    expectTypeOf<GetPatternToolInput>().toEqualTypeOf<{
      readonly name: string;
    }>();
    expectTypeOf<GetPresetToolInput>().toEqualTypeOf<{
      readonly brick: FacetPattern["nodes"][string]["type"];
      readonly name: string;
    }>();
    expectTypeOf<GetBrickSpecToolInput>().toEqualTypeOf<{
      readonly type: FacetPattern["nodes"][string]["type"];
    }>();
    expectTypeOf<GetStyleChoicesToolInput>().toEqualTypeOf<{
      readonly brick: FacetPattern["nodes"][string]["type"];
      readonly target: string;
      readonly property: string;
    }>();
  });
});
