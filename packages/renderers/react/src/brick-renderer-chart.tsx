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
import { chartTargetStyles, type ChartTargetStyles } from "./brick-style-data.js";
import { rootContainmentStyle } from "./layout-contract.js";
import { resolveBrickStyle } from "./style-resolver.js";
import {
  cappedArray,
  cappedString,
  finiteNumber,
  isObjectRecord,
  safeOwnValue,
  withInert,
} from "./brick-renderer-shared.js";

interface RenderChartSeries {
  readonly label: string;
  readonly values: readonly number[];
}

const PLOT_LEFT = 34;
const PLOT_TOP = 14;
const PLOT_WIDTH = 286;
const PLOT_HEIGHT = 100;
const X_AXIS_Y = PLOT_TOP + PLOT_HEIGHT;
const CHART_VIEWBOX_HEIGHT = 180;

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

function chartLabelsOf(raw: unknown): readonly string[] {
  const rawLabels = cappedArray(raw, MAX_CHART_POINTS);
  const labels: string[] = [];
  for (const item of rawLabels) {
    const label = cappedString(item, MAX_NODE_LABEL_CHARS);
    if (label !== undefined) labels.push(label);
  }
  return labels;
}

function chartColor(styles: ChartTargetStyles, index: number): string {
  return styles.seriesColors[index % styles.seriesColors.length] ?? styles.seriesColors[0] ?? "";
}

function formatTick(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function maxPointCount(series: readonly RenderChartSeries[]): number {
  return Math.max(0, ...series.map(({ values }) => values.length));
}

function labelForIndex(labels: readonly string[], index: number): string {
  return labels[index] ?? String(index + 1);
}

function renderAxes(
  labels: readonly string[],
  pointCount: number,
  yMin: number,
  yMax: number,
): ReactNode {
  const labelCount = Math.min(pointCount, MAX_CHART_POINTS);
  const step = labelCount <= 1 ? 0 : PLOT_WIDTH / (labelCount - 1);
  return (
    <>
      <g data-facet-chart-axis="y" aria-hidden={true}>
        <line
          x1={PLOT_LEFT}
          y1={PLOT_TOP}
          x2={PLOT_LEFT}
          y2={X_AXIS_Y}
          stroke="currentColor"
          opacity={0.35}
        />
        <text x={PLOT_LEFT - 6} y={PLOT_TOP + 4} textAnchor="end" fill="currentColor" fontSize={10}>
          {formatTick(yMax)}
        </text>
        <text x={PLOT_LEFT - 6} y={X_AXIS_Y} textAnchor="end" fill="currentColor" fontSize={10}>
          {formatTick(yMin)}
        </text>
      </g>
      <g data-facet-chart-axis="x" aria-hidden={true}>
        <line
          x1={PLOT_LEFT}
          y1={X_AXIS_Y}
          x2={PLOT_LEFT + PLOT_WIDTH}
          y2={X_AXIS_Y}
          stroke="currentColor"
          opacity={0.35}
        />
        {Array.from({ length: labelCount }, (_, index) => (
          <text
            key={`x:${String(index)}`}
            x={PLOT_LEFT + index * step}
            y={X_AXIS_Y + 18}
            textAnchor="middle"
            fill="currentColor"
            fontSize={10}
          >
            {labelForIndex(labels, index)}
          </text>
        ))}
      </g>
    </>
  );
}

function renderLegend(series: readonly RenderChartSeries[], styles: ChartTargetStyles): ReactNode {
  if (series.length === 0) return null;
  return (
    <g data-facet-chart-legend="true" aria-hidden={true}>
      {series.map((item, index) => {
        const x = PLOT_LEFT + index * 92;
        return (
          <g key={item.label} transform={`translate(${String(x)} 154)`}>
            <rect width={10} height={10} rx={2} fill={chartColor(styles, index)} />
            <text x={16} y={9} fill="currentColor" fontSize={11}>
              {item.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function renderChartBars(
  raw: unknown,
  labels: readonly string[],
  styles: ChartTargetStyles,
): ReactNode {
  const series = chartSeriesOf(raw);
  if (series.length === 0) return null;
  const values = series.flatMap((item) => item.values as number[]);
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const pointCount = maxPointCount(series);
  const barWidth = series.length > 1 ? 16 : 24;
  const barGap = 4;
  const groupGap = 12;
  const groupWidth = series.length * barWidth + Math.max(0, series.length - 1) * barGap;
  const groupStep =
    pointCount <= 1 ? groupWidth + groupGap : Math.max(groupWidth + groupGap, PLOT_WIDTH / pointCount);
  const bars = series.map((item, seriesIndex) =>
    item.values.map((value, valueIndex) => {
      const barHeight = Math.round((Math.abs(value) / max) * 100);
      const x = PLOT_LEFT + valueIndex * groupStep + seriesIndex * (barWidth + barGap);
      const y = X_AXIS_Y - barHeight;
      return (
        <rect
          key={`${item.label}:${String(valueIndex)}`}
          x={x}
          y={y}
          width={barWidth}
          height={barHeight}
          fill={chartColor(styles, seriesIndex)}
          stroke={chartColor(styles, seriesIndex)}
          strokeWidth={styles.seriesThickness}
        />
      );
    }),
  );
  return (
    <>
      {renderAxes(labels, pointCount, 0, max)}
      {bars}
      {renderLegend(series, styles)}
    </>
  );
}

function renderChartLines(
  raw: unknown,
  labels: readonly string[],
  styles: ChartTargetStyles,
): ReactNode {
  const series = chartSeriesOf(raw);
  if (series.length === 0) return null;
  const values = series.flatMap((item) => item.values as number[]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = Math.max(1, max - min);
  const pointCount = maxPointCount(series);
  const lines = series.map((item, seriesIndex) => {
    const step = item.values.length <= 1 ? 0 : PLOT_WIDTH / (item.values.length - 1);
    const points = item.values
      .map((value, valueIndex) => {
        const x = PLOT_LEFT + valueIndex * step;
        const y = PLOT_TOP + PLOT_HEIGHT - ((value - min) / range) * PLOT_HEIGHT;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return (
      <polyline
        key={item.label}
        points={points}
        fill="none"
        stroke={chartColor(styles, seriesIndex)}
        strokeWidth={styles.seriesThickness}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  });
  return (
    <>
      {renderAxes(labels, pointCount, min, max)}
      {lines}
      {renderLegend(series, styles)}
    </>
  );
}

function renderChartDonut(raw: unknown, styles: ChartTargetStyles): ReactNode {
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
        stroke={chartColor(styles, index)}
        strokeWidth={styles.seriesThickness}
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
  const labels = chartLabelsOf(safeOwnValue(node, "labels"));
  const title = cappedString(safeOwnValue(node, "title"), MAX_NODE_LABEL_CHARS);
  const styles = chartTargetStyles(
    resolveBrickStyle(theme, "chart", safeOwnValue(node, "style")),
    theme,
  );
  const chart =
    kind === "bar"
      ? renderChartBars(source, labels, styles)
      : kind === "line"
        ? renderChartLines(source, labels, styles)
        : renderChartDonut(source, styles);
  if (chart === null) return null;
  return (
    <figure
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(rootContainmentStyle({ ...styles.root, margin: 0 }), inert)}
    >
      {title === undefined ? null : <figcaption style={styles.title}>{title}</figcaption>}
      <svg
        role="img"
        aria-label={title ?? "chart"}
        viewBox={`0 0 360 ${String(CHART_VIEWBOX_HEIGHT)}`}
        width="100%"
        style={rootContainmentStyle({
          ...styles.plot,
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
