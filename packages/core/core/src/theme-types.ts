/** Theme document public contract and canonical defaults. */
import type {
  Align,
  Appear,
  Columns,
  Color,
  Direction,
  FontFamily,
  FontSize,
  FontWeight,
  Gradient,
  Highlight,
  Justify,
  Leading,
  MaxWidth,
  MinHeight,
  Radius,
  Ratio,
  Scrim,
  ScrollAxis,
  Shadow,
  Sizing,
  Space,
  TextAlign,
  Tracking,
} from "./tokens.js";
import { COMPONENT_NODE_TYPES, PRIMITIVE_BRICK_TYPES, type FacetNode } from "./nodes.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import type { RecipePartName } from "./theme-recipes.js";

export { RECIPE_PARTS } from "./theme-recipes.js";
export type { RecipePartName } from "./theme-recipes.js";

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
  readonly minHeight?: Readonly<Partial<Record<MinHeight, string>>>;
  readonly maxWidth?: Readonly<Partial<Record<MaxWidth, string>>>;
  readonly tracking?: Readonly<Partial<Record<Tracking, string>>>;
  readonly leading?: Readonly<Partial<Record<Leading, string>>>;
  readonly gradient?: Readonly<Partial<Record<Gradient, string>>>;
  readonly scrim?: Readonly<Partial<Record<Scrim, string>>>;
  readonly highlight?: Readonly<Partial<Record<Highlight, string>>>;
  /** Dark-scheme palette (same token space as `color`), used by `scheme:"dark"`. */
  readonly colorDark?: Readonly<Partial<Record<Color, string>>>;
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

export interface ComponentRecipePart {
  readonly box?: RecipeBoxStyle;
  readonly text?: RecipeTextStyle;
  readonly media?: RecipeMediaStyle;
  readonly field?: RecipeFieldStyle;
}

export type ComponentRecipeParts = Readonly<Partial<Record<RecipePartName, ComponentRecipePart>>>;

export interface ComponentRecipe extends ComponentRecipePart {
  readonly parts?: ComponentRecipeParts;
}

export const RECIPE_COMPONENTS = [
  ...PRIMITIVE_BRICK_TYPES,
  ...COMPONENT_NODE_TYPES,
] as const satisfies readonly FacetNode["type"][];
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

/** Shared cap for a document's one-line `description` (a theme's and a composition's). */
export const MAX_DESCRIPTION_LENGTH = 200;

/**
 * The canonical default palette — token NAMES → concrete hex — as the SINGLE
 * source of truth for the default colors.
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
