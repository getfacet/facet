import { describe, expect, it } from "vitest";
import { BRICK_CONTRACT } from "./brick-contract.js";

import {
  ALIGNMENTS,
  ASPECT_RATIOS,
  BORDER_WIDTHS,
  CHART_THICKNESSES,
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
  LETTER_SPACINGS,
  LINE_HEIGHTS,
  LOADING_ANIMATIONS,
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
      textAlign: TEXT_ALIGNS,
      fontStyle: FONT_STYLES,
      textWrap: ["wrap", "nowrap", "balance"],
      lineClamp: ["none", 1, 2, 3, 4],
      lineStyle: ["solid", "dashed", "dotted"],
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
