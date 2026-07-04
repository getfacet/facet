import type { CSSProperties } from "react";
import {
  COLORS,
  DEFAULT_COLORS,
  FONT_SIZES,
  FONT_WEIGHTS,
  RADII,
  RATIOS,
  SPACES,
} from "@facet/core";
import type {
  Align,
  BoxStyle,
  Color,
  FacetTheme,
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
 * The palette — token NAMES → hex, on a null prototype (like the other groups).
 * The VALUES live in `@facet/core`'s `DEFAULT_COLORS` (the single source of truth,
 * shared with the core contrast check); this map re-homes them null-proto and is
 * itself re-exported so app chrome (e.g. `ChatDock`) reuses them instead of
 * re-hardcoding hex.
 */
export const COLOR: Record<Color, string> = Object.assign(
  Object.create(null) as Record<Color, string>,
  DEFAULT_COLORS,
);

const RATIO: Record<Ratio, string> = Object.assign(Object.create(null) as Record<Ratio, string>, {
  square: "1 / 1",
  wide: "16 / 9",
  tall: "3 / 4",
} satisfies Record<Ratio, string>);

/**
 * A fully-resolved theme: every token group is a complete null-proto map, so a
 * style fn can index any token name and either land on the operator's override
 * or fall through to the default value (never `undefined` for a valid token,
 * never an inherited prototype value for a hostile one).
 */
export interface ResolvedTheme {
  readonly space: Record<Space, string>;
  readonly fontSize: Record<FontSize, string>;
  readonly fontWeight: Record<FontWeight, number>;
  readonly radius: Record<Radius, string>;
  readonly color: Record<Color, string>;
  readonly ratio: Record<Ratio, string>;
}

/**
 * The default resolved theme — today's exact values. Every zero-extra-arg style
 * call defaults to this map, so output stays byte-identical to the pre-theme
 * renderer. `COLOR` above aliases `DEFAULT_RESOLVED.color`.
 */
const DEFAULT_RESOLVED: ResolvedTheme = {
  space: SPACE,
  fontSize: FONT_SIZE,
  fontWeight: FONT_WEIGHT,
  radius: RADIUS,
  color: COLOR,
  ratio: RATIO,
};

/**
 * The default theme expressed as an operator DOCUMENT (the `@facet/core`
 * `FacetTheme` shape): token NAMES → today's concrete values, across all six
 * groups. It passes `validateTheme` cleanly, so operators can copy it as the
 * starting point for a reskin, and hosts can register it by name.
 */
export const DEFAULT_THEME: FacetTheme = {
  name: "default",
  color: COLOR,
  space: SPACE,
  fontSize: FONT_SIZE,
  fontWeight: FONT_WEIGHT,
  radius: RADIUS,
  ratio: RATIO,
};

/**
 * Overlays one theme group's overrides onto a clone of the default group. Only
 * OWN keys that are members of the token-group array and hold a primitive of the
 * expected type are copied — iterating `members` (not the override's own keys)
 * means a hostile key like `__proto__`/`constructor` is never even looked up,
 * and the null-proto clone is re-established here because a JSON round trip (the
 * boot-shipped shell → `JSON.parse`) restores an ordinary prototype (DC-011).
 */
function overlayGroup<V>(
  base: Record<string, V>,
  override: unknown,
  members: readonly string[],
  primitive: "string" | "number",
): Record<string, V> {
  const out: Record<string, V> = Object.assign(Object.create(null) as Record<string, V>, base);
  if (typeof override !== "object" || override === null) return out;
  for (const key of members) {
    if (!Object.prototype.hasOwnProperty.call(override, key)) continue;
    const value = (override as Record<string, unknown>)[key];
    if (typeof value === primitive) out[key] = value as V;
  }
  return out;
}

/**
 * Resolves a theme NAME (from `tree.theme`, treated as `unknown` — the live
 * patch path can put junk there) against an operator-authored `themes` registry
 * into a full `ResolvedTheme`. A non-string/missing/unknown name returns the
 * shared default constant (zero allocation on the common path). This is a PURE
 * lookup — the browser writes no stage state (invariant #6). `validateTheme`
 * remains the security boundary; hosts validate documents before passing them,
 * and this fn floor-guards the lookup regardless (DC-002, DC-011).
 */
