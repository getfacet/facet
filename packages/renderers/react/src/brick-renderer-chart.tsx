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
  type ChartAxis,
  type BarChartGeometry,
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
  readonly axis?: ChartAxis;
}

interface RenderedChart {
  readonly node: ReactNode;
  readonly viewBoxHeight: number;
}

function lineStyleOf(raw: unknown): ChartLineStyle | undefined {
  if (raw === "solid" || raw === "dashed" || raw === "dotted") return raw;
  return undefined;
}

function axisOf(raw: unknown): ChartAxis | undefined {
  if (raw === "primary" || raw === "secondary") return raw;
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
      const itemAxis = axisOf(safeOwnValue(item, "axis"));
      const chartSeries: {
        label: string;
        values: readonly number[];
        lineStyle?: ChartLineStyle;
        axis?: ChartAxis;
      } = {
        label,
        values,
      };
      if (itemLineStyle !== undefined) chartSeries.lineStyle = itemLineStyle;
      if (itemAxis !== undefined) chartSeries.axis = itemAxis;
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
      {renderSecondaryAxis(geometry, styles)}
    </>
  );
}

// Right-edge tick column for the secondary scale. Emitted ONLY when the geometry
// resolved a secondary scale (≥1 series assigned `axis: "secondary"`); a chart
// with zero secondary-assigned series produces no markup here (OQ-2), so output
// is byte-identical to a single-scale plot. Reuses the same axis/label color
// tokens as the primary axis — no new token scale.
function renderSecondaryAxis(geometry: ChartGeometryResult, styles: ChartTargetStyles): ReactNode {
  const ticks = geometry.secondaryYTicks;
  if (ticks === undefined || ticks.length === 0) return null;
  return (
    <g data-facet-chart-axis="secondary" aria-hidden={true}>
      <line
        x1={CHART_GEOMETRY.plot.right}
        y1={CHART_GEOMETRY.plot.top}
        x2={CHART_GEOMETRY.plot.right}
        y2={CHART_GEOMETRY.plot.bottom}
        stroke={styles.axisColor}
        opacity={0.64}
      />
      {ticks.map((tick, index) => (
        <text
          key={`sy:${String(index)}`}
          x={tick.labelX}
          y={tick.y + 4}
          textAnchor="start"
          fill={styles.labelColor}
          fontSize={10}
        >
          {tick.label}
        </text>
      ))}
    </g>
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

/**
 * The zero rules a bar chart needs. Bars are anchored on THEIR OWN scale's zero
 * (`bar.zeroY`), so a secondary group with negative values sits on a different
 * baseline than the primary one — drawing only the primary rule left those bars
 * hanging off a line that was never painted. Each distinct anchor therefore gets
 * its own rule, spanning only the marks that use it; the primary rule keeps the
 * full plot width and the stronger opacity so the main axis still reads first.
 */
function renderBarZeroLines(geometry: BarChartGeometry, styles: ChartTargetStyles): ReactNode {
  const inPlot = (y: number): boolean =>
    y > CHART_GEOMETRY.plot.top && y < CHART_GEOMETRY.plot.bottom;
  const groups = new Map<number, { left: number; right: number; primary: boolean }>();
  for (const bar of geometry.bars) {
    if (!inPlot(bar.zeroY)) continue;
    const primary = bar.zeroY === geometry.zeroY;
    const group = groups.get(bar.zeroY);
    if (group === undefined) {
      groups.set(bar.zeroY, { left: bar.x, right: bar.x + bar.width, primary });
      continue;
    }
    group.left = Math.min(group.left, bar.x);
    group.right = Math.max(group.right, bar.x + bar.width);
  }
  // With no bars anchored inside the plot the primary rule still applies (an
  // empty-ish chart keeps today's behavior).
  if (groups.size === 0 && inPlot(geometry.zeroY)) {
    groups.set(geometry.zeroY, {
      left: CHART_GEOMETRY.plot.left,
      right: CHART_GEOMETRY.plot.right,
      primary: true,
    });
  }
  return (
    <>
      {[...groups.entries()].map(([zeroY, group]) => (
        <line
          key={`zero:${String(zeroY)}`}
          data-facet-chart-axis="zero"
          x1={group.primary ? CHART_GEOMETRY.plot.left : group.left}
          y1={zeroY}
          x2={group.primary ? CHART_GEOMETRY.plot.right : group.right}
          y2={zeroY}
          stroke={styles.axisColor}
          opacity={group.primary ? 0.42 : 0.28}
          strokeLinecap="square"
        />
      ))}
    </>
  );
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
        {renderBarZeroLines(geometry, styles)}
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
  // Layer non-solid comparison lines (dashed/dotted) UNDER solid lines: earlier
  // document order paints first (below). A stable partition preserves each
  // group's authored order; `seriesIndex` still drives color, so legend/series
  // correspondence is unchanged (DC-002).
  const isSolidLine = (style: ChartLineStyle | undefined): boolean =>
    style === undefined || style === "solid";
  const orderedLines = [
    ...geometry.lines.filter((line) => !isSolidLine(line.lineStyle)),
    ...geometry.lines.filter((line) => isSolidLine(line.lineStyle)),
  ];
  return {
    node: (
      <>
        {renderAxes(geometry, styles)}
        {orderedLines.map((line) => (
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
  // Centre and size the ring from the CURRENT plot box — hardcoded coordinates
  // silently shrink into a corner whenever the figure geometry changes.
  const centerX = CHART_GEOMETRY.plot.left + CHART_GEOMETRY.plot.width / 2;
  const centerY = CHART_GEOMETRY.plot.top + CHART_GEOMETRY.plot.height / 2;
  const radius = Math.max(
    1,
    Math.min(CHART_GEOMETRY.plot.width, CHART_GEOMETRY.plot.height) / 2 - 8,
  );
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
          cx={centerX}
          cy={centerY}
          r={radius}
          fill="none"
          stroke={chartColor(styles, index)}
          strokeWidth={styles.seriesThickness}
          strokeDasharray={`${length.toFixed(2)} ${Math.max(0, circumference - length).toFixed(2)}`}
          strokeDashoffset={dashOffset.toFixed(2)}
          transform={`rotate(-90 ${String(centerX)} ${String(centerY)})`}
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
