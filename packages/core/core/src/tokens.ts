/**
 * Style tokens — the bounded vocabulary an agent may use for styling bricks.
 *
 * Values are TOKEN NAMES, never raw scalars (no `padding: 23`, no `color:
 * "#abc"`). This is what lets an agent style freely yet always land on a
 * coherent scale: any token choice is, by construction, a good-looking one. The
 * renderer (a theme) maps these names to concrete CSS. Token names are kept
 * compatible-in-spirit with the W3C Design Tokens (DTCG) format so a theme can
 * be expressed as a DTCG token file later.
 *
 * Each token group is a runtime array (the single source of truth) with its type
 * derived from it, so validators can check membership and types stay in sync.
 */

/** Spacing scale (gap, padding). */
export const SPACES = ["none", "xs", "sm", "md", "lg", "xl", "2xl"] as const;
export type Space = (typeof SPACES)[number];

/** Font size scale. */
export const FONT_SIZES = [
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
] as const;
export type FontSize = (typeof FONT_SIZES)[number];

/** Font family scale. */
export const FONT_FAMILIES = ["sans", "serif", "mono"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const FONT_WEIGHTS = ["regular", "medium", "semibold", "bold"] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const RADII = ["none", "sm", "md", "lg", "full"] as const;
export type Radius = (typeof RADII)[number];

/** Semantic color tokens — meaning, not hex. The theme decides the actual hue. */
export const COLORS = [
  "fg",
  "fg-muted",
  "bg",
  "surface",
  "surface-2",
  "accent",
  "accent-fg",
  "border",
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
] as const;
export type Color = (typeof COLORS)[number];

/** Shadow elevation tokens. Concrete box-shadow values live in a theme. */
export const SHADOWS = ["none", "sm", "md", "lg"] as const;
export type Shadow = (typeof SHADOWS)[number];

/** Flow direction. There is no absolute positioning — only flow layout. */
export const DIRECTIONS = ["row", "col"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Cross-axis alignment. */
export const ALIGNS = ["start", "center", "end", "stretch"] as const;
export type Align = (typeof ALIGNS)[number];

/** Main-axis distribution. */
export const JUSTIFIES = ["start", "center", "end", "between", "around"] as const;
export type Justify = (typeof JUSTIFIES)[number];

export const TEXT_ALIGNS = ["start", "center", "end"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** Bounded sizing — never arbitrary widths, so nothing overflows the viewport. */
export const SIZINGS = ["auto", "full"] as const;
export type Sizing = (typeof SIZINGS)[number];

export const RATIOS = ["square", "wide", "tall"] as const;
export type Ratio = (typeof RATIOS)[number];

/** Scroll axes for bounded internal scroll regions. */
export const SCROLL_AXES = ["x", "y"] as const;
export type ScrollAxis = (typeof SCROLL_AXES)[number];

/** Numeric column-count tokens for flow-safe grids. */
export const COLUMNS = [2, 3, 4] as const;
export type Columns = (typeof COLUMNS)[number];

/**
 * Enter animation for a box, replayed on each mount/re-show of the node. The
 * token names the motion only — the renderer owns duration and curve as
 * framework constants.
 */
export const APPEARS = ["none", "fade", "slide"] as const;
export type Appear = (typeof APPEARS)[number];

/**
 * Minimum-height scale for landing-grade sections. Concrete lengths (e.g.
 * `50svh`/`100svh`) live in a theme — the tree carries only the token name.
 */
export const MIN_HEIGHTS = ["auto", "half", "screen"] as const;
export type MinHeight = (typeof MIN_HEIGHTS)[number];

/**
 * Bounded max-width scale for readable content columns. Concrete lengths live
 * in a theme; layout stays flow-only and never overflows the viewport.
 */
export const MAX_WIDTHS = ["none", "prose", "narrow", "wide"] as const;
export type MaxWidth = (typeof MAX_WIDTHS)[number];

/** Letter-spacing (tracking) scale for text. Concrete values live in a theme. */
export const TRACKINGS = ["tight", "normal", "wide"] as const;
export type Tracking = (typeof TRACKINGS)[number];

/** Line-height (leading) scale for text. Concrete values live in a theme. */
export const LEADINGS = ["tight", "normal", "relaxed"] as const;
export type Leading = (typeof LEADINGS)[number];

/**
 * Named background gradients for a box. The theme maps each name to a concrete
 * CSS gradient — no raw gradient string ever enters the tree.
 */
export const GRADIENTS = ["none", "accent", "dusk", "dawn"] as const;
export type Gradient = (typeof GRADIENTS)[number];

/**
 * Scrim overlay strength painted over a box's backdrop layer so foreground text
 * stays legible. The theme owns the concrete overlay color/opacity.
 */
export const SCRIMS = ["none", "light", "dark"] as const;
export type Scrim = (typeof SCRIMS)[number];

/**
 * Authored color-scheme selection for a box subtree — a dark/light SECTION the
 * agent draws (`BoxStyle.scheme`). Deliberately DISTINCT from view-state's
 * `Scheme` in `view.ts`, which is the browser-REPORTED device preference: that
 * one is report-only inert event data that must never drive layout, this one is
 * an authored layout token that intentionally does. Same `["light","dark"]`
 * values, separate types so the two concepts can never be conflated (a future
 * edit wiring the device signal into the palette swap would be a type mismatch).
 */
export const COLOR_SCHEMES = ["light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/**
 * Text highlight treatment (decoration/background behind a text run). The theme
 * owns the concrete decoration — the tree carries only the token name.
 */
export const HIGHLIGHTS = ["none", "accent", "band"] as const;
export type Highlight = (typeof HIGHLIGHTS)[number];
