import type { CSSProperties } from "react";
import type { BrickStyleDefinition, Color } from "@facet/core";
import { boxStyle, textStyle, type ResolvedTheme } from "./theme.js";
import { intrinsicBoxStyle } from "./brick-renderer-shared.js";

const DEFAULT_CHART_COLORS: readonly Color[] = [
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "chart6",
];

type ChartStyleDefinition = BrickStyleDefinition<"chart">;
type ListStyleDefinition = BrickStyleDefinition<"list">;
type KeyValueStyleDefinition = BrickStyleDefinition<"keyValue">;
type ProgressStyleDefinition = BrickStyleDefinition<"progress">;
type LoadingStyleDefinition = BrickStyleDefinition<"loading">;

export const LOADING_PULSE_CLASS = "facet-loading-pulse";

/** Static renderer-owned motion. No authored value is interpolated into this stylesheet. */
export const LOADING_PULSE_CSS = `@keyframes ${LOADING_PULSE_CLASS} {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
.${LOADING_PULSE_CLASS} {
  animation: ${LOADING_PULSE_CLASS} 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .${LOADING_PULSE_CLASS} { animation: none; }
}
`;

function rootStyle(
  style:
    | ChartStyleDefinition
    | ListStyleDefinition
    | KeyValueStyleDefinition
    | ProgressStyleDefinition
    | LoadingStyleDefinition,
  theme: ResolvedTheme,
): CSSProperties {
  return boxStyle(style, theme);
}

function targetBoxStyle(style: object | undefined, theme: ResolvedTheme): CSSProperties {
  return intrinsicBoxStyle(boxStyle(style, theme));
}

function targetTextStyle(style: object | undefined, theme: ResolvedTheme): CSSProperties {
  return textStyle(style, theme);
}

export interface ChartTargetStyles {
  readonly root: CSSProperties;
  readonly title: CSSProperties;
  readonly plot: CSSProperties;
  readonly seriesColors: readonly string[];
  readonly seriesThickness: string;
}

export function chartTargetStyles(
  style: ChartStyleDefinition,
  theme: ResolvedTheme,
): ChartTargetStyles {
  const authoredColors = [
    style.series?.color1,
    style.series?.color2,
    style.series?.color3,
    style.series?.color4,
    style.series?.color5,
    style.series?.color6,
  ] as const;
  return {
    root: rootStyle(style, theme),
    title: targetTextStyle(style.title, theme),
    plot: targetBoxStyle(style.plot, theme),
    seriesColors: DEFAULT_CHART_COLORS.map(
      (fallback, index) => theme.color[authoredColors[index] ?? fallback],
    ),
    seriesThickness: theme.chartThickness[style.series?.thickness ?? "md"],
  };
}

export interface ListTargetStyles {
  readonly root: CSSProperties;
  readonly item: CSSProperties;
  readonly itemGap: string | undefined;
  readonly title: CSSProperties;
  readonly body: CSSProperties;
  readonly marker: CSSProperties;
}

export function listTargetStyles(
  style: ListStyleDefinition,
  theme: ResolvedTheme,
): ListTargetStyles {
  return {
    root: rootStyle(style, theme),
    item: targetBoxStyle(style.item, theme),
    itemGap: style.item?.gap === undefined ? undefined : theme.space[style.item.gap],
    title: targetTextStyle(style.title, theme),
    body: targetTextStyle(style.body, theme),
    marker: targetTextStyle(style.marker, theme),
  };
}

export interface KeyValueTargetStyles {
  readonly root: CSSProperties;
  readonly item: CSSProperties;
  readonly label: CSSProperties;
  readonly value: CSSProperties;
}

export function keyValueTargetStyles(
  style: KeyValueStyleDefinition,
  theme: ResolvedTheme,
): KeyValueTargetStyles {
  return {
    root: rootStyle(style, theme),
    item: {
      ...boxStyle(style.item, theme),
      display: "grid",
      gridTemplateColumns: "auto minmax(0, 1fr)",
      alignItems: "baseline",
    },
    label: targetTextStyle(style.label, theme),
    value: targetTextStyle(style.value, theme),
  };
}

export interface ProgressTargetStyles {
  readonly root: CSSProperties;
  readonly label: CSSProperties;
  readonly track: CSSProperties;
  readonly fill: CSSProperties;
}

export function progressTargetStyles(
  style: ProgressStyleDefinition,
  theme: ResolvedTheme,
): ProgressTargetStyles {
  return {
    root: rootStyle(style, theme),
    label: targetTextStyle(style.label, theme),
    track: {
      ...targetBoxStyle(style.track, theme),
      height: theme.progressThickness[style.track?.height ?? "md"],
    },
    // Fill extent is deliberately absent: the renderer alone derives it from value.
    fill: targetBoxStyle(style.fill, theme),
  };
}

export interface LoadingTargetStyles {
  readonly root: CSSProperties;
  readonly indicator: CSSProperties;
  readonly indicatorClassName: string | undefined;
  readonly label: CSSProperties;
}

export function loadingTargetStyles(
  style: LoadingStyleDefinition,
  theme: ResolvedTheme,
): LoadingTargetStyles {
  const indicator = style.indicator;
  const size = theme.indicatorSize[indicator?.size ?? "md"];
  const pulses = indicator?.animation === "pulse";
  return {
    root: rootStyle(style, theme),
    indicator: {
      display: "inline-block",
      width: size,
      height: size,
      borderRadius: theme.radius.full,
      background: theme.color[indicator?.color ?? "accent"],
      flexShrink: 0,
      ...(pulses ? {} : { animation: "none" }),
    },
    indicatorClassName: pulses ? LOADING_PULSE_CLASS : undefined,
    label: targetTextStyle(style.label, theme),
  };
}
