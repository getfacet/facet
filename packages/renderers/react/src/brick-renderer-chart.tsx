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
const BAR_BASELINE_Y = PLOT_TOP + PLOT_HEIGHT;
const X_AXIS_Y = BAR_BASELINE_Y + 4;
const CHART_VIEWBOX_WIDTH = 360;
const CHART_VIEWBOX_HEIGHT = 180;
const MIN_X_TICK_GAP = 34;
const AXIS_LABEL_MAX_CHARS = 12;
const LEGEND_TOP = 154;
const LEGEND_ROW_HEIGHT = 16;
const LEGEND_BOTTOM_PADDING = 4;
const LEGEND_ITEM_GAP = 12;
const LEGEND_TEXT_X = 16;
const LEGEND_CHAR_WIDTH = 7;
const LEGEND_LABEL_MAX_CHARS = 18;

interface RenderedChart {
  readonly node: ReactNode;
  readonly viewBoxHeight: number;
}

interface LegendItemLayout {
  readonly label: string;
  readonly x: number;
  readonly y: number;
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
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000 || (absolute > 0 && absolute < 0.01)) {
    return value.toExponential(2);
  }
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

function abbreviateSvgLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

function chartY(value: number, min: number, max: number): number {
  const directRange = max - min;
  if (Number.isFinite(directRange) && directRange > 0) {
    return PLOT_TOP + PLOT_HEIGHT - ((value - min) / directRange) * PLOT_HEIGHT;
  }
  const scale = Math.max(1, Math.abs(value), Math.abs(min), Math.abs(max));
  const scaledValue = value / scale;
  const scaledMin = min / scale;
  const scaledMax = max / scale;
  const scaledRange = scaledMax - scaledMin;
  if (!Number.isFinite(scaledRange) || scaledRange <= 0) return PLOT_TOP + PLOT_HEIGHT;
  return PLOT_TOP + PLOT_HEIGHT - ((scaledValue - scaledMin) / scaledRange) * PLOT_HEIGHT;
}

function xPositionForIndex(
  index: number,
  pointCount: number,
  explicitPositions: readonly number[] | undefined,
): number {
  const explicit = explicitPositions?.[index];
  if (explicit !== undefined) return explicit;
  const step = pointCount <= 1 ? 0 : PLOT_WIDTH / (pointCount - 1);
  return PLOT_LEFT + index * step;
}

function visibleXTickIndexes(
  pointCount: number,
  explicitPositions: readonly number[] | undefined,
): readonly number[] {
  if (pointCount <= 0) return [];
  if (pointCount === 1) return [0];
  const positions = Array.from({ length: pointCount }, (_, index) =>
    xPositionForIndex(index, pointCount, explicitPositions),
  );
  const lastIndex = pointCount - 1;
  const indexes: number[] = [0];
  let previousX = positions[0] ?? PLOT_LEFT;
  for (let index = 1; index < lastIndex; index += 1) {
    const x = positions[index] ?? previousX;
    const lastX = positions[lastIndex] ?? x;
    if (x - previousX >= MIN_X_TICK_GAP && lastX - x >= MIN_X_TICK_GAP) {
      indexes.push(index);
      previousX = x;
    }
  }
  const lastX = positions[lastIndex] ?? previousX;
  while (indexes.length > 1 && lastX - previousX < MIN_X_TICK_GAP) {
    indexes.pop();
    const previousIndex = indexes[indexes.length - 1] ?? 0;
    previousX = positions[previousIndex] ?? PLOT_LEFT;
  }
  indexes.push(lastIndex);
  return indexes;
}

function legendItemWidth(label: string): number {
  return LEGEND_TEXT_X + label.length * LEGEND_CHAR_WIDTH;
}

