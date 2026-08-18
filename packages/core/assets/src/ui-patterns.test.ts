import { describe, expect, it } from "vitest";

import { validateUiPatternSet } from "@facet/core";

import { DEFAULT_CATALOG } from "./catalog.js";
import { DEFAULT_UI_PATTERN_SET } from "./ui-patterns.js";

describe("default UI Patterns", () => {
  it("ships the exact four-pattern experiment registry with two variants each", () => {
    expect(DEFAULT_UI_PATTERN_SET.version).toBe("facet-default-ui-patterns-v1");
    expect(DEFAULT_UI_PATTERN_SET.patterns.map(({ id }) => id)).toEqual([
      "browse",
      "compare",
      "diagnose",
      "progress",
    ]);
    expect(DEFAULT_UI_PATTERN_SET.patterns.map(({ variants }) => variants.length)).toEqual([
      2, 2, 2, 2,
    ]);
  });

  it("resolves every component reference and example through the default catalog", () => {
    expect(validateUiPatternSet(DEFAULT_UI_PATTERN_SET, DEFAULT_CATALOG)).toEqual({
      ok: true,
      set: DEFAULT_UI_PATTERN_SET,
    });
  });

  it("keeps the full default resource graph immutable", () => {
    expect(Object.isFrozen(DEFAULT_UI_PATTERN_SET)).toBe(true);
    expect(Object.isFrozen(DEFAULT_UI_PATTERN_SET.patterns)).toBe(true);
    for (const pattern of DEFAULT_UI_PATTERN_SET.patterns) {
      expect(Object.isFrozen(pattern)).toBe(true);
      expect(Object.isFrozen(pattern.regions)).toBe(true);
      expect(Object.isFrozen(pattern.componentChoices)).toBe(true);
      expect(Object.isFrozen(pattern.variants)).toBe(true);
      expect(pattern.variants.every(Object.isFrozen)).toBe(true);
    }
  });

  it("shows materially different component structures instead of one repeated shell", () => {
    const examples = DEFAULT_UI_PATTERN_SET.patterns.flatMap(({ variants }) =>
      variants.map(({ exampleMarkup }) => exampleMarkup),
    );

    expect(examples).toHaveLength(8);
    expect(new Set(examples).size).toBe(8);
    expect(examples.some((markup) => markup.includes("<Grid"))).toBe(true);
    expect(examples.some((markup) => markup.includes("<Split"))).toBe(true);
    expect(examples.some((markup) => markup.includes("<AppShell"))).toBe(true);
    expect(examples.some((markup) => markup.includes("<Timeline"))).toBe(true);
    expect(examples.some((markup) => markup.includes("<Progress"))).toBe(true);
    expect(examples.every((markup) => !markup.includes("<Hero"))).toBe(true);
  });
});
