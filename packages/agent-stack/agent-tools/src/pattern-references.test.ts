import { MAX_PATTERNS, type FacetPattern } from "@facet/core";
import { describe, expect, it } from "vitest";
import { selectPatternReference } from "./pattern-references.js";

function frozenPattern(name: string): FacetPattern {
  const pattern: FacetPattern = {
    name,
    description: `Reference ${name}.`,
    useWhen: "Use when this exact reference matches the page need.",
    root: `${name}-root`,
    nodes: {
      [`${name}-root`]: {
        id: `${name}-root`,
        type: "box",
        children: [`${name}-copy`],
      },
      [`${name}-copy`]: { id: `${name}-copy`, type: "text", value: name },
    },
  };
  for (const node of Object.values(pattern.nodes)) Object.freeze(node);
  Object.freeze(pattern.nodes);
  return Object.freeze(pattern);
}

describe("Pattern reference selection", () => {
  it("returns the exact deeply frozen Pattern from one bounded turn snapshot", () => {
    const hero = frozenPattern("hero");
    const snapshot = Object.freeze([hero, frozenPattern("notice")]);

    const selected = selectPatternReference(snapshot, "hero");

    expect(selected).toBe(hero);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(selected?.nodes)).toBe(true);
    expect(Object.isFrozen(selected?.nodes["hero-root"])).toBe(true);
    expect(selectPatternReference(snapshot, "missing")).toBeUndefined();
  });

  it("fails closed for an impossible over-64 snapshot instead of exposing a prefix", () => {
    const overCap = Array.from({ length: MAX_PATTERNS + 1 }, (_, index) =>
      frozenPattern(`pattern-${String(index)}`),
    );

    expect(selectPatternReference(overCap, "pattern-0")).toBeUndefined();
    expect(selectPatternReference(overCap, `pattern-${String(MAX_PATTERNS)}`)).toBeUndefined();
  });
});
