import type { CSSProperties } from "react";
import type { ResolvedTheme } from "./theme.js";

type ColorName = keyof ResolvedTheme["color"];

export interface TypographyStyleValues {
  readonly fontFamily?: keyof ResolvedTheme["fontFamily"];
  readonly fontSize?: keyof ResolvedTheme["fontSize"];
  readonly fontWeight?: keyof ResolvedTheme["fontWeight"];
  readonly fontStyle?: CSSProperties["fontStyle"];
  readonly color?: ColorName;
  readonly textAlign?: "start" | "center" | "end";
  readonly letterSpacing?: keyof ResolvedTheme["letterSpacing"];
  readonly lineHeight?: keyof ResolvedTheme["lineHeight"];
  readonly textWrap?: "wrap" | "nowrap" | "balance";
  readonly lineClamp?: "none" | 1 | 2 | 3 | 4;
  readonly highlight?: keyof ResolvedTheme["highlight"];
}

export interface SurfaceStyleValues {
  readonly background?: ColorName;
  readonly color?: ColorName;
  readonly borderColor?: ColorName;
  readonly borderWidth?: keyof ResolvedTheme["borderWidth"];
  readonly borderRadius?: keyof ResolvedTheme["radius"];
  readonly shadow?: keyof ResolvedTheme["shadow"];
}

export function projectTypography(
  values: TypographyStyleValues | undefined,
  theme: ResolvedTheme,
): CSSProperties {
  if (values === undefined) return {};
  const css: CSSProperties = {};
  if (values.fontFamily !== undefined) css.fontFamily = theme.fontFamily[values.fontFamily];
  if (values.fontSize !== undefined) css.fontSize = theme.fontSize[values.fontSize];
  if (values.fontWeight !== undefined) css.fontWeight = theme.fontWeight[values.fontWeight];
  if (values.fontStyle !== undefined) css.fontStyle = values.fontStyle;
  if (values.color !== undefined) css.color = theme.color[values.color];
  if (values.textAlign !== undefined) {
    css.textAlign =
      values.textAlign === "start" ? "left" : values.textAlign === "end" ? "right" : "center";
  }
  if (values.letterSpacing !== undefined)
    css.letterSpacing = theme.letterSpacing[values.letterSpacing];
  if (values.lineHeight !== undefined) css.lineHeight = theme.lineHeight[values.lineHeight];
  if (values.textWrap === "nowrap") {
    css.whiteSpace = "nowrap";
    css.overflowWrap = "normal";
  } else if (values.textWrap === "wrap") {
    css.whiteSpace = "normal";
    css.overflowWrap = "break-word";
  } else if (values.textWrap === "balance") {
    (css as CSSProperties & { textWrap: string }).textWrap = "balance";
    css.overflowWrap = "break-word";
  }
  if (values.lineClamp !== undefined && values.lineClamp !== "none") {
    css.display = "-webkit-box";
    css.overflow = "hidden";
    (
      css as CSSProperties & { WebkitBoxOrient: "vertical"; WebkitLineClamp: number }
    ).WebkitBoxOrient = "vertical";
    (
      css as CSSProperties & { WebkitBoxOrient: "vertical"; WebkitLineClamp: number }
    ).WebkitLineClamp = values.lineClamp;
  }
  if (values.highlight !== undefined) css.backgroundImage = theme.highlight[values.highlight];
  return css;
}

export function projectSurface(
  values: SurfaceStyleValues | undefined,
  theme: ResolvedTheme,
): CSSProperties {
  if (values === undefined) return {};
  const css: CSSProperties = {};
  if (values.background !== undefined) css.background = theme.color[values.background];
  if (values.color !== undefined) css.color = theme.color[values.color];
  if (values.borderColor !== undefined) css.borderColor = theme.color[values.borderColor];
  if (values.borderWidth !== undefined) {
    css.borderStyle = "solid";
    css.borderWidth = theme.borderWidth[values.borderWidth];
  }
  if (values.borderRadius !== undefined) css.borderRadius = theme.radius[values.borderRadius];
  if (values.shadow !== undefined) css.boxShadow = theme.shadow[values.shadow];
  return css;
}
