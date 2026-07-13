import {
  COLORS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  GRADIENTS,
  HIGHLIGHTS,
  LEADINGS,
  MAX_WIDTHS,
  MIN_HEIGHTS,
  RADII,
  RATIOS,
  SCRIMS,
  SHADOWS,
  SPACES,
  TRACKINGS,
} from "./tokens.js";
import { boundedDescription, isPlainObject, printableKey } from "./issues.js";
import { IssueList } from "./theme-issues.js";
import { CONTRAST_PAIRS, MIN_CONTRAST, contrastRatio, parseSrgb } from "./theme-color.js";
import { validateRecipes } from "./theme-recipe-validation.js";
import {
  FONT_SIZE_PX_RANGE,
  LEADING_PX_RANGE,
  MAX_WIDTH_PX_RANGE,
  MIN_HEIGHT_PX_RANGE,
  RADIUS_PX_RANGE,
  SPACE_PX_RANGE,
  TRACKING_PX_RANGE,
  dimensionHandler,
  handleColor,
  handleCssShape,
  handleFontFamily,
  handleRatio,
  handleShadow,
  handleWeight,
  validateGroup,
} from "./theme-token-validation.js";
import { DEFAULT_COLORS, MAX_DESCRIPTION_LENGTH, isValidThemeName } from "./theme-types.js";
import type { ComponentRecipes, FacetTheme, ThemeValidationResult } from "./theme-types.js";

const KNOWN_KEYS = new Set([
  "name",
  "description",
  "color",
  "space",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "radius",
  "ratio",
  "shadow",
  "minHeight",
  "maxWidth",
  "tracking",
  "leading",
  "gradient",
  "scrim",
  "highlight",
  "colorDark",
  "recipes",
]);

/**
 * Validate an untrusted operator theme document. Returns a `FacetTheme` (partial
 * override) plus issues, or issues only if any `error` was raised. Never throws —
 * a hostile input whose property accessor throws is caught by the public wrapper.
 */
