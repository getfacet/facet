import type { ChartSeries } from "@facet/core";

export type ChartLineStyle = NonNullable<ChartSeries["lineStyle"]>;

export interface ChartGeometrySeries {
  readonly label: string;
  readonly values: readonly number[];
  readonly lineStyle?: ChartLineStyle;
}

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

export interface ChartTick {
  readonly label: string;
  readonly value: number;
  readonly x: number;
  readonly y: number;
  readonly labelX: number;
}

export interface ChartLegendItem {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface ChartLegendLayout {
  readonly items: readonly ChartLegendItem[];
  readonly viewBoxHeight: number;
}

export interface ChartBarMark {
  readonly seriesIndex: number;
  readonly valueIndex: number;
  readonly value: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly zeroY: number;
}

export interface ChartLineMark {
  readonly seriesIndex: number;
  readonly label: string;
  readonly lineStyle?: ChartLineStyle;
  readonly points: readonly ChartPoint[];
}

export interface ChartGeometryResult {
  readonly pointCount: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly xTicks: readonly ChartTick[];
  readonly yTicks: readonly ChartTick[];
}

export interface BarChartGeometry extends ChartGeometryResult {
  readonly zeroY: number;
  readonly bars: readonly ChartBarMark[];
}

export interface LineChartGeometry extends ChartGeometryResult {
  readonly lines: readonly ChartLineMark[];
}

export interface ChartGeometryInput {
  readonly labels: readonly string[];
  readonly series: readonly ChartGeometrySeries[];
}

export const BAR_AXIS_CLEARANCE = 4;

const VIEWBOX_WIDTH = 360;
const VIEWBOX_HEIGHT = 180;
const PLOT_LEFT = 70;
const PLOT_TOP = 18;
const PLOT_WIDTH = 250;
const PLOT_HEIGHT = 96;
const PLOT_RIGHT = PLOT_LEFT + PLOT_WIDTH;
const PLOT_BOTTOM = PLOT_TOP + PLOT_HEIGHT;
const X_AXIS_Y = PLOT_BOTTOM + BAR_AXIS_CLEARANCE + 2;
const X_LABEL_Y = X_AXIS_Y + 19;
const Y_LABEL_X = PLOT_LEFT - 8;
const MIN_X_TICK_GAP = 34;
const AXIS_LABEL_MAX_CHARS = 12;
const LEGEND_TOP = 156;
const LEGEND_ROW_HEIGHT = 16;
const LEGEND_BOTTOM_PADDING = 4;
const LEGEND_ITEM_GAP = 12;
const LEGEND_TEXT_X = 16;
const LEGEND_CHAR_WIDTH = 7;
const LEGEND_LABEL_MAX_CHARS = 18;
const LABEL_CHAR_WIDTH = 6;
const Y_TICK_COUNT = 5;

export const CHART_GEOMETRY = {
  viewBoxWidth: VIEWBOX_WIDTH,
  viewBoxHeight: VIEWBOX_HEIGHT,
  xAxisY: X_AXIS_Y,
  xLabelY: X_LABEL_Y,
  minXTickGap: MIN_X_TICK_GAP,
  axisLabelMaxChars: AXIS_LABEL_MAX_CHARS,
  plot: {
    left: PLOT_LEFT,
    top: PLOT_TOP,
    width: PLOT_WIDTH,
    height: PLOT_HEIGHT,
    right: PLOT_RIGHT,
    bottom: PLOT_BOTTOM,
  },
  legend: {
    top: LEGEND_TOP,
    rowHeight: LEGEND_ROW_HEIGHT,
    bottomPadding: LEGEND_BOTTOM_PADDING,
    itemGap: LEGEND_ITEM_GAP,
    textX: LEGEND_TEXT_X,
    charWidth: LEGEND_CHAR_WIDTH,
    labelMaxChars: LEGEND_LABEL_MAX_CHARS,
  },
  yLabelX: Y_LABEL_X,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function abbreviateChartLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

export function estimateChartLabelWidth(label: string): number {
  return label.length * LABEL_CHAR_WIDTH;
}

export function formatChartTick(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000 || (absolute > 0 && absolute < 0.01)) {
    return value.toExponential(2);
  }
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function maxPointCount(series: readonly ChartGeometrySeries[]): number {
  return Math.max(0, ...series.map(({ values }) => values.length));
}

function labelForIndex(labels: readonly string[], index: number): string {
  return labels[index] ?? String(index + 1);
}

export function chartY(value: number, min: number, max: number): number {
  const directRange = max - min;
  if (Number.isFinite(directRange) && directRange > 0) {
    const y = PLOT_BOTTOM - ((value - min) / directRange) * PLOT_HEIGHT;
    return clamp(y, PLOT_TOP, PLOT_BOTTOM);
  }
  const scale = Math.max(1, Math.abs(value), Math.abs(min), Math.abs(max));
  const scaledValue = value / scale;
  const scaledMin = min / scale;
  const scaledMax = max / scale;
  const scaledRange = scaledMax - scaledMin;
  if (!Number.isFinite(scaledRange) || scaledRange <= 0) return PLOT_BOTTOM;
  const y = PLOT_BOTTOM - ((scaledValue - scaledMin) / scaledRange) * PLOT_HEIGHT;
  return clamp(y, PLOT_TOP, PLOT_BOTTOM);
}

export function xPositionForIndex(
  index: number,
  pointCount: number,
  explicitPositions: readonly number[] | undefined,
): number {
  const explicit = explicitPositions?.[index];
  if (explicit !== undefined) return explicit;
  const step = pointCount <= 1 ? 0 : PLOT_WIDTH / (pointCount - 1);
  return PLOT_LEFT + index * step;
}

export function selectXTickIndexes(
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

function buildXTicks(
  labels: readonly string[],
  pointCount: number,
  explicitPositions: readonly number[] | undefined,
): readonly ChartTick[] {
  return selectXTickIndexes(pointCount, explicitPositions).map((index) => {
    const label = abbreviateChartLabel(labelForIndex(labels, index), AXIS_LABEL_MAX_CHARS);
    const x = xPositionForIndex(index, pointCount, explicitPositions);
    return { label, value: index, x, y: X_LABEL_Y, labelX: x };
  });
}

function scaledValueBetween(min: number, max: number, ratio: number): number {
  const directRange = max - min;
  if (Number.isFinite(directRange)) return min + directRange * ratio;
  const scale = Math.max(1, Math.abs(min), Math.abs(max));
  const scaledMin = min / scale;
  const scaledMax = max / scale;
  return (scaledMin + (scaledMax - scaledMin) * ratio) * scale;
}

function buildYTicks(min: number, max: number): readonly ChartTick[] {
  const range = max - min;
  if (!Number.isFinite(range) || range > 0) {
    return Array.from({ length: Y_TICK_COUNT }, (_, index) => {
      const ratio = Y_TICK_COUNT <= 1 ? 0 : index / (Y_TICK_COUNT - 1);
      const value = scaledValueBetween(min, max, ratio);
      const y = chartY(value, min, max);
      return {
        label: formatChartTick(value),
        value,
        x: PLOT_LEFT,
        y,
        labelX: Y_LABEL_X,
      };
    });
  }
  const y = chartY(min, min, max);
  return [{ label: formatChartTick(min), value: min, x: PLOT_LEFT, y, labelX: Y_LABEL_X }];
}

function valuesFor(series: readonly ChartGeometrySeries[]): readonly number[] {
  return series.flatMap((item) => item.values as number[]);
}

function barYRange(series: readonly ChartGeometrySeries[]): {
  readonly yMin: number;
  readonly yMax: number;
} {
  const values = valuesFor(series);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const yMin = Math.min(0, rawMin);
  const yMax = yMin === 0 && rawMax === 0 ? 1 : Math.max(0, rawMax);
  return { yMin, yMax };
}

function lineYRange(series: readonly ChartGeometrySeries[]): {
  readonly yMin: number;
  readonly yMax: number;
} {
  const values = valuesFor(series);
  return { yMin: Math.min(0, ...values), yMax: Math.max(1, ...values) };
}

export function layoutChartLegend(labels: readonly string[]): ChartLegendLayout {
  if (labels.length === 0) return { items: [], viewBoxHeight: VIEWBOX_HEIGHT };
  const items: ChartLegendItem[] = [];
  let x = PLOT_LEFT;
  let y = LEGEND_TOP;
  const rightEdge = VIEWBOX_WIDTH - 8;
  for (const rawLabel of labels) {
    const label = abbreviateChartLabel(rawLabel, LEGEND_LABEL_MAX_CHARS);
    const width = LEGEND_TEXT_X + label.length * LEGEND_CHAR_WIDTH;
    if (items.length > 0 && x + width > rightEdge) {
      x = PLOT_LEFT;
      y += LEGEND_ROW_HEIGHT;
    }
    items.push({ label, x, y, width });
    x += width + LEGEND_ITEM_GAP;
  }
  return {
    items,
    viewBoxHeight: Math.max(VIEWBOX_HEIGHT, y + LEGEND_ROW_HEIGHT + LEGEND_BOTTOM_PADDING),
  };
}

export function layoutBarChartGeometry(input: ChartGeometryInput): BarChartGeometry {
  const { labels, series } = input;
  const { yMin, yMax } = barYRange(series);
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
  const bars = series.flatMap((item, seriesIndex) =>
    item.values.map((value, valueIndex): ChartBarMark => {
      const valueY = chartY(value, yMin, yMax);
      const rawHeight = Math.abs(valueY - zeroY);
      const clearance = value === 0 ? 0 : Math.min(BAR_AXIS_CLEARANCE, rawHeight);
      const groupStart = PLOT_LEFT + valueIndex * slotWidth + (slotWidth - groupWidth) / 2;
      const x = clamp(groupStart + seriesIndex * (barWidth + barGap), PLOT_LEFT, PLOT_RIGHT);
      if (value < 0) {
        const y = clamp(zeroY + clearance, PLOT_TOP, PLOT_BOTTOM);
        const bottom = clamp(Math.max(valueY, y), PLOT_TOP, PLOT_BOTTOM);
        return {
          seriesIndex,
          valueIndex,
          value,
          x,
          y,
          width: Math.min(barWidth, PLOT_RIGHT - x),
          height: Math.max(0, bottom - y),
          zeroY,
        };
      }
      const bottom = clamp(zeroY - clearance, PLOT_TOP, PLOT_BOTTOM);
      const y = clamp(Math.min(valueY, bottom), PLOT_TOP, PLOT_BOTTOM);
      return {
        seriesIndex,
        valueIndex,
        value,
        x,
        y,
        width: Math.min(barWidth, PLOT_RIGHT - x),
        height: Math.max(0, bottom - y),
        zeroY,
      };
    }),
  );
  return {
    pointCount,
    yMin,
    yMax,
    zeroY,
    bars,
    xTicks: buildXTicks(labels, pointCount, groupCenters),
    yTicks: buildYTicks(yMin, yMax),
  };
}

export function layoutLineChartGeometry(input: ChartGeometryInput): LineChartGeometry {
  const { labels, series } = input;
  const { yMin, yMax } = lineYRange(series);
  const pointCount = maxPointCount(series);
  const lines = series.map((item, seriesIndex): ChartLineMark => {
    const points = item.values.map((value, valueIndex) => ({
      x: xPositionForIndex(valueIndex, pointCount, undefined),
      y: chartY(value, yMin, yMax),
    }));
    const line: {
      seriesIndex: number;
      label: string;
      lineStyle?: ChartLineStyle;
      points: readonly ChartPoint[];
    } = { seriesIndex, label: item.label, points };
    if (item.lineStyle !== undefined) line.lineStyle = item.lineStyle;
    return line;
  });
  return {
    pointCount,
    yMin,
    yMax,
    lines,
    xTicks: buildXTicks(labels, pointCount, undefined),
    yTicks: buildYTicks(yMin, yMax),
  };
}

export function lineDasharrayForStyle(style: ChartLineStyle | undefined): string | undefined {
  if (style === "dashed") return "6 4";
  if (style === "dotted") return "1 5";
  return undefined;
}
