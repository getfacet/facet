import { BRICK_TYPES, type BrickType } from "./brick-contract.js";
import { CONTRAST_PAIRS, MIN_CONTRAST, contrastRatio, parseSrgb } from "./theme-color.js";
import { isControlChar, isForbiddenKey, isPlainObject, nullMap, printableKey } from "./issues.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import type { BrickStyleDefinitionMap } from "./style-types.js";
import { IssueList } from "./theme-issues.js";
import { validateThemeStyle } from "./theme-style-validation.js";
import {
  aspectRatioHandler,
  colorHandler,
  fontFamilyHandler,
  fontWeightHandler,
  gradientHandler,
  lengthHandler,
  lineHeightHandler,
  scrimHandler,
  shadowHandler,
  validateCompleteGroup,
} from "./theme-token-validation.js";
import type {
  FacetPaintTokens,
  FacetPreset,
  FacetPresets,
  FacetTheme,
  FacetThemeTokens,
  ThemeValidationResult,
} from "./theme-types.js";
import { MAX_DESCRIPTION_LENGTH, isValidThemeName } from "./theme-types.js";
import {
  ASPECT_RATIOS,
  BORDER_WIDTHS,
  CHART_THICKNESSES,
  COLORS,
  CONTROL_HEIGHTS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  GRADIENTS,
  HIGHLIGHTS,
  INDICATOR_SIZES,
  LETTER_SPACINGS,
  LINE_HEIGHTS,
  MAX_WIDTHS,
  MIN_HEIGHTS,
  PROGRESS_THICKNESSES,
  RADII,
  SCRIMS,
  SHADOWS,
  SPACES,
} from "./tokens.js";

const MAX_PRESETS_PER_BRICK = 16;
const MAX_PRESETS_TOTAL = 64;
const TOKEN_KEYS = new Set([
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
]);

const length = {
  space: lengthHandler({
    unitlessZero: true,
    px: { min: 0, max: 256 },
    rem: { min: 0, max: 16 },
    em: { min: 0, max: 16 },
  }),
  fontSize: lengthHandler({
    px: { min: 8, max: 256 },
    rem: { min: 0.5, max: 16 },
    em: { min: 0.5, max: 16 },
  }),
  radius: lengthHandler({
    unitlessZero: true,
    px: { min: 0, max: 9999 },
    rem: { min: 0, max: 625 },
    em: { min: 0, max: 625 },
  }),
  borderWidth: lengthHandler({
    unitlessZero: true,
    px: { min: 0, max: 16 },
    rem: { min: 0, max: 1 },
    em: { min: 0, max: 1 },
  }),
  minHeight: lengthHandler({
    unitlessZero: true,
    keywords: { auto: "auto" },
    px: { min: 0, max: 2000 },
    rem: { min: 0, max: 125 },
    em: { min: 0, max: 125 },
    svh: { min: 0, max: 100 },
  }),
  maxWidth: lengthHandler({
    unitlessZero: true,
    keywords: { none: "none" },
    px: { min: 0, max: 4096 },
    rem: { min: 0, max: 256 },
    em: { min: 0, max: 256 },
    ch: { min: 0, max: 256 },
  }),
  letterSpacing: lengthHandler({
    unitlessZero: true,
    px: { min: -16, max: 16 },
    rem: { min: -1, max: 1 },
    em: { min: -1, max: 1 },
  }),
  controlHeight: lengthHandler({
    px: { min: 16, max: 256 },
    rem: { min: 1, max: 16 },
    em: { min: 1, max: 16 },
  }),
  indicatorSize: lengthHandler({
    px: { min: 4, max: 128 },
    rem: { min: 0.25, max: 8 },
    em: { min: 0.25, max: 8 },
  }),
  progressThickness: lengthHandler({
    px: { min: 1, max: 64 },
    rem: { min: 0.0625, max: 4 },
    em: { min: 0.0625, max: 4 },
  }),
  chartThickness: lengthHandler({
    px: { min: 1, max: 32 },
    rem: { min: 0.0625, max: 2 },
    em: { min: 0.0625, max: 2 },
  }),
} as const;

function error(issues: IssueList, message: string): void {
  issues.push({ severity: "error", message });
}

