import { DEFAULT_COLORS } from "@facet/core";
import type {
  Color,
  FontFamily,
  FontSize,
  FontWeight,
  Radius,
  Ratio,
  Shadow,
  Space,
} from "@facet/core";

/** Concrete CSS values for the closed token vocabulary, all null-prototype. */
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
  { regular: 400, medium: 500, semibold: 600, bold: 700 } satisfies Record<FontWeight, number>,
);

export const RADIUS: Record<Radius, string> = Object.assign(
  Object.create(null) as Record<Radius, string>,
  { none: "0", sm: "6px", md: "10px", lg: "16px", full: "9999px" } satisfies Record<Radius, string>,
);

export const COLOR: Record<Color, string> = Object.assign(
  Object.create(null) as Record<Color, string>,
  DEFAULT_COLORS,
);

export const RATIO: Record<Ratio, string> = Object.assign(
  Object.create(null) as Record<Ratio, string>,
  { square: "1 / 1", wide: "16 / 9", tall: "3 / 4" } satisfies Record<Ratio, string>,
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
