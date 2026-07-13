import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAGE_SPEC } from "@facet/core";
import type { FacetCatalog, FacetComposition, FacetTheme } from "@facet/core";
import {
  FACET_AGENT_ROLE_PROMPT,
  FACET_ASSET_PRIVACY_PROMPT,
  FACET_PAGE_BRIEF_HEADING,
  FACET_PAGE_EXPERIENCE_PROMPT,
  FACET_STATE_EDITING_PROMPT,
  FACET_TOOL_PLAYBOOK_PROMPT,
  FACET_TOOL_RESULT_CONTRACT_PROMPT,
  buildFacetAgentSystemPrompt,
} from "./prompt-kit.js";

const PAGE_BRIEF = "# Northstar Studio\n\nBuild a compact product-planning page.";

// Built at runtime so the legacy token never appears as a source literal
// (same idiom as theme.test.ts).
const legacyNaming = new RegExp(["st", "amp"].join(""), "i");

function sectionBetween(system: string, start: string, end: string): string {
  const startIndex = system.indexOf(start);
  const endIndex = system.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? system.slice(startIndex, endIndex) : "";
}

function promptSection(system: string, heading: "CATALOG" | "THEMES" | "COMPOSITIONS"): string {
  const start = system.indexOf(heading);
  if (start < 0) return "";
  const nextHeadings = ["CATALOG", "THEMES", "COMPOSITIONS", FACET_PAGE_BRIEF_HEADING]
    .filter((candidate) => candidate !== heading)
    .map((candidate) => system.indexOf(candidate, start + heading.length))
    .filter((index) => index > start);
  const end = Math.min(...nextHeadings);
  return system.slice(start, end);
}

function assetSection(system: string, heading: "THEMES" | "COMPOSITIONS"): string {
  return promptSection(system, heading);
}

function catalogSection(system: string): string {
  return promptSection(system, "CATALOG");
}

function catalogFixture(): FacetCatalog {
  return {
    name: "studio-catalog",
    description: "Compact SaaS catalog",
    theme: { active: "studio", switchPolicy: "locked", allowed: ["studio", "print"] },
    bricks: [
      {
        type: "section",
        variants: ["surface", "hero"],
        guidance: "Use for compact screen regions.",
      },
      { type: "card", variants: ["metric"], guidance: "Use for grouped records." },
      { type: "button", variants: ["primary"] },
    ],
    compositions: { mode: "allow", names: ["pricing-grid", "onboarding-flow"] },
    primitiveFallback: "discouraged",
    policy: {
      order: ["composition", "component", "primitive"],
      editBeforeAppend: true,
      compactScreens: true,
      maxScreenSections: 4,
    },
  };
}

describe("prompt-kit canonical composition surface", () => {
  it("is the canonical composition prompt surface with no old asset names", () => {
    const source = readFileSync(new URL("./prompt-kit.ts", import.meta.url), "utf8");

    expect(source).toContain("use_composition");
    expect(source).toContain("compositions");
    expect(source).not.toMatch(legacyNaming);
  });
});

