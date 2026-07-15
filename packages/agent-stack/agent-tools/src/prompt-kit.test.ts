import { readFileSync } from "node:fs";
import { BRICK_TYPES, STAGE_SPEC } from "@facet/core";
import type { FacetCatalog, FacetComposition, FacetTheme } from "@facet/core";
import { describe, expect, it } from "vitest";
import {
  FACET_AGENT_ROLE_PROMPT,
  FACET_ASSET_PRIVACY_PROMPT,
  FACET_DATA_BINDING_PROMPT,
  FACET_PAGE_BRIEF_HEADING,
  FACET_PAGE_EXPERIENCE_PROMPT,
  FACET_POLISHED_BRICK_GUIDANCE_PROMPT,
  FACET_STATE_EDITING_PROMPT,
  FACET_TOOL_PLAYBOOK_PROMPT,
  FACET_TOOL_RESULT_CONTRACT_PROMPT,
  buildFacetAgentSystemPrompt,
} from "./prompt-kit.js";

const PAGE_BRIEF = "# Northstar Studio\n\nBuild a compact product-planning page.";
const EXACT_ROSTER = BRICK_TYPES.join(", ");
const RETIRED_TERMS = [
  ["compo", "nent"].join(""),
  ["intrin", "sic"].join(""),
  ["primi", "tive"].join(""),
  ["leg", "acy"].join(""),
  ["but", "ton"].join(""),
  ["ta", "bs"].join(""),
  ["n", "av"].join(""),
  ["met", "ric"].join(""),
  ["st", "at"].join(""),
  ["fo", "rm"].join(""),
  ["filter", "Bar"].join(""),
] as const;

function expectBrickReferenceLanguageOnly(text: string): void {
  for (const term of RETIRED_TERMS) {
    expect(text).not.toMatch(new RegExp(`\\b${term}\\b`, "i"));
  }
}

function promptSection(system: string, heading: "CATALOG" | "THEMES" | "COMPOSITIONS"): string {
  const start = system.indexOf(heading);
  if (start < 0) return "";
  const next = ["CATALOG", "THEMES", "COMPOSITIONS", FACET_PAGE_BRIEF_HEADING]
    .filter((candidate) => candidate !== heading)
    .map((candidate) => system.indexOf(candidate, start + heading.length))
    .filter((index) => index > start);
  const end = next.length === 0 ? system.length : Math.min(...next);
  return system.slice(start, end);
}

function catalogFixture(): FacetCatalog {
  return {
    name: "studio-catalog",
    description: "Compact SaaS catalog",
    theme: { active: "studio", switchPolicy: "locked", allowed: ["studio", "print"] },
    bricks: [
      { type: "box", variants: ["surface", "selected"], guidance: "Compact regions." },
      { type: "table", variants: ["default"], guidance: "Display-only rows." },
      { type: "input", variants: ["default"] },
    ],
    compositions: { mode: "allow", names: ["pricing-grid", "onboarding-flow"] },
    policy: { editBeforeAppend: true, compactScreens: true, maxScreenSections: 4 },
  };
}