function validateThemeInner(input: unknown): ThemeValidationResult {
  const issues = new IssueList();
  if (!isPlainObject(input)) {
    issues.push({ severity: "error", message: "theme document is not an object" });
    return { issues: issues.list };
  }

  const name = input.name;
  if (typeof name !== "string" || !isValidThemeName(name)) {
    issues.push({ severity: "error", message: "theme name is missing or malformed" });
    return { issues: issues.list };
  }

  const theme: {
    name: string;
    description?: string;
    color?: Record<string, string>;
    space?: Record<string, string>;
    fontFamily?: Record<string, string>;
    fontSize?: Record<string, string>;
    fontWeight?: Record<string, number>;
    radius?: Record<string, string>;
    ratio?: Record<string, string>;
    shadow?: Record<string, string>;
    minHeight?: Record<string, string>;
    maxWidth?: Record<string, string>;
    tracking?: Record<string, string>;
    leading?: Record<string, string>;
    gradient?: Record<string, string>;
    scrim?: Record<string, string>;
    highlight?: Record<string, string>;
    colorDark?: Record<string, string>;
    recipes?: ComponentRecipes;
  } = { name };

  if (input.description !== undefined) {
    const { description, warning } = boundedDescription(
      input.description,
      "theme",
      MAX_DESCRIPTION_LENGTH,
    );
    if (description !== undefined) theme.description = description;
    if (warning !== undefined) issues.push({ severity: "warning", message: warning });
  }

  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      issues.push({
        severity: "warning",
        message: `unknown theme key "${printableKey(key)}" dropped`,
      });
    }
  }

  if (input.color !== undefined) {
    const group = validateGroup(input.color, COLORS, "color", handleColor, issues);
    if (group !== undefined) theme.color = group;
  }
  if (input.space !== undefined) {
    const group = validateGroup(
      input.space,
      SPACES,
      "space",
      dimensionHandler(SPACE_PX_RANGE.lo, SPACE_PX_RANGE.hi),
      issues,
    );
    if (group !== undefined) theme.space = group;
  }
  if (input.fontFamily !== undefined) {
    const group = validateGroup(
      input.fontFamily,
      FONT_FAMILIES,
      "fontFamily",
      handleFontFamily,
      issues,
    );
    if (group !== undefined) theme.fontFamily = group;
  }
  if (input.fontSize !== undefined) {
    const group = validateGroup(
      input.fontSize,
      FONT_SIZES,
      "fontSize",
      dimensionHandler(FONT_SIZE_PX_RANGE.lo, FONT_SIZE_PX_RANGE.hi),
      issues,
    );
    if (group !== undefined) theme.fontSize = group;
  }
  if (input.fontWeight !== undefined) {
    const group = validateGroup(input.fontWeight, FONT_WEIGHTS, "fontWeight", handleWeight, issues);
    if (group !== undefined) theme.fontWeight = group;
  }
  if (input.radius !== undefined) {
    const group = validateGroup(
      input.radius,
      RADII,
      "radius",
      dimensionHandler(RADIUS_PX_RANGE.lo, RADIUS_PX_RANGE.hi),
      issues,
    );
    if (group !== undefined) theme.radius = group;
  }
  if (input.ratio !== undefined) {
    const group = validateGroup(input.ratio, RATIOS, "ratio", handleRatio, issues);
    if (group !== undefined) theme.ratio = group;
  }
  if (input.shadow !== undefined) {
    const group = validateGroup(input.shadow, SHADOWS, "shadow", handleShadow, issues);
    if (group !== undefined) theme.shadow = group;
  }
  if (input.minHeight !== undefined) {
    const group = validateGroup(
      input.minHeight,
      MIN_HEIGHTS,
      "minHeight",
      dimensionHandler(MIN_HEIGHT_PX_RANGE.lo, MIN_HEIGHT_PX_RANGE.hi),
      issues,
    );
    if (group !== undefined) theme.minHeight = group;
  }
  if (input.maxWidth !== undefined) {
    const group = validateGroup(
      input.maxWidth,
      MAX_WIDTHS,
      "maxWidth",
      dimensionHandler(MAX_WIDTH_PX_RANGE.lo, MAX_WIDTH_PX_RANGE.hi),
      issues,
    );
    if (group !== undefined) theme.maxWidth = group;
  }
  if (input.tracking !== undefined) {
    const group = validateGroup(
      input.tracking,
      TRACKINGS,
      "tracking",
      dimensionHandler(TRACKING_PX_RANGE.lo, TRACKING_PX_RANGE.hi),
      issues,
    );
    if (group !== undefined) theme.tracking = group;
  }
  if (input.leading !== undefined) {
    const group = validateGroup(
      input.leading,
      LEADINGS,
      "leading",
      dimensionHandler(LEADING_PX_RANGE.lo, LEADING_PX_RANGE.hi),
      issues,
    );
    if (group !== undefined) theme.leading = group;
  }
  if (input.gradient !== undefined) {
    const group = validateGroup(input.gradient, GRADIENTS, "gradient", handleCssShape, issues);
    if (group !== undefined) theme.gradient = group;
  }
  if (input.scrim !== undefined) {
    const group = validateGroup(input.scrim, SCRIMS, "scrim", handleCssShape, issues);
    if (group !== undefined) theme.scrim = group;
  }
  if (input.highlight !== undefined) {
    const group = validateGroup(input.highlight, HIGHLIGHTS, "highlight", handleCssShape, issues);
    if (group !== undefined) theme.highlight = group;
  }
  if (input.colorDark !== undefined) {
    const group = validateGroup(input.colorDark, COLORS, "colorDark", handleColor, issues);
    if (group !== undefined) theme.colorDark = group;
  }
  if (input.recipes !== undefined) {
    const recipes = validateRecipes(input.recipes, issues);
    if (recipes !== undefined) theme.recipes = recipes;
  }

  // Contrast is MEASURED, never enforced: a low ratio is a warning, not a refusal.
  // Measured against EFFECTIVE colors (override ?? default): resolveTheme overlays
  // a partial document on the defaults, so a doc that overrides only ONE member of
  // a pair (the most common low-contrast mistake, e.g. bg #000 on default fg) must
  // still be checked — skip a pair only when NEITHER member is overridden.
  if (theme.color !== undefined) {
    for (const [a, b] of CONTRAST_PAIRS) {
      const oa = theme.color[a];
      const ob = theme.color[b];
      if (oa === undefined && ob === undefined) continue;
      const sa = parseSrgb(oa ?? DEFAULT_COLORS[a]);
      const sb = parseSrgb(ob ?? DEFAULT_COLORS[b]);
      if (sa === undefined || sb === undefined) continue;
      const ratio = contrastRatio(sa, sb);
      if (ratio < MIN_CONTRAST) {
        issues.push({
          severity: "warning",
          message: `low contrast for (${a}, ${b}): ratio ${ratio.toFixed(2)} is below ${MIN_CONTRAST}`,
        });
      }
    }
  }

  // Gate on `hasError` (tracked before the cap) — NOT a scan of the retained
  // list, which the issue cap can trim an error out of. A document with ≥64
  // warnings before an error-bearing value must still be refused wholesale.
  if (issues.hasError) return { issues: issues.list };
  return { theme: theme as FacetTheme, issues: issues.list };
}

/**
 * Public boundary: runs `validateThemeInner` but catches any throw from a hostile
 * input (e.g. `{ get color() { throw } }`) so the documented "NEVER throws"
 * contract holds for a live in-process document, not just JSON-shaped input.
 */
export function validateTheme(input: unknown): ThemeValidationResult {
  try {
    return validateThemeInner(input);
  } catch {
    return { issues: [{ severity: "error", message: "theme document threw during validation" }] };
  }
}
