import type { BrickType } from "./brick-contract.js";
import type {
  Alignment,
  AspectRatio,
  BorderWidth,
  ChartThickness,
  Color,
  Columns,
  ControlHeight,
  Direction,
  EnterAnimation,
  FontFamily,
  FontSize,
  FontStyle,
  FontWeight,
  Gradient,
  Highlight,
  IndicatorSize,
  Justification,
  LetterSpacing,
  LineClamp,
  LineHeight,
  TextWrap,
  LoadingAnimation,
  MaxWidth,
  MinHeight,
  ObjectFit,
  ObjectPosition,
  ProgressThickness,
  Radius,
  Scrim,
  Scroll,
  Shadow,
  Space,
  TextAlign,
  Width,
} from "./tokens.js";

interface TypographyStyle {
  readonly fontFamily?: FontFamily;
  readonly fontSize?: FontSize;
  readonly fontWeight?: FontWeight;
  readonly fontStyle?: FontStyle;
  readonly color?: Color;
  readonly textAlign?: TextAlign;
  readonly letterSpacing?: LetterSpacing;
  readonly lineHeight?: LineHeight;
}

interface TextFlowStyle {
  readonly textWrap?: TextWrap;
  readonly lineClamp?: LineClamp;
}

interface FlowTypographyStyle extends TypographyStyle, TextFlowStyle {}

interface SurfaceStyle {
  readonly background?: Color;
  readonly color?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly borderRadius?: Radius;
  readonly shadow?: Shadow;
}

interface PaintState {
  readonly background?: Color;
  readonly color?: Color;
  readonly borderColor?: Color;
  readonly shadow?: Shadow;
}

interface FocusState {
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly shadow?: Shadow;
}

interface BoxDirectStyle {
  readonly direction?: Direction;
  readonly gap?: Space;
  readonly padding?: Space;
  readonly alignItems?: Alignment;
  readonly justifyContent?: Justification;
  readonly wrap?: boolean;
  readonly columns?: Columns;
  readonly grow?: boolean;
  readonly width?: Width;
  readonly minHeight?: MinHeight;
  readonly maxWidth?: MaxWidth;
  readonly scroll?: Scroll;
  readonly sticky?: boolean;
  readonly background?: Color;
  readonly color?: Color;
  readonly backgroundGradient?: Gradient;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly borderRadius?: Radius;
  readonly shadow?: Shadow;
  readonly backdropScrim?: Scrim;
  readonly enterAnimation?: EnterAnimation;
}

export interface BoxStyleDefinition extends BoxDirectStyle {
  readonly hover?: PaintState;
  readonly pressed?: PaintState;
  readonly focus?: FocusState;
}

export interface TextStyleDefinition extends FlowTypographyStyle {
  readonly highlight?: Highlight;
}

export interface MediaStyleDefinition {
  readonly width?: Width;
  readonly aspectRatio?: AspectRatio;
  readonly objectFit?: ObjectFit;
  readonly objectPosition?: ObjectPosition;
  readonly iconSize?: IndicatorSize;
  readonly padding?: Space;
  readonly background?: Color;
  readonly color?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly borderRadius?: Radius;
}

interface InputControlDirectStyle extends TypographyStyle, SurfaceStyle {
  readonly padding?: Space;
  readonly controlHeight?: ControlHeight;
}

interface InputControlStyle extends InputControlDirectStyle {
  readonly hover?: PaintState;
  readonly focus?: FocusState;
}

interface InputPlaceholderStyle {
  readonly color?: Color;
  readonly fontStyle?: FontStyle;
}

interface InputIndicatorDirectStyle {
  readonly color?: Color;
  readonly background?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly borderRadius?: Radius;
  readonly indicatorSize?: IndicatorSize;
}

interface InputIndicatorStyle extends InputIndicatorDirectStyle {
  readonly checked?: Pick<InputIndicatorDirectStyle, "color" | "background" | "borderColor">;
  readonly focus?: Pick<InputIndicatorDirectStyle, "borderColor" | "borderWidth">;
}

interface InputOptionDirectStyle extends TypographyStyle {
  readonly gap?: Space;
}

interface InputOptionStyle extends InputOptionDirectStyle {
  readonly checked?: Pick<InputOptionDirectStyle, "color" | "fontWeight">;
  readonly hover?: Pick<InputOptionDirectStyle, "color" | "fontWeight">;
}

interface InputDirectStyle {
  readonly width?: Width;
  readonly direction?: Direction;
  readonly gap?: Space;
  readonly alignItems?: Alignment;
  readonly label?: TypographyStyle;
  readonly control?: InputControlDirectStyle;
  readonly placeholder?: InputPlaceholderStyle;
  readonly indicator?: InputIndicatorDirectStyle;
  readonly option?: InputOptionDirectStyle;
}

