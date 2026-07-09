/**
 * Theme documents — the ONE place raw CSS values enter Facet, as OPERATOR data
 * (never tree content, never model output). A `FacetTheme` is a PARTIAL override
 * over the default theme: token NAMES (the same `tokens.ts` vocabulary the agent
 * styles with) mapped to concrete CSS values. `validateTheme` is the single
 * safety boundary for that untrusted operator input.
 *
 * The validator is pure and dependency-free (no `node:*`, no color library —
 * WCAG contrast is plain arithmetic) so it runs identically on server and in the
 * browser. It NEVER throws: any input, however hostile or malformed, comes back
 * as `{ theme?, issues }`. A single `severity: "error"` issue refuses the whole
 * document (`theme` undefined); warnings keep the document but flag a clamp,
 * a dropped key, or a low-contrast pair.
 */
import {
  COLORS,
  ALIGNS,
  APPEARS,
  COLUMNS,
  DIRECTIONS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  JUSTIFIES,
  RADII,
  RATIOS,
  SCROLL_AXES,
  SHADOWS,
  SIZINGS,
  SPACES,
  TEXT_ALIGNS,
  type Align,
  type Appear,
  type Columns,
  type Color,
  type Direction,
  type FontFamily,
  type FontSize,
  type FontWeight,
  type Justify,
  type Radius,
  type Ratio,
  type ScrollAxis,
  type Shadow,
  type Sizing,
  type Space,
  type TextAlign,
} from "./tokens.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import {
  boundedDescription,
  isForbiddenKey,
  isControlChar,
  isPlainObject,
  MAX_ISSUES,
  MAX_VALUE_LENGTH,
  nullMap,
  printableKey,
  ISSUES_SUPPRESSED,
} from "./issues.js";

/** A partial override document over the default theme. Every group is optional. */
export interface FacetTheme {
  readonly name: string;
  readonly description?: string;
  readonly color?: Readonly<Partial<Record<Color, string>>>;
  readonly space?: Readonly<Partial<Record<Space, string>>>;
  readonly fontFamily?: Readonly<Partial<Record<FontFamily, string>>>;
  readonly fontSize?: Readonly<Partial<Record<FontSize, string>>>;
  readonly fontWeight?: Readonly<Partial<Record<FontWeight, number>>>;
  readonly radius?: Readonly<Partial<Record<Radius, string>>>;
  readonly ratio?: Readonly<Partial<Record<Ratio, string>>>;
  readonly shadow?: Readonly<Partial<Record<Shadow, string>>>;
  readonly recipes?: ComponentRecipes;
}

export interface RecipeBoxStyle {
  readonly direction?: Direction;
  readonly gap?: Space;
  readonly pad?: Space;
  readonly align?: Align;
  readonly justify?: Justify;
  readonly wrap?: boolean;
  readonly bg?: Color;
  readonly radius?: Radius;
  readonly border?: boolean;
  readonly grow?: boolean;
  readonly width?: Sizing;
  readonly appear?: Appear;
  readonly scroll?: ScrollAxis | true;
  readonly columns?: Columns;
  readonly shadow?: Shadow;
}

export interface RecipeTextStyle {
  readonly family?: FontFamily;
  readonly size?: FontSize;
  readonly weight?: FontWeight;
  readonly color?: Color;
  readonly align?: TextAlign;
}

export interface RecipeMediaStyle {
  readonly radius?: Radius;
  readonly width?: Sizing;
  readonly ratio?: Ratio;
}

export interface RecipeFieldStyle {
  readonly width?: Sizing;
}

export interface ComponentRecipe {
  readonly box?: RecipeBoxStyle;
  readonly text?: RecipeTextStyle;
  readonly media?: RecipeMediaStyle;
  readonly field?: RecipeFieldStyle;
}

export const RECIPE_COMPONENTS = [
  "box",
  "text",
  "media",
  "field",
  "button",
  "section",
  "card",
  "tabs",
  "table",
  "chart",
  "stat",
  "badge",
  "progress",
  "alert",
  "list",
  "divider",
] as const;
export type RecipeComponentName = (typeof RECIPE_COMPONENTS)[number];

export type ComponentRecipes = Readonly<
  Partial<Record<RecipeComponentName, Readonly<Record<string, ComponentRecipe>>>>