describe("buildFacetAgentSystemPrompt catalog guidance", () => {
  it("component guidance prefers compositions, components, and edits before primitive fallback without leaking assets", () => {
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: {
        catalog: catalogFixture(),
        themes: [
          {
            name: "studio",
            description: "Studio theme",
            color: { bg: "#123456" },
            recipeInternals: "recipe-internal-sentinel",
          },
        ] as unknown as readonly FacetTheme[],
        compositions: [
          {
            name: "pricing-grid",
            description: "Pricing grid composition",
            slots: { title: "Private title default" },
            root: "composition-root-private",
            nodes: {
              "composition-root-private": {
                id: "composition-root-private",
                type: "text",
                value: "composition-node-json",
              },
            },
            providerKey: "sk-provider-secret",
            visitorId: "visitor-private-id",
          },
        ] as unknown as readonly FacetComposition[],
      },
    });

    expect(system).toContain("COMPONENT GUIDANCE");
    expect(system).toMatch(/Primitive Brick -> Component -> Catalog/i);
    expect(system).toMatch(/catalog-advertised compositions/i);
    expect(system).toMatch(/intrinsic components with catalog-advertised variants/i);
    expect(system).toMatch(/primitive fallback/i);
    expect(system).toMatch(/product-quality defaults/i);
    expect(system).toMatch(/field for raw inputs/i);
    expect(system).toMatch(/button for actions/i);
    expect(system).toMatch(/tabs\/nav for local navigation/i);
    expect(system).toMatch(/editBeforeAppend is true/i);
    expect(system).toMatch(
      /component recipes, composition internals, and concrete theme token values as renderer\/operator internals/i,
    );
    expect(system).toMatch(/never write raw CSS/i);

    const section = catalogSection(system);
    expect(section).toContain("section variants: surface, hero");
    expect(section).toContain("card variants: metric");
    expect(section).toContain("button variants: primary");
    expect(section).toContain("policy order: composition -> component -> primitive");

    const compositionsSection = assetSection(system, "COMPOSITIONS");
    expect(system).not.toContain("#123456");
    expect(system).not.toContain("recipe-internal-sentinel");
    expect(system).not.toContain("composition-root-private");
    expect(system).not.toContain("composition-node-json");
    expect(system).not.toContain("Private title default");
    expect(system).not.toContain("sk-provider-secret");
    expect(system).not.toContain("visitor-private-id");
    expect(compositionsSection).not.toContain('"nodes"');
    expect(compositionsSection).not.toContain('"root"');
  });

  it("teaches append_node against all container parents, not only boxes", () => {
    expect(FACET_TOOL_PLAYBOOK_PROMPT).toContain(
      "existing container parent (box, section, card, or form)",
    );
    expect(FACET_TOOL_PLAYBOOK_PROMPT).not.toContain("existing box parent");
  });

  it("teaches the canonical use_composition tool and no old tool names", () => {
    expect(FACET_TOOL_PLAYBOOK_PROMPT).toContain("use_composition");
    expect(FACET_TOOL_PLAYBOOK_PROMPT).not.toMatch(legacyNaming);
    expect(FACET_STATE_EDITING_PROMPT).toContain("use_composition");
    expect(FACET_STATE_EDITING_PROMPT).not.toMatch(legacyNaming);
    expect(FACET_ASSET_PRIVACY_PROMPT).toContain("composition");
    expect(FACET_ASSET_PRIVACY_PROMPT).not.toMatch(legacyNaming);
  });

  it("serializes compact catalog policy without leaking theme values or unknown fields", () => {
    const catalog = {
      ...catalogFixture(),
      operatorSecret: "catalog-secret",
      themeTokenValues: { accent: "#123456" },
    } as unknown as FacetCatalog;
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: {
        catalog,
        themes: [
          {
            name: "studio",
            description: "Studio theme",
            color: { bg: "#0b1020" },
            space: { md: "18px" },
          },
        ] as unknown as readonly FacetTheme[],
      },
    });

    const section = catalogSection(system);
    expect(section).toContain("CATALOG");
    expect(section).toContain("studio-catalog");
    expect(section).toContain("Compact SaaS catalog");
    expect(section).toMatch(/active theme:\s*studio/i);
    expect(section).toMatch(/switchPolicy:\s*locked/i);
    expect(section).toMatch(/allowed themes:\s*studio, print/i);
    expect(section).toMatch(/allowed components/i);
    expect(section).toContain("section");
    expect(section).toContain("surface, hero");
    expect(section).toContain("Use for compact screen regions.");
    expect(section).toContain("card");
    expect(section).toContain("metric");
    expect(section).toMatch(/composition policy:\s*allow pricing-grid, onboarding-flow/i);
    expect(section).toMatch(/primitiveFallback:\s*discouraged/i);
    expect(section).toMatch(/policy order:\s*composition -> component -> primitive/i);
    expect(section).toMatch(/edit-before-append:\s*true/i);
    expect(section).toMatch(/compact screen:\s*true/i);
    expect(section).toMatch(/max screen sections:\s*4/i);
    expect(section).not.toContain("#123456");
    expect(section).not.toContain("#0b1020");
    expect(section).not.toContain("18px");
    expect(section).not.toContain("catalog-secret");
    expect(section).not.toContain("themeTokenValues");
  });

  it("explains locked theme behavior and the catalog use order", () => {
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: { catalog: catalogFixture() },
    });
    const section = catalogSection(system);

    expect(section).toMatch(/locked/i);
    expect(section).toMatch(/do not call set_theme/i);
    expect(section).toMatch(/keep the active theme/i);
    expect(section).toMatch(/composition -> component -> primitive fallback/i);
    expect(section).toMatch(/edit before you append/i);
    expect(section).toMatch(/compact screen/i);
  });

  it("does not contradict catalog edit/compact opt-outs", () => {
    const catalog: FacetCatalog = {
      ...catalogFixture(),
      policy: {
        ...catalogFixture().policy,
        editBeforeAppend: false,
        compactScreens: false,
      },
    };
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: { catalog },
    });
    const section = catalogSection(system);

    expect(section).toMatch(/edit-before-append:\s*false/i);
    expect(section).toMatch(/compact screen:\s*false/i);
    expect(section).toMatch(/catalog allows append-first edits/i);
    expect(section).toMatch(/catalog allows broader screens/i);
  });

  it("serializes composition metadata (whitelisted compact fields only) and no composition JSON", () => {
    const compositions = [
      {
        name: "metric-card",
        description: "Metric card composition",
        metadata: {
          category: "dashboard",
          useWhen: "Show one KPI with trend context.",
          avoidWhen: "Avoid for long tables.",
          variants: ["compact", "emphasis"],
          tags: ["analytics", "kpi"],
          repeatable: true,
          preferredParent: "section",
          composedOf: ["card", "metric"],
          dataRequirements: ["metric label", "current value"],
          followUpEdits: ["update metric value after data changes"],
          root: "metadata-root-leak",
          nodes: { leak: true },
          unknownSecret: "composition-secret",
          themeTokenValues: { accent: "#abcdef" },
        },
        slots: { title: "Revenue", value: "$42k" },
        root: "metric-root",
        nodes: {
          "metric-root": { id: "metric-root", type: "card", children: ["metric-title"] },
          "metric-title": { id: "metric-title", type: "text", value: "{{title}}" },
        },
      },
    ] as unknown as readonly FacetComposition[];

    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: { compositions },
    });
    const section = assetSection(system, "COMPOSITIONS");

    expect(section).toContain("metric-card");
    expect(section).toContain("Metric card composition");
    expect(section).toContain("use_composition");
    expect(section).not.toMatch(legacyNaming);
    expect(section).toContain("slots: title, value");
    expect(section).toContain("category: dashboard");
    expect(section).toContain("useWhen: Show one KPI with trend context.");
    expect(section).toContain("avoidWhen: Avoid for long tables.");
    expect(section).toContain("variants: compact, emphasis");
    expect(section).toContain("tags: analytics, kpi");
    expect(section).toContain("repeatable: true");
    expect(section).toContain("preferredParent: section");
    expect(section).toContain("composedOf: card, metric");
    expect(section).toContain("dataRequirements: metric label, current value");
    expect(section).toContain("followUpEdits: update metric value after data changes");
    expect(section).not.toContain("metric-root");
    expect(section).not.toContain("metric-title");
    expect(section).not.toContain("metadata-root-leak");
    expect(section).not.toContain("Revenue");
    expect(section).not.toContain("$42k");
    expect(section).not.toContain("composition-secret");
    expect(section).not.toContain("#abcdef");
    expect(section).not.toContain('"nodes"');
    expect(section).not.toContain('"root"');
    expect(section).not.toContain("unknownSecret");
    expect(section).not.toContain("themeTokenValues");
  });
});

