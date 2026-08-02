import { describe, expect, it } from "vitest";

import {
  FACET_FOUNDATION_TOKEN_NAMES,
  FACET_SEMANTIC_TOKEN_NAMES,
  FACET_THEME_CONTRACT,
  themeTokenRef,
  themeTokenVar,
} from "./theme-contract.js";

describe("Facet Design Contract v1 metadata", () => {
  it("exposes Design Contract v1 foundation and semantic metadata in projection order", () => {
    expect(FACET_THEME_CONTRACT.foundation.map((group) => group.name)).toEqual([
      "palette",
      "typography",
      "space",
      "size",
      "radius",
      "borderWidth",
      "shadow",
      "opacity",
      "motion",
      "effect",
      "breakpoint",
      "density",
    ]);
    expect(FACET_THEME_CONTRACT.semantic.map((group) => group.name)).toEqual([
      "canvas",
      "surface",
      "text",
      "border",
      "action",
      "status",
      "state",
      "focus",
      "selection",
      "disabled",
      "overlay",
      "loading",
      "layer",
      "validation",
    ]);
  });

  it("covers broad product UI foundation groups", () => {
    expect(FACET_FOUNDATION_TOKEN_NAMES.palette).toContain("brand500");
    expect(FACET_FOUNDATION_TOKEN_NAMES.palette).toContain("categorical12");
    expect(FACET_FOUNDATION_TOKEN_NAMES.typography).toContain("fontFamilyDisplay");
    expect(FACET_FOUNDATION_TOKEN_NAMES.space).toContain("mega");
    expect(FACET_FOUNDATION_TOKEN_NAMES.size).toContain("touchTarget");
    expect(FACET_FOUNDATION_TOKEN_NAMES.motion).toContain("easeEmphasized");
  });

  it("covers semantic UI states without domain-specific components", () => {
    expect(FACET_SEMANTIC_TOKEN_NAMES.action).toContain("destructiveBg");
    expect(FACET_SEMANTIC_TOKEN_NAMES.status).toContain("infoBorder");
    expect(FACET_SEMANTIC_TOKEN_NAMES.focus).toEqual([
      "ringColor",
      "ringWidth",
      "ringOffset",
      "ringStyle",
    ]);
    expect(FACET_SEMANTIC_TOKEN_NAMES.loading).toContain("shimmerDuration");
    expect(Object.keys(FACET_SEMANTIC_TOKEN_NAMES)).not.toContain("chart");
    expect(Object.keys(FACET_SEMANTIC_TOKEN_NAMES)).not.toContain("calendar");
  });

  it("builds stable CSS variable names for every layer", () => {
    expect(themeTokenVar({ layer: "foundation", group: "palette", token: "brand500" })).toBe(
      "--facet-foundation-palette-brand500",
    );
    expect(themeTokenRef({ layer: "semantic", group: "text", token: "linkHover" })).toBe(
      "var(--facet-semantic-text-link-hover)",
    );
    expect(themeTokenVar({ layer: "recipe", namespace: "Button", token: "focusRing" })).toBe(
      "--facet-recipe-button-focus-ring",
    );
    expect(themeTokenRef({ layer: "extension", namespace: "chart", token: "seriesA" })).toBe(
      "var(--facet-ext-chart-series-a)",
    );
  });

  it("is frozen plain metadata", () => {
    expect(Object.isFrozen(FACET_THEME_CONTRACT)).toBe(true);
    expect(Object.isFrozen(FACET_THEME_CONTRACT.foundation)).toBe(true);
    expect(Object.isFrozen(FACET_THEME_CONTRACT.foundation[0])).toBe(true);
    expect(Object.isFrozen(FACET_THEME_CONTRACT.foundation[0]?.tokens)).toBe(true);
  });
});
