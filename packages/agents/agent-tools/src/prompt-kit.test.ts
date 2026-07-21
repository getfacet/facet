import { BRICK_TYPES, STAGE_SPEC } from "@facet/core";
import { describe, expect, it } from "vitest";
import {
  FACET_AGENT_ROLE_PROMPT,
  FACET_ASSET_PRIVACY_PROMPT,
  FACET_DATA_BINDING_PROMPT,
  FACET_PAGE_BRIEF_HEADING,
  FACET_PAGE_EXPERIENCE_PROMPT,
  FACET_POLISHED_BRICK_GUIDANCE_PROMPT,
  FACET_STATE_EDITING_PROMPT,
  FACET_STYLE_DISCOVERY_POLICY,
  FACET_TOOL_PLAYBOOK_PROMPT,
  FACET_TOOL_RESULT_CONTRACT_PROMPT,
  buildFacetAgentSystemPrompt,
} from "./prompt-kit.js";
import type { StageToolAssets } from "./types.js";

const PAGE_BRIEF = "# Northstar Studio\n\nBuild a compact product-planning page.";
const RETIRED_TERMS = [
  ["get", "composition"].join("_"),
  ["set", "theme"].join("_"),
  ["get", "token"].join("_"),
  ["cata", "log"].join(""),
  ["compo", "sitions"].join(""),
  ["vari", "ant"].join(""),
  ["reci", "pe"].join(""),
] as const;

function promptAssets(): StageToolAssets {
  return {
    theme: {
      privateConcreteValue: ["#", "123456"].join(""),
      operatorSecret: "theme-secret",
    },
    patterns: [
      {
        name: "account-summary",
        description: "private full Pattern",
        root: "private-root",
        nodes: { "private-root": { value: "private Pattern content" } },
      },
    ],
    patternIndex: [
      {
        name: "account-summary",
        description: "A compact account summary.",
        useWhen: "Account status needs one focused view.",
      },
    ],
    brickIndex: [
      {
        type: "box",
        description: "The only container Brick.",
        useWhen: "Grouping a flow of Bricks.",
      },
      {
        type: "text",
        description: "A text Brick.",
        useWhen: "Showing concise copy.",
      },
    ],
    presetIndex: [
      {
        brick: "box",
        name: "panel",
        description: "A reusable panel treatment.",
        useWhen: "A distinct content surface is needed.",
      },
    ],
  } as unknown as StageToolAssets;
}

function expectNoRetiredTerms(text: string): void {
  for (const term of RETIRED_TERMS) expect(text).not.toContain(term);
}

