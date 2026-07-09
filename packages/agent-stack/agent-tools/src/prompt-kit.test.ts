import { describe, expect, it } from "vitest";
import { STAGE_SPEC } from "@facet/core";
import type { FacetCatalog, FacetStamp, FacetTheme } from "@facet/core";
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

function sectionBetween(system: string, start: string, end: string): string {
  const startIndex = system.indexOf(start);
  const endIndex = system.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? system.slice(startIndex, endIndex) : "";
}

function promptSection(system: string, heading: "CATALOG" | "THEMES" | "STAMPS"): string {
  const start = system.indexOf(heading);
  if (start < 0) return "";
  const nextHeadings = ["CATALOG", "THEMES", "STAMPS", FACET_PAGE_BRIEF_HEADING]
    .filter((candidate) => candidate !== heading)
    .map((candidate) => system.indexOf(candidate, start + heading.length))
    .filter((index) => index > start);
  const end = Math.min(...nextHeadings);
  return system.slice(start, end);
}

function assetSection(system: string, heading: "THEMES" | "STAMPS"): string {
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
    stamps: { mode: "allow", names: ["pricing-grid", "onboarding-flow"] },
    primitiveFallback: "discouraged",
    policy: {
      order: ["stamp", "brick", "primitive"],
      editBeforeAppend: true,
      compactScreens: true,
      maxScreenSections: 4,
    },
  };
}

