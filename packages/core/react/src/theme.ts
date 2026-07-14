import type { CSSProperties } from "react";
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
  RECIPE_COMPONENTS,
  RECIPE_PARTS,
  SCRIMS,
  SHADOWS,
  SPACES,
  TRACKINGS,
} from "@facet/core";
import type {
  Align,
  BoxStyle,
  Color,
  ComponentRecipe,
  ComponentRecipePart,
  ComponentRecipeParts,
  ComponentRecipes,
  FacetTheme,
  FontFamily,
  FontSize,
  FontWeight,
  Gradient,
  Highlight,
  InputStyle,
  Justify,
  Leading,
  MaxWidth,
  MediaStyle,
  MinHeight,
  Radius,
  Ratio,
  RecipeComponentName,
  RecipePartName,
  Scrim,
  Shadow,
  Space,
  TextStyle,
  Tracking,
} from "@facet/core";
// The default token VALUES live in `@facet/assets` (node-free, deps = core) — the
// SINGLE source of default-theme truth. react imports them as its render floor and
// re-exports `DEFAULT_THEME` + `COLOR` for back-compat, but owns no second copy
// that could drift (RISK-INV-1 / RISK-API-2).
import {
  COLOR,
  COLOR_DARK,
  DEFAULT_THEME,
  FONT_FAMILY,
  FONT_SIZE,
  FONT_WEIGHT,
  GRADIENT,
  HIGHLIGHT,
  LEADING,
  MAX_WIDTH,
  MIN_HEIGHT,
  RADIUS,
  RATIO,
  SCRIM,
  SHADOW as DEFAULT_SHADOW,
  SPACE,
  TRACKING,
} from "@facet/assets";
import { rootContainmentStyle, scrollContainmentStyle, stickyStyle } from "./layout-contract.js";

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
  // Landing-grade groups. `color` above is the ACTIVE palette (defaults to
  // `colorLight`); the renderer swaps a subtree onto `colorDark` for a dark
  // section at render time. `minHeight`/`maxWidth`/`leading` ship their defaults
  // here (not through DEFAULT_THEME — their svh/ch/unitless values are not
  // accepted by core's operator dimension handler), yet stay operator-overridable.
  readonly minHeight: Record<MinHeight, string>;
  readonly maxWidth: Record<MaxWidth, string>;
  readonly tracking: Record<Tracking, string>;
  readonly leading: Record<Leading, string>;
  readonly gradient: Record<Gradient, string>;
  readonly scrim: Record<Scrim, string>;
  readonly highlight: Record<Highlight, string>;
  readonly colorLight: Record<Color, string>;
  readonly colorDark: Record<Color, string>;
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