export interface InputStyleDefinition extends Omit<
  InputDirectStyle,
  "control" | "indicator" | "option"
> {
  readonly control?: InputControlStyle;
  readonly indicator?: InputIndicatorStyle;
  readonly option?: InputOptionStyle;
}

interface RichTextQuoteStyle extends TypographyStyle {
  readonly background?: Color;
  readonly padding?: Space;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
}

interface RichTextCodeStyle extends TypographyStyle {
  readonly background?: Color;
  readonly padding?: Space;
  readonly borderRadius?: Radius;
}

interface RichTextLinkDirectStyle extends TypographyStyle {
  readonly highlight?: Highlight;
}

interface LinkPaintState {
  readonly color?: Color;
  readonly highlight?: Highlight;
}

interface RichTextLinkStyle extends RichTextLinkDirectStyle {
  readonly hover?: LinkPaintState;
  readonly pressed?: LinkPaintState;
  readonly focus?: LinkPaintState;
}

interface MarkerStyle {
  readonly color?: Color;
  readonly fontSize?: FontSize;
  readonly fontWeight?: FontWeight;
}

interface RichTextDirectStyle extends FlowTypographyStyle {
  readonly blockGap?: Space;
  readonly heading1?: TypographyStyle;
  readonly heading2?: TypographyStyle;
  readonly heading3?: TypographyStyle;
  readonly quote?: RichTextQuoteStyle;
  readonly code?: RichTextCodeStyle;
  readonly link?: RichTextLinkDirectStyle;
  readonly listMarker?: MarkerStyle;
}

export interface RichTextStyleDefinition extends Omit<RichTextDirectStyle, "link"> {
  readonly link?: RichTextLinkStyle;
}

interface TableRootStyle extends SurfaceStyle {
  readonly width?: Width;
}

interface TableCaptionStyle extends FlowTypographyStyle {
  readonly padding?: Space;
  readonly background?: Color;
}

interface TableHeaderDirectStyle extends FlowTypographyStyle {
  readonly padding?: Space;
  readonly background?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
}

interface TableHeaderPaintState {
  readonly background?: Color;
  readonly color?: Color;
  readonly borderColor?: Color;
}

interface TableHeaderStyle extends TableHeaderDirectStyle {
  readonly hover?: TableHeaderPaintState;
  readonly pressed?: TableHeaderPaintState;
  readonly focus?: Pick<TableHeaderDirectStyle, "borderColor" | "borderWidth">;
  readonly sorted?: Pick<TableHeaderDirectStyle, "background" | "color" | "fontWeight">;
}

interface TableRowDirectStyle {
  readonly background?: Color;
  readonly color?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
}

interface TableRowStyle extends TableRowDirectStyle {
  readonly alternate?: TableRowDirectStyle;
  readonly hover?: TableRowDirectStyle;
}

interface TableCellStyle extends FlowTypographyStyle {
  readonly padding?: Space;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
}

interface TableDirectStyle extends TableRootStyle {
  readonly caption?: TableCaptionStyle;
  readonly header?: TableHeaderDirectStyle;
  readonly row?: TableRowDirectStyle;
  readonly cell?: TableCellStyle;
}

export interface TableStyleDefinition extends Omit<TableDirectStyle, "header" | "row"> {
  readonly header?: TableHeaderStyle;
  readonly row?: TableRowStyle;
}

interface ChartPlotStyle {
  readonly background?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly borderRadius?: Radius;
  readonly axisColor?: Color;
  readonly gridColor?: Color;
  readonly labelColor?: Color;
}

interface ChartSeriesStyle {
  readonly color1?: Color;
  readonly color2?: Color;
  readonly color3?: Color;
  readonly color4?: Color;
  readonly color5?: Color;
  readonly color6?: Color;
  readonly thickness?: ChartThickness;
}

export interface ChartStyleDefinition {
  readonly width?: Width;
  readonly gap?: Space;
  readonly padding?: Space;
  readonly background?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly borderRadius?: Radius;
  readonly shadow?: Shadow;
  readonly title?: TypographyStyle;
  readonly plot?: ChartPlotStyle;
  readonly series?: ChartSeriesStyle;
}

interface ListItemStyle {
  readonly gap?: Space;
  readonly padding?: Space;
  readonly background?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly borderRadius?: Radius;
}

export interface ListStyleDefinition {
  readonly gap?: Space;
  readonly padding?: Space;
  readonly background?: Color;
  readonly color?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly borderRadius?: Radius;
  readonly item?: ListItemStyle;
  readonly title?: FlowTypographyStyle;
  readonly body?: FlowTypographyStyle;
  readonly marker?: MarkerStyle;
}