>;

export interface ThemeIssue {
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface ThemeValidationResult {
  /** Present iff no `error` issue was raised. */
  readonly theme?: FacetTheme;
  readonly issues: readonly ThemeIssue[];
}

/**
 * True iff `name` is a valid theme name — a short, filename-safe identifier
 * (1–64 chars of `[a-zA-Z0-9_-]`, leading char alphanumeric). The single rule
 * both `validateTheme` (a theme document's own name) and `validateTree` (a
 * tree's `theme` reference) apply, so the two can never drift apart.
 */
export function isValidThemeName(name: string): boolean {
  return SLOT_NAME_RE.test(name);
}

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
  "recipes",
]);

/** Substrings that make a CSS value dangerous regardless of context. */
const DANGEROUS_SUBSTRINGS = ["url(", "var(", "expression(", "javascript:"];

/** Shared cap for a document's one-line `description` (a theme's and a stamp's). */
export const MAX_DESCRIPTION_LENGTH = 200;

/**
 * A bounded issue collector. Once `MAX_ISSUES` real entries are recorded,
 * further pushes are dropped after a single `ISSUES_SUPPRESSED` tail entry — so
 * a 100k-junk-key group cannot balloon the issues list (each junk key would
 * otherwise emit one issue object). `everError` is tracked BEFORE the cap check
 * so the whole-document-refusal decision (`hasError`) never misses an error
 * issue that the cap suppressed — a document with 64 warnings THEN an error must
 * still be refused (theme.ts contract "Present iff no error issue was raised").
 * `.list` is the plain array to return.
 */
class IssueList {
  private readonly items: ThemeIssue[] = [];
  private suppressed = false;
  private everError = false;
  push(issue: ThemeIssue): void {
    if (issue.severity === "error") this.everError = true;
    if (this.items.length >= MAX_ISSUES) {
      if (!this.suppressed) {
        this.items.push({ severity: "warning", message: ISSUES_SUPPRESSED });
        this.suppressed = true;
      }
      return;
    }
    this.items.push(issue);
  }
  /** True iff any `error` issue was raised — even one dropped past the cap. */
  get hasError(): boolean {
    return this.everError;
  }
  get list(): ThemeIssue[] {
    return this.items;
  }
}

/** Clamp bounds in px-equivalents (invariant #5: a theme cannot push content off-screen). */
const SPACE_PX_RANGE = { lo: 0, hi: 512 } as const;
const FONT_SIZE_PX_RANGE = { lo: 0, hi: 512 } as const;
const RADIUS_PX_RANGE = { lo: 0, hi: 9999 } as const;
const WEIGHT_RANGE = { lo: 1, hi: 1000 } as const;

/**
 * The canonical default palette — token NAMES → concrete hex — as the SINGLE
 * source of truth for the default colors. `@facet/react` (which depends on core)
 * builds its `COLOR`/`DEFAULT_THEME`/`resolveTheme` on this map, and the contrast
 * check below overlays a partial override on it so an EFFECTIVE (override ??
 * default) pair is measured, not just override-vs-override.
 */
export const DEFAULT_COLORS: Readonly<Record<Color, string>> = {
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
  neutral: "#64748b",
  info: "#0284c7",
  "chart-1": "#2563eb",
  "chart-2": "#16a34a",
  "chart-3": "#d97706",
  "chart-4": "#dc2626",
  "chart-5": "#7c3aed",
  "chart-6": "#0891b2",
};

/**
 * WCAG contrast is measured for these pairs against the EFFECTIVE colors — each
 * member is the document's override if present, else the `DEFAULT_COLORS` value
 * it renders on — so a partial override (e.g. `bg` only) is still checked.
 */
const CONTRAST_PAIRS: readonly (readonly [Color, Color])[] = [
  ["fg", "bg"],
  ["fg-muted", "bg"],
  ["accent-fg", "accent"],
];
const MIN_CONTRAST = 4.5;

/**
 * Rejects a raw CSS string that is too long, contains a control/injection
 * character, or carries a dangerous CSS function. Whitespace is collapsed before
 * the substring check so `u r l (` cannot smuggle a `url(` past it.
 */