describe("buildFacetAgentSystemPrompt", () => {
  it("includes the canonical STAGE_SPEC and page brief without copying stage vocabulary", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });

    expect(system).toContain(FACET_AGENT_ROLE_PROMPT);
    expect(system).toContain(STAGE_SPEC);
    expect(system).toContain(FACET_PAGE_EXPERIENCE_PROMPT);
    expect(system).toContain(FACET_STATE_EDITING_PROMPT);
    expect(system).toContain(FACET_TOOL_PLAYBOOK_PROMPT);
    expect(system).toContain(FACET_TOOL_RESULT_CONTRACT_PROMPT);
    expect(system).toContain(FACET_ASSET_PRIVACY_PROMPT);
    expect(system.endsWith(`${FACET_PAGE_BRIEF_HEADING}\n\n${PAGE_BRIEF}`)).toBe(true);
  });

  it("primes the agent to target the visitor's current view (screen/toggles/device)", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });
    expect(FACET_PAGE_EXPERIENCE_PROMPT).toContain("visitor's current view");
    expect(FACET_PAGE_EXPERIENCE_PROMPT).toMatch(
      /target[^.]*screen the visitor is (?:actually )?viewing/i,
    );
    expect(FACET_PAGE_EXPERIENCE_PROMPT).toMatch(/navigate them deliberately/i);
    expect(system).toContain("visitor's current view");
  });

  it("teaches the per-column sortable opt-in and the view.sort report (DC-005)", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });
    // A table column may opt into local sorting with sortable: true (no agent turn).
    expect(system).toMatch(/sortable/i);
    expect(system).toMatch(/sortable: true/);
    expect(system).toMatch(/no agent turn|without.*agent/i);
    // The view line teaches that an event's view.sort reports the visitor's sort.
    expect(system).toMatch(/view\.sort/);
  });

  it("teaches data-warehouse authoring and from binding without fetch or a DSL", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });
    // The data-binding section is composed into the system prompt (not dead).
    expect(system).toContain("DATA BINDING");
    // Author once, bind many by name via `from`.
    expect(system).toMatch(/"data" warehouse/i);
    expect(system).toMatch(/bind[^.]*by NAME with its "from"/i);
    expect(system).toMatch(/"from" wins over inline/i);
    // Closed projection, no computation.
    expect(system).toMatch(/chart draws one series per NUMERIC column/i);
    expect(system).toMatch(/metric or stat reads ONE cell via "column"/i);
    // Hard boundary: names only — no fetch/resolver/expression (invariant #1/#7).
    expect(system).toMatch(/never a URL, endpoint, query, expression, or resolver/i);
    expect(system).toMatch(/no fetch, computed column, or formula/i);
  });

  it("guides compact UX, edit-before-append, bounded render_page use, and short chat", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });

    expect(system).toMatch(/compact UX/i);
    expect(system).toMatch(/edit before you append/i);
    expect(system).toMatch(/render_page only for the first paint or a major restructure/i);
    expect(system).toMatch(/short chat/i);
    expect(system).toMatch(/reuse existing node ids/i);
  });

  it("teaches the tool playbook and structured outcome recovery before completion", () => {
    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });

    expect(system).toContain("TOOL PLAYBOOK");
    expect(system).toContain("TOOL RESULT CONTRACT");
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

  it("omits asset sections when assets are missing or empty", () => {
    const base = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF });
    const empty = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: { themes: [], compositions: [] },
    });

    expect(empty).toBe(base);
    expect(base).not.toContain("Themes you may select by NAME with the set_theme tool");
    expect(base).not.toContain(
      "Reusable catalog compositions you may expand with the use_composition tool",
    );
  });

  it("serializes theme names and descriptions only, never theme values or unknown fields", () => {
    const themes = [
      {
        name: "midnight",
        description: "Dark, high-contrast night palette",
        color: { bg: "#0b1020", fg: "#e8ecff" },
        space: { md: "14px" },
        fontFamily: { sans: "Inter, sans-serif" },
        apiKey: "sk-secret-theme-value",
      },
      { name: "sunrise", description: "Warm light morning palette", color: { bg: "#fff7ed" } },
    ] as readonly (FacetTheme & { readonly apiKey?: string })[];

    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF, assets: { themes } });
    const themesSection = assetSection(system, "THEMES");

    expect(themesSection).toContain("midnight");
    expect(themesSection).toContain("Dark, high-contrast night palette");
    expect(themesSection).toContain("sunrise");
    expect(themesSection).toContain("Warm light morning palette");
    expect(themesSection).toContain("set_theme");
    expect(themesSection).not.toContain("#0b1020");
    expect(themesSection).not.toContain("#e8ecff");
    expect(themesSection).not.toContain("#fff7ed");
    expect(themesSection).not.toContain("14px");
    expect(themesSection).not.toContain("Inter");
    expect(themesSection).not.toContain("sk-secret-theme-value");
    expect(themesSection).not.toContain('"color"');
    expect(themesSection).not.toContain('"fontFamily"');
  });

  it("serializes composition names, descriptions, and slot names only, never node JSON", () => {
    const compositions: readonly FacetComposition[] = [
      {
        name: "cta",
        description: "A call-to-action button",
        slots: { label: "Get started", href: "/signup" },
        root: "cta",
        nodes: {
          cta: { id: "cta", type: "box", children: ["cta-label"] },
          "cta-label": { id: "cta-label", type: "text", value: "{{label}}" },
        },
      },
    ];

    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF, assets: { compositions } });
    const compositionsSection = assetSection(system, "COMPOSITIONS");

    expect(compositionsSection).toContain("cta");
    expect(compositionsSection).toContain("A call-to-action button");
    expect(compositionsSection).toContain("label");
    expect(compositionsSection).toContain("href");
    expect(compositionsSection).toContain("use_composition");
    expect(compositionsSection).not.toContain("cta-label");
    expect(compositionsSection).not.toContain('"nodes"');
    expect(compositionsSection).not.toContain('"root"');
    expect(compositionsSection).not.toContain("Get started");
    expect(compositionsSection).not.toContain("/signup");
  });

  it("formats assets without descriptions and slotless compositions cleanly", () => {
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: {
        themes: [{ name: "plain" }, { name: "empty-description", description: "" }],
        compositions: [
          {
            name: "plain-composition",
            root: "s",
            nodes: { s: { id: "s", type: "text", value: "x" } },
          },
        ],
      },
    });

    const themesSection = assetSection(system, "THEMES");
    const compositionsSection = assetSection(system, "COMPOSITIONS");
    expect(themesSection).toContain("- plain");
    expect(themesSection).toContain("- empty-description");
    expect(themesSection).not.toContain("undefined");
    expect(compositionsSection).toContain("- plain-composition");
    expect(compositionsSection).toContain("slots: (none)");
    expect(compositionsSection).not.toContain("undefined");
  });

  it("skips malformed assets and bounds prompt-only asset metadata", () => {
    const longDescription = "d".repeat(500);
    const slotEntries = Array.from({ length: 80 }, (_, index) => [`slot_${String(index)}`, "x"]);
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: {
        themes: [
          null,
          { name: "has space", description: "invalid" },
          { name: "safe", description: longDescription },
        ] as unknown as FacetTheme[],
        compositions: [
          null,
          { name: "bad composition", slots: { ok: "x" } },
          {
            name: "composition",
            description: longDescription,
            slots: Object.fromEntries(slotEntries),
            root: "s",
            nodes: { s: { id: "s", type: "text", value: "x" } },
          },
        ] as unknown as FacetComposition[],
      },
    });

    const themesSection = assetSection(system, "THEMES");
    const compositionsSection = assetSection(system, "COMPOSITIONS");
    expect(themesSection).toContain("- safe:");
    expect(themesSection).not.toContain("has space");
    expect(themesSection).not.toContain(longDescription);
    expect(themesSection).toContain("d".repeat(200));
    expect(compositionsSection).toContain("- composition:");
    expect(compositionsSection).not.toContain("bad composition");
    expect(compositionsSection).not.toContain(longDescription);
    expect(compositionsSection).toContain("slot_0");
    expect(compositionsSection).toContain("slot_63");
    expect(compositionsSection).not.toContain("slot_64");
  });

  it("keeps asset guidance separate from the final page brief", () => {
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: {
        themes: [{ name: "studio", description: "Clean workspace" }],
        compositions: [{ name: "hero", slots: { title: "Default" }, root: "h", nodes: {} }],
      },
    });

    expect(sectionBetween(system, "THEMES", FACET_PAGE_BRIEF_HEADING)).toContain("COMPOSITIONS");
    expect(system).toMatch(new RegExp(`${FACET_PAGE_BRIEF_HEADING}\\n\\n# Northstar Studio`));
  });
});
