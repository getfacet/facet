import { DEFAULT_COLORS } from "@facet/core";
import type {
  Color,
  FacetTheme,
  FontFamily,
  FontSize,
  FontWeight,
  Radius,
  Ratio,
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

/**
 * The default theme expressed as an operator DOCUMENT (the `@facet/core`
 * `FacetTheme` shape): token NAMES → today's concrete values, across all seven
 * groups. It passes `validateTheme` cleanly, so operators can copy it as the
 * starting point for a reskin, and hosts can register it by name. `@facet/react`
 * and `@facet/runtime` both import this as the default base layer.
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
};