function safeOwnValue(record: Record<string, unknown>, key: string): unknown {
  try {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
    return record[key];
  } catch {
    return undefined;
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
        const recipe = safeOwnValue(overrideVariants, name);
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
  const styleBundles = mergeComponentRecipePart(base, override);
  const merged: {
    box?: ComponentRecipe["box"];
    text?: ComponentRecipe["text"];
    media?: ComponentRecipe["media"];
    field?: ComponentRecipe["field"];
    parts?: ComponentRecipe["parts"];
  } = { ...(styleBundles ?? {}) };
  const overrideParts = safeOwnValue(override, "parts");
  const parts = mergeComponentRecipeParts(
    isObjectRecord(base?.parts) ? base.parts : undefined,
    isObjectRecord(overrideParts) ? overrideParts : undefined,
  );
  if (parts !== undefined) merged.parts = parts;
  return Object.keys(merged).length > 0
    ? (merged as ComponentRecipe)
    : (override as ComponentRecipe);
}

function mergeComponentRecipeParts(
  base: ComponentRecipeParts | undefined,
  override: Record<string, unknown> | undefined,
): ComponentRecipeParts | undefined {
  if (base === undefined && override === undefined) return undefined;
  const merged: Partial<Record<RecipePartName, ComponentRecipePart>> = Object.create(
    null,
  ) as Partial<Record<RecipePartName, ComponentRecipePart>>;
  for (const partName of RECIPE_PARTS) {
    const basePart = isObjectRecord(base?.[partName]) ? base[partName] : undefined;
    const overrideValue = override === undefined ? undefined : safeOwnValue(override, partName);
    const overridePart = isObjectRecord(overrideValue) ? overrideValue : undefined;
    const part = mergeComponentRecipePart(basePart, overridePart);
    if (part !== undefined) merged[partName] = part;
  }
  return Object.keys(merged).length > 0 ? (merged as ComponentRecipeParts) : undefined;
}

function mergeComponentRecipePart(
  base: ComponentRecipePart | undefined,
  override: Record<string, unknown> | undefined,
): ComponentRecipePart | undefined {
  if (base === undefined && override === undefined) return undefined;
  const merged: {
    box?: ComponentRecipePart["box"];
    text?: ComponentRecipePart["text"];
    media?: ComponentRecipePart["media"];
    field?: ComponentRecipePart["field"];
  } = {};
  for (const key of ["box", "text", "media", "field"] as const) {
    const baseStyle = isObjectRecord(base?.[key]) ? base[key] : undefined;
    const overrideValue = override === undefined ? undefined : safeOwnValue(override, key);
    const overrideStyle = isObjectRecord(overrideValue) ? overrideValue : undefined;
    if (baseStyle === undefined && overrideStyle === undefined) continue;
    merged[key] = { ...(baseStyle ?? {}), ...(overrideStyle ?? {}) };
  }
  return Object.keys(merged).length > 0 ? (merged as ComponentRecipePart) : undefined;
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
  // MIN_HEIGHT/MAX_WIDTH/LEADING come straight from @facet/assets: DEFAULT_THEME
  // omits them (svh/ch/unitless aren't valid operator-doc dimensions), so the
  // resolved floor is sourced from the raw maps here (WU-4 handoff).
  minHeight: MIN_HEIGHT,
  maxWidth: MAX_WIDTH,
  tracking: TRACKING,
  leading: LEADING,
  gradient: GRADIENT,
  scrim: SCRIM,
  highlight: HIGHLIGHT,
  colorLight: COLOR,
  colorDark: COLOR_DARK,
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
  // `color` is the ACTIVE (light) palette; `colorLight` mirrors it so a nested
  // light-palette island restores exactly the operator's light overrides.
  const color = overlayGroup(COLOR, doc.color, COLORS, "string");
  const resolved: ResolvedTheme = {
    space: overlayGroup(SPACE, doc.space, SPACES, "string"),
    fontFamily: overlayGroup(FONT_FAMILY, doc.fontFamily, FONT_FAMILIES, "string"),
    fontSize: overlayGroup(FONT_SIZE, doc.fontSize, FONT_SIZES, "string"),
    fontWeight: overlayGroup(FONT_WEIGHT, doc.fontWeight, FONT_WEIGHTS, "number"),
    radius: overlayGroup(RADIUS, doc.radius, RADII, "string"),
    color,
    ratio: overlayGroup(RATIO, doc.ratio, RATIOS, "string"),
    shadow: overlayGroup(DEFAULT_SHADOW, doc.shadow, SHADOWS, "string"),
    minHeight: overlayGroup(MIN_HEIGHT, doc.minHeight, MIN_HEIGHTS, "string"),
    maxWidth: overlayGroup(MAX_WIDTH, doc.maxWidth, MAX_WIDTHS, "string"),
    tracking: overlayGroup(TRACKING, doc.tracking, TRACKINGS, "string"),
    leading: overlayGroup(LEADING, doc.leading, LEADINGS, "string"),
    gradient: overlayGroup(GRADIENT, doc.gradient, GRADIENTS, "string"),
    scrim: overlayGroup(SCRIM, doc.scrim, SCRIMS, "string"),
    highlight: overlayGroup(HIGHLIGHT, doc.highlight, HIGHLIGHTS, "string"),
    colorLight: color,
    colorDark: overlayGroup(COLOR_DARK, doc.colorDark, COLORS, "string"),
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
        gridTemplateColumns: `repeat(${String(style.columns)},minmax(0,1fr))`,
      }
    : {
        display: "flex",
        flexDirection: style.direction === "row" ? "row" : "column",
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
  if (style.minHeight) css.minHeight = theme.minHeight[style.minHeight];
  if (style.maxWidth) {
    const resolved = theme.maxWidth[style.maxWidth];
    css.maxWidth = resolved;
    // A constrained section column centers itself; `none` releases the guard.
    if (style.maxWidth !== "none") css.marginInline = "auto";
  }
  if (style.gradient) css.backgroundImage = theme.gradient[style.gradient];
  // `sticky` → `position:sticky` with a framework-owned top (stays in flow; no
  // author offset). `position:absolute` is never emitted for a flow box.
  if (style.sticky) Object.assign(css, stickyStyle());
  // `scroll:"x"` deliberately supersedes the old "never overflow-x" guard, but
  // only as a bounded internal region: maxWidth/minWidth keep the page from
  // widening while children clip inside the box. `true` is legacy vertical.
  if (style.scroll === "x") {
    Object.assign(css, scrollContainmentStyle("x"));
  } else if (style.scroll === "y" || style.scroll === true) {
    Object.assign(css, scrollContainmentStyle("y"));
  }
  return rootContainmentStyle(css);
}

export function textStyle(
  style: TextStyle = {},
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = { margin: 0, wordBreak: "break-word" };
  const rawFamily = (style as { readonly family?: unknown }).family;
  const family: FontFamily = isFontFamily(rawFamily) ? rawFamily : "sans";
  const fontFamily = theme.fontFamily[family];
  if (fontFamily !== undefined) css.fontFamily = fontFamily;
  if (style.size) css.fontSize = theme.fontSize[style.size];
  if (style.weight) css.fontWeight = theme.fontWeight[style.weight];
  if (style.color) css.color = theme.color[style.color];
  if (style.tracking) css.letterSpacing = theme.tracking[style.tracking];
  if (style.leading) css.lineHeight = theme.leading[style.leading];
  // A named highlight paints a decoration/band behind the text run.
  if (style.highlight) css.backgroundImage = theme.highlight[style.highlight];
  if (style.align) {
    css.textAlign = style.align === "start" ? "left" : style.align === "end" ? "right" : "center";
  }
  return rootContainmentStyle(css);
}

/**
 * The theme-owned LOOK of each richtext run mark (invariant #4: marks are
 * semantic NAMES; the theme, not the agent, decides their rendered token look).
 * Marks compose — several kinds on one run merge into one style — so `underline`
 * and `strike` accumulate onto a single `textDecorationLine`. An unknown kind
 * never reaches here (core drops it; the renderer also skips it), so this switch
 * is total over the closed `MARK_KINDS`. `code` uses renderer-owned relative
 * (em) insets, not author pixels; `link` gets the accent color + underline
 * decoration (the interactivity is wired in the renderer, not here).
 */
export function markLookCss(
  kinds: readonly string[],
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = {};
  const decorations: string[] = [];
  for (const kind of kinds) {
    switch (kind) {
      case "bold":
        css.fontWeight = theme.fontWeight.bold;
        break;
      case "italic":
        css.fontStyle = "italic";
        break;
      case "underline":
        if (!decorations.includes("underline")) decorations.push("underline");
        break;
      case "strike":
        if (!decorations.includes("line-through")) decorations.push("line-through");
        break;
      case "code":
        css.fontFamily = theme.fontFamily.mono;
        css.background = theme.color["surface-2"];
        css.borderRadius = theme.radius.sm;
        // Relative (em) insets are renderer-owned, not author pixels (INV #4/#5).
        css.padding = "0.1em 0.3em";
        break;
      case "link":
        css.color = theme.color.accent;
        if (!decorations.includes("underline")) decorations.push("underline");
        break;
    }
  }
  if (decorations.length > 0) css.textDecorationLine = decorations.join(" ");
  return css;
}

/** The heading element tag for a (clamped) richtext heading `level` (1–3). */
export function headingTag(level: number): "h1" | "h2" | "h3" {
  const clamped = Number.isFinite(level) ? Math.min(3, Math.max(1, Math.round(level))) : 1;
  return clamped === 1 ? "h1" : clamped === 2 ? "h2" : "h3";
}

/** Theme-owned heading typography by (clamped) level — a token size/weight scale. */
export function headingLookCss(
  level: number,
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const tag = headingTag(level);
  const size: FontSize = tag === "h1" ? "2xl" : tag === "h2" ? "xl" : "lg";
  const weight: FontWeight = tag === "h3" ? "semibold" : "bold";
  return { fontSize: theme.fontSize[size], fontWeight: theme.fontWeight[weight] };
}

/** Max nesting the renderer will indent a list item to (mirrors core's MAX_LIST_DEPTH). */
export const RENDER_MAX_LIST_DEPTH = 5;

/**
 * Renderer-owned FLOW indent for a nested list item (RISK-INV-3): a
 * `margin-inline-start` that scales a single theme space step by the CLAMPED
 * `depth`. Never `position:absolute`, never an author-controlled pixel — layout
 * stays flow-only. `depth 0` yields no indent.
 */
export function listIndentCss(
  depth: number,
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const clamped = Number.isFinite(depth)
    ? Math.min(RENDER_MAX_LIST_DEPTH, Math.max(0, Math.round(depth)))
    : 0;
  if (clamped <= 0) return {};
  return { marginInlineStart: `calc(${theme.space.lg} * ${clamped})` };
}

/** Theme-owned blockquote look — a leading accent border + muted, padded body. */
export function quoteLookCss(theme: ResolvedTheme = DEFAULT_RESOLVED): CSSProperties {
  return {
    borderInlineStart: `2px solid ${theme.color.border}`,
    paddingInlineStart: theme.space.md,
    color: theme.color["fg-muted"],
  };
}

export function mediaStyle(
  style: MediaStyle = {},
  theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = { display: "block", objectFit: "cover", height: "auto" };
  if (style.radius) css.borderRadius = theme.radius[style.radius];
  if (style.width === "full") css.width = "100%";
  if (style.ratio) css.aspectRatio = theme.ratio[style.ratio];
  return rootContainmentStyle(css);
}

// fieldStyle uses no themed token today (only the width sizing keyword), but
// keeps the trailing theme parameter for call-site symmetry with the other three
// and so a future themed field affordance is a non-breaking addition.
export function fieldStyle(
  style: InputStyle = {},
  _theme: ResolvedTheme = DEFAULT_RESOLVED,
): CSSProperties {
  const css: CSSProperties = {};
  if (style.width === "full") css.width = "100%";
  return rootContainmentStyle(css);
}
