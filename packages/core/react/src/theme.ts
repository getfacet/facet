import type { CSSProperties } from "react";
import {
  COLORS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  RADII,
  RATIOS,
  RECIPE_COMPONENTS,
  SHADOWS,
  SPACES,
} from "@facet/core";
import type {
  Align,
  BoxStyle,
  Color,
  ComponentRecipe,
  ComponentRecipes,
  FacetTheme,
  FieldStyle,
  FontFamily,
  FontSize,
  FontWeight,
  Justify,
  MediaStyle,
  Radius,
  Ratio,
  RecipeComponentName,
  Shadow,
  Space,
  TextStyle,
} from "@facet/core";
// The default token VALUES live in `@facet/assets` (node-free, deps = core) — the
// SINGLE source of default-theme truth. react imports them as its render floor and
// re-exports `DEFAULT_THEME` + `COLOR` for back-compat, but owns no second copy
// that could drift (RISK-INV-1 / RISK-API-2).
import {
  COLOR,
  DEFAULT_THEME,
  FONT_FAMILY,
  FONT_SIZE,
  FONT_WEIGHT,
  RADIUS,
  RATIO,
  SHADOW as DEFAULT_SHADOW,
  SPACE,
} from "@facet/assets";

export { COLOR, DEFAULT_THEME };

/**
 * A fully-resolved theme: every token group is a complete null-proto map, so a
 * style fn can index any token name and either land on the operator's override
 * or fall through to the default value (never `undefined` for a valid token,
 * never an inherited prototype value for a hostile one).
 */
export interface ResolvedTheme {
  readonly space: Record<Space, string>;
  readonly fontFamily: Record<FontFamily, string>;
  readonly fontSize: Record<FontSize, string>;
  readonly fontWeight: Record<FontWeight, number>;
  readonly radius: Record<Radius, string>;
  readonly color: Record<Color, string>;
  readonly ratio: Record<Ratio, string>;
  readonly shadow: Record<Shadow, string>;
  readonly recipes?: ComponentRecipes;
}

const MAX_RECIPE_VARIANTS = 64;

function safeObjectKeys(value: object): readonly string[] {
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}

function mergeRecipes(override: unknown): ComponentRecipes | undefined {
  const defaults = DEFAULT_THEME.recipes;
  const out: Partial<Record<RecipeComponentName, Readonly<Record<string, ComponentRecipe>>>> =
    Object.create(null) as Partial<
      Record<RecipeComponentName, Readonly<Record<string, ComponentRecipe>>>
    >;
  const hasOverride = isObjectRecord(override);
  for (const component of RECIPE_COMPONENTS) {
    const baseVariants = isObjectRecord(defaults?.[component]) ? defaults[component] : undefined;
    const overrideVariants =
      hasOverride && isObjectRecord(override[component]) ? override[component] : undefined;
    if (baseVariants === undefined && overrideVariants === undefined) continue;
    const variants: Record<string, ComponentRecipe> = Object.assign(
      Object.create(null) as Record<string, ComponentRecipe>,
      baseVariants,
    );
    if (overrideVariants !== undefined) {
      for (const name of safeObjectKeys(overrideVariants).slice(0, MAX_RECIPE_VARIANTS)) {
        const recipe = overrideVariants[name];
        if (!isObjectRecord(recipe)) continue;
        variants[name] = mergeComponentRecipe(variants[name], recipe);
      }
    }
    out[component] = variants;
  }
  return Object.keys(out).length > 0 ? (out as ComponentRecipes) : undefined;
}

function mergeComponentRecipe(
  base: ComponentRecipe | undefined,
  override: Record<string, unknown>,
): ComponentRecipe {
  const merged: {
    box?: ComponentRecipe["box"];
    text?: ComponentRecipe["text"];
    media?: ComponentRecipe["media"];
    field?: ComponentRecipe["field"];
  } = {};
  for (const key of ["box", "text", "media", "field"] as const) {
    const basePart = isObjectRecord(base?.[key]) ? base[key] : undefined;
    const overridePart = isObjectRecord(override[key]) ? override[key] : undefined;
    if (basePart === undefined && overridePart === undefined) continue;
    merged[key] = { ...(basePart ?? {}), ...(overridePart ?? {}) };
  }
  return Object.keys(merged).length > 0
    ? (merged as ComponentRecipe)
    : (override as ComponentRecipe);
}

/**
 * The default resolved theme — today's exact values. Every zero-extra-arg style
 * call defaults to this map. `COLOR` above aliases `DEFAULT_RESOLVED.color`.
 */
