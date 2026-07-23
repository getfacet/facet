/** Public contract for one complete, operator-owned Facet design system. */
import type { BrickType } from "./brick-contract.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import type { BrickStyleDefinition, BrickStyleDefinitionMap } from "./style-types.js";
import type {
  AspectRatio,
  BorderWidth,
  ChartThickness,
  Color,
  ControlHeight,
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
} from "./tokens.js";

export type CompleteMap<K extends PropertyKey, V> = Readonly<Record<K, V>>;

export interface FacetPaintTokens {
  readonly color: CompleteMap<Color, string>;
  readonly shadow: CompleteMap<Shadow, string>;
  readonly gradient: CompleteMap<Gradient, string>;
  readonly scrim: CompleteMap<Scrim, string>;
  readonly highlight: CompleteMap<Highlight, string>;
}

export interface FacetThemeTokens {
  readonly space: CompleteMap<Space, string>;
  readonly fontSize: CompleteMap<FontSize, string>;
  readonly fontFamily: CompleteMap<FontFamily, string>;
  readonly fontWeight: CompleteMap<FontWeight, number>;
  readonly radius: CompleteMap<Radius, string>;
  readonly borderWidth: CompleteMap<BorderWidth, string>;
  readonly aspectRatio: CompleteMap<AspectRatio, string>;
  readonly minHeight: CompleteMap<MinHeight, string>;
  readonly maxWidth: CompleteMap<MaxWidth, string>;
  readonly layoutWidth: CompleteMap<LayoutWidth, string>;
  readonly maxHeight: CompleteMap<MaxHeight, string>;
  readonly letterSpacing: CompleteMap<LetterSpacing, string>;
  readonly lineHeight: CompleteMap<LineHeight, string>;
  readonly controlHeight: CompleteMap<ControlHeight, string>;
  readonly indicatorSize: CompleteMap<IndicatorSize, string>;
  readonly progressThickness: CompleteMap<ProgressThickness, string>;
  readonly chartThickness: CompleteMap<ChartThickness, string>;
  readonly paint: {
    readonly light: FacetPaintTokens;
    readonly dark: FacetPaintTokens;
  };
}

export interface FacetPreset<B extends BrickType = BrickType> {
  readonly description: string;
  readonly useWhen: string;
  readonly avoidWhen?: string;
  readonly style: BrickStyleDefinition<B>;
}

export type FacetPresets = Readonly<{
  readonly [B in BrickType]?: Readonly<Record<string, FacetPreset<B>>>;
}>;

export interface FacetTheme {
  readonly name: string;
  readonly description?: string;
  readonly tokens: FacetThemeTokens;
  readonly defaults: BrickStyleDefinitionMap;
  readonly presets?: FacetPresets;
}

export interface ThemeIssue {
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface ThemeValidationResult {
  /** Present iff validation raised no error. Invalid Themes are never partial. */
  readonly theme?: FacetTheme;
  readonly issues: readonly ThemeIssue[];
}

/** Shared filename/slot-safe name grammar for Theme and Preset identifiers. */
export function isValidThemeName(name: string): boolean {
  return SLOT_NAME_RE.test(name);
}

/** Shared bound for short agent-facing Theme/Preset prose. */
export const MAX_DESCRIPTION_LENGTH = 200;

/** Theme concrete CSS values are operator data, but remain tightly bounded. */
export const MAX_THEME_CSS_VALUE_BYTES = 512;
