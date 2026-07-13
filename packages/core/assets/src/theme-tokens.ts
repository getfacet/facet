import { DEFAULT_COLORS } from "@facet/core";
import type {
  Color,
  FontFamily,
  FontSize,
  FontWeight,
  Gradient,
  Highlight,
  Leading,
  MaxWidth,
  MinHeight,
  Radius,
  Ratio,
  Scrim,
  Shadow,
  Space,
  Tracking,
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
    // Landing-grade display ramp (~1.3× steps), continuing the px scale above.
    "4xl": "64px",
    "5xl": "80px",
    "6xl": "96px",
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

// ── Landing-grade token groups ──────────────────────────────────────────────
// Concrete resolved CSS for the closed landing-grade vocabulary. The dimension
// groups deliberately use the semantically-correct units (`svh`, `ch`, unitless
// line-heights, the `auto`/`none` keywords) that a section-scale layout needs —
// these are consumed directly by @facet/react's DEFAULT_RESOLVED, not routed
// through the operator theme-document validator (whose dimension handler only
// accepts 0/px/rem/em); see theme.ts for which groups DEFAULT_THEME wires in.

export const MIN_HEIGHT: Record<MinHeight, string> = Object.assign(
  Object.create(null) as Record<MinHeight, string>,
  {
    auto: "auto",
    half: "50svh",
    screen: "100svh",
  } satisfies Record<MinHeight, string>,
);

export const MAX_WIDTH: Record<MaxWidth, string> = Object.assign(
  Object.create(null) as Record<MaxWidth, string>,
  {
    none: "none",
    prose: "65ch",
    narrow: "640px",
    wide: "1200px",
  } satisfies Record<MaxWidth, string>,
);

export const TRACKING: Record<Tracking, string> = Object.assign(
  Object.create(null) as Record<Tracking, string>,
  {
    tight: "-0.02em",
    normal: "0",
    wide: "0.04em",
  } satisfies Record<Tracking, string>,
);

export const LEADING: Record<Leading, string> = Object.assign(
  Object.create(null) as Record<Leading, string>,
  {
    tight: "1.1",
    normal: "1.5",
    relaxed: "1.75",
  } satisfies Record<Leading, string>,
);

export const GRADIENT: Record<Gradient, string> = Object.assign(
  Object.create(null) as Record<Gradient, string>,
  {
    none: "none",
    accent: "linear-gradient(180deg, #4f46e5, #7c3aed)",
    dusk: "linear-gradient(180deg, #1e293b, #4f46e5)",
    dawn: "linear-gradient(135deg, #f59e0b, #db2777)",
  } satisfies Record<Gradient, string>,
);

export const SCRIM: Record<Scrim, string> = Object.assign(
  Object.create(null) as Record<Scrim, string>,
  {
    none: "transparent",
    light: "rgba(255, 255, 255, 0.4)",
    dark: "rgba(0, 0, 0, 0.5)",
  } satisfies Record<Scrim, string>,
);

export const HIGHLIGHT: Record<Highlight, string> = Object.assign(
  Object.create(null) as Record<Highlight, string>,
  {
    none: "none",
    accent: "linear-gradient(transparent 60%, #c7d2fe 60%)",
    band: "linear-gradient(transparent 55%, #fde68a 55%)",
  } satisfies Record<Highlight, string>,
);

// Dark-scheme palette: the same closed `Color` keys as COLOR, retuned for a dark
// background (light fg, dark bg/surface, brightened accents/charts). Selected by
// `scheme:"dark"` at render time via ResolvedTheme.colorDark.
export const COLOR_DARK: Record<Color, string> = Object.assign(
  Object.create(null) as Record<Color, string>,
  {
    fg: "#f5f5f7",
    "fg-muted": "#a1a1aa",
    bg: "#0b0b0f",
    surface: "#16161c",
    "surface-2": "#1f1f27",
    // indigo-600 (darker than -500) so white accent-fg clears the 4.5 contrast
    // floor the new colorDark contrast check enforces (−500 measured 4.47).
    accent: "#4f46e5",
    "accent-fg": "#ffffff",
    border: "#2a2a33",
    neutral: "#94a3b8",
    info: "#38bdf8",
    success: "#22c55e",
    warning: "#f59e0b",
    danger: "#f87171",
    "chart-1": "#60a5fa",
    "chart-2": "#4ade80",
    "chart-3": "#fbbf24",
    "chart-4": "#f87171",
    "chart-5": "#a78bfa",
    "chart-6": "#22d3ee",
  } satisfies Record<Color, string>,
);
