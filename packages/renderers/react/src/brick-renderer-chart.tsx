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
import {
  CHART_GEOMETRY,
  layoutBarChartGeometry,
  layoutChartLegend,
  layoutLineChartGeometry,
  lineDasharrayForStyle,
  type ChartGeometryResult,
  type ChartLineStyle,
} from "./chart-geometry.js";
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
  readonly lineStyle?: ChartLineStyle;
}

interface RenderedChart {
  readonly node: ReactNode;
  readonly viewBoxHeight: number;
}

function lineStyleOf(raw: unknown): ChartLineStyle | undefined {
  if (raw === "solid" || raw === "dashed" || raw === "dotted") return raw;
  return undefined;
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
    if (values.length > 0) {
      const itemLineStyle = lineStyleOf(safeOwnValue(item, "lineStyle"));
      const chartSeries: { label: string; values: readonly number[]; lineStyle?: ChartLineStyle } =
        {
          label,
          values,
        };
      if (itemLineStyle !== undefined) chartSeries.lineStyle = itemLineStyle;
      series.push(chartSeries);
    }
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

function renderAxes(geometry: ChartGeometryResult, styles: ChartTargetStyles): ReactNode {
  return (
    <>
      <g data-facet-chart-grid="true" aria-hidden={true}>
        {geometry.yTicks.map((tick, index) => (
          <line
            key={`grid:${String(index)}`}
            x1={CHART_GEOMETRY.plot.left}
            y1={tick.y}
            x2={CHART_GEOMETRY.plot.right}
            y2={tick.y}
            stroke={styles.gridColor}
            opacity={0.24}
            strokeLinecap="square"
          />
        ))}
      </g>
      <g data-facet-chart-axis="y" aria-hidden={true}>
        <line
          x1={CHART_GEOMETRY.plot.left}
          y1={CHART_GEOMETRY.plot.top}
          x2={CHART_GEOMETRY.plot.left}
          y2={CHART_GEOMETRY.plot.bottom}
          stroke={styles.axisColor}
          opacity={0.64}
        />
        {geometry.yTicks.map((tick, index) => (
          <text
            key={`y:${String(index)}`}
            x={tick.labelX}
            y={tick.y + 4}
            textAnchor="end"
            fill={styles.labelColor}
            fontSize={10}
          >
            {tick.label}
          </text>
        ))}
      </g>
      <g data-facet-chart-axis="x" aria-hidden={true}>
        <line
          x1={CHART_GEOMETRY.plot.left}
          y1={CHART_GEOMETRY.xAxisY}
          x2={CHART_GEOMETRY.plot.right}
          y2={CHART_GEOMETRY.xAxisY}
          stroke={styles.axisColor}
          opacity={0.64}
          strokeLinecap="square"
        />
        {geometry.xTicks.map((tick, index) => (
          <text
            key={`x:${String(index)}`}
            x={tick.labelX}
            y={tick.y}
            textAnchor="middle"
            fill={styles.labelColor}
            fontSize={11}
          >
            {tick.label}
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
  const layout = layoutChartLegend(series.map((item) => item.label));
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
            <text x={CHART_GEOMETRY.legend.textX} y={9} fill={styles.labelColor} fontSize={12}>
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
  const geometry = layoutBarChartGeometry({ labels, series });
  return {
    node: (
      <>
        {renderAxes(geometry, styles)}
        {geometry.zeroY <= CHART_GEOMETRY.plot.top ||
        geometry.zeroY >= CHART_GEOMETRY.plot.bottom ? null : (
          <line
            data-facet-chart-axis="zero"
            x1={CHART_GEOMETRY.plot.left}
            y1={geometry.zeroY}
            x2={CHART_GEOMETRY.plot.right}
            y2={geometry.zeroY}
            stroke={styles.axisColor}
            opacity={0.42}
            strokeLinecap="square"
          />
        )}
        {geometry.bars.map((bar) => (
          <rect
            key={`${String(bar.seriesIndex)}:${String(bar.valueIndex)}`}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            fill={chartColor(styles, bar.seriesIndex)}
          />
        ))}
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
  const geometry = layoutLineChartGeometry({ labels, series });
  return {
    node: (
      <>
        {renderAxes(geometry, styles)}
        {geometry.lines.map((line) => (
          <polyline
            key={line.label}
            points={line.points
              .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
              .join(" ")}
            fill="none"
            stroke={chartColor(styles, line.seriesIndex)}
            strokeWidth={styles.seriesThickness}
            strokeDasharray={lineDasharrayForStyle(line.lineStyle)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
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
    viewBoxHeight: CHART_GEOMETRY.viewBoxHeight,
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
        viewBox={`0 0 ${String(CHART_GEOMETRY.viewBoxWidth)} ${String(chart.viewBoxHeight)}`}
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
