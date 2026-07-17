import type { FacetTheme } from "@facet/core";
import { DEFAULT_BRICK_STYLES, PRESETS } from "./theme-styles.js";
import {
  ASPECT_RATIO,
  BORDER_WIDTH,
  CHART_THICKNESS,
  CONTROL_HEIGHT,
  FONT_FAMILY,
  FONT_SIZE,
  FONT_WEIGHT,
  INDICATOR_SIZE,
  LETTER_SPACING,
  LINE_HEIGHT,
  MAX_WIDTH,
  MIN_HEIGHT,
  PAINT_DARK,
  PAINT_LIGHT,
  PROGRESS_THICKNESS,
  RADIUS,
  SPACE,
} from "./theme-tokens.js";

export {
  ASPECT_RATIO,
  BORDER_WIDTH,
  CHART_THICKNESS,
  COLOR,
  COLOR_DARK,
  CONTROL_HEIGHT,
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
  PAINT_DARK,
  PAINT_LIGHT,
  PROGRESS_THICKNESS,
  RADIUS,
  SCRIM,
  SHADOW,
  SPACE,
} from "./theme-tokens.js";

/**
 * Facet's one bundled design system. Agents author only its closed names;
 * concrete CSS values stay inside this validated operator Theme.
 */
export const DEFAULT_THEME: FacetTheme = {
  name: "default",
  description: "Facet's balanced default design system for clear application interfaces.",
  tokens: {
    space: SPACE,
    fontSize: FONT_SIZE,
    fontFamily: FONT_FAMILY,
    fontWeight: FONT_WEIGHT,
    radius: RADIUS,
    borderWidth: BORDER_WIDTH,
    aspectRatio: ASPECT_RATIO,
    minHeight: MIN_HEIGHT,
    maxWidth: MAX_WIDTH,
    letterSpacing: LETTER_SPACING,
    lineHeight: LINE_HEIGHT,
    controlHeight: CONTROL_HEIGHT,
    indicatorSize: INDICATOR_SIZE,
    progressThickness: PROGRESS_THICKNESS,
    chartThickness: CHART_THICKNESS,
    paint: { light: PAINT_LIGHT, dark: PAINT_DARK },
  },
  defaults: DEFAULT_BRICK_STYLES,
  presets: PRESETS,
};
