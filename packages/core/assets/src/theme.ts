import { DEFAULT_COLORS } from "@facet/core";
import type {
  Color,
  ComponentRecipe,
  ComponentRecipes,
  FacetTheme,
  FontFamily,
  FontSize,
  FontWeight,
  Radius,
  Ratio,
  Shadow,
  Space,
} from "@facet/core";

/**
 * The default theme data — where token NAMES become concrete CSS values. This is
 * the one place pixels, hex codes, and font stacks live; the agent never sees
 * them. Swap these maps to reskin every Facet page without touching a single
 * agent. `@facet/react` imports these as its default floor, so this is now the
 * SINGLE source of truth for the default token values (no per-renderer copy).
 */
// Agents emit token NAMES that index straight into these maps, so the maps are
// built on a null prototype: a hostile token like "constructor" or "__proto__"
// then resolves to `undefined` instead of an inherited prototype value that
// would land in the CSS. The `satisfies Record<...>` on each source literal
// keeps the exhaustiveness check (a missing or typo'd key is a compile error);
// the outer `Object.assign` return type would otherwise erase it.
export const SPACE: Record<Space, string> = Object.assign(
  Object.create(null) as Record<Space, string>,
  {
    none: "0",
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "40px",
    "2xl": "64px",
  } satisfies Record<Space, string>,
);

export const FONT_SIZE: Record<FontSize, string> = Object.assign(
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

export const FONT_FAMILY: Record<FontFamily, string> = Object.assign(
  Object.create(null) as Record<FontFamily, string>,
  {
    sans: "Nunito, sans-serif",
    serif: 'Georgia, "Times New Roman", serif',
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  } satisfies Record<FontFamily, string>,
);

export const FONT_WEIGHT: Record<FontWeight, number> = Object.assign(
  Object.create(null) as Record<FontWeight, number>,
  {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  } satisfies Record<FontWeight, number>,
);

export const RADIUS: Record<Radius, string> = Object.assign(
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
 * itself re-exported (through the renderer) so app chrome (e.g. `ChatDock`) reuses
 * them instead of re-hardcoding hex.
 */
export const COLOR: Record<Color, string> = Object.assign(
  Object.create(null) as Record<Color, string>,
  DEFAULT_COLORS,
);

export const RATIO: Record<Ratio, string> = Object.assign(
  Object.create(null) as Record<Ratio, string>,
  {
    square: "1 / 1",
    wide: "16 / 9",
    tall: "3 / 4",
  } satisfies Record<Ratio, string>,
);

export const SHADOW: Record<Shadow, string> = Object.assign(
  Object.create(null) as Record<Shadow, string>,
  {
    none: "none",
    sm: "0 1px 2px rgba(15, 23, 42, 0.08)",
    md: "0 12px 30px rgba(15, 23, 42, 0.14)",
    lg: "0 24px 60px rgba(15, 23, 42, 0.18)",
  } satisfies Record<Shadow, string>,
);

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
        control: { field: { width: "full" } },
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
  stat: recipeVariants({
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
  }),
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
      box: { bg: "surface-2", radius: "full", width: "full" },
      parts: {
        label: { text: { color: "fg-muted", size: "sm", weight: "medium" } },
        track: { box: { bg: "surface-2", radius: "full", width: "full" } },
        fill: { box: { bg: "accent", radius: "full", width: "full" } },
      },
    },
    success: {
      box: { bg: "success", radius: "full", width: "full" },
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
  recipes: RECIPES,
};
