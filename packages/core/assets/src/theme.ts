import type { ComponentRecipe, ComponentRecipes, FacetTheme } from "@facet/core";
import {
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

const recipeVariants = <T extends Record<string, ComponentRecipe>>(variants: T): Readonly<T> =>
  Object.assign(Object.create(null) as T, variants);

const sectionParts = (): NonNullable<ComponentRecipe["parts"]> => ({
  label: { text: { color: "fg-muted", size: "sm", weight: "semibold" } },
  title: { text: { color: "fg", size: "xl", weight: "bold" } },
  body: { text: { color: "fg" } },
});

const cardParts = (): NonNullable<ComponentRecipe["parts"]> => ({
  header: { box: { gap: "xs" } },
  title: { text: { color: "fg", size: "lg", weight: "bold" } },
  body: { text: { color: "fg-muted" } },
  footer: { box: { direction: "row", gap: "sm", align: "center" } },
  actions: { box: { direction: "row", gap: "sm", align: "center", wrap: true } },
});

const metricRecipeVariants = (): Readonly<Record<"default" | "success", ComponentRecipe>> =>
  recipeVariants({
    default: {
      box: { bg: "surface", border: true, gap: "xs", pad: "md", radius: "md", shadow: "sm" },
      text: { color: "fg-muted", size: "sm" },
      parts: {
        label: { text: { color: "fg-muted", size: "sm" } },
        value: { text: { color: "fg", size: "xl", weight: "bold" } },
        trend: { text: { color: "fg-muted", size: "sm", weight: "medium" } },
      },
    },
    success: {
      box: { bg: "surface", border: true, gap: "xs", pad: "md", radius: "md" },
      text: { color: "success", size: "sm", weight: "semibold" },
      parts: {
        label: { text: { color: "fg-muted", size: "sm" } },
        value: { text: { color: "success", size: "xl", weight: "bold" } },
        trend: { text: { color: "success", size: "sm", weight: "medium" } },
      },
    },
  });

export const RECIPES: ComponentRecipes = Object.assign(Object.create(null) as ComponentRecipes, {
  box: recipeVariants({
    panel: {
      box: { bg: "surface", border: true, pad: "md", radius: "md", shadow: "sm" },
    },
    inset: {
      box: { bg: "surface-2", pad: "md", radius: "md" },
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
  field: recipeVariants({
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
  button: recipeVariants({
    primary: {
      box: { bg: "accent", border: true, pad: "sm", radius: "md", shadow: "sm" },
      text: { color: "accent-fg", weight: "semibold" },
      parts: {
        label: { text: { color: "accent-fg", weight: "semibold" } },
      },
    },
    secondary: {
      box: { bg: "surface", border: true, pad: "sm", radius: "md" },
      text: { color: "fg", weight: "semibold" },
      parts: {
        label: { text: { color: "fg", weight: "semibold" } },
      },
    },
    danger: {
      box: { bg: "danger", border: true, pad: "sm", radius: "md", shadow: "sm" },
      text: { color: "accent-fg", weight: "semibold" },
      parts: {
        label: { text: { color: "accent-fg", weight: "semibold" } },
      },
    },
  }),
  section: recipeVariants({
    default: {
      box: { gap: "md", pad: "lg", width: "full" },
      text: { color: "fg" },
      parts: sectionParts(),
    },
    surface: {
      box: { bg: "surface", gap: "md", pad: "lg", radius: "lg", width: "full" },
      text: { color: "fg" },
      parts: sectionParts(),
    },
  }),
  card: recipeVariants({
    default: {
      box: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md", shadow: "sm" },
      text: { color: "fg" },
      parts: cardParts(),
    },
    interactive: {
      box: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md", shadow: "md" },
      text: { color: "fg" },
      parts: cardParts(),
    },
  }),
  tabs: recipeVariants({
    default: {
      box: { bg: "surface", border: true, gap: "xs", pad: "xs", radius: "full" },
      text: { color: "fg-muted", size: "sm", weight: "semibold" },
      parts: {
        tabList: { box: { direction: "row", gap: "xs", wrap: true } },
        tab: {
          box: { bg: "surface", border: true, pad: "sm", radius: "full" },
          text: { color: "fg-muted", size: "sm", weight: "semibold" },
        },
        activeTab: {
          box: { bg: "accent", border: true, pad: "sm", radius: "full" },
          text: { color: "accent-fg", size: "sm", weight: "semibold" },
        },
      },
    },
  }),
  nav: recipeVariants({
    default: {
      box: { direction: "row", gap: "sm", pad: "xs", width: "full", wrap: true },
      text: { color: "fg-muted", size: "sm", weight: "semibold" },
      parts: {
        item: {
          box: { pad: "sm", radius: "md" },
          text: { color: "fg-muted", size: "sm", weight: "semibold" },
        },
        activeTab: {
          box: { bg: "surface-2", pad: "sm", radius: "md" },
          text: { color: "fg", size: "sm", weight: "semibold" },
        },
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
  metric: metricRecipeVariants(),
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
  stat: metricRecipeVariants(),
  badge: recipeVariants({
    neutral: {
      box: { bg: "surface-2", pad: "xs", radius: "full" },
      text: { color: "neutral", size: "xs", weight: "semibold" },
      parts: {
        label: { text: { color: "neutral", size: "xs", weight: "semibold" } },
      },
    },
    success: {
      box: { bg: "surface", border: true, pad: "xs", radius: "full" },
      text: { color: "success", size: "xs", weight: "semibold" },
      parts: {
        label: { text: { color: "success", size: "xs", weight: "semibold" } },
      },
    },
    warning: {
      box: { bg: "surface", border: true, pad: "xs", radius: "full" },
      text: { color: "warning", size: "xs", weight: "semibold" },
      parts: {
        label: { text: { color: "warning", size: "xs", weight: "semibold" } },
      },
    },
    danger: {
      box: { bg: "surface", border: true, pad: "xs", radius: "full" },
      text: { color: "danger", size: "xs", weight: "semibold" },
      parts: {
        label: { text: { color: "danger", size: "xs", weight: "semibold" } },
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
  alert: recipeVariants({
    info: {
      box: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md" },
      text: { color: "info" },
      parts: {
        title: { text: { color: "info", weight: "bold" } },
        body: { text: { color: "fg" } },
      },
    },
    success: {
      box: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md" },
      text: { color: "success" },
      parts: {
        title: { text: { color: "success", weight: "bold" } },
        body: { text: { color: "fg" } },
      },
    },
    warning: {
      box: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md" },
      text: { color: "warning" },
      parts: {
        title: { text: { color: "warning", weight: "bold" } },
        body: { text: { color: "fg" } },
      },
    },
    danger: {
      box: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md" },
      text: { color: "danger" },
      parts: {
        title: { text: { color: "danger", weight: "bold" } },
        body: { text: { color: "fg" } },
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
  divider: recipeVariants({
    default: {
      box: { border: true, width: "full" },
      parts: {
        label: { text: { color: "fg-muted", size: "xs", weight: "medium" } },
        rule: { box: { bg: "border", width: "full" } },
      },
    },
  }),
  form: recipeVariants({
    default: {
      box: { bg: "surface", border: true, gap: "md", pad: "md", radius: "md", width: "full" },
      text: { color: "fg" },
      parts: {
        header: { box: { gap: "xs" } },
        title: { text: { color: "fg", size: "lg", weight: "bold" } },
        body: { text: { color: "fg-muted" } },
        actions: {
          box: { bg: "accent", pad: "sm", radius: "md" },
          text: { color: "accent-fg", weight: "semibold" },
        },
      },
    },
  }),
  search: recipeVariants({
    default: {
      box: { direction: "row", gap: "sm", align: "end", wrap: true, width: "full" },
      text: { color: "fg" },
      field: { width: "full" },
      parts: {
        label: { text: { color: "fg-muted", size: "sm", weight: "semibold" } },
        control: { box: { gap: "xs", grow: true }, field: { width: "full" } },
        input: { field: { width: "full" } },
      },
    },
  }),
  filterBar: recipeVariants({
    default: {
      box: { direction: "row", gap: "sm", align: "end", wrap: true, width: "full" },
      text: { color: "fg" },
      field: { width: "full" },
      parts: {
        item: { box: { gap: "xs", grow: true } },
        label: { text: { color: "fg-muted", size: "sm", weight: "semibold" } },
        control: { field: { width: "full" } },
        input: { field: { width: "full" } },
      },
    },
  }),
  emptyState: recipeVariants({
    default: {
      box: {
        bg: "surface",
        border: true,
        gap: "sm",
        pad: "lg",
        radius: "md",
        align: "center",
        width: "full",
      },
      text: { color: "fg", align: "center" },
      parts: {
        title: { text: { color: "fg", align: "center", size: "lg", weight: "bold" } },
        body: { text: { color: "fg-muted", align: "center" } },
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
} satisfies ComponentRecipes);

/**
 * The default theme expressed as an operator DOCUMENT (the `@facet/core`
 * `FacetTheme` shape): token NAMES → today's concrete values, across all eight
 * token groups plus component recipes. It passes `validateTheme` cleanly, so
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
