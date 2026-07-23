import { describe, expect, it } from "vitest";
import { BRICK_CONTRACT } from "./brick-contract.js";

import {
  ALIGNMENTS,
  ASPECT_RATIOS,
  BORDER_WIDTHS,
  CHART_THICKNESSES,
  COLLAPSES,
  COLORS,
  COLUMNS,
  CONTROL_HEIGHTS,
  DIRECTIONS,
  ENTER_ANIMATIONS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_STYLES,
  FONT_WEIGHTS,
  GRADIENTS,
  HIGHLIGHTS,
  INDICATOR_SIZES,
  JUSTIFICATIONS,
  LAYOUT_WIDTHS,
  LETTER_SPACINGS,
  LINE_HEIGHTS,
  LOADING_ANIMATIONS,
  MAX_HEIGHTS,
  MAX_WIDTHS,
  MIN_HEIGHTS,
  OBJECT_FITS,
  OBJECT_POSITIONS,
  PROGRESS_THICKNESSES,
  RADII,
  SCRIMS,
  SCROLLS,
  SHADOWS,
  SPACES,
  TEXT_ALIGNS,
  WIDTHS,
} from "./tokens.js";
import {
  isStyleValueAllowedForProperty,
  STYLE_VALUE_CONTRACT,
  styleValueChoicesForProperty,
  styleValueDomainForProperty,
  styleValueNamesForProperty,
} from "./style-value-contract.js";

const names = (domain: { readonly values: readonly { readonly name: unknown }[] }) =>
  domain.values.map(({ name }) => name);

type TestStyleValueDomain = {
  readonly description: string;
  readonly values: readonly {
    readonly name: unknown;
    readonly description: string;
    readonly useWhen: string;
    readonly avoidWhen?: string;
  }[];
};

