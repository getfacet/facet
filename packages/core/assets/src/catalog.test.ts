import { BRICK_TYPES, CATALOG_BRICK_TYPES, validateCatalog } from "@facet/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG } from "./catalog.js";

const RETIRED_FIELDS = ["components", "primitiveFallback"] as const;
const RETIRED_BRICKS = ["button", "form", "filterBar", "metric", "tabs", "nav", "stat"];

describe("DEFAULT_CATALOG", () => {
  it("validates with the exact final brick roster and zero issues", () => {
    const { catalog, issues } = validateCatalog(DEFAULT_CATALOG);

    expect(issues).toEqual([]);
    expect(CATALOG_BRICK_TYPES).toEqual(BRICK_TYPES);
    expect(catalog.bricks.map((brick) => brick.type)).toEqual(BRICK_TYPES);
    expect(catalog.bricks).toHaveLength(11);
    expect(catalog.theme.switchPolicy).toBe("locked");
    expect(catalog.compositions).toEqual({ mode: "all" });
    expect(catalog.policy).toEqual({
      editBeforeAppend: true,
      compactScreens: true,
      maxScreenSections: 6,
    });
  });

  it("advertises variants and guidance only for final bricks", () => {
    const byType = new Map(DEFAULT_CATALOG.bricks.map((brick) => [brick.type, brick] as const));

    expect(byType.get("media")?.variants).toEqual(["default", "hero"]);
    expect(byType.get("table")?.variants).toEqual(["default"]);
    expect(byType.get("chart")?.variants).toEqual(["default"]);
    expect(byType.get("list")?.variants).toEqual(["default", "compact"]);
    expect(byType.get("progress")?.variants).toEqual(["default", "success"]);
    expect(byType.get("chart")?.guidance).toMatch(/display-only/i);
    expect(byType.get("box")?.guidance).toMatch(/flow|pressable/i);
    for (const retired of RETIRED_BRICKS) expect([...byType.keys()]).not.toContain(retired);
  });

  it("contains no retired tier fields or hidden structural definitions", () => {
    for (const field of RETIRED_FIELDS) expect(DEFAULT_CATALOG).not.toHaveProperty(field);
    expect(DEFAULT_CATALOG.policy).not.toHaveProperty("order");
    expect(DEFAULT_CATALOG).not.toHaveProperty("componentDefinitions");
    expect(DEFAULT_CATALOG).not.toHaveProperty("componentLibrary");
    expect(Array.isArray(DEFAULT_CATALOG.compositions)).toBe(false);
  });
});
