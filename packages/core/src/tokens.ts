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
export const FONT_SIZES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;
export type FontSize = (typeof FONT_SIZES)[number];

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
  "success",
  "warning",
  "danger",
] as const;
export type Color = (typeof COLORS)[number];

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

/**
 * Enter animation for a box, replayed on each mount/re-show of the node. The
 * token names the motion only — the theme owns duration and curve.
 */
export const APPEARS = ["none", "fade", "slide"] as const;
export type Appear = (typeof APPEARS)[number];
