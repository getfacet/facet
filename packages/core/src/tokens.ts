/**
 * Style tokens — the bounded vocabulary an agent may use for styling bricks.
 *
 * Values are TOKEN NAMES, never raw scalars (no `padding: 23`, no `color:
 * "#abc"`). This is what lets the agent style freely yet always land on a
 * coherent scale: any token choice is, by construction, a good-looking one. The
 * renderer (a theme) maps these names to concrete CSS. Token names are kept
 * compatible-in-spirit with the W3C Design Tokens (DTCG) format so a theme can
 * be expressed as a DTCG token file later.
 */

/** Spacing scale (gap, padding). */
export type Space = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

/** Font size scale. */
export type FontSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

export type FontWeight = "regular" | "medium" | "semibold" | "bold";

export type Radius = "none" | "sm" | "md" | "lg" | "full";

/** Semantic color tokens — meaning, not hex. The theme decides the actual hue. */
export type Color =
  | "fg"
  | "fg-muted"
  | "bg"
  | "surface"
  | "surface-2"
  | "accent"
  | "accent-fg"
  | "border"
  | "success"
  | "warning"
  | "danger";

/** Flow direction. There is no absolute positioning — only flow layout. */
export type Direction = "row" | "col";

/** Cross-axis alignment. */
export type Align = "start" | "center" | "end" | "stretch";

/** Main-axis distribution. */
export type Justify = "start" | "center" | "end" | "between" | "around";

export type TextAlign = "start" | "center" | "end";

/** Bounded sizing — never arbitrary widths, so nothing overflows the viewport. */
export type Sizing = "auto" | "full";

export type Ratio = "square" | "wide" | "tall";
