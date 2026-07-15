import type { BrickRecipe, BrickRecipes, FacetTheme } from "@facet/core";
import {
  COLOR,
  COLOR_DARK,
  FONT_FAMILY,
  FONT_SIZE,
  FONT_WEIGHT,
  GRADIENT,
  HIGHLIGHT,
  RADIUS,
  RATIO,
  SCRIM,
  SHADOW,
  SPACE,
  TRACKING,
} from "./theme-tokens.js";

export {
  COLOR,
  COLOR_DARK,
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
  SHADOW,
  SPACE,
  TRACKING,
} from "./theme-tokens.js";

const recipeVariants = <T extends Record<string, BrickRecipe>>(variants: T): Readonly<T> =>
  Object.assign(Object.create(null) as T, variants);

export const RECIPES: BrickRecipes = Object.assign(Object.create(null) as BrickRecipes, {
  box: recipeVariants({
    panel: {
      box: { bg: "surface", border: true, pad: "md", radius: "md", shadow: "sm" },
    },
    inset: {
      box: { bg: "surface-2", pad: "md", radius: "md" },
    },
    selected: {
      box: { bg: "accent", border: true, pad: "sm", radius: "md" },
    },
  }),
  text: recipeVariants({
    eyebrow: {
      text: { color: "fg-muted", size: "sm", weight: "semibold" },
    },
    heading: {
      text: { color: "fg", size: "2xl", weight: "bold" },
    },
    muted: {
      text: { color: "fg-muted", size: "sm" },
    },
  }),
  media: recipeVariants({
    default: {
      media: { radius: "md", width: "full" },
    },
    hero: {
      media: { radius: "lg", ratio: "wide", width: "full" },
    },
  }),
  input: recipeVariants({
    default: {
      field: { width: "full" },
      parts: {
        label: { text: { color: "fg-muted", size: "sm", weight: "semibold" } },
        control: {
          box: { bg: "bg", border: true, pad: "sm", radius: "sm" },
          field: { width: "full" },
        },
        input: { field: { width: "full" } },
        helpText: { text: { color: "fg-muted", size: "xs" } },
        errorText: { text: { color: "danger", size: "xs", weight: "medium" } },
      },
    },
  }),
  table: recipeVariants({
    default: {
      box: { bg: "surface", border: true, pad: "md", radius: "md", scroll: "x" },
      text: { color: "fg", size: "sm" },
      parts: {
        title: { text: { color: "fg-muted", size: "sm", weight: "semibold" } },
        table: { text: { color: "fg", size: "sm" } },
        headerRow: { text: { color: "fg-muted", size: "sm", weight: "semibold" } },
        headerCell: {
          box: { pad: "sm" },
          text: { color: "fg-muted", size: "sm", weight: "semibold" },
        },
        row: { text: { color: "fg", size: "sm" } },
        cell: {
          box: { pad: "sm" },
          text: { color: "fg", size: "sm" },
        },
      },
    },
  }),
  chart: recipeVariants({
    default: {
      box: { bg: "surface", border: true, pad: "md", radius: "md", shadow: "sm" },
      text: { color: "fg-muted", size: "sm" },
      parts: {
        title: { text: { color: "fg", size: "sm", weight: "semibold" } },
        plot: { box: { bg: "surface-2", radius: "md" } },
        legend: { text: { color: "fg-muted", size: "xs" } },
      },
    },
  }),
  keyValue: recipeVariants({
    default: {
      box: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md" },
      text: { color: "fg" },
      parts: {
        item: { box: { direction: "row", gap: "md", justify: "between", wrap: true } },
        label: { text: { color: "fg-muted", size: "sm" } },
        value: { text: { color: "fg", weight: "semibold" } },
      },
    },
  }),
  progress: recipeVariants({
    default: {
      box: { gap: "xs", width: "full" },
      parts: {
        label: { text: { color: "fg-muted", size: "sm", weight: "medium" } },
        track: { box: { bg: "surface-2", radius: "full", width: "full" } },
        fill: { box: { bg: "accent", radius: "full", width: "full" } },
      },
    },
    success: {
      box: { gap: "xs", width: "full" },
      parts: {
        label: { text: { color: "success", size: "sm", weight: "medium" } },
        track: { box: { bg: "surface-2", radius: "full", width: "full" } },
        fill: { box: { bg: "success", radius: "full", width: "full" } },
      },
    },
  }),
  list: recipeVariants({
    default: {
      box: { gap: "sm", pad: "sm" },
      text: { color: "fg" },
      parts: {
        item: { box: { bg: "surface", border: true, pad: "sm", radius: "md" } },
        itemTitle: { text: { color: "fg", weight: "semibold" } },
        itemText: { text: { color: "fg-muted", size: "sm" } },
      },
    },
    compact: {
      box: { gap: "xs", pad: "xs" },
      text: { color: "fg-muted", size: "sm" },
      parts: {
        item: { box: { pad: "xs", radius: "sm" } },
        itemTitle: { text: { color: "fg", size: "sm", weight: "semibold" } },
        itemText: { text: { color: "fg-muted", size: "xs" } },
      },
    },
  }),
  loading: recipeVariants({
    default: {
      box: { direction: "row", gap: "sm", align: "center", pad: "sm", width: "full" },
      text: { color: "fg-muted", size: "sm" },
      parts: {
        label: { text: { color: "fg-muted", size: "sm" } },
      },
    },
  }),
} satisfies BrickRecipes);

/**
 * The default theme expressed as an operator DOCUMENT (the `@facet/core`
 * `FacetTheme` shape): token NAMES → today's concrete values, across all eight
 * token groups plus brick recipes. It passes `validateTheme` cleanly, so
 * operators can copy it as the starting point for a reskin, and hosts can
 * register it by name. `@facet/react` and `@facet/runtime` both import this as
 * the default base layer.
 */
export const DEFAULT_THEME: FacetTheme = {
  name: "default",
  color: COLOR,
  space: SPACE,
  fontFamily: FONT_FAMILY,
  fontSize: FONT_SIZE,
  fontWeight: FONT_WEIGHT,
  radius: RADIUS,
  ratio: RATIO,
  shadow: SHADOW,
  // Landing-grade groups whose default values are expressible in — and validate
  // cleanly through — the operator theme document. The dimension groups
  // (minHeight/maxWidth/leading) are intentionally omitted: their
  // semantically-correct defaults (`auto`/`50svh`/`65ch`/unitless line-heights)
  // are not accepted by core's dimension handler (0/px/rem/em only), so they ship
  // as resolved defaults via @facet/react's DEFAULT_RESOLVED (the MIN_HEIGHT/
  // MAX_WIDTH/LEADING maps) and resolveTheme falls back to them when a document
  // omits the group. Operators may still override those groups with px/rem/em.
  tracking: TRACKING,
  gradient: GRADIENT,
  scrim: SCRIM,
  highlight: HIGHLIGHT,
  colorDark: COLOR_DARK,
  recipes: RECIPES,
};