function rejectUnknownKeys(
  raw: Record<string, unknown>,
  known: ReadonlySet<string>,
  path: string,
  issues: IssueList,
): void {
  for (const key of Object.keys(raw)) {
    if (isForbiddenKey(key) || !known.has(key)) {
      error(issues, `${path} has unknown or forbidden key "${printableKey(key)}"`);
    }
  }
}

function prose(
  raw: unknown,
  path: string,
  required: boolean,
  issues: IssueList,
): string | undefined {
  if (raw === undefined && !required) return undefined;
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_DESCRIPTION_LENGTH ||
    raw.trim() !== raw
  ) {
    error(issues, `${path} must be non-empty bounded prose without surrounding whitespace`);
    return undefined;
  }
  for (let index = 0; index < raw.length; index += 1) {
    if (isControlChar(raw.charCodeAt(index))) {
      error(issues, `${path} contains a control character`);
      return undefined;
    }
  }
  return raw;
}

function validatePaint(raw: unknown, path: string, issues: IssueList): FacetPaintTokens {
  const empty = nullMap<unknown>();
  if (!isPlainObject(raw)) {
    error(issues, `${path} is missing or not an object`);
    return empty as unknown as FacetPaintTokens;
  }
  rejectUnknownKeys(
    raw,
    new Set(["color", "shadow", "gradient", "scrim", "highlight"]),
    path,
    issues,
  );
  return {
    color: validateCompleteGroup(raw.color, COLORS, `${path}.color`, colorHandler, issues),
    shadow: validateCompleteGroup(raw.shadow, SHADOWS, `${path}.shadow`, shadowHandler, issues),
    gradient: validateCompleteGroup(
      raw.gradient,
      GRADIENTS,
      `${path}.gradient`,
      gradientHandler,
      issues,
    ),
    scrim: validateCompleteGroup(raw.scrim, SCRIMS, `${path}.scrim`, scrimHandler, issues),
    highlight: validateCompleteGroup(
      raw.highlight,
      HIGHLIGHTS,
      `${path}.highlight`,
      gradientHandler,
      issues,
    ),
  };
}

function validateBaseScales(
  raw: Record<string, unknown>,
  issues: IssueList,
): Pick<
  FacetThemeTokens,
  "space" | "fontSize" | "fontFamily" | "fontWeight" | "radius" | "borderWidth"
> {
  return {
    space: validateCompleteGroup(raw.space, SPACES, "tokens.space", length.space, issues),
    fontSize: validateCompleteGroup(
      raw.fontSize,
      FONT_SIZES,
      "tokens.fontSize",
      length.fontSize,
      issues,
    ),
    fontFamily: validateCompleteGroup(
      raw.fontFamily,
      FONT_FAMILIES,
      "tokens.fontFamily",
      fontFamilyHandler,
      issues,
    ),
    fontWeight: validateCompleteGroup(
      raw.fontWeight,
      FONT_WEIGHTS,
      "tokens.fontWeight",
      fontWeightHandler,
      issues,
    ),
    radius: validateCompleteGroup(raw.radius, RADII, "tokens.radius", length.radius, issues),
    borderWidth: validateCompleteGroup(
      raw.borderWidth,
      BORDER_WIDTHS,
      "tokens.borderWidth",
      length.borderWidth,
      issues,
    ),
  };
}

function validateLayoutScales(
  raw: Record<string, unknown>,
  issues: IssueList,
): Pick<
  FacetThemeTokens,
  "aspectRatio" | "minHeight" | "maxWidth" | "letterSpacing" | "lineHeight"
> {
  return {
    aspectRatio: validateCompleteGroup(
      raw.aspectRatio,
      ASPECT_RATIOS,
      "tokens.aspectRatio",
      aspectRatioHandler,
      issues,
    ),
    minHeight: validateCompleteGroup(
      raw.minHeight,
      MIN_HEIGHTS,
      "tokens.minHeight",
      length.minHeight,
      issues,
    ),
    maxWidth: validateCompleteGroup(
      raw.maxWidth,
      MAX_WIDTHS,
      "tokens.maxWidth",
      length.maxWidth,
      issues,
    ),
    letterSpacing: validateCompleteGroup(
      raw.letterSpacing,
      LETTER_SPACINGS,
      "tokens.letterSpacing",
      length.letterSpacing,
      issues,
    ),
    lineHeight: validateCompleteGroup(
      raw.lineHeight,
      LINE_HEIGHTS,
      "tokens.lineHeight",
      lineHeightHandler,
      issues,
    ),
  };
}