export function resolveTheme(name: unknown, themes?: readonly FacetTheme[]): ResolvedTheme {
  if (typeof name !== "string" || themes === undefined) return DEFAULT_RESOLVED;
  const doc = themes.find((t) => (t as { name?: unknown } | null)?.name === name);
  if (doc === undefined) return DEFAULT_RESOLVED;
  return {
    space: overlayGroup(SPACE, doc.space, SPACES, "string"),
    fontSize: overlayGroup(FONT_SIZE, doc.fontSize, FONT_SIZES, "string"),
    fontWeight: overlayGroup(FONT_WEIGHT, doc.fontWeight, FONT_WEIGHTS, "number"),
    radius: overlayGroup(RADIUS, doc.radius, RADII, "string"),
    color: overlayGroup(COLOR, doc.color, COLORS, "string"),
    ratio: overlayGroup(RATIO, doc.ratio, RATIOS, "string"),
  };
}

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

// The one concrete scroll-region height — a renderer constant, not a theme
// token (RISK-API-5): agents say `scroll: true`, never a number.
const SCROLL_MAX_HEIGHT = "20rem";

/**
 * Note: `appear` is renderer-bound — the class name and the once-per-stage
 * `<style>` element live in `StageRenderer` (via the internal `appear.ts`),
 * not in this token→CSS map, so direct `boxStyle` consumers see no
 * animation CSS here (RISK-API-2).
 */
export function boxStyle(
  style: BoxStyle = {},
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = {
    display: "flex",
    flexDirection: style.direction === "row" ? "row" : "column",
    boxSizing: "border-box",
  };
  if (style.gap) css.gap = theme.space[style.gap];
  if (style.pad) css.padding = theme.space[style.pad];
  if (style.align) css.alignItems = alignValue(style.align);
  if (style.justify) css.justifyContent = justifyValue(style.justify);
  if (style.wrap) css.flexWrap = "wrap";
  if (style.bg) css.background = theme.color[style.bg];
  if (style.radius) css.borderRadius = theme.radius[style.radius];
  if (style.border) css.border = `1px solid ${theme.color.border}`;
  if (style.grow) css.flexGrow = 1;
  if (style.width === "full") css.width = "100%";
  // Literal `true` only (total-function pattern on the raw live path — any
  // other value maps to no CSS): a bounded, vertically scrollable region.
  // Never overflow-x (RISK-INV-6a); the `minHeight: 0` is load-bearing — a
  // flex child defaults to `min-height: auto` and would silently refuse to
  // clip inside a `grow` column without it.
  if (style.scroll === true) {
    css.overflowY = "auto";
    css.overflowX = "hidden";
    css.maxHeight = SCROLL_MAX_HEIGHT;
    css.minHeight = 0;
  }
  return css;
}

export function textStyle(
  style: TextStyle = {},
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = { margin: 0 };
  if (style.size) css.fontSize = theme.fontSize[style.size];
  if (style.weight) css.fontWeight = theme.fontWeight[style.weight];
  if (style.color) css.color = theme.color[style.color];
  if (style.align) {
    css.textAlign = style.align === "start" ? "left" : style.align === "end" ? "right" : "center";
  }
  return css;
}

export function imageStyle(
  style: ImageStyle = {},
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = { display: "block", objectFit: "cover" };
  if (style.radius) css.borderRadius = theme.radius[style.radius];
  if (style.width === "full") css.width = "100%";
  if (style.ratio) css.aspectRatio = theme.ratio[style.ratio];
  return css;
}

// fieldStyle uses no themed token today (only the width sizing keyword), but
// keeps the trailing theme parameter for call-site symmetry with the other three
// and so a future themed field affordance is a non-breaking addition.
export function fieldStyle(
  style: FieldStyle = {},
  _theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = {};
  if (style.width === "full") css.width = "100%";
  return css;
}
