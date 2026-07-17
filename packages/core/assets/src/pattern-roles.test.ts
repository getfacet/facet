import { describe, expect, it } from "vitest";
import { validatePattern, type FacetPattern } from "@facet/core";
import { DATA_PATTERNS } from "./pattern-chart-table.js";
import { CONTAINER_PATTERNS } from "./pattern-containers.js";
import { CONTROL_PATTERNS } from "./pattern-controls.js";
import { DEFAULT_THEME } from "./theme.js";

const RETIRED_STYLE_KEYS = new Set([
  ["active", "Style"].join(""),
  ["active", "Variant"].join(""),
  "align",
  "bg",
  "border",
  "pad",
  "radius",
  "size",
  "variant",
  "weight",
]);

const collectKeys = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) return value.flatMap((entry) => collectKeys(entry));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => [key, ...collectKeys(entry)]);
};

const PATTERN_ROLES: ReadonlyArray<readonly FacetPattern[]> = [
  CONTROL_PATTERNS,
  CONTAINER_PATTERNS,
  DATA_PATTERNS,
];

describe("default Pattern role leaves", () => {
  it("validates every migrated Pattern role", () => {
    expect(PATTERN_ROLES.map((patterns) => patterns.length)).toEqual([6, 3, 1]);

    for (const patterns of PATTERN_ROLES) {
      for (const pattern of patterns) {
        const result = validatePattern(pattern, DEFAULT_THEME);
        expect(result.issues, pattern.name).toEqual([]);
        expect(result.pattern, pattern.name).toEqual(pattern);

        const keys = collectKeys(pattern.nodes);
        for (const retired of RETIRED_STYLE_KEYS) {
          expect(keys, `${pattern.name}:${retired}`).not.toContain(retired);
        }
      }
    }
  });

  it("uses Presets for repeatable Brick roles and direct style for structure", () => {
    const controls = new Map(CONTROL_PATTERNS.map((pattern) => [pattern.name, pattern]));
    expect(controls.get("cta-button")?.nodes["cta-button.root"]?.style).toMatchObject({
      preset: "primaryAction",
    });
    expect(controls.get("form")?.nodes["form.email"]?.style).toMatchObject({
      preset: "standard",
    });
    expect(controls.get("tabs")?.nodes["tabs.root"]?.style).toMatchObject({
      direction: "row",
      gap: "xs",
    });

    const containers = new Map(CONTAINER_PATTERNS.map((pattern) => [pattern.name, pattern]));
    expect(containers.get("card")?.nodes["card.root"]?.style).toMatchObject({
      preset: "panel",
    });
    expect(containers.get("section")?.nodes["section.root"]?.style).toMatchObject({
      gap: "md",
      padding: "lg",
    });

    expect(DATA_PATTERNS[0]?.nodes["chart-table-view.chart"]?.style).toMatchObject({
      preset: "panel",
    });
  });
});
