import { describe, expect, it } from "vitest";

import { validateCatalog, type FacetCatalog } from "./catalog.js";
import { UI_PATTERN_BOUNDS, validateUiPatternSet, type UiPatternSet } from "./ui-pattern.js";

function catalog(): FacetCatalog {
  const result = validateCatalog({
    components: [
      {
        tag: "Screen",
        whenToUse: "Declare one screen.",
        props: {
          name: { type: "string", guidance: "Unique screen name.", required: true },
        },
        acceptsChildren: true,
      },
      {
        tag: "Stack",
        whenToUse: "Stack content.",
        props: {},
        acceptsChildren: true,
      },
      {
        tag: "Text",
        whenToUse: "Show text.",
        props: {
          value: { type: "string", guidance: "Visible copy.", required: true },
        },
        acceptsChildren: false,
      },
    ],
  });
  if (!result.ok) throw new Error(`fixture catalog rejected: ${result.code}`);
  return result.catalog;
}

function validSet(): UiPatternSet {
  return {
    version: "test-patterns-v1",
    patterns: [
      {
        id: "browse",
        title: "Browse a collection",
        whenToUse: "Use when a visitor must scan and narrow several options.",
        avoidWhen: ["Avoid when only one subject exists."],
        informationOrder: ["Narrowing controls", "Results", "Selection"],
        regions: [
          {
            id: "results",
            purpose: "Show the available options in a repeatable structure.",
            relationship: "Keep narrowing controls directly before the results.",
          },
        ],
        componentChoices: [
          {
            whenToUse: "Use a vertical reading flow for short factual options.",
            tags: ["Stack", "Text"],
            rationale: "The options remain easy to scan without decorative containers.",
          },
        ],
        variants: [
          {
            id: "compact-list",
            whenToUse: "Use for a short factual collection.",
            composition: "A single results region in reading order.",
            exampleMarkup:
              '<Facet entry="main"><Screen name="main"><Stack><Text value="Result A" /><Text value="Result B" /></Stack></Screen></Facet>',
          },
        ],
        avoid: ["Do not put a marketing introduction before the results."],
      },
    ],
  };
}

describe("UI Pattern contract", () => {
  it("accepts a bounded set whose references and examples match the supplied catalog", () => {
    const result = validateUiPatternSet(validSet(), catalog());

    expect(result).toEqual({ ok: true, set: validSet() });
    expect(UI_PATTERN_BOUNDS.patterns).toBeGreaterThanOrEqual(4);
    expect(UI_PATTERN_BOUNDS.variantsPerPattern).toBeGreaterThanOrEqual(2);
  });

  it("returns stable paths for duplicate ids, stale component tags, and invalid examples", () => {
    const first = validSet().patterns[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const result = validateUiPatternSet(
      {
        version: "test-patterns-v1",
        patterns: [
          first,
          {
            ...first,
            componentChoices: [
              {
                whenToUse: "Use an unavailable component.",
                tags: ["UnknownCard"],
                rationale: "This must be rejected.",
              },
            ],
            variants: [
              {
                ...first.variants[0],
                exampleMarkup: "<script>bad</script>",
              },
            ],
          },
        ],
      },
      catalog(),
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        { code: "duplicate-pattern-id", path: "patterns[1].id" },
        { code: "unknown-component", path: "patterns[1].componentChoices[0].tags[0]" },
        { code: "invalid-example", path: "patterns[1].variants[0].exampleMarkup" },
      ],
    });
  });

  it("rejects unknown and over-bound values without throwing", () => {
    expect(validateUiPatternSet(null, catalog())).toEqual({
      ok: false,
      issues: [{ code: "invalid-pattern-set", path: "$" }],
    });
    expect(
      validateUiPatternSet(
        {
          ...validSet(),
          version: "x".repeat(UI_PATTERN_BOUNDS.stringChars + 1),
        },
        catalog(),
      ),
    ).toEqual({
      ok: false,
      issues: [{ code: "invalid-value", path: "version" }],
    });
    expect(
      validateUiPatternSet(
        {
          ...validSet(),
          patterns: Array.from({ length: UI_PATTERN_BOUNDS.patterns + 1 }, (_, index) => ({
            ...validSet().patterns[0],
            id: `pattern-${index}`,
          })),
        },
        catalog(),
      ),
    ).toEqual({
      ok: false,
      issues: [{ code: "invalid-value", path: "patterns" }],
    });
  });
});
