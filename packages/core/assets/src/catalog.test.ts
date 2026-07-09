import { describe, expect, it } from "vitest";
import { CATALOG_BRICK_TYPES, validateCatalog } from "@facet/core";
import { DEFAULT_CATALOG } from "./catalog.js";

describe("DEFAULT_CATALOG", () => {
  it("catalog validates and exposes the full v1 brick coverage", () => {
    const { catalog, issues } = validateCatalog(DEFAULT_CATALOG);

    expect(issues).toEqual([]);
    expect(catalog.theme.switchPolicy).toBe("locked");
    expect(catalog.policy.order).toEqual(["stamp", "brick", "primitive"]);
    expect(catalog.policy.editBeforeAppend).toBe(true);
    expect(catalog.policy.compactScreens).toBe(true);

    const types = new Set(catalog.bricks.map((brick) => brick.type));
    for (const type of CATALOG_BRICK_TYPES) {
      expect(types.has(type), type).toBe(true);
    }
  });

  it("catalog includes variants and guidance for agent-facing high-level bricks", () => {
    const section = DEFAULT_CATALOG.bricks.find((brick) => brick.type === "section");
    const card = DEFAULT_CATALOG.bricks.find((brick) => brick.type === "card");
    const chart = DEFAULT_CATALOG.bricks.find((brick) => brick.type === "chart");

    expect(section?.variants).toContain("surface");
    expect(card?.variants).toContain("interactive");
    expect(chart?.variants).toContain("default");
    expect(section?.guidance).toMatch(/screen/i);
    expect(chart?.guidance).toMatch(/display-only/i);
  });
});
