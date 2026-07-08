import { describe, expect, it } from "vitest";
import { STAGE_SPEC } from "@facet/core";
import type { FacetStamp, FacetTheme } from "@facet/core";
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

function assetSection(system: string, heading: "THEMES" | "STAMPS"): string {
  const start = system.indexOf(heading);
  if (start < 0) return "";
  const nextTheme = heading === "STAMPS" ? -1 : system.indexOf("STAMPS", start + heading.length);
  const pageBrief = system.indexOf(FACET_PAGE_BRIEF_HEADING, start + heading.length);
  const endCandidates = [nextTheme, pageBrief].filter((index) => index > start);
  const end = Math.min(...endCandidates);
  return system.slice(start, end);
}

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
