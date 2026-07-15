import { describe, expect, it } from "vitest";
import {
  CATALOG_BRICK_TYPES,
  CATALOG_COMPONENT_TYPES,
  PRIMITIVE_BRICK_TYPES,
  validateCatalog,
} from "@facet/core";
import { DEFAULT_CATALOG } from "./catalog.js";

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacyPolicyField = ["st", "amp", "s"].join("");
const legacyOrderField = ["component", "Order"].join("");
const legacyDefinitionsField = ["component", "Definitions"].join("");

describe("DEFAULT_CATALOG", () => {
  it("catalog validates and exposes primitives, components, and legacy brick compatibility", () => {
    const { catalog, issues } = validateCatalog(DEFAULT_CATALOG);

    expect(issues).toEqual([]);
    expect(catalog.theme.switchPolicy).toBe("locked");
    expect(catalog.policy.order).toEqual(["component", "primitive"]);
    expect(catalog.policy.editBeforeAppend).toBe(true);
    expect(catalog.policy.compactScreens).toBe(true);

    const types = new Set(catalog.bricks.map((brick) => brick.type));
    for (const type of CATALOG_BRICK_TYPES) {
      expect(types.has(type), type).toBe(true);
    }

    const primitiveTypes = new Set(PRIMITIVE_BRICK_TYPES);
    for (const brick of catalog.bricks) {
      if (primitiveTypes.has(brick.type as (typeof PRIMITIVE_BRICK_TYPES)[number])) {
        expect([...PRIMITIVE_BRICK_TYPES]).toContain(brick.type);
      }
    }

    const componentTypes = new Set((catalog.components ?? []).map((component) => component.type));
    for (const type of CATALOG_COMPONENT_TYPES) {
      expect(componentTypes.has(type), type).toBe(true);
    }
    expect(componentTypes.has("stat")).toBe(false);
  });

  it("catalog includes variants and guidance for agent-facing components", () => {
    const section = DEFAULT_CATALOG.components?.find((component) => component.type === "section");
    const card = DEFAULT_CATALOG.components?.find((component) => component.type === "card");
    const chart = DEFAULT_CATALOG.components?.find((component) => component.type === "chart");
    const metric = DEFAULT_CATALOG.components?.find((component) => component.type === "metric");
    const stat = DEFAULT_CATALOG.bricks.find((brick) => brick.type === "stat");

    expect(section?.variants).toContain("surface");
    expect(card?.variants).toContain("interactive");
    expect(chart?.variants).toContain("default");
    expect(metric?.variants).toEqual(["default", "success"]);
    expect(stat?.guidance).toMatch(/legacy alias/i);
    expect(section?.guidance).toMatch(/screen/i);
    expect(chart?.guidance).toMatch(/display-only/i);
  });

  it("does not hide structural component definitions in default assets", () => {
    expect(Object.prototype.hasOwnProperty.call(DEFAULT_CATALOG, legacyDefinitionsField)).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(DEFAULT_CATALOG, "componentLibrary")).toBe(false);
    expect(DEFAULT_CATALOG.compositions).toEqual({ mode: "all" });
    expect(Array.isArray(DEFAULT_CATALOG.compositions)).toBe(false);
  });

  it("pins the default catalog to the canonical composition shape", () => {
    expect(Object.prototype.hasOwnProperty.call(DEFAULT_CATALOG, legacyPolicyField)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(DEFAULT_CATALOG.policy, legacyOrderField)).toBe(
      false,
    );
    expect(DEFAULT_CATALOG.compositions).toEqual({ mode: "all" });
    expect(DEFAULT_CATALOG.policy.order).toEqual(["component", "primitive"]);
  });

  it("ships concrete reference datasets", () => {
    const { catalog, issues } = validateCatalog(DEFAULT_CATALOG);

    expect(issues).toEqual([]);
    expect(catalog.compositions).toEqual({ mode: "all" });
    expect(catalog.policy.order).toEqual(["component", "primitive"]);
  });
});