function validateComponentScales(
  raw: Record<string, unknown>,
  issues: IssueList,
): Pick<
  FacetThemeTokens,
  "controlHeight" | "indicatorSize" | "progressThickness" | "chartThickness"
> {
  return {
    controlHeight: validateCompleteGroup(
      raw.controlHeight,
      CONTROL_HEIGHTS,
      "tokens.controlHeight",
      length.controlHeight,
      issues,
    ),
    indicatorSize: validateCompleteGroup(
      raw.indicatorSize,
      INDICATOR_SIZES,
      "tokens.indicatorSize",
      length.indicatorSize,
      issues,
    ),
    progressThickness: validateCompleteGroup(
      raw.progressThickness,
      PROGRESS_THICKNESSES,
      "tokens.progressThickness",
      length.progressThickness,
      issues,
    ),
    chartThickness: validateCompleteGroup(
      raw.chartThickness,
      CHART_THICKNESSES,
      "tokens.chartThickness",
      length.chartThickness,
      issues,
    ),
  };
}

function validateTokens(raw: unknown, issues: IssueList): FacetThemeTokens {
  const empty = nullMap<unknown>();
  if (!isPlainObject(raw)) {
    error(issues, "theme.tokens is missing or not an object");
    return empty as unknown as FacetThemeTokens;
  }
  rejectUnknownKeys(raw, TOKEN_KEYS, "theme.tokens", issues);

  let light: FacetPaintTokens = empty as unknown as FacetPaintTokens;
  let dark: FacetPaintTokens = empty as unknown as FacetPaintTokens;
  if (!isPlainObject(raw.paint)) error(issues, "theme.tokens.paint is missing or not an object");
  else {
    rejectUnknownKeys(raw.paint, new Set(["light", "dark"]), "theme.tokens.paint", issues);
    light = validatePaint(raw.paint.light, "theme.tokens.paint.light", issues);
    dark = validatePaint(raw.paint.dark, "theme.tokens.paint.dark", issues);
  }

  return {
    ...validateBaseScales(raw, issues),
    ...validateLayoutScales(raw, issues),
    ...validateComponentScales(raw, issues),
    paint: { light, dark },
  };
}

function warnAboutContrast(tokens: FacetThemeTokens, issues: IssueList): void {
  for (const mode of ["light", "dark"] as const) {
    const colors = tokens.paint[mode].color;
    for (const [foregroundName, backgroundName] of CONTRAST_PAIRS) {
      const foregroundValue = colors[foregroundName];
      const backgroundValue = colors[backgroundName];
      if (typeof foregroundValue !== "string" || typeof backgroundValue !== "string") continue;
      const foreground = parseSrgb(foregroundValue);
      const background = parseSrgb(backgroundValue);
      if (foreground === undefined || background === undefined) continue;
      const ratio = contrastRatio(foreground, background);
      if (ratio >= MIN_CONTRAST) continue;
      issues.push({
        severity: "warning",
        message:
          `theme.tokens.paint.${mode}.color.${foregroundName} / ` +
          `${backgroundName} contrast ${ratio.toFixed(2)} is below ${String(MIN_CONTRAST)}`,
      });
    }
  }
}

function validateDefaults(raw: unknown, issues: IssueList): BrickStyleDefinitionMap {
  const output = nullMap<unknown>();
  if (!isPlainObject(raw)) {
    error(issues, "theme.defaults is missing or not an object");
    return output as unknown as BrickStyleDefinitionMap;
  }
  rejectUnknownKeys(raw, new Set(BRICK_TYPES), "theme.defaults", issues);
  for (const brick of BRICK_TYPES) {
    if (!Object.prototype.hasOwnProperty.call(raw, brick)) {
      error(issues, `theme.defaults.${brick} is missing`);
      continue;
    }
    output[brick] = validateThemeStyle(raw[brick], brick, true, `theme.defaults.${brick}`, issues);
  }
  return output as unknown as BrickStyleDefinitionMap;
}

