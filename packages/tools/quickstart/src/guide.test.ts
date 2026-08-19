import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMarkup, serializeDocument, validateAuthorMarkup } from "@facet/core";
import { DEFAULT_CATALOG } from "@facet/assets";
import { normalizeBudget } from "@facet/reference-agent";
import {
  QUICKSTART_INITIAL_MARKUP,
  QUICKSTART_INITIAL_STAGE,
  QUICKSTART_PAGE_BRIEF,
} from "./guide.js";

function propText(nodeId: string, prop: string): string | undefined {
  const value = QUICKSTART_INITIAL_STAGE.nodes[nodeId]?.props[prop];
  if (value === undefined) return undefined;
  return value.kind === "scalar" ? value.value : `${value.scheme}:${value.target}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("quickstart guide", () => {
  it("validates the raw author markup source against the default catalog", () => {
    const parsed = parseMarkup(QUICKSTART_INITIAL_MARKUP);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.code);

    const validated = validateAuthorMarkup(parsed.ast, DEFAULT_CATALOG, {});
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(validated.error.code);
    expect(validated.document).toEqual(QUICKSTART_INITIAL_STAGE);
  });

  it("seeds a valid default-catalog ComponentDocument", () => {
    const catalogTags = new Set(DEFAULT_CATALOG.components.map((component) => component.tag));

    expect(QUICKSTART_INITIAL_STAGE.entry).toBe("what");
    expect(QUICKSTART_INITIAL_STAGE.screens).toHaveLength(4);
    expect(Object.keys(QUICKSTART_INITIAL_STAGE.nodes).length).toBeGreaterThan(80);
    for (const node of Object.values(QUICKSTART_INITIAL_STAGE.nodes)) {
      expect(catalogTags.has(node.tag)).toBe(true);
    }
  });

  it("keeps the seeded tour on component markup concepts only", () => {
    const serialized = serializeDocument(QUICKSTART_INITIAL_STAGE).text;

    expect(serialized).toContain('<Screen name="what"');
    expect(serialized).toContain('<Navigation label="Quickstart" orientation="horizontal"');
    expect(serialized).toContain(
      '<NavigationItem slot="items" label="Design System" action="nav:system"',
    );
    expect(serialized).toContain('<Button slot="actions" label="Try a surface" action="nav:try"');
    expect(serialized).toContain(
      '<Detail slot="primary" eyebrow="Live contract" title="The page is data, not code"',
    );
    expect(serialized).toContain('<Collection title="Starter surfaces"');
    expect(serialized).toContain('<Modal triggerLabel="How should I ask?"');
    expect(serialized).not.toContain("<AppShell");
    expect(serialized).not.toContain("Pattern"); // component-hard-cut: allowed-negative
    expect(serialized).not.toContain("Preset"); // component-hard-cut: allowed-negative
    expect(serialized).not.toContain("Brick"); // component-hard-cut: allowed-negative
  });

  it("pins the regenerated seed size and sha256 golden", () => {
    const json = JSON.stringify(QUICKSTART_INITIAL_STAGE);

    expect(json).toHaveLength(23_575);
    expect(sha256(json)).toBe("da42d6215d7e3607718bb8d35211a57c6f7dc665996927f8120080dbd6c01c3d");
  });

  it("keeps the seed within the quickstart prompt budget", () => {
    const budget = normalizeBudget({ budgetPreset: "quickstart" });
    const json = JSON.stringify(QUICKSTART_INITIAL_STAGE);

    expect(json.length).toBeLessThanOrEqual(budget.maxStageJsonChars);
  });

  it("uses stable generated node ids for critical calls to action", () => {
    const values = Object.entries(QUICKSTART_INITIAL_STAGE.nodes)
      .filter(([, candidate]) => candidate.tag === "Button" || candidate.tag === "NavigationItem")
      .map(([id]) => ({ id, label: propText(id, "label"), action: propText(id, "action") }));

    expect(values).toContainEqual(
      expect.objectContaining({ label: "Try a surface", action: "nav:try" }),
    );
    expect(values).toContainEqual(
      expect.objectContaining({ label: "Build dashboard", action: "agent:build_dashboard" }),
    );
    expect(values).toContainEqual(
      expect.objectContaining({ label: "Build my surface", action: "agent:build_surface" }),
    );
    expect(values).toContainEqual(
      expect.objectContaining({ label: "Design System", action: "nav:system" }),
    );
  });

  it("brief instructs future turns to stay inside the component-markup contract", () => {
    expect(QUICKSTART_PAGE_BRIEF).toContain("# Facet quickstart tour");
    expect(QUICKSTART_PAGE_BRIEF).toContain("safe declarative");
    expect(QUICKSTART_PAGE_BRIEF).toContain("component markup");
    expect(QUICKSTART_PAGE_BRIEF).toContain("active registered catalog");
    expect(QUICKSTART_PAGE_BRIEF).toContain(
      "Do not say the page changed unless a mutation tool returned an accepted patch",
    );
    expect(QUICKSTART_PAGE_BRIEF).toContain("Keep the seeded tour layout stable");
    expect(QUICKSTART_PAGE_BRIEF).not.toContain("Pattern"); // component-hard-cut: allowed-negative
    expect(QUICKSTART_PAGE_BRIEF).not.toContain("Preset"); // component-hard-cut: allowed-negative
    expect(QUICKSTART_PAGE_BRIEF).not.toContain("Brick"); // component-hard-cut: allowed-negative
  });

  it("brief tells the agent to choose a service group before components", () => {
    expect(QUICKSTART_PAGE_BRIEF).toContain(
      "Choose the service\nfamily before choosing components",
    );
    expect(QUICKSTART_PAGE_BRIEF).toContain("Personal Profile / Resume");
    expect(QUICKSTART_PAGE_BRIEF).toContain("Booking / Consultation");
    expect(QUICKSTART_PAGE_BRIEF).toContain("Operations / Board");
    expect(QUICKSTART_PAGE_BRIEF).toContain("SaaS\nand analytics are only two families");
  });

  it("describes the active registered catalog", () => {
    expect(QUICKSTART_PAGE_BRIEF).toContain("active registered catalog");
    expect(DEFAULT_CATALOG.components).toHaveLength(47);
    for (const spec of DEFAULT_CATALOG.components) {
      expect(QUICKSTART_PAGE_BRIEF).toContain(spec.tag);
    }
    expect(QUICKSTART_PAGE_BRIEF).not.toContain("registered default-catalog components");
    expect(QUICKSTART_PAGE_BRIEF).not.toContain("Author only registered default-catalog");
  });
});
