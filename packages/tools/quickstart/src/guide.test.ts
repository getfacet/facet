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
    expect(Object.keys(QUICKSTART_INITIAL_STAGE.nodes)).toHaveLength(84);
    for (const node of Object.values(QUICKSTART_INITIAL_STAGE.nodes)) {
      expect(catalogTags.has(node.tag)).toBe(true);
    }
  });

  it("keeps the seeded tour on component markup concepts only", () => {
    const serialized = serializeDocument(QUICKSTART_INITIAL_STAGE).text;

    expect(serialized).toContain('<Screen name="what"');
    expect(serialized).toContain('<Button label="Show runtime loop" action="nav:structure"');
    expect(serialized).toContain('<Modal triggerLabel="Why immutable?"');
    expect(serialized).not.toContain("Pattern"); // component-hard-cut: allowed-negative
    expect(serialized).not.toContain("Preset"); // component-hard-cut: allowed-negative
    expect(serialized).not.toContain("Brick"); // component-hard-cut: allowed-negative
  });

  it("pins the regenerated seed size and sha256 golden", () => {
    const json = JSON.stringify(QUICKSTART_INITIAL_STAGE);

    expect(json).toHaveLength(12483);
    expect(sha256(json)).toBe("3990dcdd1b25f6d8e7e149060409e523d37bde2b2faaab9a530c969a2a57504d");
  });

  it("keeps the seed within the quickstart prompt budget", () => {
    const budget = normalizeBudget({ budgetPreset: "quickstart" });
    const json = JSON.stringify(QUICKSTART_INITIAL_STAGE);

    expect(json.length).toBeLessThanOrEqual(budget.maxStageJsonChars);
  });

  it("uses stable generated node ids for critical calls to action", () => {
    const values = Object.entries(QUICKSTART_INITIAL_STAGE.nodes)
      .filter(([, candidate]) => candidate.tag === "Button")
      .map(([id]) => ({ id, label: propText(id, "label"), action: propText(id, "action") }));

    expect(values).toContainEqual(expect.objectContaining({ label: "Show runtime loop" }));
    expect(values).toContainEqual(
      expect.objectContaining({ label: "Build dashboard", action: "agent:build_dashboard" }),
    );
    expect(values).toContainEqual(
      expect.objectContaining({ label: "Component Catalog", action: "nav:system" }),
    );
  });

  it("brief instructs future turns to stay inside the component-markup contract", () => {
    expect(QUICKSTART_PAGE_BRIEF).toContain("# Facet quickstart tour");
    expect(QUICKSTART_PAGE_BRIEF).toContain("safe declarative");
    expect(QUICKSTART_PAGE_BRIEF).toContain("component markup");
    expect(QUICKSTART_PAGE_BRIEF).toContain("registered default-catalog components");
    expect(QUICKSTART_PAGE_BRIEF).not.toContain("Pattern"); // component-hard-cut: allowed-negative
    expect(QUICKSTART_PAGE_BRIEF).not.toContain("Preset"); // component-hard-cut: allowed-negative
    expect(QUICKSTART_PAGE_BRIEF).not.toContain("Brick"); // component-hard-cut: allowed-negative
  });
});