describe("Facet prompt brick and reference contract", () => {
  it("teaches exactly the final bricks and optional reference reads", () => {
    const teaching = [
      FACET_PAGE_EXPERIENCE_PROMPT,
      FACET_POLISHED_BRICK_GUIDANCE_PROMPT,
      FACET_DATA_BINDING_PROMPT,
      FACET_STATE_EDITING_PROMPT,
      FACET_TOOL_PLAYBOOK_PROMPT,
      FACET_ASSET_PRIVACY_PROMPT,
    ].join("\n");

    expect(FACET_POLISHED_BRICK_GUIDANCE_PROMPT).toContain(`Bricks are ${EXACT_ROSTER}.`);
    expect(FACET_STATE_EDITING_PROMPT).toMatch(/optionally (?:inspect|read)/i);
    expect(FACET_STATE_EDITING_PROMPT).toContain("get_composition");
    expect(FACET_STATE_EDITING_PROMPT).toMatch(/native bricks/i);
    expect(FACET_TOOL_PLAYBOOK_PROMPT).toMatch(/existing box parent/i);
    expectBrickReferenceLanguageOnly(teaching);
  });

  it("teaches bottom-up authoring for new box hierarchies", () => {
    expect(FACET_STATE_EDITING_PROMPT).toMatch(/leaf nodes first/i);
    expect(FACET_STATE_EDITING_PROMPT).toMatch(/inner boxes bottom-up/i);
    expect(FACET_STATE_EDITING_PROMPT).toMatch(/append the top box/i);
    expect(FACET_STATE_EDITING_PROMPT).toMatch(/already exists/i);
  });

  it("bounds fixed-choice filters to preauthored local screens", () => {
    const guidance = FACET_POLISHED_BRICK_GUIDANCE_PROMPT;

    expect(guidance).toMatch(/fixed-choice filter/i);
    expect(guidance).toMatch(/bounded[^.]*preauthored screens/i);
    expect(guidance).toContain('"kind":"navigate"');
    expect(guidance).toContain('"active"');
    expect(guidance).toContain('"activeVariant":"selected"');
    expect(guidance).toMatch(/local view/i);
    expect(guidance).toMatch(/never add Apply, input\.onChange, query/i);
    expect(guidance).toMatch(/fetch/i);
    expect(guidance).toMatch(/never run backend work in the browser/i);
    expect(guidance).toMatch(/open-ended[^.]*agent/i);
  });

  it("verifies the quickstart guide copy directly without a production import", () => {
    const guideSource = readFileSync(
      new URL("../../quickstart/src/guide.ts", import.meta.url),
      "utf8",
    );
    const promptSource = readFileSync(new URL("./prompt-kit.ts", import.meta.url), "utf8");

    expect(guideSource).toContain(EXACT_ROSTER);
    expect(guideSource).toMatch(/optional[^.]*reference/i);
    expectBrickReferenceLanguageOnly(guideSource);
    expect(promptSource).not.toContain("quickstart/src/guide");
  });

  it("keeps richtext blocks, closed marks, and gated links in the brick teaching", () => {
    const guidance = FACET_POLISHED_BRICK_GUIDANCE_PROMPT;

    expect(guidance).toMatch(/blocks[^]*runs/i);
    expect(guidance).toContain("bold, italic, underline, strike, code, and link");
    expect(guidance).toMatch(/internal FacetAction/i);
    expect(guidance).toMatch(/gated external URL/i);
    expect(guidance).toMatch(/never javascript: or data:/i);
  });

  it("teaches grouped input collection through a pressable box", () => {
    const guidance = FACET_POLISHED_BRICK_GUIDANCE_PROMPT;

    expect(guidance).toMatch(/related inputs in one box/i);
    expect(guidance).toMatch(/pressable agent action/i);
    expect(guidance).toContain('"collect"');
    expect(guidance).toMatch(/values should be submitted together/i);
  });
});

