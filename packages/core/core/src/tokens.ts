/**
 * Closed style values an agent may author.
 *
 * Token domains carry brand-sensitive names whose concrete values are supplied
 * by a validated Theme. Fixed domains carry renderer semantics that do not vary
 * by Theme. Neither surface accepts raw CSS values.
 */

export const SPACES = ["none", "xs", "sm", "md", "lg", "xl", "2xl"] as const;
export type Space = (typeof SPACES)[number];

export const FONT_SIZES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const FONT_FAMILIES = ["sans", "serif", "mono"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const FONT_WEIGHTS = ["regular", "medium", "semibold", "bold"] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const RADII = ["none", "sm", "md", "lg", "full"] as const;
export type Radius = (typeof RADII)[number];

export const BORDER_WIDTHS = ["none", "thin", "medium", "thick"] as const;
export type BorderWidth = (typeof BORDER_WIDTHS)[number];

export const ASPECT_RATIOS = ["auto", "square", "landscape", "portrait", "wide"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const MIN_HEIGHTS = ["auto", "half", "screen"] as const;
export type MinHeight = (typeof MIN_HEIGHTS)[number];

export const MAX_WIDTHS = ["none", "prose", "narrow", "wide"] as const;
export type MaxWidth = (typeof MAX_WIDTHS)[number];

export const LETTER_SPACINGS = ["tight", "normal", "wide"] as const;
export type LetterSpacing = (typeof LETTER_SPACINGS)[number];

export const LINE_HEIGHTS = ["tight", "normal", "relaxed"] as const;
export type LineHeight = (typeof LINE_HEIGHTS)[number];

export const CONTROL_HEIGHTS = ["sm", "md", "lg"] as const;
export type ControlHeight = (typeof CONTROL_HEIGHTS)[number];

export const INDICATOR_SIZES = ["sm", "md", "lg"] as const;
export type IndicatorSize = (typeof INDICATOR_SIZES)[number];

export const PROGRESS_THICKNESSES = ["sm", "md", "lg"] as const;
export type ProgressThickness = (typeof PROGRESS_THICKNESSES)[number];

export const CHART_THICKNESSES = ["sm", "md", "lg"] as const;
export type ChartThickness = (typeof CHART_THICKNESSES)[number];

/** Semantic paint roles. Theme light/dark branches own their concrete colors. */
export const COLORS = [
  "background",
  "surface",
  "mutedSurface",
  "foreground",
  "mutedForeground",
  "border",
  "accent",
  "accentSurface",
  "accentForeground",
  "focusRing",
  "success",
  "successSurface",
  "successForeground",
  "warning",
  "warningSurface",
  "warningForeground",
  "danger",
  "dangerSurface",
  "dangerForeground",
  "info",
  "infoSurface",
  "infoForeground",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "chart6",
  "inherit",
] as const;
export type Color = (typeof COLORS)[number];

export const SHADOWS = ["none", "sm", "md", "lg"] as const;
export type Shadow = (typeof SHADOWS)[number];

export const GRADIENTS = ["none", "accent", "success", "warning", "danger", "info"] as const;
export type Gradient = (typeof GRADIENTS)[number];

export const SCRIMS = ["none", "soft", "strong"] as const;
export type Scrim = (typeof SCRIMS)[number];

export const HIGHLIGHTS = ["none", "accent", "warning"] as const;
export type Highlight = (typeof HIGHLIGHTS)[number];

/** Fixed renderer semantics. These values are never resolved through a Theme. */
export const DIRECTIONS = ["row", "column"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ALIGNMENTS = ["start", "center", "end", "stretch"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export const JUSTIFICATIONS = ["start", "center", "end", "between", "around"] as const;
export type Justification = (typeof JUSTIFICATIONS)[number];

export const BOOLEAN_VALUES = [false, true] as const;
export type BooleanValue = (typeof BOOLEAN_VALUES)[number];

export const WIDTHS = ["auto", "full"] as const;
export type Width = (typeof WIDTHS)[number];

export const SCROLLS = ["none", "horizontal", "vertical"] as const;
export type Scroll = (typeof SCROLLS)[number];

export const COLUMNS = ["none", 2, 3, 4] as const;
export type Columns = (typeof COLUMNS)[number];

export const TEXT_ALIGNS = ["start", "center", "end"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const FONT_STYLES = ["normal", "italic"] as const;
export type FontStyle = (typeof FONT_STYLES)[number];

export const OBJECT_FITS = ["cover", "contain"] as const;
export type ObjectFit = (typeof OBJECT_FITS)[number];

export const OBJECT_POSITIONS = ["center", "top", "bottom", "start", "end"] as const;
export type ObjectPosition = (typeof OBJECT_POSITIONS)[number];

export const ENTER_ANIMATIONS = ["none", "fade", "slide"] as const;
export type EnterAnimation = (typeof ENTER_ANIMATIONS)[number];

export const LOADING_ANIMATIONS = ["none", "pulse"] as const;
export type LoadingAnimation = (typeof LOADING_ANIMATIONS)[number];