function unsafeValue(value: string): string | undefined {
  if (value.length > MAX_VALUE_LENGTH) return `value exceeds ${MAX_VALUE_LENGTH} characters`;
  for (let i = 0; i < value.length; i++) {
    if (isControlChar(value.charCodeAt(i))) return "value contains a control character";
  }
  if (/[;{}<>\\`]/.test(value)) return "value contains a disallowed character";
  const collapsed = value.replace(/\s+/g, "").toLowerCase();
  for (const bad of DANGEROUS_SUBSTRINGS) {
    if (collapsed.includes(bad)) return `value contains "${bad}"`;
  }
  return undefined;
}

const HEX_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Argument chars are constrained to digits/dot/comma/percent/whitespace and the
// letters of "deg" — anything else (e.g. a smuggled keyword) fails the match.
const RGB_HSL_RE = /^(rgb|rgba|hsl|hsla)\(([0-9.,%\sdeg]+)\)$/i;
const NAMED_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  aqua: [0, 255, 255],
  black: [0, 0, 0],
  blue: [0, 0, 255],
  cyan: [0, 255, 255],
  fuchsia: [255, 0, 255],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  grey: [128, 128, 128],
  lime: [0, 255, 0],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  navy: [0, 0, 128],
  olive: [128, 128, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  red: [255, 0, 0],
  silver: [192, 192, 192],
  teal: [0, 128, 128],
  white: [255, 255, 255],
  yellow: [255, 255, 0],
};

function isAllowedColor(value: string): boolean {
  return parseSrgb(value) !== undefined;
}

const DIMENSION_RE = /^(-?\d*\.?\d+)(px|rem|em)$/;

/** px-equivalent of a dimension (`0` or `<number>px/rem/em`), or undefined if malformed. */
function dimensionPx(value: string): number | undefined {
  if (value === "0") return 0;
  const match = DIMENSION_RE.exec(value);
  if (match === null) return undefined;
  const scalar = Number(match[1]);
  if (!Number.isFinite(scalar)) return undefined;
  return match[2] === "px" ? scalar : scalar * 16;
}

const RATIO_RE = /^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/;

function isAllowedRatio(value: string): boolean {
  const match = RATIO_RE.exec(value);
  if (match === null) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  return Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0;
}

type Handled<V> = { readonly value: V; readonly warning?: string } | { readonly error: string };

/**
 * Validates one token group: iterates the raw map's OWN keys, dropping forbidden
 * and unknown-token keys with a warning, running `handle` on each surviving
 * value. A value `error` is surfaced (and refuses the whole document); a `value`
 * (with an optional clamp `warning`) is written to a null-proto output map.
 * Returns the map only if it has at least one entry.
 */
function validateGroup<V>(
  raw: unknown,
  members: readonly string[],
  group: string,
  handle: (value: unknown) => Handled<V>,
  issues: IssueList,
): Record<string, V> | undefined {
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "warning",
      message: `theme group "${group}" is not an object; ignored`,
    });
    return undefined;
  }
  const out = nullMap<V>();
  for (const key of Object.keys(raw)) {
    if (isForbiddenKey(key)) {
      issues.push({
        severity: "warning",
        message: `theme "${group}": forbidden key "${printableKey(key)}" dropped`,
      });
      continue;
    }
    if (!members.includes(key)) {
      issues.push({
        severity: "warning",
        message: `theme "${group}": unknown token "${printableKey(key)}" dropped`,
      });
      continue;
    }
    const result = handle(raw[key]);
    if ("error" in result) {
      issues.push({
        severity: "error",
        message: `theme "${group}" token "${printableKey(key)}": ${result.error}`,
      });
      continue;
    }
    if (result.warning !== undefined) {
      issues.push({
        severity: "warning",
        message: `theme "${group}" token "${printableKey(key)}": ${result.warning}`,
      });
    }
    out[key] = result.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function handleColor(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (!isAllowedColor(value)) return { error: "not an allowed color value" };
  return { value };
}

function dimensionHandler(lo: number, hi: number): (value: unknown) => Handled<string> {
  return (value) => {
    if (typeof value !== "string") return { error: "value is not a string" };
    const unsafe = unsafeValue(value);
    if (unsafe !== undefined) return { error: unsafe };
    const px = dimensionPx(value);
    if (px === undefined) return { error: "not 0 or a <number>px/rem/em dimension" };
    if (px < lo || px > hi) {
      const clamped = Math.min(hi, Math.max(lo, px));
      return { value: `${clamped}px`, warning: `dimension "${value}" clamped to ${clamped}px` };
    }
    return { value };
  };
}

function handleWeight(value: unknown): Handled<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: "fontWeight is not a finite number" };
  }
  if (value < WEIGHT_RANGE.lo || value > WEIGHT_RANGE.hi) {
    const clamped = Math.min(WEIGHT_RANGE.hi, Math.max(WEIGHT_RANGE.lo, value));
    return { value: clamped, warning: `fontWeight ${value} clamped to ${clamped}` };
  }
  return { value };
}

const FONT_FAMILY_RE = /^[A-Za-z0-9 _,'" -]+$/;

function handleFontFamily(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (!/[A-Za-z]/.test(value) || !FONT_FAMILY_RE.test(value)) {
    return { error: "not an allowed font-family value" };
  }
  return { value };
}

function handleRatio(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (!isAllowedRatio(value)) return { error: "not a <n> / <m> ratio" };
  return { value };
}

function handleShadow(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (value.trim() === "") return { error: "shadow value is empty" };
  return { value };
}

function tokenValue<T extends string | number>(
  raw: unknown,
  members: readonly T[],
  path: string,
  issues: IssueList,
): T | undefined {
  if ((members as readonly unknown[]).includes(raw)) return raw as T;
  issues.push({ severity: "warning", message: `${path}: invalid token dropped` });
  return undefined;
}

function booleanValue(raw: unknown, path: string, issues: IssueList): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  issues.push({ severity: "warning", message: `${path}: invalid boolean dropped` });
  return undefined;
}

function recipeStyleObject(
  raw: unknown,
  path: string,
  issues: IssueList,
): Record<string, unknown> | undefined {
  if (!isPlainObject(raw)) {
    issues.push({ severity: "warning", message: `${path}: style is not an object; ignored` });
    return undefined;
  }
  return raw;
}

function warnUnknownStyleKeys(
  raw: Record<string, unknown>,
  known: ReadonlySet<string>,
  path: string,
  issues: IssueList,
): void {
  for (const key of Object.keys(raw)) {
    if (isForbiddenKey(key)) {
      issues.push({
        severity: "warning",
        message: `${path}: forbidden key "${printableKey(key)}" dropped`,
      });
      continue;
    }
    if (!known.has(key)) {
      issues.push({
        severity: "warning",
        message: `${path}: unknown style key "${printableKey(key)}" dropped`,
      });
    }
  }
}

const RECIPE_BOX_STYLE_KEYS = new Set([
  "direction",
  "gap",
  "pad",
  "align",
  "justify",
  "wrap",
  "bg",
  "radius",
  "border",
  "grow",
  "width",
  "appear",
  "scroll",
  "columns",
  "shadow",
]);

function validateRecipeBoxStyle(
  raw: unknown,
  path: string,
  issues: IssueList,
): RecipeBoxStyle | undefined {
  const input = recipeStyleObject(raw, path, issues);
  if (input === undefined) return undefined;
  warnUnknownStyleKeys(input, RECIPE_BOX_STYLE_KEYS, path, issues);
  const out: Record<string, unknown> = nullMap<unknown>();
  if (input.direction !== undefined) {
    const value = tokenValue(input.direction, DIRECTIONS, `${path}.direction`, issues);
    if (value !== undefined) out.direction = value;
  }
  if (input.gap !== undefined) {
    const value = tokenValue(input.gap, SPACES, `${path}.gap`, issues);
    if (value !== undefined) out.gap = value;
  }
  if (input.pad !== undefined) {
    const value = tokenValue(input.pad, SPACES, `${path}.pad`, issues);
    if (value !== undefined) out.pad = value;
  }
  if (input.align !== undefined) {
    const value = tokenValue(input.align, ALIGNS, `${path}.align`, issues);
    if (value !== undefined) out.align = value;
  }
  if (input.justify !== undefined) {
    const value = tokenValue(input.justify, JUSTIFIES, `${path}.justify`, issues);
    if (value !== undefined) out.justify = value;
  }
  if (input.wrap !== undefined) {
    const value = booleanValue(input.wrap, `${path}.wrap`, issues);
    if (value !== undefined) out.wrap = value;
  }
  if (input.bg !== undefined) {
    const value = tokenValue(input.bg, COLORS, `${path}.bg`, issues);
    if (value !== undefined) out.bg = value;
  }
  if (input.radius !== undefined) {
    const value = tokenValue(input.radius, RADII, `${path}.radius`, issues);
    if (value !== undefined) out.radius = value;
  }
  if (input.border !== undefined) {
    const value = booleanValue(input.border, `${path}.border`, issues);
    if (value !== undefined) out.border = value;
  }
  if (input.grow !== undefined) {
    const value = booleanValue(input.grow, `${path}.grow`, issues);
    if (value !== undefined) out.grow = value;
  }
  if (input.width !== undefined) {
    const value = tokenValue(input.width, SIZINGS, `${path}.width`, issues);
    if (value !== undefined) out.width = value;
  }
  if (input.appear !== undefined) {
    const value = tokenValue(input.appear, APPEARS, `${path}.appear`, issues);
    if (value !== undefined) out.appear = value;
  }
  if (input.scroll !== undefined) {
    if (input.scroll === true) {
      out.scroll = true;
    } else {
      const value = tokenValue(input.scroll, SCROLL_AXES, `${path}.scroll`, issues);
      if (value !== undefined) out.scroll = value;
    }
  }
  if (input.columns !== undefined) {
    const value = tokenValue(input.columns, COLUMNS, `${path}.columns`, issues);
    if (value !== undefined) out.columns = value;
  }
  if (input.shadow !== undefined) {
    const value = tokenValue(input.shadow, SHADOWS, `${path}.shadow`, issues);
    if (value !== undefined) out.shadow = value;
  }
  return Object.keys(out).length > 0 ? (out as RecipeBoxStyle) : undefined;
}

const RECIPE_TEXT_STYLE_KEYS = new Set(["family", "size", "weight", "color", "align"]);

function validateRecipeTextStyle(
  raw: unknown,
  path: string,
  issues: IssueList,
): RecipeTextStyle | undefined {
  const input = recipeStyleObject(raw, path, issues);
  if (input === undefined) return undefined;
  warnUnknownStyleKeys(input, RECIPE_TEXT_STYLE_KEYS, path, issues);
  const out: Record<string, unknown> = nullMap<unknown>();
  if (input.family !== undefined) {
    const value = tokenValue(input.family, FONT_FAMILIES, `${path}.family`, issues);
    if (value !== undefined) out.family = value;
  }
  if (input.size !== undefined) {
    const value = tokenValue(input.size, FONT_SIZES, `${path}.size`, issues);
    if (value !== undefined) out.size = value;
  }
  if (input.weight !== undefined) {
    const value = tokenValue(input.weight, FONT_WEIGHTS, `${path}.weight`, issues);
    if (value !== undefined) out.weight = value;
  }
  if (input.color !== undefined) {
    const value = tokenValue(input.color, COLORS, `${path}.color`, issues);
    if (value !== undefined) out.color = value;
  }
  if (input.align !== undefined) {
    const value = tokenValue(input.align, TEXT_ALIGNS, `${path}.align`, issues);
    if (value !== undefined) out.align = value;
  }
  return Object.keys(out).length > 0 ? (out as RecipeTextStyle) : undefined;
}

const RECIPE_MEDIA_STYLE_KEYS = new Set(["radius", "width", "ratio"]);

function validateRecipeMediaStyle(
  raw: unknown,
  path: string,
  issues: IssueList,
): RecipeMediaStyle | undefined {
  const input = recipeStyleObject(raw, path, issues);
  if (input === undefined) return undefined;
  warnUnknownStyleKeys(input, RECIPE_MEDIA_STYLE_KEYS, path, issues);
  const out: Record<string, unknown> = nullMap<unknown>();
  if (input.radius !== undefined) {
    const value = tokenValue(input.radius, RADII, `${path}.radius`, issues);
    if (value !== undefined) out.radius = value;
  }
  if (input.width !== undefined) {
    const value = tokenValue(input.width, SIZINGS, `${path}.width`, issues);
    if (value !== undefined) out.width = value;
  }
  if (input.ratio !== undefined) {
    const value = tokenValue(input.ratio, RATIOS, `${path}.ratio`, issues);
    if (value !== undefined) out.ratio = value;
  }
  return Object.keys(out).length > 0 ? (out as RecipeMediaStyle) : undefined;
}

const RECIPE_FIELD_STYLE_KEYS = new Set(["width"]);

function validateRecipeFieldStyle(
  raw: unknown,
  path: string,
  issues: IssueList,
): RecipeFieldStyle | undefined {
  const input = recipeStyleObject(raw, path, issues);
  if (input === undefined) return undefined;
  warnUnknownStyleKeys(input, RECIPE_FIELD_STYLE_KEYS, path, issues);
  const out: Record<string, unknown> = nullMap<unknown>();
  if (input.width !== undefined) {
    const value = tokenValue(input.width, SIZINGS, `${path}.width`, issues);
    if (value !== undefined) out.width = value;
  }
  return Object.keys(out).length > 0 ? (out as RecipeFieldStyle) : undefined;
}

const COMPONENT_RECIPE_KEYS = new Set(["box", "text", "media", "field"]);

function validateComponentRecipe(
  raw: unknown,
  path: string,
  issues: IssueList,
): ComponentRecipe | undefined {
  if (!isPlainObject(raw)) {
    issues.push({ severity: "warning", message: `${path}: recipe is not an object; ignored` });
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (isForbiddenKey(key)) {
      issues.push({
        severity: "warning",
        message: `${path}: forbidden key "${printableKey(key)}" dropped`,
      });
      continue;
    }
    if (!COMPONENT_RECIPE_KEYS.has(key)) {
      issues.push({
        severity: "warning",
        message: `${path}: unknown recipe key "${printableKey(key)}" dropped`,
      });
    }
  }
  const out: Record<string, unknown> = nullMap<unknown>();
  if (raw.box !== undefined) {
    const box = validateRecipeBoxStyle(raw.box, `${path}.box`, issues);
    if (box !== undefined) out.box = box;
  }
  if (raw.text !== undefined) {
    const text = validateRecipeTextStyle(raw.text, `${path}.text`, issues);
    if (text !== undefined) out.text = text;
  }
  if (raw.media !== undefined) {
    const media = validateRecipeMediaStyle(raw.media, `${path}.media`, issues);
    if (media !== undefined) out.media = media;
  }
  if (raw.field !== undefined) {
    const field = validateRecipeFieldStyle(raw.field, `${path}.field`, issues);
    if (field !== undefined) out.field = field;
  }
  return Object.keys(out).length > 0 ? (out as ComponentRecipe) : undefined;
}

function isRecipeComponentName(value: string): value is RecipeComponentName {
  return (RECIPE_COMPONENTS as readonly string[]).includes(value);
}

function validateRecipes(raw: unknown, issues: IssueList): ComponentRecipes | undefined {
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "warning",
      message: `theme group "recipes" is not an object; ignored`,
    });
    return undefined;
  }
  const out = nullMap<Readonly<Record<string, ComponentRecipe>>>();
  for (const component of Object.keys(raw)) {
    if (isForbiddenKey(component)) {
      issues.push({
        severity: "warning",
        message: `theme "recipes": forbidden component "${printableKey(component)}" dropped`,
      });
      continue;
    }
    if (!isRecipeComponentName(component)) {
      issues.push({
        severity: "warning",
        message: `theme "recipes": unknown component "${printableKey(component)}" dropped`,
      });
      continue;
    }
    const variantsRaw = raw[component];
    if (!isPlainObject(variantsRaw)) {
      issues.push({
        severity: "warning",
        message: `theme "recipes.${component}" is not an object; ignored`,
      });
      continue;
    }
    const variants = nullMap<ComponentRecipe>();
    for (const variant of Object.keys(variantsRaw)) {
      if (isForbiddenKey(variant)) {
        issues.push({
          severity: "warning",
          message: `theme "recipes.${component}": forbidden variant "${printableKey(variant)}" dropped`,
        });
        continue;
      }
      if (!SLOT_NAME_RE.test(variant)) {
        issues.push({
          severity: "warning",
          message: `theme "recipes.${component}": malformed variant "${printableKey(variant)}" dropped`,
        });
        continue;
      }
      const recipe = validateComponentRecipe(
        variantsRaw[variant],
        `theme recipes.${component}.${variant}`,
        issues,
      );
      if (recipe !== undefined) variants[variant] = recipe;
    }
    if (Object.keys(variants).length > 0) out[component] = variants;
  }
  return Object.keys(out).length > 0 ? (out as ComponentRecipes) : undefined;
}

/** Parse a safe color value to sRGB channels [0,255]; else undefined. */
function parseSrgb(value: string): readonly [number, number, number] | undefined {
  if (value.startsWith("#")) {
    if (!HEX_RE.test(value)) return undefined;
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      if (hex.length === 4 && parseInt(`${hex[3]}${hex[3]}`, 16) !== 255) return undefined;
      hex = hex
        .slice(0, 3)
        .split("")
        .map((c) => c + c)
        .join("");
    } else if (hex.length === 8) {
      if (parseInt(hex.slice(6, 8), 16) !== 255) return undefined;
      hex = hex.slice(0, 6);
    } else if (hex.length !== 6) {
      return undefined;
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }
  const lower = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, lower)) {
    return NAMED_COLORS[lower];
  }

  const match = RGB_HSL_RE.exec(value);
  if (match === null) return undefined;
  const fn = match[1]!.toLowerCase();
  const rawArgs = match[2]!;
  const commaSeparated = rawArgs.includes(",");
  const parts = (commaSeparated ? rawArgs.split(",") : rawArgs.trim().split(/\s+/)).map((p) =>
    p.trim(),
  );
  const alphaAllowed = fn === "rgba" || fn === "hsla";
  if (alphaAllowed && !commaSeparated) return undefined;
  if (parts.length !== 3 && !(alphaAllowed && parts.length === 4)) return undefined;
  if (parts.length === 4 && !isOpaqueAlpha(parts[3]!)) return undefined;

  if (fn === "rgb" || fn === "rgba") {
    const channel = (raw: string): number | undefined => {
      if (raw === "") return undefined;
      const scalar = raw.endsWith("%") ? raw.slice(0, -1) : raw;
      if (scalar === "") return undefined;
      const value = raw.endsWith("%") ? (Number(scalar) / 100) * 255 : Number(scalar);
      if (!Number.isFinite(value) || value < 0 || value > 255) return undefined;
      return value;
    };
    const [r, g, b] = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)];
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return [r, g, b];
  }

  const hue = parseHue(parts[0]!);
  const saturation = parsePercent(parts[1]!);
  const lightness = parsePercent(parts[2]!);
  if (hue === undefined || saturation === undefined || lightness === undefined) return undefined;
  return hslToSrgb(hue, saturation, lightness);
}

function parseHue(raw: string): number | undefined {
  const value = raw.toLowerCase().endsWith("deg") ? raw.slice(0, -3) : raw;
  if (value === "") return undefined;
  const hue = Number(value);
  if (!Number.isFinite(hue)) return undefined;
  return ((hue % 360) + 360) % 360;
}

function parsePercent(raw: string): number | undefined {
  if (!raw.endsWith("%")) return undefined;
  const scalar = raw.slice(0, -1);
  if (scalar === "") return undefined;
  const value = Number(scalar);
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return value / 100;
}

function isOpaqueAlpha(raw: string): boolean {
  const scalar = raw.endsWith("%") ? raw.slice(0, -1) : raw;
  if (scalar === "") return false;
  const value = raw.endsWith("%") ? Number(scalar) / 100 : Number(scalar);
  return Number.isFinite(value) && value === 1;
}

function hslToSrgb(
  hue: number,
  saturation: number,
  lightness: number,
): readonly [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const h = hue / 60;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const [r1, g1, b1] =
    h < 1
      ? [chroma, x, 0]
      : h < 2
        ? [x, chroma, 0]
        : h < 3
          ? [0, chroma, x]
          : h < 4
            ? [0, x, chroma]
            : h < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = lightness - chroma / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Validate an untrusted operator theme document. Returns a `FacetTheme` (partial
 * override) plus issues, or issues only if any `error` was raised. Never throws —
 * a hostile input whose property accessor throws (a proxy/getter handed in by a
 * live in-process document) is caught by the `validateTheme` wrapper below and
 * refused with an error issue, keeping the header's "NEVER throws" contract true.
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
