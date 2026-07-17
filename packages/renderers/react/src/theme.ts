import type { CSSProperties } from "react";
import { validateTheme } from "@facet/core";
import type {
  Alignment,
  AspectRatio,
  BorderWidth,
  BoxStyle,
  BrickStyleDefinitionMap,
  ChartThickness,
  Color,
  ColorMode,
  ControlHeight,
  FacetPresets,
  FacetTheme,
  FontFamily,
  FontSize,
  FontWeight,
  Gradient,
  Highlight,
  IndicatorSize,
  InputStyle,
  Justification,
  LetterSpacing,
  LineHeight,
  MaxWidth,
  MediaStyle,
  MinHeight,
  ProgressThickness,
  Radius,
  Scrim,
  Shadow,
  Space,
  TextStyle,
} from "@facet/core";
import { DEFAULT_THEME } from "@facet/assets";
import { rootContainmentStyle, scrollContainmentStyle, stickyStyle } from "./layout-contract.js";
import { projectSurface, projectTypography } from "./style-projection.js";

export { DEFAULT_THEME };

/** Default light paint map retained for renderer-owned chrome such as ChatDock. */
export const COLOR = DEFAULT_THEME.tokens.paint.light.color;

/** One complete Theme with exactly one effective light/dark paint branch. */
export interface ResolvedTheme {
  readonly name: string;
  readonly description?: string;
  readonly colorMode: ColorMode;
  readonly space: Readonly<Record<Space, string>>;
  readonly fontSize: Readonly<Record<FontSize, string>>;
  readonly fontFamily: Readonly<Record<FontFamily, string>>;
  readonly fontWeight: Readonly<Record<FontWeight, number>>;
  readonly radius: Readonly<Record<Radius, string>>;
  readonly borderWidth: Readonly<Record<BorderWidth, string>>;
  readonly aspectRatio: Readonly<Record<AspectRatio, string>>;
  readonly minHeight: Readonly<Record<MinHeight, string>>;
  readonly maxWidth: Readonly<Record<MaxWidth, string>>;
  readonly letterSpacing: Readonly<Record<LetterSpacing, string>>;
  readonly lineHeight: Readonly<Record<LineHeight, string>>;
  readonly controlHeight: Readonly<Record<ControlHeight, string>>;
  readonly indicatorSize: Readonly<Record<IndicatorSize, string>>;
  readonly progressThickness: Readonly<Record<ProgressThickness, string>>;
  readonly chartThickness: Readonly<Record<ChartThickness, string>>;
  readonly color: Readonly<Record<Color, string>>;
  readonly shadow: Readonly<Record<Shadow, string>>;
  readonly gradient: Readonly<Record<Gradient, string>>;
  readonly scrim: Readonly<Record<Scrim, string>>;
  readonly highlight: Readonly<Record<Highlight, string>>;
  readonly defaults: BrickStyleDefinitionMap;
  readonly presets?: FacetPresets;
}

const defaultValidation = validateTheme(DEFAULT_THEME);
const VALID_DEFAULT_THEME = defaultValidation.theme ?? DEFAULT_THEME;

function effectiveTheme(raw: unknown): FacetTheme {
  if (raw === undefined || raw === DEFAULT_THEME) return VALID_DEFAULT_THEME;
  return validateTheme(raw).theme ?? VALID_DEFAULT_THEME;
}

/**
 * Validate a singular complete Theme and select one paint branch. Invalid input
 * falls back whole; no custom fragment is overlaid onto the bundled Theme.
 */
export function resolveTheme(raw?: unknown, rawColorMode: unknown = "light"): ResolvedTheme {
  const theme = effectiveTheme(raw);
  const colorMode: ColorMode = rawColorMode === "dark" ? "dark" : "light";
  const paint = theme.tokens.paint[colorMode];
  const resolved: ResolvedTheme = {
    name: theme.name,
    colorMode,
    space: theme.tokens.space,
    fontSize: theme.tokens.fontSize,
    fontFamily: theme.tokens.fontFamily,
    fontWeight: theme.tokens.fontWeight,
    radius: theme.tokens.radius,
    borderWidth: theme.tokens.borderWidth,
    aspectRatio: theme.tokens.aspectRatio,
    minHeight: theme.tokens.minHeight,
    maxWidth: theme.tokens.maxWidth,
    letterSpacing: theme.tokens.letterSpacing,
    lineHeight: theme.tokens.lineHeight,
    controlHeight: theme.tokens.controlHeight,
    indicatorSize: theme.tokens.indicatorSize,
    progressThickness: theme.tokens.progressThickness,
    chartThickness: theme.tokens.chartThickness,
    color: paint.color,
    shadow: paint.shadow,
    gradient: paint.gradient,
    scrim: paint.scrim,
    highlight: paint.highlight,
    defaults: theme.defaults,
  };
  if (theme.description !== undefined)
    (resolved as { description?: string }).description = theme.description;
  if (theme.presets !== undefined) (resolved as { presets?: FacetPresets }).presets = theme.presets;
  return resolved;
}

const DEFAULT_RESOLVED = resolveTheme();

function alignValue(align: Alignment): CSSProperties["alignItems"] {
  return align === "start" ? "flex-start" : align === "end" ? "flex-end" : align;
}