describe("buildFacetAgentSystemPrompt catalog guidance", () => {
  it("teaches append_node against all container parents, not only boxes", () => {
    expect(FACET_TOOL_PLAYBOOK_PROMPT).toContain(
      "existing container parent (box, section, or card)",
    );
    expect(FACET_TOOL_PLAYBOOK_PROMPT).not.toContain("existing box parent");
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
    expect(section).toMatch(/allowed bricks/i);
    expect(section).toContain("section");
    expect(section).toContain("surface, hero");
    expect(section).toContain("Use for compact screen regions.");
    expect(section).toContain("card");
    expect(section).toContain("metric");
    expect(section).toMatch(/stamp policy:\s*allow pricing-grid, onboarding-flow/i);
    expect(section).toMatch(/primitiveFallback:\s*discouraged/i);
    expect(section).toMatch(/policy order:\s*stamp -> brick -> primitive/i);
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
    expect(section).toMatch(/stamp -> high-level brick -> primitive fallback/i);
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

  it("serializes only whitelisted compact stamp metadata and no stamp JSON", () => {
    const stamps = [
      {
        name: "metric-card",
        description: "Metric card stamp",
        metadata: {
          category: "dashboard",
          useWhen: "Show one KPI with trend context.",
          avoidWhen: "Avoid for long tables.",
          variants: ["compact", "emphasis"],
          tags: ["analytics", "kpi"],
          repeatable: true,
          preferredParent: "section",
          composedOf: ["card", "stat"],
          dataRequirements: ["metric label", "current value"],
          followUpEdits: ["update stat value after data changes"],
          root: "metadata-root-leak",
          nodes: { leak: true },
          unknownSecret: "stamp-secret",
          themeTokenValues: { accent: "#abcdef" },
        },
        slots: { title: "Revenue", value: "$42k" },
        root: "metric-root",
        nodes: {
          "metric-root": { id: "metric-root", type: "card", children: ["metric-title"] },
          "metric-title": { id: "metric-title", type: "text", value: "{{title}}" },
        },
      },
    ] as unknown as readonly FacetStamp[];

    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: { stamps },
    });
    const section = assetSection(system, "STAMPS");

    expect(section).toContain("metric-card");
    expect(section).toContain("Metric card stamp");
    expect(section).toContain("slots: title, value");
    expect(section).toContain("category: dashboard");
    expect(section).toContain("useWhen: Show one KPI with trend context.");
    expect(section).toContain("avoidWhen: Avoid for long tables.");
    expect(section).toContain("variants: compact, emphasis");
    expect(section).toContain("tags: analytics, kpi");
    expect(section).toContain("repeatable: true");
    expect(section).toContain("preferredParent: section");
    expect(section).toContain("composedOf: card, stat");
    expect(section).toContain("dataRequirements: metric label, current value");
    expect(section).toContain("followUpEdits: update stat value after data changes");
    expect(section).not.toContain("metric-root");
    expect(section).not.toContain("metric-title");
    expect(section).not.toContain("metadata-root-leak");
    expect(section).not.toContain("Revenue");
    expect(section).not.toContain("$42k");
    expect(section).not.toContain("stamp-secret");
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
      assets: { themes: [], stamps: [] },
    });

    expect(empty).toBe(base);
    expect(base).not.toContain("Themes you may select by NAME with the set_theme tool");
    expect(base).not.toContain("Reusable stamps you may expand with the use_stamp tool");
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

  it("serializes stamp names, descriptions, and slot names only, never node JSON", () => {
    const stamps: readonly FacetStamp[] = [
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

    const system = buildFacetAgentSystemPrompt({ pageBrief: PAGE_BRIEF, assets: { stamps } });
    const stampsSection = assetSection(system, "STAMPS");

    expect(stampsSection).toContain("cta");
    expect(stampsSection).toContain("A call-to-action button");
    expect(stampsSection).toContain("label");
    expect(stampsSection).toContain("href");
    expect(stampsSection).toContain("use_stamp");
    expect(stampsSection).not.toContain("cta-label");
    expect(stampsSection).not.toContain('"nodes"');
    expect(stampsSection).not.toContain('"root"');
    expect(stampsSection).not.toContain("Get started");
    expect(stampsSection).not.toContain("/signup");
  });

  it("formats assets without descriptions and slotless stamps cleanly", () => {
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: {
        themes: [{ name: "plain" }, { name: "empty-description", description: "" }],
        stamps: [
          { name: "plain-stamp", root: "s", nodes: { s: { id: "s", type: "text", value: "x" } } },
        ],
      },
    });

    const themesSection = assetSection(system, "THEMES");
    const stampsSection = assetSection(system, "STAMPS");
    expect(themesSection).toContain("- plain");
    expect(themesSection).toContain("- empty-description");
    expect(themesSection).not.toContain("undefined");
    expect(stampsSection).toContain("- plain-stamp");
    expect(stampsSection).toContain("slots: (none)");
    expect(stampsSection).not.toContain("undefined");
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
        stamps: [
          null,
          { name: "bad stamp", slots: { ok: "x" } },
          {
            name: "stamp",
            description: longDescription,
            slots: Object.fromEntries(slotEntries),
            root: "s",
            nodes: { s: { id: "s", type: "text", value: "x" } },
          },
        ] as unknown as FacetStamp[],
      },
    });

    const themesSection = assetSection(system, "THEMES");
    const stampsSection = assetSection(system, "STAMPS");
    expect(themesSection).toContain("- safe:");
    expect(themesSection).not.toContain("has space");
    expect(themesSection).not.toContain(longDescription);
    expect(themesSection).toContain("d".repeat(200));
    expect(stampsSection).toContain("- stamp:");
    expect(stampsSection).not.toContain("bad stamp");
    expect(stampsSection).not.toContain(longDescription);
    expect(stampsSection).toContain("slot_0");
    expect(stampsSection).toContain("slot_63");
    expect(stampsSection).not.toContain("slot_64");
  });

  it("keeps asset guidance separate from the final page brief", () => {
    const system = buildFacetAgentSystemPrompt({
      pageBrief: PAGE_BRIEF,
      assets: {
        themes: [{ name: "studio", description: "Clean workspace" }],
        stamps: [{ name: "hero", slots: { title: "Default" }, root: "h", nodes: {} }],
      },
    });

    expect(sectionBetween(system, "THEMES", FACET_PAGE_BRIEF_HEADING)).toContain("STAMPS");
    expect(system).toMatch(new RegExp(`${FACET_PAGE_BRIEF_HEADING}\\n\\n# Northstar Studio`));
  });
});
