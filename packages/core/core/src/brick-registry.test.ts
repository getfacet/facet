import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BRICK_REGISTRY, CORE_NODE_TYPES } from "./brick-registry.js";
import { BRICK_TYPES } from "./nodes.js";

const RETIRED_TYPES = ["button", "tabs", "nav", "metric", "stat", "form", "filterBar"];

describe("brick registry exhaustiveness", () => {
  it("has exactly 11 direct own-property brick entries", () => {
    expect(CORE_NODE_TYPES).toEqual(BRICK_TYPES);
    expect(Object.keys(BRICK_REGISTRY)).toEqual(BRICK_TYPES);
    expect(Object.keys(BRICK_REGISTRY)).toHaveLength(11);
    for (const type of BRICK_TYPES) expect(Object.hasOwn(BRICK_REGISTRY, type)).toBe(true);
  });

  it("guards prototype names and contains no retired route", () => {
    for (const inherited of ["constructor", "toString", "__proto__"]) {
      expect(Object.hasOwn(BRICK_REGISTRY, inherited)).toBe(false);
    }
    for (const retired of RETIRED_TYPES) expect(Object.hasOwn(BRICK_REGISTRY, retired)).toBe(false);

    const source = readFileSync(new URL("./brick-registry.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:component|control|metric|stat)\b/i);
  });

  it("points every brick directly at a validator and its behavior handlers", () => {
    for (const type of BRICK_TYPES) {
      const entry = BRICK_REGISTRY[type];
      expect(typeof entry.validate).toBe("function");
      expect(typeof entry.rendersSelf).toBe("function");
      expect(entry).not.toHaveProperty("kind");
      expect(entry).not.toHaveProperty("role");
    }
  });

  it("has no composition fill hooks", () => {
    for (const type of BRICK_TYPES) {
      const entry = BRICK_REGISTRY[type];
      expect("fill" in entry).toBe(false);
      expect("stringLeaves" in entry).toBe(false);
    }
  });
});
