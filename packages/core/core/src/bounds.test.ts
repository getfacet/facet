import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { isFacetIdentifier, parseDataPath } from "./identifiers.js";

/**
 * The bound registry. Every entry is one of B-01..B-28 with its approved
 * verbatim value. This table is the anti-drift check: if a bound is renamed,
 * removed, or silently retuned, exactly one row here fails.
 */
const REGISTRY: ReadonlyArray<{
  readonly id: string;
  readonly what: string;
  readonly actual: number;
  readonly expected: number;
}> = [
  {
    id: "B-01",
    what: "markup source per mutation call (characters)",
    actual: BOUNDS.markupSourceChars,
    expected: 20_000,
  },
  {
    id: "B-02",
    what: "nodes created/replaced per mutation call",
    actual: BOUNDS.nodesPerMutation,
    expected: 500,
  },
  {
    id: "B-03",
    what: "element nesting depth (author and document)",
    actual: BOUNDS.elementDepth,
    expected: 32,
  },
  {
    id: "B-04",
    what: "props per element",
    actual: BOUNDS.propsPerElement,
    expected: 32,
  },
  {
    id: "B-05",
    what: "attribute value length (characters)",
    actual: BOUNDS.attributeValueChars,
    expected: 2_000,
  },
  {
    id: "B-06",
    what: "identifier length (characters)",
    actual: BOUNDS.identifierChars,
    expected: 64,
  },
  {
    id: "B-07",
    what: "nodes per document",
    actual: BOUNDS.nodesPerDocument,
    expected: 5_000,
  },
  {
    id: "B-08",
    what: "screens per document",
    actual: BOUNDS.screensPerDocument,
    expected: 64,
  },
  {
    id: "B-09",
    what: "components per active catalog",
    actual: BOUNDS.componentsPerCatalog,
    expected: 256,
  },
  {
    id: "B-10",
    what: "props per component spec",
    actual: BOUNDS.propsPerComponentSpec,
    expected: 48,
  },
  {
    id: "B-11",
    what: "enum values per prop",
    actual: BOUNDS.enumValuesPerProp,
    expected: 64,
  },
  {
    id: "B-12",
    what: "component when-to-use text (characters)",
    actual: BOUNDS.componentWhenToUseChars,
    expected: 200,
  },
  {
    id: "B-13",
    what: "per-prop guidance text (characters)",
    actual: BOUNDS.propGuidanceChars,
    expected: 200,
  },
  {
    id: "B-14",
    what: "data path depth (segments)",
    actual: BOUNDS.dataPathDepth,
    expected: 8,
  },
  {
    id: "B-15",
    what: "complete Data Model, canonical JSON (characters)",
    actual: BOUNDS.dataModelCanonicalJsonChars,
    expected: 1_000_000,
  },
  {
    id: "B-16",
    what: "total values in the complete Data Model",
    actual: BOUNDS.dataModelValues,
    expected: 100_000,
  },
  {
    id: "B-17",
    what: "array length anywhere in the complete Data Model",
    actual: BOUNDS.dataModelArrayLength,
    expected: 50_000,
  },
  {
    id: "B-18",
    what: "object keys per object anywhere in the complete Data Model",
    actual: BOUNDS.dataModelObjectKeys,
    expected: 256,
  },
  {
    id: "B-19",
    what: "string value anywhere in the complete Data Model (characters)",
    actual: BOUNDS.dataModelStringChars,
    expected: 4_000,
  },
  {
    id: "B-20",
    what: "agent publish_data incoming payload (characters)",
    actual: BOUNDS.publishDataPayloadChars,
    expected: 20_000,
  },
  {
    id: "B-21",
    what: "read_data result — array items half of the pair",
    actual: BOUNDS.readDataResult.items,
    expected: 100,
  },
  {
    id: "B-21",
    what: "read_data result — characters half of the pair",
    actual: BOUNDS.readDataResult.chars,
    expected: 20_000,
  },
  {
    id: "B-22",
    what: "collect fields per event",
    actual: BOUNDS.collectFieldsPerEvent,
    expected: 32,
  },
  {
    id: "B-23",
    what: "collected value / arg length (characters each)",
    actual: BOUNDS.collectedValueChars,
    expected: 2_000,
  },
  {
    id: "B-24",
    what: "one framework-controlled UI/error copy string (characters)",
    actual: BOUNDS.frameworkCopyChars,
    expected: 500,
  },
  {
    id: "B-25",
    what: "conversation message text, visitor or assistant (characters)",
    actual: BOUNDS.conversationMessageChars,
    expected: 20_000,
  },
  {
    id: "B-26",
    what: "role-specific semantic signals per component",
    actual: BOUNDS.componentAuthoringSignals,
    expected: 8,
  },
  {
    id: "B-27",
    what: "task outcomes per component",
    actual: BOUNDS.componentAuthoringOutcomes,
    expected: 6,
  },
  {
    id: "B-28",
    what: "component authoring guidance text (characters)",
    actual: BOUNDS.componentAuthoringGuidanceChars,
    expected: 200,
  },
];

