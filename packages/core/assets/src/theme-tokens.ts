import type {
  AspectRatio,
  BorderWidth,
  ChartThickness,
  Color,
  ControlHeight,
  FacetPaintTokens,
  FontFamily,
  FontSize,
  FontWeight,
  Gradient,
  Highlight,
  IndicatorSize,
  LayoutWidth,
  LetterSpacing,
  LineHeight,
  MaxHeight,
  MaxWidth,
  MinHeight,
  ProgressThickness,
  Radius,
  Scrim,
  Shadow,
  Space,
} from "@facet/core";

const tokenMap = <K extends string, V>(values: Record<K, V>): Readonly<Record<K, V>> =>
  Object.assign(Object.create(null) as Record<K, V>, values);

export const SPACE = tokenMap<Space, string>({
  none: "0",
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "40px",
  "2xl": "64px",
});

export const FONT_SIZE = tokenMap<FontSize, string>({
  xs: "12px",
  sm: "14px",
  md: "16px",
  lg: "20px",
  xl: "28px",
  "2xl": "36px",
  "3xl": "48px",
  "4xl": "64px",
});

export const FONT_FAMILY = tokenMap<FontFamily, string>({
  sans: "Nunito, sans-serif",
  serif: 'Georgia, "Times New Roman", serif',
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
});

export const FONT_WEIGHT = tokenMap<FontWeight, number>({
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
});

export const RADIUS = tokenMap<Radius, string>({
  none: "0",
  sm: "6px",
  md: "10px",
  lg: "16px",
  full: "9999px",
});

export const BORDER_WIDTH = tokenMap<BorderWidth, string>({
  none: "0",
  thin: "1px",
  medium: "2px",
  thick: "4px",
});

export const ASPECT_RATIO = tokenMap<AspectRatio, string>({
  auto: "auto",
  square: "1 / 1",
  landscape: "4 / 3",
  portrait: "3 / 4",
  wide: "16 / 9",
});

export const MIN_HEIGHT = tokenMap<MinHeight, string>({
  auto: "auto",
  half: "50svh",
  screen: "100svh",
});

export const MAX_WIDTH = tokenMap<MaxWidth, string>({
  none: "none",
  prose: "65ch",
  narrow: "640px",
  wide: "1200px",
});

// One scale serves both `basis` (a pane's own width) and `itemWidth` (an
// auto-grid item floor). Pure lengths — no keyword, no unitless zero.
export const LAYOUT_WIDTH = tokenMap<LayoutWidth, string>({
  xs: "12rem",
  sm: "16rem",
  md: "20rem",
  lg: "24rem",
});

// `none` is the absent-equivalent sentinel (no CSS max-height emitted); the
// bounded values fill half or all of the small viewport height.
export const MAX_HEIGHT = tokenMap<MaxHeight, string>({
  none: "none",
  half: "50svh",
  screen: "100svh",
});

export const LETTER_SPACING = tokenMap<LetterSpacing, string>({
  tight: "-0.02em",
  normal: "0",
  wide: "0.04em",
});

export const LINE_HEIGHT = tokenMap<LineHeight, string>({
  tight: "1.1",
  normal: "1.5",
  relaxed: "1.75",
});

export const CONTROL_HEIGHT = tokenMap<ControlHeight, string>({
  sm: "32px",
  md: "40px",
  lg: "48px",
});

export const INDICATOR_SIZE = tokenMap<IndicatorSize, string>({
  sm: "12px",
  md: "16px",
  lg: "20px",
});

export const PROGRESS_THICKNESS = tokenMap<ProgressThickness, string>({
  sm: "4px",
  md: "8px",
  lg: "12px",
});

export const CHART_THICKNESS = tokenMap<ChartThickness, string>({
  sm: "1px",
  md: "2px",
  lg: "4px",
});

export const COLOR = tokenMap<Color, string>({
  background: "#ffffff",
  surface: "#f8fafc",
  mutedSurface: "#eef2f7",
  foreground: "#172033",
  mutedForeground: "#64748b",
  border: "#dce2ea",
  accent: "#4f46e5",
  accentSurface: "#eef2ff",
  accentForeground: "#ffffff",
  focusRing: "#6366f1",
  success: "#15803d",
  successSurface: "#dcfce7",
  successForeground: "#14532d",
  warning: "#b45309",
  warningSurface: "#fef3c7",
  warningForeground: "#78350f",
  danger: "#b91c1c",
  dangerSurface: "#fee2e2",
  dangerForeground: "#7f1d1d",
  info: "#0369a1",
  infoSurface: "#e0f2fe",
  infoForeground: "#0c4a6e",
  chart1: "#2563eb",
  chart2: "#16a34a",
  chart3: "#d97706",
  chart4: "#dc2626",
  chart5: "#7c3aed",
  chart6: "#0891b2",
  inherit: "inherit",
});

export const COLOR_DARK = tokenMap<Color, string>({
  background: "#0b0b0f",
  surface: "#16161c",
  mutedSurface: "#20202a",
  foreground: "#f5f5f7",
  mutedForeground: "#a1a1aa",
  border: "#30303b",
  accent: "#818cf8",
  accentSurface: "#312e81",
  accentForeground: "#111827",
  focusRing: "#a5b4fc",
  success: "#4ade80",
  successSurface: "#14532d",
  successForeground: "#dcfce7",
  warning: "#fbbf24",
  warningSurface: "#78350f",
  warningForeground: "#fef3c7",
  danger: "#f87171",
  dangerSurface: "#7f1d1d",
  dangerForeground: "#fee2e2",
  info: "#38bdf8",
  infoSurface: "#0c4a6e",
  infoForeground: "#e0f2fe",
  chart1: "#60a5fa",
  chart2: "#4ade80",
  chart3: "#fbbf24",
  chart4: "#f87171",
  chart5: "#a78bfa",
  chart6: "#22d3ee",
  inherit: "inherit",
});

export const SHADOW = tokenMap<Shadow, string>({
  none: "none",
  sm: "0 1px 2px rgba(15, 23, 42, 0.08)",
  md: "0 12px 30px rgba(15, 23, 42, 0.14)",
  lg: "0 24px 60px rgba(15, 23, 42, 0.18)",
});

export const GRADIENT = tokenMap<Gradient, string>({
  none: "none",
  accent: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
  success: "linear-gradient(135deg, #15803d 0%, #16a34a 100%)",
  warning: "linear-gradient(135deg, #b45309 0%, #d97706 100%)",
  danger: "linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)",
  info: "linear-gradient(135deg, #0369a1 0%, #0891b2 100%)",
});

export const SCRIM = tokenMap<Scrim, string>({
  none: "transparent",
  soft: "rgba(15, 23, 42, 0.35)",
  strong: "rgba(15, 23, 42, 0.7)",
});

export const HIGHLIGHT = tokenMap<Highlight, string>({
  none: "none",
  accent: "linear-gradient(0deg, #c7d2fe 0%, #c7d2fe 100%)",
  warning: "linear-gradient(0deg, #fde68a 0%, #fde68a 100%)",
});

export const PAINT_LIGHT: FacetPaintTokens = {
  color: COLOR,
  shadow: SHADOW,
  gradient: GRADIENT,
  scrim: SCRIM,
  highlight: HIGHLIGHT,
};

export const PAINT_DARK: FacetPaintTokens = {
  color: COLOR_DARK,
  shadow: SHADOW,
  gradient: GRADIENT,
  scrim: SCRIM,
  highlight: HIGHLIGHT,
};