function validatePreset<B extends BrickType>(
  raw: unknown,
  brick: B,
  path: string,
  issues: IssueList,
): FacetPreset<B> | undefined {
  if (!isPlainObject(raw)) {
    error(issues, `${path} is not an object`);
    return undefined;
  }
  rejectUnknownKeys(raw, new Set(["description", "useWhen", "avoidWhen", "style"]), path, issues);
  const description = prose(raw.description, `${path}.description`, true, issues);
  const useWhen = prose(raw.useWhen, `${path}.useWhen`, true, issues);
  const avoidWhen = prose(raw.avoidWhen, `${path}.avoidWhen`, false, issues);
  const style = validateThemeStyle(raw.style, brick, false, `${path}.style`, issues);
  if (description === undefined || useWhen === undefined) return undefined;
  return avoidWhen === undefined
    ? { description, useWhen, style }
    : { description, useWhen, avoidWhen, style };
}

function validatePresets(raw: unknown, issues: IssueList): FacetPresets | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    error(issues, "theme.presets is not an object");
    return undefined;
  }
  rejectUnknownKeys(raw, new Set(BRICK_TYPES), "theme.presets", issues);
  const output = nullMap<Readonly<Record<string, FacetPreset<BrickType>>>>();
  let total = 0;
  for (const brick of BRICK_TYPES) {
    if (!Object.prototype.hasOwnProperty.call(raw, brick)) continue;
    const rawBrick = raw[brick];
    if (!isPlainObject(rawBrick)) {
      error(issues, `theme.presets.${brick} is not an object`);
      continue;
    }
    const names = Object.keys(rawBrick);
    total += names.length;
    if (names.length > MAX_PRESETS_PER_BRICK) {
      error(issues, `theme.presets.${brick} exceeds ${MAX_PRESETS_PER_BRICK} Presets`);
    }
    const presets = nullMap<FacetPreset<BrickType>>();
    for (const name of names) {
      if (isForbiddenKey(name) || !SLOT_NAME_RE.test(name)) {
        error(issues, `theme.presets.${brick} has malformed Preset name "${printableKey(name)}"`);
        continue;
      }
      const validated = validatePreset(
        rawBrick[name],
        brick,
        `theme.presets.${brick}.${name}`,
        issues,
      );
      if (validated !== undefined) presets[name] = validated;
    }
    output[brick] = presets;
  }
  if (total > MAX_PRESETS_TOTAL)
    error(issues, `theme.presets exceeds ${MAX_PRESETS_TOTAL} total Presets`);
  return output as FacetPresets;
}

function validateThemeInner(input: unknown): ThemeValidationResult {
  const issues = new IssueList();
  if (!isPlainObject(input)) {
    error(issues, "theme document is not an object");
    return { issues: issues.list };
  }
  rejectUnknownKeys(
    input,
    new Set(["name", "description", "tokens", "defaults", "presets"]),
    "theme",
    issues,
  );
  const name = input.name;
  if (typeof name !== "string" || !isValidThemeName(name)) {
    error(issues, "theme name is missing or malformed");
  }
  const description = prose(input.description, "theme.description", false, issues);
  const tokens = validateTokens(input.tokens, issues);
  const defaults = validateDefaults(input.defaults, issues);
  const presets = validatePresets(input.presets, issues);
  if (issues.hasError || typeof name !== "string" || !isValidThemeName(name)) {
    return { issues: issues.list };
  }
  warnAboutContrast(tokens, issues);
  const theme: FacetTheme = { name, tokens, defaults };
  if (description !== undefined) (theme as { description?: string }).description = description;
  if (presets !== undefined) (theme as { presets?: FacetPresets }).presets = presets;
  return { theme, issues: issues.list };
}

/** Never-throw, whole-document Theme gate. No value is clamped or partially retained. */
export function validateTheme(input: unknown): ThemeValidationResult {
  try {
    return validateThemeInner(input);
  } catch {
    return { issues: [{ severity: "error", message: "theme document threw during validation" }] };
  }
}