function justifyValue(justify: Justification): CSSProperties["justifyContent"] {
  if (justify === "start") return "flex-start";
  if (justify === "end") return "flex-end";
  if (justify === "between") return "space-between";
  if (justify === "around") return "space-around";
  return "center";
}

/** Root box mapping retained as a small public helper; target mappings live in role modules. */
export function boxStyle(
  style: BoxStyle = {},
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const isGrid = style.columns === 2 || style.columns === 3 || style.columns === 4;
  const css: CSSProperties = isGrid
    ? { display: "grid", gridTemplateColumns: `repeat(${String(style.columns)},minmax(0,1fr))` }
    : { display: "flex", flexDirection: style.direction ?? "column" };
  if (style.gap !== undefined) css.gap = theme.space[style.gap];
  if (style.padding !== undefined) css.padding = theme.space[style.padding];
  if (style.alignItems !== undefined) css.alignItems = alignValue(style.alignItems);
  if (style.justifyContent !== undefined) css.justifyContent = justifyValue(style.justifyContent);
  if (!isGrid && style.wrap === true) css.flexWrap = "wrap";
  Object.assign(css, projectSurface(style, theme));
  if (style.backgroundGradient !== undefined)
    css.backgroundImage = theme.gradient[style.backgroundGradient];
  if (style.grow === true) css.flexGrow = 1;
  if (style.width === "full") css.width = "100%";
  if (style.minHeight !== undefined) css.minHeight = theme.minHeight[style.minHeight];
  if (style.maxWidth !== undefined) {
    css.maxWidth = theme.maxWidth[style.maxWidth];
    if (style.maxWidth !== "none") css.marginInline = "auto";
  }
  if (style.sticky === true) Object.assign(css, stickyStyle());
  if (style.scroll === "horizontal") Object.assign(css, scrollContainmentStyle("x"));
  else if (style.scroll === "vertical") Object.assign(css, scrollContainmentStyle("y"));
  return rootContainmentStyle(css);
}

/** Root typography mapping retained for direct consumers and semantic render helpers. */
export function textStyle(
  style: TextStyle = {},
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = {
    margin: 0,
    wordBreak: "break-word",
    ...projectTypography(style, theme),
  };
  if (css.fontFamily === undefined) css.fontFamily = theme.fontFamily.sans;
  return rootContainmentStyle(css);
}

export function mediaStyle(
  style: MediaStyle = {},
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = { display: "block", height: "auto" };
  if (style.objectFit !== undefined) css.objectFit = style.objectFit;
  if (style.objectPosition !== undefined) css.objectPosition = style.objectPosition;
  if (style.borderRadius !== undefined) css.borderRadius = theme.radius[style.borderRadius];
  if (style.width === "full") css.width = "100%";
  if (style.aspectRatio !== undefined) css.aspectRatio = theme.aspectRatio[style.aspectRatio];
  return rootContainmentStyle(css);
}

export function fieldStyle(
  style: InputStyle = {},
  _theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = {};
  if (style.width === "full") css.width = "100%";
  if (style.direction !== undefined) css.flexDirection = style.direction;
  if (style.gap !== undefined) css.gap = _theme.space[style.gap];
  if (style.alignItems !== undefined) css.alignItems = alignValue(style.alignItems);
  return rootContainmentStyle(css);
}

export function markLookCss(
  kinds: readonly string[],
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = {};
  const decorations: string[] = [];
  for (const kind of kinds) {
    if (kind === "bold") css.fontWeight = theme.fontWeight.bold;
    else if (kind === "italic") css.fontStyle = "italic";
    else if (kind === "underline") decorations.push("underline");
    else if (kind === "strike") decorations.push("line-through");
    else if (kind === "code") {
      css.fontFamily = theme.fontFamily.mono;
      css.background = theme.color.mutedSurface;
      css.borderRadius = theme.radius.sm;
      css.padding = "0.1em 0.3em";
    } else if (kind === "link") {
      css.color = theme.color.accent;
      decorations.push("underline");
    }
  }
  if (decorations.length > 0) css.textDecorationLine = [...new Set(decorations)].join(" ");
  return css;
}

export function headingTag(level: number): "h1" | "h2" | "h3" {
  const clamped = Number.isFinite(level) ? Math.min(3, Math.max(1, Math.round(level))) : 1;
  return clamped === 1 ? "h1" : clamped === 2 ? "h2" : "h3";
}

export function headingLookCss(
  level: number,
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const tag = headingTag(level);
  const size: FontSize = tag === "h1" ? "2xl" : tag === "h2" ? "xl" : "lg";
  const weight: FontWeight = tag === "h3" ? "semibold" : "bold";
  return { fontSize: theme.fontSize[size], fontWeight: theme.fontWeight[weight] };
}

export const RENDER_MAX_LIST_DEPTH = 5;

export function listIndentCss(
  depth: number,
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const clamped = Number.isFinite(depth)
    ? Math.min(RENDER_MAX_LIST_DEPTH, Math.max(0, Math.round(depth)))
    : 0;
  return clamped <= 0 ? {} : { marginInlineStart: `calc(${theme.space.lg} * ${clamped})` };
}

export function quoteLookCss(theme: ResolvedTheme = DEFAULT_RESOLVED): CSSProperties {
  return {
    borderInlineStart: `${theme.borderWidth.medium} solid ${theme.color.border}`,
    paddingInlineStart: theme.space.md,
    color: theme.color.mutedForeground,
  };
}