/** Every leaf number in BOUNDS, flattened through the B-21 pair. */
function leafValues(): ReadonlyArray<readonly [string, unknown]> {
  const leaves: Array<readonly [string, unknown]> = [];
  for (const [key, value] of Object.entries(BOUNDS)) {
    if (typeof value === "object" && value !== null) {
      for (const [inner, innerValue] of Object.entries(value)) {
        leaves.push([`${key}.${inner}`, innerValue]);
      }
      continue;
    }
    leaves.push([key, value]);
  }
  return leaves;
}

describe("BOUNDS registry", () => {
  it.each(REGISTRY)("$id — $what", ({ actual, expected }) => {
    expect(actual).toBe(expected);
  });

  it("declares all 28 bounds B-01..B-28 and nothing else", () => {
    const declared = new Set(REGISTRY.map((entry) => entry.id));
    const expectedIds = Array.from({ length: 28 }, (_, index) => {
      return `B-${String(index + 1).padStart(2, "0")}`;
    });
    expect(Array.from(declared).sort()).toEqual(expectedIds);
    // B-21 is a pair, so it contributes one key holding both halves.
    expect(Object.keys(BOUNDS)).toHaveLength(28);
  });

  it("expresses every bound as a positive integer character or structural count", () => {
    for (const [name, value] of leafValues()) {
      expect(
        typeof value === "number" && Number.isSafeInteger(value) && value > 0,
        `${name} must be a positive integer count`,
      ).toBe(true);
    }
  });

  it("declares NO token-count limit anywhere — bounds are implementation-independent", () => {
    const serialized = JSON.stringify(BOUNDS);
    expect(serialized).not.toMatch(/token/i);
    for (const [name] of leafValues()) {
      expect(name).not.toMatch(/token/i);
    }
  });

  it("models B-21 as a readable pair of items and characters", () => {
    expect(Object.keys(BOUNDS.readDataResult).sort()).toEqual(["chars", "items"]);
  });
});

describe("BOUNDS immutability", () => {
  it("is frozen at the top level and through the B-21 pair", () => {
    expect(Object.isFrozen(BOUNDS)).toBe(true);
    expect(Object.isFrozen(BOUNDS.readDataResult)).toBe(true);
  });

  it("cannot be mutated by a consumer", () => {
    const escaped = BOUNDS as unknown as Record<string, unknown>;
    const nested = BOUNDS.readDataResult as unknown as Record<string, unknown>;
    try {
      escaped["identifierChars"] = 1;
    } catch {
      // Strict-mode assignment to a frozen object throws; either way the
      // value below must be unchanged.
    }
    try {
      nested["items"] = 1;
    } catch {
      // as above
    }
    try {
      escaped["newBound"] = 1;
    } catch {
      // as above
    }
    expect(BOUNDS.identifierChars).toBe(64);
    expect(BOUNDS.readDataResult.items).toBe(100);
    expect("newBound" in BOUNDS).toBe(false);
  });
});

describe("BOUNDS enforcement — B-06 identifier length", () => {
  it("accepts an identifier of exactly B-06 characters", () => {
    const atLimit = `a${"b".repeat(BOUNDS.identifierChars - 1)}`;
    expect(atLimit).toHaveLength(64);
    expect(isFacetIdentifier(atLimit)).toBe(true);
  });

  it("rejects an identifier one character past B-06", () => {
    const pastLimit = `a${"b".repeat(BOUNDS.identifierChars)}`;
    expect(pastLimit).toHaveLength(65);
    expect(isFacetIdentifier(pastLimit)).toBe(false);
  });
});

describe("BOUNDS enforcement — B-14 data path depth", () => {
  it("accepts a data path of exactly B-14 segments", () => {
    const atLimit = Array.from({ length: BOUNDS.dataPathDepth }, (_, index) => `seg${index}`).join(
      ".",
    );
    expect(parseDataPath(atLimit)).toHaveLength(8);
  });

  it("rejects a data path one segment past B-14", () => {
    const pastLimit = Array.from(
      { length: BOUNDS.dataPathDepth + 1 },
      (_, index) => `seg${index}`,
    ).join(".");
    expect(parseDataPath(pastLimit)).toBeNull();
  });
});