describe("STYLE_VALUE_CONTRACT", () => {
  it("keeps token metadata in exact domain order", () => {
    const domains = {
      space: SPACES,
      fontSize: FONT_SIZES,
      fontFamily: FONT_FAMILIES,
      fontWeight: FONT_WEIGHTS,
      radius: RADII,
      borderWidth: BORDER_WIDTHS,
      aspectRatio: ASPECT_RATIOS,
      minHeight: MIN_HEIGHTS,
      maxWidth: MAX_WIDTHS,
      layoutWidth: LAYOUT_WIDTHS,
      maxHeight: MAX_HEIGHTS,
      letterSpacing: LETTER_SPACINGS,
      lineHeight: LINE_HEIGHTS,
      controlHeight: CONTROL_HEIGHTS,
      indicatorSize: INDICATOR_SIZES,
      progressThickness: PROGRESS_THICKNESSES,
      chartThickness: CHART_THICKNESSES,
      color: COLORS,
      shadow: SHADOWS,
      gradient: GRADIENTS,
      scrim: SCRIMS,
      highlight: HIGHLIGHTS,
    } as const;

    expect(Object.keys(STYLE_VALUE_CONTRACT.tokens)).toEqual(Object.keys(domains));
    for (const domainName of Object.keys(domains) as (keyof typeof domains)[]) {
      expect(names(STYLE_VALUE_CONTRACT.tokens[domainName])).toEqual(domains[domainName]);
    }
  });

  it("keeps fixed-choice metadata in exact domain order", () => {
    const domains = {
      direction: DIRECTIONS,
      alignment: ALIGNMENTS,
      justification: JUSTIFICATIONS,
      boolean: [false, true],
      width: WIDTHS,
      scroll: SCROLLS,
      columns: COLUMNS,
      collapse: COLLAPSES,
      textAlign: TEXT_ALIGNS,
      fontStyle: FONT_STYLES,
      textWrap: ["wrap", "nowrap", "balance"],
      lineClamp: ["none", 1, 2, 3, 4],
      lineStyle: ["solid", "dashed", "dotted"],
      dividers: ["none", "rows", "grid"],
      objectFit: OBJECT_FITS,
      objectPosition: OBJECT_POSITIONS,
      enterAnimation: ENTER_ANIMATIONS,
      animation: LOADING_ANIMATIONS,
    } as const;

    expect(Object.keys(STYLE_VALUE_CONTRACT.fixed)).toEqual(Object.keys(domains));
    for (const domainName of Object.keys(domains) as (keyof typeof domains)[]) {
      expect(names(STYLE_VALUE_CONTRACT.fixed[domainName])).toEqual(domains[domainName]);
    }
  });

  it("documents product-grade text and chart fixed choices", () => {
    const fixed = STYLE_VALUE_CONTRACT.fixed as typeof STYLE_VALUE_CONTRACT.fixed & {
      readonly textWrap: TestStyleValueDomain;
      readonly lineClamp: TestStyleValueDomain;
      readonly lineStyle: TestStyleValueDomain;
    };

    expect(fixed.textWrap).toBeDefined();
    expect(fixed.lineClamp).toBeDefined();
    expect(fixed.lineStyle).toBeDefined();

    expect(names(fixed.textWrap)).toEqual(["wrap", "nowrap", "balance"]);
    expect(names(fixed.lineClamp)).toEqual(["none", 1, 2, 3, 4]);
    expect(names(fixed.lineStyle)).toEqual(["solid", "dashed", "dotted"]);

    expect(fixed.textWrap.description).toContain("Text wrapping");
    expect(fixed.lineClamp.description).toContain("Line clamp");
    expect(fixed.lineStyle.description).toContain("Chart line");

    for (const domain of [fixed.textWrap, fixed.lineClamp, fixed.lineStyle]) {
      for (const value of domain.values) {
        expect(value.description).not.toEqual("");
        expect(value.useWhen).not.toEqual("");
      }
    }
  });

  it("exposes width fit metadata and allowed property choices", () => {
    const widthProperty = BRICK_CONTRACT.box.style.root.properties.width!;
    const widthChoices = styleValueChoicesForProperty("width", widthProperty);

    expect(names(STYLE_VALUE_CONTRACT.fixed.width)).toEqual(["auto", "fit", "full"]);
    expect(widthChoices.map(({ name }) => name)).toEqual(["auto", "fit", "full"]);
    expect(widthChoices.find(({ name }) => name === "fit")).toMatchObject({
      description: expect.stringContaining("intrinsic"),
      useWhen: expect.stringContaining("compact"),
    });
    expect(isStyleValueAllowedForProperty("width", widthProperty, "fit")).toBe(true);
  });

  it("provides bounded agent guidance without concrete CSS values", () => {
    const serialized = JSON.stringify(STYLE_VALUE_CONTRACT);
    expect(serialized).not.toMatch(/#[0-9a-f]{3,8}|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw)\b/i);

    for (const family of [STYLE_VALUE_CONTRACT.tokens, STYLE_VALUE_CONTRACT.fixed]) {
      for (const domain of Object.values(family)) {
        expect(domain.description.length).toBeGreaterThan(0);
        expect(domain.description.length).toBeLessThanOrEqual(160);
        for (const value of domain.values) {
          expect(value.description.length).toBeGreaterThan(0);
          expect(value.description.length).toBeLessThanOrEqual(160);
          expect(value.useWhen.length).toBeGreaterThan(0);
          expect(value.useWhen.length).toBeLessThanOrEqual(200);
          if ("avoidWhen" in value && value.avoidWhen !== undefined) {
            expect(value.avoidWhen.length).toBeGreaterThan(0);
            expect(value.avoidWhen.length).toBeLessThanOrEqual(200);
          }
        }
      }
    }
  });

  it("filters property-specific choices through one canonical rule", () => {
    const properties = BRICK_CONTRACT.box.style.root.properties;
    const color = properties.color!;
    const background = properties.background!;

    expect(styleValueChoicesForProperty("color", color).map(({ name }) => name)).toContain(
      "inherit",
    );
    expect(
      styleValueChoicesForProperty("background", background).map(({ name }) => name),
    ).not.toContain("inherit");
    expect(isStyleValueAllowedForProperty("color", color, "inherit")).toBe(true);
    expect(isStyleValueAllowedForProperty("background", background, "inherit")).toBe(false);
  });
});

describe("analytics-data-surface dividers domain", () => {
  it("registers the closed fixed dividers domain with exact values", () => {
    const fixed = STYLE_VALUE_CONTRACT.fixed as typeof STYLE_VALUE_CONTRACT.fixed & {
      readonly dividers: TestStyleValueDomain;
    };

    expect(fixed.dividers).toBeDefined();
    expect(names(fixed.dividers)).toEqual(["none", "rows", "grid"]);
    for (const value of fixed.dividers.values) {
      expect(value.description).not.toEqual("");
      expect(value.useWhen).not.toEqual("");
    }
  });

  it("resolves table dividers and stickyHeader properties to their fixed domains", () => {
    const dividersProperty = BRICK_CONTRACT.table.style.root.properties.dividers;
    expect(dividersProperty).toMatchObject({ source: "fixed", domain: "dividers" });
    const dividersDomain = styleValueDomainForProperty(dividersProperty);
    expect(dividersDomain).toBeDefined();
    expect(names(dividersDomain!)).toEqual(["none", "rows", "grid"]);

    const stickyProperty = BRICK_CONTRACT.table.style.root.properties.stickyHeader;
    expect(stickyProperty).toMatchObject({ source: "fixed", domain: "boolean" });
    const stickyDomain = styleValueDomainForProperty(stickyProperty);
    expect(stickyDomain).toBeDefined();
    expect(names(stickyDomain!)).toEqual([false, true]);
  });

  it("locks the token scale roster to the exact 22 entries", () => {
    expect(Object.keys(STYLE_VALUE_CONTRACT.tokens)).toEqual([
      "space",
      "fontSize",
      "fontFamily",
      "fontWeight",
      "radius",
      "borderWidth",
      "aspectRatio",
      "minHeight",
      "maxWidth",
      "layoutWidth",
      "maxHeight",
      "letterSpacing",
      "lineHeight",
      "controlHeight",
      "indicatorSize",
      "progressThickness",
      "chartThickness",
      "color",
      "shadow",
      "gradient",
      "scrim",
      "highlight",
    ]);
  });
});

describe("box layout vocabulary", () => {
  it("registers layoutWidth and maxHeight token domains after maxWidth", () => {
    const tokens = STYLE_VALUE_CONTRACT.tokens as typeof STYLE_VALUE_CONTRACT.tokens & {
      readonly layoutWidth: TestStyleValueDomain;
      readonly maxHeight: TestStyleValueDomain;
    };

    expect(tokens.layoutWidth).toBeDefined();
    expect(names(tokens.layoutWidth)).toEqual(["xs", "sm", "md", "lg"]);
    expect(tokens.maxHeight).toBeDefined();
    expect(names(tokens.maxHeight)).toEqual(["none", "half", "screen"]);

    for (const domain of [tokens.layoutWidth, tokens.maxHeight]) {
      for (const value of domain.values) {
        expect(value.description).not.toEqual("");
        expect(value.useWhen).not.toEqual("");
      }
    }
  });

  it("registers the collapse fixed domain and the columns auto member", () => {
    const fixed = STYLE_VALUE_CONTRACT.fixed as typeof STYLE_VALUE_CONTRACT.fixed & {
      readonly collapse: TestStyleValueDomain;
    };

    expect(fixed.collapse).toBeDefined();
    expect(names(fixed.collapse)).toEqual(["none", "stack"]);
    for (const value of fixed.collapse.values) {
      expect(value.description).not.toEqual("");
      expect(value.useWhen).not.toEqual("");
    }

    expect(names(STYLE_VALUE_CONTRACT.fixed.columns)).toEqual(["none", 2, 3, 4, "auto"]);
  });

  it("wires the new box layout properties to their closed domains", () => {
    const box = BRICK_CONTRACT.box.style.root.properties;
    expect(box.basis).toMatchObject({ source: "token", domain: "layoutWidth" });
    expect(box.itemWidth).toMatchObject({ source: "token", domain: "layoutWidth" });
    expect(box.maxHeight).toMatchObject({ source: "token", domain: "maxHeight" });
    expect(box.collapse).toMatchObject({ source: "fixed", domain: "collapse" });
    expect(box.columns).toMatchObject({ source: "fixed", domain: "columns" });
  });

  it("resolves every new box layout property through the canonical choice rule", () => {
    const box = BRICK_CONTRACT.box.style.root.properties;
    expect(styleValueNamesForProperty("basis", box.basis!)).toEqual(["xs", "sm", "md", "lg"]);
    expect(styleValueNamesForProperty("itemWidth", box.itemWidth!)).toEqual([
      "xs",
      "sm",
      "md",
      "lg",
    ]);
    expect(styleValueNamesForProperty("maxHeight", box.maxHeight!)).toEqual([
      "none",
      "half",
      "screen",
    ]);
    expect(styleValueNamesForProperty("collapse", box.collapse!)).toEqual(["none", "stack"]);
    expect(styleValueNamesForProperty("columns", box.columns!)).toEqual(["none", 2, 3, 4, "auto"]);
  });
});