function layoutLegend(series: readonly RenderChartSeries[]): {
  readonly items: readonly LegendItemLayout[];
  readonly viewBoxHeight: number;
} {
  if (series.length === 0) return { items: [], viewBoxHeight: CHART_VIEWBOX_HEIGHT };
  const items: LegendItemLayout[] = [];
  let x = PLOT_LEFT;
  let y = LEGEND_TOP;
  const rightEdge = PLOT_LEFT + PLOT_WIDTH;
  for (const item of series) {
    const label = abbreviateSvgLabel(item.label, LEGEND_LABEL_MAX_CHARS);
    const width = legendItemWidth(label);
    if (items.length > 0 && x + width > rightEdge) {
      x = PLOT_LEFT;
      y += LEGEND_ROW_HEIGHT;
    }
    items.push({ label, x, y });
    x += width + LEGEND_ITEM_GAP;
  }
  return {
    items,
    viewBoxHeight: Math.max(CHART_VIEWBOX_HEIGHT, y + LEGEND_ROW_HEIGHT + LEGEND_BOTTOM_PADDING),
  };
}

function renderAxes(
  labels: readonly string[],
  pointCount: number,
  yMin: number,
  yMax: number,
  styles: ChartTargetStyles,
  xPositions?: readonly number[],
): ReactNode {
  const labelCount = Math.min(pointCount, MAX_CHART_POINTS);
  const tickIndexes = visibleXTickIndexes(labelCount, xPositions);
  return (
    <>
      <g data-facet-chart-axis="y" aria-hidden={true}>
        <line
          x1={PLOT_LEFT}
          y1={PLOT_TOP}
          x2={PLOT_LEFT}
          y2={BAR_BASELINE_Y}
          stroke={styles.axisColor}
          opacity={0.45}
        />
        <text
          x={PLOT_LEFT - 6}
          y={PLOT_TOP + 4}
          textAnchor="end"
          fill={styles.axisColor}
          fontSize={11}
        >
          {formatTick(yMax)}
        </text>
        <text
          x={PLOT_LEFT - 6}
          y={BAR_BASELINE_Y + 4}
          textAnchor="end"
          fill={styles.axisColor}
          fontSize={11}
        >
          {formatTick(yMin)}
        </text>
      </g>
      <g data-facet-chart-axis="x" aria-hidden={true}>
        <line
          x1={PLOT_LEFT}
          y1={X_AXIS_Y}
          x2={PLOT_LEFT + PLOT_WIDTH}
          y2={X_AXIS_Y}
          stroke={styles.axisColor}
          opacity={0.28}
          strokeLinecap="square"
        />
        {tickIndexes.map((index) => (
          <text
            key={`x:${String(index)}`}
            x={xPositionForIndex(index, labelCount, xPositions)}
            y={X_AXIS_Y + 19}
            textAnchor="middle"
            fill={styles.axisColor}
            fontSize={11}
          >
            {abbreviateSvgLabel(labelForIndex(labels, index), AXIS_LABEL_MAX_CHARS)}
          </text>
        ))}
      </g>
    </>
  );
}

function renderLegend(
  series: readonly RenderChartSeries[],
  styles: ChartTargetStyles,
): { readonly node: ReactNode; readonly viewBoxHeight: number } {
  const layout = layoutLegend(series);
  if (layout.items.length === 0) return { node: null, viewBoxHeight: layout.viewBoxHeight };
  return {
    node: (
      <g data-facet-chart-legend="true" aria-hidden={true}>
        {layout.items.map((item, index) => (
          <g
            key={`${item.label}:${String(index)}`}
            transform={`translate(${String(item.x)} ${String(item.y)})`}
          >
            <rect width={10} height={10} rx={2} fill={chartColor(styles, index)} />
            <text x={16} y={9} fill={styles.axisColor} fontSize={12}>
              {item.label}
            </text>
          </g>
        ))}
      </g>
    ),
    viewBoxHeight: layout.viewBoxHeight,
  };
}

