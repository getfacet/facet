import type { ChartSeries } from "@facet/core";

export type ChartLineStyle = NonNullable<ChartSeries["lineStyle"]>;
export type ChartAxis = NonNullable<ChartSeries["axis"]>;

export interface ChartGeometrySeries {
  readonly label: string;
  readonly values: readonly number[];
  readonly lineStyle?: ChartLineStyle;
  readonly axis?: ChartAxis;
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
  /**
   * Right-edge tick set for the secondary scale. Present only when at least one
   * series is assigned `axis: "secondary"` (zero-secondary charts render exactly
   * as a single-scale plot, OQ-2).
   */
  readonly secondaryYTicks?: readonly ChartTick[];
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

/** A resolved y-scale: nice-step domain plus its positioned tick set. */
export interface ChartScale {
  readonly yMin: number;
  readonly yMax: number;
  readonly yTicks: readonly ChartTick[];
}

export interface ResolvedChartScales {
  readonly primary: ChartScale;
  readonly secondary?: ChartScale;
}

export const BAR_AXIS_CLEARANCE = 4;
/** Floor for a non-zero bar: clearance never shrinks a mark below this height. */
export const MIN_BAR_HEIGHT = 1.5;

// Product-grade figure: the plot occupies a decisively larger share of the
// viewBox (width 332/448 ≈ 0.74, height 140/240 ≈ 0.58). Both label gutters are
// the same width (50u ≈ 8 characters) so a secondary axis label never clips at
// the right edge AND a negative label keeps the same precision as its positive
// twin — a narrower gutter charged the minus sign against the mantissa budget,
// so -0.00125 degraded to "-1.3e-3" while 0.00125 printed exactly.
const VIEWBOX_WIDTH = 448;
const VIEWBOX_HEIGHT = 240;
const PLOT_LEFT = 58;
const PLOT_TOP = 16;
const PLOT_WIDTH = 332;
const PLOT_HEIGHT = 140;
const PLOT_RIGHT = PLOT_LEFT + PLOT_WIDTH;
const PLOT_BOTTOM = PLOT_TOP + PLOT_HEIGHT;
const X_AXIS_Y = PLOT_BOTTOM + BAR_AXIS_CLEARANCE + 2;
const X_LABEL_Y = X_AXIS_Y + 16;
const Y_LABEL_X = PLOT_LEFT - 8;
const SECONDARY_LABEL_X = PLOT_RIGHT + (PLOT_LEFT - Y_LABEL_X);
const MIN_X_TICK_GAP = 34;
const AXIS_LABEL_MAX_CHARS = 12;
const LEGEND_TOP = 200;
const LEGEND_ROW_HEIGHT = 16;
const LEGEND_BOTTOM_PADDING = 4;
const LEGEND_ITEM_GAP = 12;
const LEGEND_TEXT_X = 16;
const LEGEND_CHAR_WIDTH = 7;
const LEGEND_LABEL_MAX_CHARS = 18;
const LABEL_CHAR_WIDTH = 6;
const Y_TICK_TARGET = 5;

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
  secondaryYLabelX: SECONDARY_LABEL_X,
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

/** Drop a trailing fractional zero run ("45.0" -> "45", "1.20" -> "1.2"). */
function trimFloat(rawText: string): string {
  // `toFixed` itself switches to exponential form at |value| >= 1e21, so EVERY
  // rendering path normalises the redundant "e+" here rather than each branch
  // remembering to (contract rule 4 — one notation per ladder).
  const text = rawText.replace("e+", "e");
  if (!text.includes(".")) return text;
  // Trim ONLY the mantissa: "5.00e-10" must not lose the exponent's zero and
  // silently become "5.00e-1" — a label nine orders of magnitude off its tick.
  const exponent = text.indexOf("e");
  if (exponent === -1) return text.replace(/\.?0+$/, "");
  return `${text.slice(0, exponent).replace(/\.?0+$/, "")}${text.slice(exponent)}`;
}

/**
 * TICK LABEL CONTRACT — one place, because these rules were previously spread
 * across four independent exits and each patch broke another.
 *
 * A rendered tick label must be:
 *   1. FAITHFUL     — it parses back to the exact value it sits on;
 *   2. DISTINCT     — no two ticks of one ladder share a label;
 *   3. BOUNDED      — it fits the axis gutter, so the plot never clips it;
 *   4. CONSISTENT   — one ladder uses ONE notation (zero is always "0").
 *
 * Notation is therefore chosen ONCE PER LADDER from its largest magnitude, and
 * every tick renders in that notation at the shortest precision that is both
 * faithful and bounded. When no faithful rendering fits, the most precise
 * bounded one wins — width is a hard limit, precision degrades knowingly.
 */
const COMPACT_UNITS: readonly (readonly [number, string])[] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

// The widest label an axis gutter can show without running past the viewBox
// edge (labels are right-anchored at Y_LABEL_X and left-anchored at its mirror).
const MAX_TICK_LABEL_WIDTH = Y_LABEL_X;

/** How a whole ladder spells its numbers. */
export type TickNotation =
  | { readonly kind: "plain" }
  | { readonly kind: "compact"; readonly threshold: number; readonly suffix: string }
  | { readonly kind: "exponent" };

const PLAIN_NOTATION: TickNotation = { kind: "plain" };
const EXPONENT_NOTATION: TickNotation = { kind: "exponent" };

function labelFits(text: string): boolean {
  return text.length * LABEL_CHAR_WIDTH <= MAX_TICK_LABEL_WIDTH;
}

/** Parse a rendered label back to the number it claims — the faithfulness oracle. */
export function parseTickLabel(text: string): number {
  const suffix = COMPACT_UNITS.find(([, unit]) => text.endsWith(unit));
  return suffix === undefined ? Number(text) : Number(text.slice(0, -1)) * suffix[0];
}

interface TickRendering {
  readonly text: string;
  /**
   * Whether `text` recovers the tick's value. Judged in the domain the text was
   * produced in — reading a compact label back by MULTIPLYING the mantissa adds
   * float error of its own ("4.1" × 1e9 ≠ 4.1e9), which would reject a perfectly
   * faithful label.
   */
  readonly faithful: boolean;
}

/** Every rendering of `value` in `notation`, shortest (least precise) first. */
function tickRenderings(value: number, notation: TickNotation): readonly TickRendering[] {
  if (notation.kind === "compact") {
    const scaled = value / notation.threshold;
    return Array.from({ length: 5 }, (_, digits) => {
      const mantissa = trimFloat(scaled.toFixed(digits));
      return { text: `${mantissa}${notation.suffix}`, faithful: Number(mantissa) === scaled };
    });
  }
  if (notation.kind === "exponent") {
    // Drop the redundant "+" of a positive exponent: one free character of
    // mantissa precision at no cost to meaning ("1.25e16", not "1.3e+16").
    return Array.from({ length: 4 }, (_, digits) => {
      const text = trimFloat(value.toExponential(digits));
      return { text, faithful: Number(text) === value };
    });
  }
  return Array.from({ length: 13 }, (_, digits) => {
    const text = trimFloat(value.toFixed(digits));
    return { text, faithful: Number(text) === value };
  });
}

function renderTick(value: number, notation: TickNotation): string {
  const renderings = tickRenderings(value, notation);
  for (const rendering of renderings) {
    if (rendering.faithful && labelFits(rendering.text)) return rendering.text;
  }
  // Nothing is both faithful and bounded: width is the hard limit, so take the
  // most precise rendering that still fits, and the shortest if none does.
  const bounded = renderings.filter((rendering) => labelFits(rendering.text));
  return (bounded[bounded.length - 1] ?? renderings[0])?.text ?? "0";
}

function rendersFaithfully(value: number, notation: TickNotation): boolean {
  return tickRenderings(value, notation).some(
    (rendering) => rendering.faithful && labelFits(rendering.text),
  );
}

/**
 * Pick the one notation a ladder spells its ticks in: the most readable form
 * that renders EVERY tick faithfully within the gutter. Preference order is
 * compact (for thousands and up) → plain → exponent.
 */
export function tickNotationFor(values: readonly number[]): TickNotation {
  const finite = values.filter((value) => Number.isFinite(value));
  const magnitude = Math.max(0, ...finite.map((value) => Math.abs(value)));
  const candidates: TickNotation[] = [];
  for (const [threshold, suffix] of COMPACT_UNITS) {
    if (magnitude < threshold) continue;
    // A unit is only useful while it keeps the mantissa readable; beyond that
    // the exponent form takes over (this is what the old ad-hoc 1e15 valve did).
    if (magnitude / threshold < 1e3) candidates.push({ kind: "compact", threshold, suffix });
    break;
  }
  candidates.push(PLAIN_NOTATION, EXPONENT_NOTATION);
  for (const notation of candidates) {
    const usable = finite.every((value) => value === 0 || rendersFaithfully(value, notation));
    if (usable) return notation;
  }
  return EXPONENT_NOTATION;
}

/**
 * Render one tick. Pass the ladder's notation so a whole axis stays consistent;
 * without one the value is spelled on its own terms (the standalone contract).
 */
export function formatChartTick(value: number, notation?: TickNotation): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : value < 0 ? "-∞" : "0";
  // Zero is universally spelled "0" — never "0K" and never "0e0".
  if (value === 0) return "0";
  return renderTick(value, notation ?? tickNotationFor([value]));
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

// Choose a step from the 1/2/2.5/5×10^n family so ~Y_TICK_TARGET intervals cover
// the range; degenerate ranges return NaN (handled by the caller's fallback).
function niceStep(range: number): number {
  if (!Number.isFinite(range) || range <= 0) return Number.NaN;
  const rough = range / Y_TICK_TARGET;
  const exponent = Math.floor(Math.log10(rough));
  const base = 10 ** exponent;
  const fraction = rough / base;
  const niceFraction =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return niceFraction * base;
}

// Step-aligned tick values spanning [min,max]: first tick ≤ min, last tick ≥ max,
// landing on multiples of the step (so 0 is included when the range includes 0).
// Interpolate across a span too wide to subtract directly: rescale both bounds
// by the larger magnitude first, exactly as `chartY` does for the same case.
function scaledValueBetween(min: number, max: number, ratio: number): number {
  const directRange = max - min;
  if (Number.isFinite(directRange)) return min + directRange * ratio;
  const scale = Math.max(1, Math.abs(min), Math.abs(max));
  const scaledMin = min / scale;
  const scaledMax = max / scale;
  return (scaledMin + (scaledMax - scaledMin) * ratio) * scale;
}

function clampFinite(value: number): number {
  return Math.min(Number.MAX_VALUE, Math.max(-Number.MAX_VALUE, value));
}

// Snap by SIGNIFICANT digits, not decimal places: a fixed decimal cap rounded
// every tick of a sub-1e-12 domain to 0, collapsing the ladder to one tick and
// flattening the plot. Twelve significant digits still absorbs the float
// accumulation a ladder would otherwise carry.
function snapTick(value: number): number {
  return clampFinite(value === 0 ? 0 : Number(value.toPrecision(12)));
}

// Degenerate ranges (zero, non-finite) fall back to a single tick at min.
function niceTickValues(min: number, max: number): readonly number[] {
  const step = niceStep(max - min);
  if (!Number.isFinite(step) || step <= 0) {
    // A span that overflows to Infinity is still a real domain (every value is
    // finite and passes Core's chart gate); fall back to the scaled ladder
    // rather than collapsing the axis to one tick and flattening every mark.
    if (min < max && Number.isFinite(min) && Number.isFinite(max)) {
      return Array.from({ length: Y_TICK_TARGET + 1 }, (_, index) =>
        scaledValueBetween(min, max, index / Y_TICK_TARGET),
      );
    }
    return [min];
  }

  // Near Number.MAX_VALUE a step-aligned bound can overflow to ±Infinity even
  // though every input value is finite (and finite values pass core's chart
  // gate) — clamp each bound and fall back to the single-tick path when the
  // span itself is no longer finite, so no Infinity/NaN ever reaches a tick.
  const start = snapTick(Math.floor(min / step) * step);
  const end = snapTick(Math.ceil(max / step) * step);
  const count = Math.round((end - start) / step);
  if (!Number.isFinite(count) || count < 0) return [min];
  const values: number[] = [];
  // A step-relative zero clamp: accumulating `start + index * step` across a
  // zero crossing leaves a ~1e-17 residue that significant-digit snapping
  // preserves, so the baseline gridline printed "2.8e-17" instead of "0". The
  // threshold sits far above float accumulation and far below any real tick.
  const zeroBand = Math.abs(step) / 1e6;
  for (let index = 0; index <= count && values.length <= 12; index += 1) {
    const raw = start + index * step;
    const value = Math.abs(raw) < zeroBand ? 0 : snapTick(raw);
    if (values.length === 0 || values[values.length - 1] !== value) values.push(value);
  }
  return values.length > 0 ? values : [min];
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

// Resolve one axis group to a nice-step scale positioned at the given anchor
// (left edge for primary, right edge for secondary). The plot domain is the nice
// tick span so data points sit inside the axis and ticks reach the plot edges.
// Extend a nice ladder upward, in its own step, until it has `tickCount` levels.
// Only the DOMAIN gains headroom — every level stays step-aligned, so the marks
// mapped through it remain truthful. A ladder whose step is unusable (the
// degenerate/overflow fallbacks) is returned untouched.
function padTickValues(values: readonly number[], tickCount: number): readonly number[] {
  const step = (values[1] ?? Number.NaN) - (values[0] ?? Number.NaN);
  if (!Number.isFinite(step) || step <= 0 || values.length >= tickCount) return values;
  const base = values[0] ?? 0;
  const zeroBand = Math.abs(step) / 1e6;
  const padded = [...values];
  // Generate each new level from the ORIGIN by index and snap it, exactly as
  // niceTickValues does: accumulating `last + step` drifted by an ULP per level
  // and the residue then forced the top label into scientific notation.
  for (let index = values.length; index < tickCount; index += 1) {
    const raw = base + index * step;
    if (!Number.isFinite(raw)) return values;
    padded.push(Math.abs(raw) < zeroBand ? 0 : snapTick(raw));
  }
  return padded;
}

function resolveScale(
  series: readonly ChartGeometrySeries[],
  kind: "bar" | "line",
  anchorX: number,
  labelX: number,
  tickCount?: number,
): ChartScale {
  const range = kind === "bar" ? barYRange(series) : lineYRange(series);
  const natural = niceTickValues(range.yMin, range.yMax);
  const values = tickCount === undefined ? natural : padTickValues(natural, tickCount);
  const yMin = values[0] ?? range.yMin;
  const yMax = values[values.length - 1] ?? range.yMax;
  // One notation for the whole ladder — a per-value choice let a single axis mix
  // "500T" with "1e15" (contract rule 4).
  const notation = tickNotationFor(values);
  const yTicks = values.map((value): ChartTick => ({
    label: formatChartTick(value, notation),
    value,
    x: anchorX,
    y: chartY(value, yMin, yMax),
    labelX,
  }));
  return { yMin, yMax, yTicks };
}

// Group series by their `axis` field and resolve an independent nice scale per
// group. Zero series assigned "secondary" ⇒ no secondary scale, and the primary
// group is every series — exactly the single-scale computation (OQ-2).
export function resolveScaleRanges(
  series: readonly ChartGeometrySeries[],
  kind: "bar" | "line",
): ResolvedChartScales {
  const primarySeries = series.filter((item) => item.axis !== "secondary");
  const secondarySeries = series.filter((item) => item.axis === "secondary");
  // A scale is only meaningful for a NON-EMPTY group. When every series opts
  // into "secondary" there is just one group: scale it as the primary (left)
  // axis rather than resolving an empty group into a fabricated 0..1 range.
  const primary = resolveScale(
    primarySeries.length > 0 ? primarySeries : series,
    kind,
    PLOT_LEFT,
    Y_LABEL_X,
  );
  if (secondarySeries.length === 0 || primarySeries.length === 0) return { primary };
  // Gridlines are drawn from the PRIMARY ladder alone, so two independently
  // chosen ladders would leave the right-edge labels floating between the rules.
  // Reconcile both onto one level count, then source the secondary tick y from
  // the primary array so the alignment is structural and cannot drift.
  const naturalSecondary = resolveScale(secondarySeries, kind, PLOT_RIGHT, SECONDARY_LABEL_X);
  const levels = Math.max(primary.yTicks.length, naturalSecondary.yTicks.length);
  const alignedPrimary = resolveScale(
    primarySeries.length > 0 ? primarySeries : series,
    kind,
    PLOT_LEFT,
    Y_LABEL_X,
    levels,
  );
  const alignedSecondary = resolveScale(
    secondarySeries,
    kind,
    PLOT_RIGHT,
    SECONDARY_LABEL_X,
    levels,
  );
  if (alignedPrimary.yTicks.length !== alignedSecondary.yTicks.length) {
    // A fallback ladder refused padding: keep both natural rather than implying
    // a shared grid that does not exist.
    return { primary, secondary: naturalSecondary };
  }
  return {
    primary: alignedPrimary,
    secondary: {
      ...alignedSecondary,
      yTicks: alignedSecondary.yTicks.map((tick, index) => ({
        ...tick,
        y: alignedPrimary.yTicks[index]?.y ?? tick.y,
      })),
    },
  };
}

function scaleForSeries(item: ChartGeometrySeries, scales: ResolvedChartScales): ChartScale {
  return item.axis === "secondary" && scales.secondary ? scales.secondary : scales.primary;
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
  const scales = resolveScaleRanges(series, "bar");
  const { primary } = scales;
  const zeroY = chartY(0, primary.yMin, primary.yMax);
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
  const bars = series.flatMap((item, seriesIndex) => {
    const scale = scaleForSeries(item, scales);
    const seriesZeroY = chartY(0, scale.yMin, scale.yMax);
    return item.values.map((value, valueIndex): ChartBarMark => {
      const valueY = chartY(value, scale.yMin, scale.yMax);
      const rawHeight = Math.abs(valueY - seriesZeroY);
      // Clearance lifts marks off the axis but may never erase them: a bar
      // whose rawHeight is inside the clearance window keeps MIN_BAR_HEIGHT so
      // a small non-zero value stays visually distinct from a true zero.
      const clearance =
        value === 0 ? 0 : Math.min(BAR_AXIS_CLEARANCE, Math.max(0, rawHeight - MIN_BAR_HEIGHT));
      const groupStart = PLOT_LEFT + valueIndex * slotWidth + (slotWidth - groupWidth) / 2;
      const x = clamp(groupStart + seriesIndex * (barWidth + barGap), PLOT_LEFT, PLOT_RIGHT);
      if (value < 0) {
        const y = clamp(seriesZeroY + clearance, PLOT_TOP, PLOT_BOTTOM);
        const rawBottom = clamp(Math.max(valueY, y), PLOT_TOP, PLOT_BOTTOM);
        // A non-zero bar keeps at least MIN_BAR_HEIGHT (grown away from the
        // zero line, inside the plot) so it never collapses into a zero mark.
        // Inside this branch the value is strictly negative, so the floor always
        // applies — the mark grows downward from the zero line.
        const bottom = clamp(Math.max(rawBottom, y + MIN_BAR_HEIGHT), PLOT_TOP, PLOT_BOTTOM);
        return {
          seriesIndex,
          valueIndex,
          value,
          x,
          y,
          width: Math.min(barWidth, PLOT_RIGHT - x),
          height: Math.max(0, bottom - y),
          zeroY: seriesZeroY,
        };
      }
      const bottom = clamp(seriesZeroY - clearance, PLOT_TOP, PLOT_BOTTOM);
      const rawY = clamp(Math.min(valueY, bottom), PLOT_TOP, PLOT_BOTTOM);
      // Same floor for positive bars: extend upward from the zero line.
      const y =
        value === 0 ? rawY : clamp(Math.min(rawY, bottom - MIN_BAR_HEIGHT), PLOT_TOP, PLOT_BOTTOM);
      return {
        seriesIndex,
        valueIndex,
        value,
        x,
        y,
        width: Math.min(barWidth, PLOT_RIGHT - x),
        height: Math.max(0, bottom - y),
        zeroY: seriesZeroY,
      };
    });
  });
  const result: BarChartGeometry = {
    pointCount,
    yMin: primary.yMin,
    yMax: primary.yMax,
    zeroY,
    bars,
    xTicks: buildXTicks(labels, pointCount, groupCenters),
    yTicks: primary.yTicks,
  };
  return scales.secondary ? { ...result, secondaryYTicks: scales.secondary.yTicks } : result;
}

export function layoutLineChartGeometry(input: ChartGeometryInput): LineChartGeometry {
  const { labels, series } = input;
  const scales = resolveScaleRanges(series, "line");
  const pointCount = maxPointCount(series);
  const lines = series.map((item, seriesIndex): ChartLineMark => {
    const scale = scaleForSeries(item, scales);
    const points = item.values.map((value, valueIndex) => ({
      x: xPositionForIndex(valueIndex, pointCount, undefined),
      y: chartY(value, scale.yMin, scale.yMax),
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
  const result: LineChartGeometry = {
    pointCount,
    yMin: scales.primary.yMin,
    yMax: scales.primary.yMax,
    lines,
    xTicks: buildXTicks(labels, pointCount, undefined),
    yTicks: scales.primary.yTicks,
  };
  return scales.secondary ? { ...result, secondaryYTicks: scales.secondary.yTicks } : result;
}

export function lineDasharrayForStyle(style: ChartLineStyle | undefined): string | undefined {
  if (style === "dashed") return "6 4";
  if (style === "dotted") return "1 5";
  return undefined;
}