describe("buildFacetAgentSystemPrompt", () => {
  it("includes canonical teaching and the page brief", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });

    expect(system).toContain(FACET_AGENT_ROLE_PROMPT);
    expect(system).toContain(STAGE_SPEC);
    expect(system).toContain(FACET_PAGE_EXPERIENCE_PROMPT);
    expect(system).toContain(FACET_POLISHED_BRICK_GUIDANCE_PROMPT);
    expect(system).toContain(FACET_TOOL_RESULT_CONTRACT_PROMPT);
    expect(system.endsWith(`${FACET_PAGE_BRIEF_HEADING}\n\n${PAGE_BRIEF}`)).toBe(true);
  });

  it("serializes only final catalog brick guidance and editing policy", () => {
    const catalog = {
      ...catalogFixture(),
      operatorSecret: "catalog-secret",
      themeTokenValues: { accent: "#123456" },
    } as FacetCatalog;
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF, assets: { catalog } });
    const section = promptSection(system, "CATALOG");

    expect(section).toContain("allowed bricks: box variants: surface, selected");
    expect(section).toContain("table variants: default");
    expect(section).toMatch(/reference policy:\s*allow pricing-grid, onboarding-flow/i);
    expect(section).toMatch(/edit-before-append:\s*true/i);
    expect(section).toMatch(/compact screen:\s*true/i);
    expect(section).toMatch(/max screen sections:\s*4/i);
    expectBrickReferenceLanguageOnly(section);
    expect(section).not.toContain("catalog-secret");
    expect(section).not.toContain("#123456");
  });

  it("honors locked themes and catalog editing opt-outs", () => {
    const catalog: FacetCatalog = {
      ...catalogFixture(),
      policy: {
        ...catalogFixture().policy,
        editBeforeAppend: false,
        compactScreens: false,
      },
    };
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF, assets: { catalog } });
    const section = promptSection(system, "CATALOG");

    expect(section).toMatch(/locked/i);
    expect(section).toMatch(/do not call set_theme/i);
    expect(section).toMatch(/keep the active theme/i);
    expect(section).toMatch(/edit-before-append:\s*false/i);
    expect(section).toMatch(/compact screen:\s*false/i);
    expect(section).toMatch(/catalog allows append-first edits/i);
    expect(section).toMatch(/catalog allows broader screens/i);
  });

  it("selects, deduplicates, and indexes references without exposing their nodes", () => {
    const compositions = [
      {
        name: "pricing-grid",
        metadata: { description: "The allowed reference.", category: "private-category" },
        root: "pricing-root",
        nodes: { "pricing-root": { id: "pricing-root", type: "text", value: "private-copy" } },
      },
      {
        name: "pricing-grid",
        metadata: { description: "A duplicate that must not win." },
        root: "duplicate-root",
        nodes: { "duplicate-root": { id: "duplicate-root", type: "text", value: "duplicate" } },
      },
      {
        name: "not-allowed",
        metadata: { description: "Filtered by catalog policy." },
        root: "hidden-root",
        nodes: { "hidden-root": { id: "hidden-root", type: "text", value: "hidden" } },
      },
    ] as readonly FacetComposition[];
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: { catalog: catalogFixture(), compositions },
    });
    const section = promptSection(system, "COMPOSITIONS");

    expect(section).toContain("- pricing-grid: The allowed reference.");
    expect(section.match(/^- pricing-grid:/gm)).toHaveLength(1);
    expect(section).not.toContain("not-allowed");
    expect(section).not.toContain("private-category");
    expect(section).not.toContain("pricing-root");
    expect(section).not.toContain("private-copy");
    expect(section).toMatch(/skip[^.]*simple UI/i);
    expect(section).toMatch(/author[^.]*native stage tools/i);
  });

  it("keeps theme values and reference node data private", () => {
    const themes = [
      {
        name: "midnight",
        description: "Dark palette",
        color: { bg: "#0b1020" },
        apiKey: "theme-secret",
      },
    ] as readonly (FacetTheme & { readonly apiKey?: string })[];
    const compositions: readonly FacetComposition[] = [
      {
        name: "summary-card",
        metadata: { description: "A compact summary reference.", category: "private" },
        root: "summary-root",
        nodes: { "summary-root": { id: "summary-root", type: "text", value: "Private copy" } },
      },
    ];
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: { themes, compositions },
    });
    const themeSection = promptSection(system, "THEMES");
    const referenceSection = promptSection(system, "COMPOSITIONS");

    expect(themeSection).toContain("midnight");
    expect(themeSection).toContain("Dark palette");
    expect(themeSection).not.toContain("#0b1020");
    expect(themeSection).not.toContain("theme-secret");
    expect(referenceSection).toContain("summary-card");
    expect(referenceSection).toContain("A compact summary reference.");
    expect(referenceSection).not.toContain("summary-root");
    expect(referenceSection).not.toContain("Private copy");
    expect(referenceSection).not.toContain("private");
  });

  it("omits empty asset sections and bounds reference metadata", () => {
    const base = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });
    const empty = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: { themes: [], compositions: [] },
    });
    const compositions = Array.from({ length: 1_024 }, (_, index) => ({
      name: `reference-${String(index).padStart(4, "0")}${"x".repeat(50)}`,
      metadata: { description: "d".repeat(200) },
      root: "root",
      nodes: { root: { id: "root", type: "text" as const, value: "example" } },
    }));
    const bounded = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: { compositions },
    });
    const section = promptSection(bounded, "COMPOSITIONS");

    expect(empty).toBe(base);
    expect(section.match(/^- reference-/gm)).toHaveLength(128);
    expect(section).toContain("reference-0127");
    expect(section).not.toContain("reference-0128");
    expect(bounded.length).toBeLessThan(96_000);
  });

  it("keeps current-view, sorting, and final data-binding guidance live", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });

    expect(system).toContain("visitor's current view");
    expect(system).toMatch(/target[^.]*screen the visitor is (?:actually )?viewing/i);
    expect(system).toMatch(/navigate them deliberately/i);
    expect(system).toMatch(/sortable: true/);
    expect(system).toMatch(/view\.sort/);
    expect(system).toMatch(/no agent turn|without.*agent/i);
    expect(system).toMatch(/"data" warehouse/i);
    expect(system).toMatch(/bind[^.]*by NAME with its "from"/i);
    expect(system).toMatch(/"from" wins over inline/i);
    expect(system).toMatch(/"from" bindable bricks:[^.]*text/i);
    expect(system).toMatch(/text reads ONE cell via "column"/i);
    expect(system).toMatch(/never a URL, endpoint, query, expression, or resolver/i);
    expect(system).toMatch(/active look[^]*\{"screen":/i);
    expect(system).toMatch(/\{"toggled":/i);
  });

  it("keeps compact editing and structured tool-result recovery guidance", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });

    expect(system).toMatch(/compact UX/i);
    expect(system).toMatch(/edit before you append/i);
    expect(system).toMatch(/render_page only for the first paint or a major restructure/i);
    expect(system).toMatch(/short chat/i);
    expect(system).toMatch(/reuse existing node ids/i);
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
    expect(system).toMatch(/visible_to_visitor/);
    expect(system).toMatch(/next_action/);
    expect(system).toMatch(/Do not claim completion/i);
  });

  it("formats sparse themes and skips malformed or incomplete assets", () => {
    const longDescription = "d".repeat(500);
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: {
        themes: [
          null,
          { name: "has space", description: "invalid" },
          { name: "plain" },
          { name: "safe", description: longDescription },
        ] as unknown as readonly FacetTheme[],
        compositions: [
          null,
          { name: "bad reference", metadata: { description: "invalid name" } },
          {
            name: "missing-description",
            root: "root",
            nodes: { root: { id: "root", type: "text", value: "x" } },
          },
          {
            name: "safe-reference",
            metadata: { description: longDescription },
            root: "root",
            nodes: { root: { id: "root", type: "text", value: "x" } },
          },
        ] as unknown as readonly FacetComposition[],
      },
    });
    const themes = promptSection(system, "THEMES");
    const references = promptSection(system, "COMPOSITIONS");

    expect(themes).toContain("- plain");
    expect(themes).toContain("- safe:");
    expect(themes).not.toContain("has space");
    expect(themes).toContain("d".repeat(200));
    expect(themes).not.toContain(longDescription);
    expect(references).toContain("- safe-reference:");
    expect(references).not.toContain("bad reference");
    expect(references).not.toContain("missing-description");
    expect(references).toContain("d".repeat(200));
    expect(references).not.toContain(longDescription);
  });

  it("keeps asset guidance before and separate from the final page brief", () => {
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: {
        themes: [{ name: "studio", description: "Clean workspace" }],
        compositions: [
          {
            name: "hero",
            metadata: { description: "A compact hero reference." },
            root: "hero-root",
            nodes: { "hero-root": { id: "hero-root", type: "text", value: "Hero" } },
          },
        ],
      },
    });
    const briefStart = system.indexOf(FACET_PAGE_BRIEF_HEADING);

    expect(system.indexOf("THEMES")).toBeLessThan(briefStart);
    expect(system.indexOf("COMPOSITIONS")).toBeLessThan(briefStart);
    expect(system).toMatch(new RegExp(`${FACET_PAGE_BRIEF_HEADING}\\n\\n# Northstar Studio`));
  });
});
