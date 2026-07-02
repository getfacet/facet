import type { CSSProperties } from "react";
import type {
  Align,
  BoxStyle,
  Color,
  FieldStyle,
  FontSize,
  FontWeight,
  ImageStyle,
  Justify,
  Radius,
  Ratio,
  Space,
  TextStyle,
} from "@facet/core";

/**
 * The default theme — where token NAMES become concrete CSS values. This is the
 * one place pixels and hex codes live; the agent never sees them. Swap this map
 * to reskin every Facet page without touching a single agent.
 */
// Agents emit token NAMES that index straight into these maps, so the maps are
// built on a null prototype: a hostile token like "constructor" or "__proto__"
// then resolves to `undefined` instead of an inherited prototype value that
// would land in the CSS. The `satisfies Record<...>` on each source literal
// keeps the exhaustiveness check (a missing or typo'd key is a compile error);
// the outer `Object.assign` return type would otherwise erase it.
const SPACE: Record<Space, string> = Object.assign(Object.create(null) as Record<Space, string>, {
  none: "0",
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "40px",
  "2xl": "64px",
} satisfies Record<Space, string>);

const FONT_SIZE: Record<FontSize, string> = Object.assign(
  Object.create(null) as Record<FontSize, string>,
  {
    xs: "12px",
    sm: "14px",
    md: "16px",
    lg: "20px",
    xl: "28px",
    "2xl": "36px",
    "3xl": "48px",
  } satisfies Record<FontSize, string>,
);

const FONT_WEIGHT: Record<FontWeight, number> = Object.assign(
  Object.create(null) as Record<FontWeight, number>,
  {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  } satisfies Record<FontWeight, number>,
);

const RADIUS: Record<Radius, string> = Object.assign(
  Object.create(null) as Record<Radius, string>,
  {
    none: "0",
    sm: "6px",
    md: "10px",
    lg: "16px",
    full: "9999px",
  } satisfies Record<Radius, string>,
);

/**
 * The palette — token NAMES → hex. Exported as the single source of truth so
 * app chrome (e.g. `ChatDock`) reuses these values instead of re-hardcoding hex.
 */
export const COLOR: Record<Color, string> = Object.assign(
  Object.create(null) as Record<Color, string>,
  {
    fg: "#1a1d23",
    "fg-muted": "#6b7280",
    bg: "#ffffff",
    surface: "#f6f7f9",
    "surface-2": "#eceef1",
    accent: "#4f46e5",
    "accent-fg": "#ffffff",
    border: "#e2e5ea",
    success: "#16a34a",
    warning: "#d97706",
    danger: "#dc2626",
  } satisfies Record<Color, string>,
);

const RATIO: Record<Ratio, string> = Object.assign(Object.create(null) as Record<Ratio, string>, {
  square: "1 / 1",
  wide: "16 / 9",
  tall: "3 / 4",
} satisfies Record<Ratio, string>);

function alignValue(align: Align): CSSProperties["alignItems"] {
  switch (align) {
    case "start":
      return "flex-start";
    case "end":
      return "flex-end";
    case "center":
      return "center";
    case "stretch":
      return "stretch";
  }
}

function justifyValue(justify: Justify): CSSProperties["justifyContent"] {
  switch (justify) {
    case "start":
      return "flex-start";
    case "end":
      return "flex-end";
    case "center":
      return "center";
    case "between":
      return "space-between";
    case "around":
      return "space-around";
  }
}

export function boxStyle(style: BoxStyle = {}): CSSProperties {
  const css: CSSProperties = {
    display: "flex",
    flexDirection: style.direction === "row" ? "row" : "column",
    boxSizing: "border-box",
  };
  if (style.gap) css.gap = SPACE[style.gap];
  if (style.pad) css.padding = SPACE[style.pad];
  if (style.align) css.alignItems = alignValue(style.align);
  if (style.justify) css.justifyContent = justifyValue(style.justify);
  if (style.wrap) css.flexWrap = "wrap";
  if (style.bg) css.background = COLOR[style.bg];
  if (style.radius) css.borderRadius = RADIUS[style.radius];
  if (style.border) css.border = `1px solid ${COLOR.border}`;
  if (style.grow) css.flexGrow = 1;
  if (style.width === "full") css.width = "100%";
  return css;
}

export function textStyle(style: TextStyle = {}): CSSProperties {
  const css: CSSProperties = { margin: 0 };
  if (style.size) css.fontSize = FONT_SIZE[style.size];
  if (style.weight) css.fontWeight = FONT_WEIGHT[style.weight];
  if (style.color) css.color = COLOR[style.color];
  if (style.align) {
    css.textAlign = style.align === "start" ? "left" : style.align === "end" ? "right" : "center";
  }
  return css;
}

export function imageStyle(style: ImageStyle = {}): CSSProperties {
  const css: CSSProperties = { display: "block", objectFit: "cover" };
  if (style.radius) css.borderRadius = RADIUS[style.radius];
  if (style.width === "full") css.width = "100%";
  if (style.ratio) css.aspectRatio = RATIO[style.ratio];
  return css;
}

export function fieldStyle(style: FieldStyle = {}): CSSProperties {
  const css: CSSProperties = {};
  if (style.width === "full") css.width = "100%";
  return css;
}