describe("buildFacetAgentSystemPrompt", () => {
  it("teaches Pattern first progressive style discovery", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF, assets: promptAssets() });
    const patternIndex = system.indexOf("PATTERNS");
    const brickIndex = system.indexOf("BRICKS");
    const presetIndex = system.indexOf("PRESETS");

    expect(patternIndex).toBeGreaterThanOrEqual(0);
    expect(patternIndex).toBeLessThan(presetIndex);
    expect(presetIndex).toBeLessThan(brickIndex);
    expect(system).toContain("account-summary");
    expect(system).toContain("get_pattern");
    expect(system).toContain("get_brick_spec");
    expect(system).toContain("get_style_choices");
    expect(system).toContain("get_preset");
    expect(system).toMatch(/adapt[^.]*do not blindly copy/i);
    expect(system).toMatch(/Pattern[^.]*Preset[^.]*first/i);
    expect(system).toMatch(/one unfamiliar Brick[^.]*get_brick_spec/i);
    expect(system).toMatch(/get_style_choices[^.]*directly choosing[^.]*unfamiliar property/i);
    expect(system).toMatch(/invalid_authoring[^]*retry/i);
    expectNoRetiredTerms(system);
    expect(system).not.toMatch(/(?:#[0-9a-f]{3,8}|\b\d+(?:\.\d+)?(?:px|rem|em)\b|rgba?\()/i);
  });

  it("includes the canonical teaching before the final page brief", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });

    expect(system).toContain(FACET_AGENT_ROLE_PROMPT);
    expect(system).toContain(STAGE_SPEC);
    expect(system).toContain(FACET_PAGE_EXPERIENCE_PROMPT);
    expect(system).toContain(FACET_POLISHED_BRICK_GUIDANCE_PROMPT);
    expect(system).toContain(FACET_DATA_BINDING_PROMPT);
    expect(system).toContain(FACET_STATE_EDITING_PROMPT);
    expect(system).toContain(FACET_TOOL_PLAYBOOK_PROMPT);
    expect(system).toContain(FACET_TOOL_RESULT_CONTRACT_PROMPT);
    expect(system).toContain(FACET_ASSET_PRIVACY_PROMPT);
    expect(system.endsWith(`${FACET_PAGE_BRIEF_HEADING}\n\n${PAGE_BRIEF}`)).toBe(true);
    expect(system.indexOf("PATTERNS")).toBeLessThan(system.indexOf(FACET_PAGE_BRIEF_HEADING));
  });

  it("owns runner-specific workflow outside the tool-neutral Core stage contract", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });
    const runnerTerms = [
      "get_pattern",
      "get_preset",
      "get_brick_spec",
      "get_style_choices",
      "render_page",
      "set_node",
      "append_node",
      "remove_node",
      "no_stage_change",
      "applied_visible",
    ];

    for (const term of runnerTerms) {
      expect(STAGE_SPEC).not.toContain(term);
      expect(system).toContain(term);
    }
  });

  it("always indexes all Core Bricks when no turn snapshot is supplied", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });
    const brickSection = system.slice(system.indexOf("BRICKS"), system.indexOf("PAGE BRIEF"));

    for (const type of BRICK_TYPES) expect(brickSection).toContain(`- ${type}:`);
    expect(brickSection).toContain("get_brick_spec");
    expect(system).toMatch(/PATTERNS[^]*\(none available\)/);
    expect(system).toMatch(/PRESETS[^]*\(none available\)/);
  });

  it("serializes only bounded index metadata and keeps exact assets private", () => {
    const assets = promptAssets();
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF, assets });

    expect(system).toContain("A compact account summary.");
    expect(system).toContain("A reusable panel treatment.");
    expect(system).not.toContain("theme-secret");
    expect(system).not.toContain("private-root");
    expect(system).not.toContain("private Pattern content");
    expect(system).not.toContain("private full Pattern");
    expect(system).not.toContain(
      (assets.theme as unknown as { privateConcreteValue: string }).privateConcreteValue,
    );
  });

  it("bounds malformed indexes without throwing or reading hostile assets", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("secret getter");
        },
      },
    ) as StageToolAssets;
    expect(() =>
      buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF, assets: hostile }),
    ).not.toThrow();

    const many = Array.from({ length: 100 }, (_, index) => ({
      name: `pattern-${String(index)}`,
      description: "Bounded Pattern metadata.",
      useWhen: "A bounded example is useful.",
    }));
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: { ...promptAssets(), patternIndex: many },
    });
    expect(system.match(/^- pattern-/gm)).toHaveLength(64);
    expect(system).toContain("pattern-63");
    expect(system).not.toContain("pattern-64");
  });

  it("keeps closed authoring and structured recovery guidance", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });

    expect(FACET_POLISHED_BRICK_GUIDANCE_PROMPT).toContain(`Bricks are ${BRICK_TYPES.join(", ")}.`);
    expect(system).toMatch(/Preset[^.]*direct style/i);
    expect(system).toContain("activeWhen");
    expect(system).toContain('"style.active"');
    for (const outcome of [
      "applied_visible",
      "applied_not_visible",
      "applied_with_warnings",
      "pending",
      "rejected",
      "no_stage_change",
    ]) {
      expect(system).toContain(outcome);
    }
    expect(system).toContain("invalid_authoring");
    expect(system).toMatch(/repair the complete call, and retry/i);
  });

  it("teaches product-grade media icon and text flow vocabulary", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });

    expect(FACET_POLISHED_BRICK_GUIDANCE_PROMPT).toContain(
      `Bricks are ${BRICK_TYPES.join(", ")}.`,
    );
    expect(system).toMatch(/media\.kind[^.]*"icon"[^.]*MEDIA_ICON_NAMES/i);
    expect(system).toMatch(/never raw SVG[^.]*path[^.]*CSS/i);
    expect(system).toMatch(/text, list, richtext, and table[^.]*textWrap[^.]*lineClamp/i);
    expect(system).toMatch(/table columns[^.]*align/i);
    expect(system).toMatch(/chart series[^.]*lineStyle/i);
    expect(system).toMatch(/chart plot[^.]*axisColor[^.]*gridColor[^.]*labelColor[^.]*tokens/i);
    expect(system).toMatch(/get_brick_spec[^.]*media icon[^.]*lineStyle/i);
    expect(system).toMatch(/get_style_choices[^.]*textWrap[^.]*lineClamp[^.]*axisColor/i);
    expect(system).toMatch(/custom assets[^.]*per-agent or per-user/i);
    expect(system).toMatch(/bundled defaults[^.]*fallback/i);
    expect(system).not.toMatch(/default Presets?[^.]*solve[^.]*benchmark quality/i);
    expect(system).not.toMatch(/default Patterns?[^.]*solve[^.]*benchmark quality/i);
  });

  it("requires a visible mutation before completing a requested page change", () => {
    const editingContract = `${FACET_STATE_EDITING_PROMPT}\n${FACET_TOOL_RESULT_CONTRACT_PROMPT}`;
    const preparation = editingContract.indexOf("asset reads and inspections are preparation only");
    const mutation = editingContract.indexOf("must call a mutation tool");
    const completion = editingContract.indexOf(
      "must receive applied_visible before claiming completion",
    );

    expect(preparation).toBeGreaterThanOrEqual(0);
    expect(mutation).toBeGreaterThan(preparation);
    expect(completion).toBeGreaterThan(mutation);
    expect(editingContract.slice(mutation, completion)).toContain(
      "render_page, set_node, append_node, or remove_node",
    );
    expect(editingContract).toMatch(
      /no_stage_change[^.]*does not satisfy[^.]*page-change request/i,
    );
    expect(editingContract).toMatch(
      /factual or no-change request[^.]*does not require a mutation/i,
    );
    expect(editingContract).not.toMatch(
      /asset reads? or inspections?[^.]*complete the page change/i,
    );
  });

  it("authors a new hierarchy off-stage and attaches only its top node", () => {
    const leaves = FACET_STATE_EDITING_PROMPT.indexOf("create every unattached leaf with set_node");
    const boxes = FACET_STATE_EDITING_PROMPT.indexOf("create inner boxes bottom-up with set_node");
    const attach = FACET_STATE_EDITING_PROMPT.indexOf(
      "append_node the completed top node to the existing parent exactly once",
    );

    expect(leaves).toBeGreaterThanOrEqual(0);
    expect(boxes).toBeGreaterThan(leaves);
    expect(attach).toBeGreaterThan(boxes);
    expect(FACET_STATE_EDITING_PROMPT).toMatch(
      /never append a descendant directly to the destination and also reference it from the new container/i,
    );
    expect(FACET_STATE_EDITING_PROMPT).not.toMatch(
      /append descendants? directly to the destination before/i,
    );
  });

  it("keeps known-reference reuse and unfamiliar-value lookup as one coherent policy", () => {
    expect(FACET_STYLE_DISCOVERY_POLICY).toEqual({
      knownChoiceSources: ["Pattern", "same-Brick Preset"],
      lookupTrigger: "directly choosing an unfamiliar value",
    });

    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });
    for (const source of FACET_STYLE_DISCOVERY_POLICY.knownChoiceSources) {
      expect(system).toContain(source);
    }
    expect(system).toContain("known valid choices and may be re-authored");
    expect(system).toContain("get_style_choices only when directly choosing an unfamiliar value");
    expect(system).not.toContain("use only choices disclosed by get_style_choices");
  });

  it("keeps data binding rich text and current-view guidance live", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });

    expect(system).toContain("visitor's current view");
    expect(system).toContain("view.sort");
    expect(system).toMatch(/"from" wins over inline/i);
    expect(system).toMatch(/table, chart, list, keyValue, and text/i);
    expect(system).toMatch(/blocks and runs/i);
    expect(system).toContain("bold, italic, underline, strike, code, and link");
    expect(system).toMatch(/never javascript: or data:/i);
  });
});