interface KeyValueItemStyle {
  readonly gap?: Space;
  readonly padding?: Space;
  readonly background?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
}

export interface KeyValueStyleDefinition {
  readonly gap?: Space;
  readonly padding?: Space;
  readonly background?: Color;
  readonly color?: Color;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly borderRadius?: Radius;
  readonly item?: KeyValueItemStyle;
  readonly label?: TypographyStyle;
  readonly value?: TypographyStyle;
}

interface ProgressTrackStyle {
  readonly background?: Color;
  readonly height?: ProgressThickness;
  readonly borderColor?: Color;
  readonly borderWidth?: BorderWidth;
  readonly borderRadius?: Radius;
}

interface ProgressFillStyle {
  readonly background?: Color;
  readonly backgroundGradient?: Gradient;
  readonly borderRadius?: Radius;
}

export interface ProgressStyleDefinition {
  readonly width?: Width;
  readonly gap?: Space;
  readonly label?: TypographyStyle;
  readonly track?: ProgressTrackStyle;
  readonly fill?: ProgressFillStyle;
}

interface LoadingIndicatorStyle {
  readonly size?: IndicatorSize;
  readonly color?: Color;
  readonly animation?: LoadingAnimation;
}

export interface LoadingStyleDefinition {
  readonly direction?: Direction;
  readonly gap?: Space;
  readonly alignItems?: Alignment;
  readonly indicator?: LoadingIndicatorStyle;
  readonly label?: TypographyStyle;
}

/** Direct style data used by Theme defaults and Preset definitions. */
export interface BrickStyleDefinitionMap {
  readonly box: BoxStyleDefinition;
  readonly text: TextStyleDefinition;
  readonly media: MediaStyleDefinition;
  readonly input: InputStyleDefinition;
  readonly richtext: RichTextStyleDefinition;
  readonly table: TableStyleDefinition;
  readonly chart: ChartStyleDefinition;
  readonly list: ListStyleDefinition;
  readonly keyValue: KeyValueStyleDefinition;
  readonly progress: ProgressStyleDefinition;
  readonly loading: LoadingStyleDefinition;
}

export type BrickStyleDefinition<B extends BrickType> = BrickStyleDefinitionMap[B];

interface BrickActiveStyleDefinitionMap {
  readonly box: BoxDirectStyle;
  readonly text: TextStyleDefinition;
  readonly media: MediaStyleDefinition;
  readonly input: InputDirectStyle;
  readonly richtext: RichTextDirectStyle;
  readonly table: TableDirectStyle;
  readonly chart: ChartStyleDefinition;
  readonly list: ListStyleDefinition;
  readonly keyValue: KeyValueStyleDefinition;
  readonly progress: ProgressStyleDefinition;
  readonly loading: LoadingStyleDefinition;
}

/** Same-Brick Preset plus direct properties, without recursive or ephemeral state. */
export type BrickActiveStyle<B extends BrickType> = BrickActiveStyleDefinitionMap[B] & {
  readonly preset?: string;
};

type PresetStyle<D> = D & { readonly preset?: string };
type ActivePresetStyle<B extends BrickType, D> = PresetStyle<D> & {
  readonly active?: BrickActiveStyle<B>;
};

/** Authored style object by native Brick type. */
export interface BrickStyleByType {
  readonly box: ActivePresetStyle<"box", BoxStyleDefinition>;
  readonly text: ActivePresetStyle<"text", TextStyleDefinition>;
  readonly media: PresetStyle<MediaStyleDefinition>;
  readonly input: PresetStyle<InputStyleDefinition>;
  readonly richtext: PresetStyle<RichTextStyleDefinition>;
  readonly table: PresetStyle<TableStyleDefinition>;
  readonly chart: PresetStyle<ChartStyleDefinition>;
  readonly list: PresetStyle<ListStyleDefinition>;
  readonly keyValue: PresetStyle<KeyValueStyleDefinition>;
  readonly progress: PresetStyle<ProgressStyleDefinition>;
  readonly loading: PresetStyle<LoadingStyleDefinition>;
}

export type BrickStyle<B extends BrickType> = BrickStyleByType[B];
export type BoxStyle = BrickStyle<"box">;
export type TextStyle = BrickStyle<"text">;
export type MediaStyle = BrickStyle<"media">;
export type InputStyle = BrickStyle<"input">;
export type RichTextStyle = BrickStyle<"richtext">;
export type TableStyle = BrickStyle<"table">;
export type ChartStyle = BrickStyle<"chart">;
export type ListStyle = BrickStyle<"list">;
export type KeyValueStyle = BrickStyle<"keyValue">;
export type ProgressStyle = BrickStyle<"progress">;
export type LoadingStyle = BrickStyle<"loading">;
