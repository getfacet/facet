import type { ReactNode } from "react";
import {
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  MAX_NODE_LABEL_CHARS,
  resolveNodeData,
  type ChartSeries,
  type FacetNode,
} from "@facet/core";
import type { BrickRenderContext } from "./brick-renderer-types.js";
import type { ResolvedTheme } from "./theme.js";
import { resolveRecipePart } from "./recipe-parts.js";
import { rootContainmentStyle } from "./layout-contract.js";
import {
  cappedArray,
  cappedString,
  componentBoxStyle,
  componentRecipe,
  componentTextStyle,
  finiteNumber,
  intrinsicBoxStyle,
  isObjectRecord,
  safeOwnValue,
  withInert,
} from "./brick-renderer-shared.js";

interface RenderChartSeries {
  readonly label: string;
  readonly values: readonly number[];
}

function chartSeriesOf(raw: unknown): readonly RenderChartSeries[] {
  const rawSeries = cappedArray(safeOwnValue(raw, "series"), MAX_CHART_SERIES);
  const series: RenderChartSeries[] = [];
  for (const item of rawSeries) {
    if (!isObjectRecord(item)) continue;
    const label = cappedString(safeOwnValue(item, "label"), MAX_NODE_LABEL_CHARS);
    const rawValues = cappedArray(safeOwnValue(item, "values"), MAX_CHART_POINTS);
    if (label === undefined) continue;
    const values: number[] = [];
    for (const value of rawValues) {
      const number = finiteNumber(value);
      if (number !== undefined) values.push(number);
    }
    if (values.length > 0) series.push({ label, values });
  }
  return series;
}

function chartColor(theme: ResolvedTheme, index: number): string {
  return theme.color[`chart-${String((index % 6) + 1)}` as keyof typeof theme.color];
}

function renderChartBars(raw: unknown, theme: ResolvedTheme): ReactNode {
  const series = chartSeriesOf(raw);
  if (series.length === 0) return null;
  const values = series.flatMap((item) => item.values as number[]);
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const barWidth = 24;
  const gap = 10;
  const height = 120;
  let index = 0;
  return series.map((item, seriesIndex) =>
    item.values.map((value) => {
      const barHeight = Math.round((Math.abs(value) / max) * 100);
      const x = index++ * (barWidth + gap);
      const y = height - barHeight;
      return (
        <rect
          key={`${item.label}:${String(index)}`}
          x={x}
          y={y}
          width={barWidth}
          height={barHeight}
          fill={chartColor(theme, seriesIndex)}
        />
      );
    }),
  );
}

function renderChartLines(raw: unknown, theme: ResolvedTheme): ReactNode {
  const series = chartSeriesOf(raw);
  if (series.length === 0) return null;
  const values = series.flatMap((item) => item.values as number[]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = Math.max(1, max - min);
  const width = 320;
  const top = 12;
  const height = 112;
  return series.map((item, seriesIndex) => {
    const step = item.values.length <= 1 ? 0 : width / (item.values.length - 1);
    const points = item.values
      .map((value, valueIndex) => {
        const x = 20 + valueIndex * step;
        const y = top + height - ((value - min) / range) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return (
      <polyline
        key={item.label}
        points={points}
        fill="none"
        stroke={chartColor(theme, seriesIndex)}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  });
}

function renderChartDonut(raw: unknown, theme: ResolvedTheme): ReactNode {
  const slices = chartSeriesOf(raw).flatMap((item) =>
    item.values
      .map((value) => Math.abs(value))
      .filter((value) => value > 0)
      .slice(0, MAX_CHART_POINTS),
  );
  if (slices.length === 0) return null;
  const total = slices.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return slices.map((value, index) => {
    const length = (value / total) * circumference;
    const dashOffset = -offset;
    offset += length;
    return (
      <circle
        key={String(index)}
        cx={70}
        cy={70}
        r={radius}
        fill="none"
        stroke={chartColor(theme, index)}
        strokeWidth={20}
        strokeDasharray={`${length.toFixed(2)} ${Math.max(0, circumference - length).toFixed(2)}`}
        strokeDashoffset={dashOffset.toFixed(2)}
        transform="rotate(-90 70 70)"
      />
    );
  });
}

export function renderChart<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const kind = safeOwnValue(node, "kind");
  if (kind !== "bar" && kind !== "line" && kind !== "donut") return null;
  // Resolve the effective series through the ONE core helper: a `from` binding
  // projects one numeric-column series per dataset row (precedence: from wins,
  // dangling ⇒ empty chart), while an unbound chart returns its inline series
  // unchanged. The `{ series }` wrapper feeds the existing `safeOwnValue`-based
  // cap/validation pass below — a pure read, no state.
  const series: readonly ChartSeries[] =
    node.type === "chart" ? resolveNodeData(node, context.data) : [];
  const source = { series };
  const chart =
    kind === "bar"
      ? renderChartBars(source, theme)
      : kind === "line"
        ? renderChartLines(source, theme)
        : renderChartDonut(source, theme);
  if (chart === null) return null;
  const title = cappedString(safeOwnValue(node, "title"), MAX_NODE_LABEL_CHARS);
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "chart", variant);
  const style = componentBoxStyle(theme, recipe, {
    gap: "sm",
    pad: "sm",
    width: "full",
  });
  const plotPart = resolveRecipePart(recipe, "plot", theme);
  return (
    <figure
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(rootContainmentStyle({ ...style, margin: 0 }), inert)}
    >
      {title === undefined ? null : (
        <figcaption style={componentTextStyle(theme, recipe, { weight: "semibold" }, "title")}>
          {title}
        </figcaption>
      )}
      <svg
        role="img"
        aria-label={title ?? "chart"}
        viewBox="0 0 360 140"
        width="100%"
        style={rootContainmentStyle({
          ...intrinsicBoxStyle(plotPart.box),
          display: "block",
          width: "100%",
          height: "auto",
          overflow: "hidden",
        })}
      >
        {title === undefined ? null : <title>{title}</title>}
        {chart}
      </svg>
    </figure>
  );
}
