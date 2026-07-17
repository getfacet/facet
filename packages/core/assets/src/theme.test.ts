import type { FacetTheme } from "@facet/core";
import { validateTheme } from "@facet/core";
import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIO,
  BORDER_WIDTH,
  CHART_THICKNESS,
  COLOR,
  COLOR_DARK,
  CONTROL_HEIGHT,
  DEFAULT_THEME,
  FONT_FAMILY,
  FONT_SIZE,
  FONT_WEIGHT,
  GRADIENT,
  HIGHLIGHT,
  INDICATOR_SIZE,
  LETTER_SPACING,
  LINE_HEIGHT,
  MAX_WIDTH,
  MIN_HEIGHT,
  PROGRESS_THICKNESS,
  RADIUS,
  SCRIM,
  SHADOW,
  SPACE,
} from "./theme.js";

const EXPECTED_TARGETS = {
  box: [],
  text: [],
  media: [],
  input: ["control", "indicator", "label", "option", "placeholder"],
  richtext: ["code", "heading1", "heading2", "heading3", "link", "listMarker", "quote"],
  table: ["caption", "cell", "header", "row"],
  chart: ["plot", "series", "title"],
  list: ["body", "item", "marker", "title"],
  keyValue: ["item", "label", "value"],
  progress: ["fill", "label", "track"],
  loading: ["indicator", "label"],
} as const;

const TOKEN_GROUPS = [
  "space",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "radius",
  "borderWidth",
  "aspectRatio",
  "minHeight",
  "maxWidth",
  "letterSpacing",
  "lineHeight",
  "controlHeight",
  "indicatorSize",
  "progressThickness",
  "chartThickness",
  "paint",
] as const;

describe("DEFAULT_THEME", () => {
  it("ships one complete default Theme", () => {
    const result = validateTheme(DEFAULT_THEME);

    expect(result.theme, result.issues.map(({ message }) => message).join("\n")).toBeDefined();
    expect(result.issues).toEqual([]);
    expect(DEFAULT_THEME.name).toBe("default");
    expect(DEFAULT_THEME.description).toMatch(/Facet/);
    expect(Object.keys(DEFAULT_THEME.tokens).sort()).toEqual([...TOKEN_GROUPS].sort());
    expect(Object.keys(DEFAULT_THEME.defaults).sort()).toEqual(
      Object.keys(EXPECTED_TARGETS).sort(),
    );

    for (const [brick, targets] of Object.entries(EXPECTED_TARGETS)) {
      const style = DEFAULT_THEME.defaults[brick as keyof FacetTheme["defaults"]];
      for (const target of targets) expect(style).toHaveProperty(target);
    }

    expect(Object.keys(DEFAULT_THEME.tokens.paint.light.color).sort()).toEqual(
      Object.keys(DEFAULT_THEME.tokens.paint.dark.color).sort(),
    );
    expect(DEFAULT_THEME.tokens.paint.light.color.background).toBe("#ffffff");
    expect(DEFAULT_THEME.tokens.paint.dark.color.background).toBe("#0b0b0f");
    expect(DEFAULT_THEME.tokens.paint.light.color.inherit).toBe("inherit");
    expect(DEFAULT_THEME.tokens.paint.dark.color.inherit).toBe("inherit");

    expect(DEFAULT_THEME.presets?.box?.panel).toMatchObject({
      description: expect.any(String),
      useWhen: expect.any(String),
      style: { background: "surface", borderRadius: "md" },
    });
    expect(DEFAULT_THEME.presets?.box?.primaryAction?.avoidWhen).toBeTruthy();
    expect(DEFAULT_THEME.presets?.text?.heading?.style).toMatchObject({
      fontSize: "2xl",
      fontWeight: "bold",
    });
    expect(DEFAULT_THEME.presets?.progress?.success?.style.fill).toMatchObject({
      background: "success",
    });

    let presetCount = 0;
    for (const presets of Object.values(DEFAULT_THEME.presets ?? {})) {
      expect(Object.keys(presets).length).toBeLessThanOrEqual(16);
      for (const preset of Object.values(presets)) {
        presetCount += 1;
        expect(preset.description.length).toBeGreaterThan(0);
        expect(preset.useWhen.length).toBeGreaterThan(0);
      }
    }
    expect(presetCount).toBeGreaterThanOrEqual(11);
    expect(presetCount).toBeLessThanOrEqual(64);

    expect(DEFAULT_THEME).not.toHaveProperty("recipes");
    expect(JSON.stringify(DEFAULT_THEME)).not.toContain('"recipe"');
  });

  it("exports every complete token map as null-prototype data", () => {
    const maps = [
      SPACE,
      FONT_SIZE,
      FONT_FAMILY,
      FONT_WEIGHT,
      RADIUS,
      BORDER_WIDTH,
      ASPECT_RATIO,
      MIN_HEIGHT,
      MAX_WIDTH,
      LETTER_SPACING,
      LINE_HEIGHT,
      CONTROL_HEIGHT,
      INDICATOR_SIZE,
      PROGRESS_THICKNESS,
      CHART_THICKNESS,
      COLOR,
      COLOR_DARK,
      SHADOW,
      GRADIENT,
      SCRIM,
      HIGHLIGHT,
    ];

    for (const map of maps) {
      expect(Object.getPrototypeOf(map)).toBeNull();
      expect(Reflect.get(map, "__proto__")).toBeUndefined();
      expect(Reflect.get(map, "constructor")).toBeUndefined();
    }
  });
});