const DEFAULT_RESOLVED: ResolvedTheme = {
  space: SPACE,
  fontFamily: FONT_FAMILY,
  fontSize: FONT_SIZE,
  fontWeight: FONT_WEIGHT,
  radius: RADIUS,
  color: COLOR,
  ratio: RATIO,
  shadow: DEFAULT_SHADOW,
  recipes: mergeRecipes(undefined) ?? (Object.create(null) as ComponentRecipes),
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

function isFontFamily(value: unknown): value is FontFamily {
  return typeof value === "string" && (FONT_FAMILIES as readonly string[]).includes(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  const resolved: ResolvedTheme = {
    space: overlayGroup(SPACE, doc.space, SPACES, "string"),
    fontFamily: overlayGroup(FONT_FAMILY, doc.fontFamily, FONT_FAMILIES, "string"),
    fontSize: overlayGroup(FONT_SIZE, doc.fontSize, FONT_SIZES, "string"),
    fontWeight: overlayGroup(FONT_WEIGHT, doc.fontWeight, FONT_WEIGHTS, "number"),
    radius: overlayGroup(RADIUS, doc.radius, RADII, "string"),
    color: overlayGroup(COLOR, doc.color, COLORS, "string"),
    ratio: overlayGroup(RATIO, doc.ratio, RATIOS, "string"),
    shadow: overlayGroup(DEFAULT_SHADOW, doc.shadow, SHADOWS, "string"),
  };
  const recipes = mergeRecipes((doc as { readonly recipes?: unknown }).recipes);
  return recipes === undefined ? resolved : { ...resolved, recipes };
}

const EMPTY_RECIPE: ComponentRecipe = {};

export function resolveRecipe(
  theme: ResolvedTheme,
  component: RecipeComponentName,
  variant?: unknown,
  tone?: unknown,
): ComponentRecipe {
  const variants = theme.recipes?.[component];
  if (!isObjectRecord(variants)) return EMPTY_RECIPE;
  for (const key of [variant, tone, "default"]) {
    if (typeof key !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(variants, key)) continue;
    const recipe = (variants as Record<string, unknown>)[key];
    if (isObjectRecord(recipe)) return recipe as ComponentRecipe;
  }
  return EMPTY_RECIPE;
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
// token (RISK-API-5): agents say `scroll`, never a number.
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
  const isGrid = style.columns === 2 || style.columns === 3 || style.columns === 4;
  const css: CSSProperties = isGrid
    ? {
        display: "grid",
        boxSizing: "border-box",
        gridTemplateColumns: `repeat(${String(style.columns)},minmax(0,1fr))`,
      }
    : {
        display: "flex",
        flexDirection: style.direction === "row" ? "row" : "column",
        boxSizing: "border-box",
      };
  if (style.gap) css.gap = theme.space[style.gap];
  if (style.pad) css.padding = theme.space[style.pad];
  if (style.align) css.alignItems = alignValue(style.align);
  if (style.justify) css.justifyContent = justifyValue(style.justify);
  if (!isGrid && style.wrap) css.flexWrap = "wrap";
  if (style.bg) css.background = theme.color[style.bg];
  if (style.radius) css.borderRadius = theme.radius[style.radius];
  if (style.border) css.border = `1px solid ${theme.color.border}`;
  if (style.shadow) css.boxShadow = theme.shadow[style.shadow];
  if (style.grow) css.flexGrow = 1;
  if (style.width === "full") css.width = "100%";
  // `scroll:"x"` deliberately supersedes the old "never overflow-x" guard, but
  // only as a bounded internal region: maxWidth/minWidth keep the page from
  // widening while children clip inside the box. `true` is legacy vertical.
  if (style.scroll === "x") {
    css.overflowX = "auto";
    css.overflowY = "hidden";
    css.maxWidth = "100%";
    css.minWidth = 0;
  } else if (style.scroll === "y" || style.scroll === true) {
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
  const rawFamily = (style as { readonly family?: unknown }).family;
  const family: FontFamily = isFontFamily(rawFamily) ? rawFamily : "sans";
  const fontFamily = theme.fontFamily[family];
  if (fontFamily !== undefined) css.fontFamily = fontFamily;
  if (style.size) css.fontSize = theme.fontSize[style.size];
  if (style.weight) css.fontWeight = theme.fontWeight[style.weight];
  if (style.color) css.color = theme.color[style.color];
  if (style.align) {
    css.textAlign = style.align === "start" ? "left" : style.align === "end" ? "right" : "center";
  }
  return css;
}

export function mediaStyle(
  style: MediaStyle = {},
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