function renderChartBars(
  raw: unknown,
  labels: readonly string[],
  styles: ChartTargetStyles,
): RenderedChart | null {
  const series = chartSeriesOf(raw);
  if (series.length === 0) return null;
  const legend = renderLegend(series, styles);
  const values = series.flatMap((item) => item.values as number[]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const yMin = Math.min(0, rawMin);
  const yMax = yMin === 0 && rawMax === 0 ? 1 : Math.max(0, rawMax);
  const zeroY = chartY(0, yMin, yMax);
  const pointCount = maxPointCount(series);
  const slotWidth = PLOT_WIDTH / Math.max(1, pointCount);
  const groupPadding = Math.min(10, Math.max(2, slotWidth * 0.2));
  const availableGroupWidth = Math.max(1, slotWidth - groupPadding);
  const requestedBarGap =
    series.length > 1 ? Math.min(4, Math.max(1, availableGroupWidth * 0.12)) : 0;
  const maximumBarGap =
    series.length > 1
      ? Math.max(0, (availableGroupWidth - series.length * 0.5) / (series.length - 1))
      : 0;
  const barGap = Math.min(requestedBarGap, maximumBarGap);
  const maxBarWidth = series.length > 1 ? 32 : 44;
  const barWidth = Math.min(
    maxBarWidth,
    Math.max(
      0.125,
      (availableGroupWidth - Math.max(0, series.length - 1) * barGap) / series.length,
    ),
  );
  const groupWidth = series.length * barWidth + Math.max(0, series.length - 1) * barGap;
  const groupCenters = Array.from(
    { length: pointCount },
    (_, valueIndex) => PLOT_LEFT + valueIndex * slotWidth + slotWidth / 2,
  );
  const bars = series.map((item, seriesIndex) =>
    item.values.map((value, valueIndex) => {
      const valueY = chartY(value, yMin, yMax);
      const barHeight = Math.abs(valueY - zeroY);
      const groupStart = PLOT_LEFT + valueIndex * slotWidth + (slotWidth - groupWidth) / 2;
      const x = groupStart + seriesIndex * (barWidth + barGap);
      const y = Math.min(valueY, zeroY);
      return (
        <rect
          key={`${item.label}:${String(valueIndex)}`}
          x={x}
          y={y}
          width={barWidth}
          height={barHeight}
          fill={chartColor(styles, seriesIndex)}
        />
      );
    }),
  );
  return {
    node: (
      <>
        {renderAxes(labels, pointCount, yMin, yMax, styles, groupCenters)}
        {zeroY === BAR_BASELINE_Y ? null : (
          <line
            data-facet-chart-axis="zero"
            x1={PLOT_LEFT}
            y1={zeroY}
            x2={PLOT_LEFT + PLOT_WIDTH}
            y2={zeroY}
            stroke={styles.axisColor}
            opacity={0.18}
            strokeLinecap="square"
          />
        )}
        {bars}
        {legend.node}
      </>
    ),
    viewBoxHeight: legend.viewBoxHeight,
  };
}

function renderChartLines(
  raw: unknown,
  labels: readonly string[],
  styles: ChartTargetStyles,
): RenderedChart | null {
  const series = chartSeriesOf(raw);
  if (series.length === 0) return null;
  const legend = renderLegend(series, styles);
  const values = series.flatMap((item) => item.values as number[]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const pointCount = maxPointCount(series);
  const lines = series.map((item, seriesIndex) => {
    const step = item.values.length <= 1 ? 0 : PLOT_WIDTH / (item.values.length - 1);
    const points = item.values
      .map((value, valueIndex) => {
        const x = PLOT_LEFT + valueIndex * step;
        const y = chartY(value, min, max);
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
  return {
    node: (
      <>
        {renderAxes(labels, pointCount, min, max, styles)}
        {lines}
        {legend.node}
      </>
    ),
    viewBoxHeight: legend.viewBoxHeight,
  };
}

function renderChartDonut(raw: unknown, styles: ChartTargetStyles): RenderedChart | null {
  const slices = chartSeriesOf(raw).flatMap((item) =>
    item.values
      .map((value) => Math.abs(value))
      .filter((value) => value > 0)
      .slice(0, MAX_CHART_POINTS),
  );
  if (slices.length === 0) return null;
  const maxSlice = Math.max(...slices);
  const normalizedSlices = slices.map((value) => value / maxSlice);
  const total = normalizedSlices.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return {
    node: normalizedSlices.map((value, index) => {
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
    }),
    viewBoxHeight: CHART_VIEWBOX_HEIGHT,
  };
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
        viewBox={`0 0 ${String(CHART_VIEWBOX_WIDTH)} ${String(chart.viewBoxHeight)}`}
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
        {chart.node}
      </svg>
    </figure>
  );
}
