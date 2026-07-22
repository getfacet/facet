import { describe, expect, it } from "vitest";
import {
  BAR_AXIS_CLEARANCE,
  MIN_BAR_HEIGHT,
  CHART_GEOMETRY,
  estimateChartLabelWidth,
  formatChartTick,
  layoutBarChartGeometry,
  layoutChartLegend,
  layoutLineChartGeometry,
  parseTickLabel,
  selectXTickIndexes,
} from "./chart-geometry.js";

function expectWithinPlot(point: { readonly x: number; readonly y: number }): void {
  expect(point.x).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.left);
  expect(point.x).toBeLessThanOrEqual(CHART_GEOMETRY.plot.right);
  expect(point.y).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.top);
  expect(point.y).toBeLessThanOrEqual(CHART_GEOMETRY.plot.bottom);
}

describe("chart geometry", () => {
  it("keeps chart marks clear of axes", () => {
    const labels = Array.from({ length: 18 }, (_, index) => `Week ${String(index + 1)}`);
    const bars = layoutBarChartGeometry({
      labels,
      series: [
        { label: "Actual", values: [32, 48, -14, 62, 58, 74, 68, 88] },
        { label: "Forecast", values: [28, 40, -10, 55, 52, 66, 71, 83] },
      ],
    });

    expect(CHART_GEOMETRY.xAxisY - CHART_GEOMETRY.plot.bottom).toBeGreaterThanOrEqual(
      BAR_AXIS_CLEARANCE,
    );
    expect(bars.pointCount).toBe(8);
    for (const bar of bars.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.left);
      expect(bar.x + bar.width).toBeLessThanOrEqual(CHART_GEOMETRY.plot.right);
      expect(bar.y).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.top);
      expect(bar.y + bar.height).toBeLessThanOrEqual(CHART_GEOMETRY.plot.bottom);
      if (bar.value > 0) {
        expect(bar.y + bar.height).toBeLessThanOrEqual(bar.zeroY - BAR_AXIS_CLEARANCE);
      } else if (bar.value < 0) {
        expect(bar.y).toBeGreaterThanOrEqual(bar.zeroY + BAR_AXIS_CLEARANCE);
      }
    }

    const lines = layoutLineChartGeometry({
      labels,
      series: [{ label: "Actual", values: [-12, 4, 18, 6, 22, 13, 31, 28, 36, 40, 44, 50] }],
    });
    expect(lines.pointCount).toBe(12);
    for (const line of lines.lines) {
      for (const point of line.points) expectWithinPlot(point);
    }

    const tickIndexes = selectXTickIndexes(labels.length, undefined);
    expect(tickIndexes[0]).toBe(0);
    expect(tickIndexes.at(-1)).toBe(labels.length - 1);
    for (let index = 1; index < tickIndexes.length; index += 1) {
      const current = tickIndexes[index];
      const previous = tickIndexes[index - 1];
      expect(current).toBeDefined();
      expect(previous).toBeDefined();
      expect((current ?? 0) - (previous ?? 0)).toBeGreaterThanOrEqual(2);
    }
  });

  it("bounds tick labels and wrapped legends inside the chart viewBox", () => {
    const labels = Array.from({ length: 40 }, (_, index) => `Fiscal period ${String(index + 1)}`);
    const bars = layoutBarChartGeometry({
      labels,
      series: [{ label: "Large range", values: [-Number.MAX_VALUE, Number.MAX_VALUE] }],
    });

    for (const tick of bars.yTicks) {
      expect(tick.labelX - estimateChartLabelWidth(tick.label)).toBeGreaterThanOrEqual(0);
      expect(tick.y).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.top);
      expect(tick.y).toBeLessThanOrEqual(CHART_GEOMETRY.plot.bottom);
    }
    for (const tick of bars.xTicks) {
      expect(tick.x - estimateChartLabelWidth(tick.label) / 2).toBeGreaterThanOrEqual(0);
      expect(tick.x + estimateChartLabelWidth(tick.label) / 2).toBeLessThanOrEqual(
        CHART_GEOMETRY.viewBoxWidth,
      );
    }

    const legend = layoutChartLegend([
      "Enterprise annual recurring revenue",
      "Small business activation",
      "Expansion pipeline forecast",
      "Churn-risk accounts",
    ]);

    for (const item of legend.items) {
      expect(item.x).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.left);
      expect(item.x + item.width).toBeLessThanOrEqual(CHART_GEOMETRY.viewBoxWidth - 8);
      expect(item.y + CHART_GEOMETRY.legend.rowHeight).toBeLessThanOrEqual(
        legend.viewBoxHeight - CHART_GEOMETRY.legend.bottomPadding,
      );
    }
  });
});

// Product-grade chart geometry overhaul: larger plot proportion, nice-step Y
// ticks, compact number formatting, and per-series `axis` dual-scale mapping.
describe("chart geometry tick-label contract", () => {
  // A property sweep over the whole magnitude/sign space. Example-based tests
  // let each review round surface one more unlucky value; these four assertions
  // ARE the contract stated in chart-geometry.ts, checked on every ladder.
  const MAGNITUDES = [
    1e-13, 1e-9, 1e-7, 1e-5, 0.00125, 0.0125, 0.125, 0.5, 1, 7, 23, 250, 1200, 1250, 12_500,
    250_000, 1.25e6, 3e9, 5e14, 2.5e15, 1.2e16, 1e50,
  ];
  const DOMAINS: readonly (readonly number[])[] = [
    ...MAGNITUDES.map((magnitude) => [0, magnitude]),
    ...MAGNITUDES.map((magnitude) => [-magnitude, magnitude]),
    ...MAGNITUDES.map((magnitude) => [-magnitude, magnitude / 4]),
    ...MAGNITUDES.map((magnitude) => [magnitude / 3, magnitude]),
  ];

  function assertLadder(ticks: readonly { label: string; value: number }[], context: string): void {
    const labels = ticks.map((tick) => tick.label);
    // 2. DISTINCT
    expect(new Set(labels).size, `${context} duplicate: ${labels.join("|")}`).toBe(labels.length);
    const notations = new Set<string>();
    for (const tick of ticks) {
      // 3. BOUNDED
      expect(
        estimateChartLabelWidth(tick.label),
        `${context} too wide: ${tick.label}`,
      ).toBeLessThanOrEqual(CHART_GEOMETRY.yLabelX);
      // 1. FAITHFUL
      const parsed = parseTickLabel(tick.label);
      expect(Number.isFinite(parsed), `${context} unparseable: ${tick.label}`).toBe(true);
      const relative = tick.value === 0 ? Math.abs(parsed) : Math.abs(parsed / tick.value - 1);
      expect(relative, `${context} ${tick.label} vs ${String(tick.value)}`).toBeLessThan(0.005);
      // 4. CONSISTENT (zero is exempt — always "0")
      if (tick.value === 0) continue;
      notations.add(
        /e-?\d/iu.test(tick.label) ? "exponent" : /[KMBT]$/u.test(tick.label) ? "compact" : "plain",
      );
    }
    expect(
      [...notations].length,
      `${context} mixed notation: ${labels.join("|")}`,
    ).toBeLessThanOrEqual(1);
  }

  it("never leaks a scientific '+' from the plain notation (review P3)", () => {
    // toFixed switches to exponential at |v| >= 1e21; only the exponent branch
    // used to strip the redundant "+".
    expect(formatChartTick(1e20)).toBe("1e20");
    expect(formatChartTick(1e21)).toBe("1e21");
    const geometry = layoutLineChartGeometry({
      labels: [],
      series: [{ label: "s", values: [1e21, 5e21] }],
    });
    for (const tick of geometry.yTicks) expect(tick.label).not.toContain("e+");
  });

  it("holds the tick-label contract across the magnitude and sign space", () => {
    for (const values of DOMAINS) {
      for (const layout of [layoutBarChartGeometry, layoutLineChartGeometry]) {
        const geometry = layout({ labels: [], series: [{ label: "s", values }] });
        assertLadder(geometry.yTicks, JSON.stringify(values));
      }
    }
  });

  it("holds the contract on BOTH ladders of a dual-axis chart", () => {
    for (const primaryValues of DOMAINS) {
      for (const secondaryValues of [
        [0, 250],
        [-0.0012, 0.0004],
        [5000, 20000],
      ]) {
        const geometry = layoutLineChartGeometry({
          labels: [],
          series: [
            { label: "p", values: primaryValues },
            { label: "s", values: secondaryValues, axis: "secondary" },
          ],
        });
        const context = `${JSON.stringify(primaryValues)} + ${JSON.stringify(secondaryValues)}`;
        assertLadder(geometry.yTicks, `primary ${context}`);
        assertLadder(geometry.secondaryYTicks ?? [], `secondary ${context}`);
        // The reconciled grid: both ladders share every gridline.
        expect((geometry.secondaryYTicks ?? []).map((tick) => tick.y)).toEqual(
          geometry.yTicks.map((tick) => tick.y),
        );
      }
    }
  });
});

describe("chart geometry (analytics-data-surface)", () => {
  it("keeps a PADDED dual-axis ladder free of float residue (review P2)", () => {
    // padTickValues accumulated `last + step` without the snap niceTickValues
    // applies, so a reconciled ladder ended on 0.39999999999999997 and printed
    // "4e-1" as its top label.
    const geometry = layoutBarChartGeometry({
      labels: [],
      series: [
        { label: "Rank delta", values: [-0.58, -0.2, 0.1] },
        { label: "CTR", values: [0.05, 0.04, 0.03], axis: "secondary" },
      ],
    });
    for (const ticks of [geometry.yTicks, geometry.secondaryYTicks ?? []]) {
      for (const tick of ticks) {
        expect(tick.label, ticks.map((item) => item.label).join("|")).not.toMatch(/e[-+]?\d/iu);
      }
    }
    expect(geometry.yTicks.at(-1)?.value).toBe(0.4);
  });

  it("gives a negative tick the same precision as its positive twin (review P2)", () => {
    // The minus sign was charged against the mantissa budget, so -0.00125 read
    // "-1.3e-3" — 4% off its own gridline — while 0.00125 printed exactly.
    for (const magnitude of [0.00125, 0.0025, 0.125, 1250]) {
      expect(formatChartTick(-magnitude)).toBe(`-${formatChartTick(magnitude)}`);
    }
    const geometry = layoutBarChartGeometry({
      labels: [],
      series: [{ label: "delta", values: [-0.0012, 0] }],
    });
    const labels = geometry.yTicks.map((tick) => tick.label);
    // One axis must not mix decimal and scientific notation.
    const scientific = labels.filter((label) => /e[-+]?\d/iu.test(label));
    expect(scientific, labels.join("|")).toHaveLength(0);
    for (const tick of geometry.yTicks) {
      expect(estimateChartLabelWidth(tick.label)).toBeLessThanOrEqual(CHART_GEOMETRY.yLabelX);
    }
  });

  it("labels the zero crossing '0', not a float residue (review P1)", () => {
    // Snapping by significant digits cannot collapse the residue of
    // `start + index * step` at a zero crossing, so the baseline gridline of an
    // ordinary mixed-sign delta chart read "2.8e-17".
    const datasets = [
      [0.02, -0.13],
      [0.001, -0.125],
      [0.1, -0.43],
      [0.048, 0.0499, 0.0088, -0.0599],
    ];
    for (const values of datasets) {
      for (const layout of [layoutBarChartGeometry, layoutLineChartGeometry]) {
        const geometry = layout({ labels: [], series: [{ label: "delta", values }] });
        const labels = geometry.yTicks.map((tick) => tick.label);
        expect(labels, JSON.stringify(values)).toContain("0");
        expect(
          geometry.yTicks.some((tick) => tick.value === 0),
          JSON.stringify(values),
        ).toBe(true);
        for (const label of labels) {
          expect(label, `${JSON.stringify(values)} -> ${labels.join("|")}`).not.toMatch(/e-/iu);
        }
      }
    }
    // The same must hold for a secondary ladder.
    const dual = layoutLineChartGeometry({
      labels: [],
      series: [
        { label: "p", values: [1, 2] },
        { label: "s", values: [0.02, -0.106], axis: "secondary" },
      ],
    });
    for (const tick of dual.secondaryYTicks ?? []) expect(tick.label).not.toMatch(/e-/iu);
  });

  it("puts every secondary tick on a drawn gridline (review P2)", () => {
    // Gridlines come from the PRIMARY ladder only, so two independently-chosen
    // ladders left the right-edge labels floating between the rules — a reader
    // mapping a right label to a gridline reads the wrong value.
    const domains: readonly (readonly [readonly number[], readonly number[]])[] = [
      // The shipped GSC fixture: Clicks 0..2 vs Impressions 20..230.
      [
        [1, 1, 2, 0, 1, 1, 0],
        [45, 80, 230, 55, 50, 35, 20],
      ],
      [
        [10, 30],
        [40, 100],
      ],
      [
        [0, 1],
        [0, 7],
      ],
      [
        [-5, 5],
        [0, 250],
      ],
    ];
    for (const [primaryValues, secondaryValues] of domains) {
      for (const layout of [layoutLineChartGeometry, layoutBarChartGeometry]) {
        const geometry = layout({
          labels: [],
          series: [
            { label: "p", values: primaryValues },
            { label: "s", values: secondaryValues, axis: "secondary" },
          ],
        });
        const primaryY = geometry.yTicks.map((tick) => tick.y);
        const secondaryY = (geometry.secondaryYTicks ?? []).map((tick) => tick.y);
        expect(secondaryY.length, JSON.stringify({ primaryValues, secondaryValues })).toBe(
          primaryY.length,
        );
        expect(secondaryY).toEqual(primaryY);
      }
    }
  });

  it("keeps extreme-magnitude tick labels distinct and faithful (review P2)", () => {
    // The >=1e15 valve bypassed the gutter-fitting descent and pinned every
    // label to one significant digit: 1.5e15 and 2e15 both read "2e+15".
    for (const max of [2.5e15, 1.2e16, 1e50]) {
      const geometry = layoutLineChartGeometry({
        labels: [],
        series: [{ label: "s", values: [0, max] }],
      });
      const labels = geometry.yTicks.map((tick) => tick.label);
      expect(new Set(labels).size, labels.join("|")).toBe(labels.length);
      for (const tick of geometry.yTicks) {
        const parsed = parseTickLabel(tick.label);
        expect(Number.isFinite(parsed), tick.label).toBe(true);
        const relative = tick.value === 0 ? Math.abs(parsed) : Math.abs(parsed / tick.value - 1);
        expect(relative, `${tick.label} vs ${String(tick.value)}`).toBeLessThan(0.005);
        expect(estimateChartLabelWidth(tick.label)).toBeLessThanOrEqual(CHART_GEOMETRY.yLabelX);
      }
    }
  });

  it("anchors a mixed-sign secondary bar group on its OWN zero (review P2)", () => {
    // Each bar carries its scale's zero; without this the secondary group would
    // silently hang off the primary baseline.
    const geometry = layoutBarChartGeometry({
      labels: ["a", "b"],
      series: [
        { label: "P", values: [1, 2] },
        { label: "S", values: [-100, 50], axis: "secondary" },
      ],
    });
    const primaryMarks = geometry.bars.filter((bar) => bar.seriesIndex === 0);
    const secondaryMarks = geometry.bars.filter((bar) => bar.seriesIndex === 1);
    expect(primaryMarks.length).toBeGreaterThan(0);
    expect(secondaryMarks.length).toBeGreaterThan(0);
    for (const bar of primaryMarks) expect(bar.zeroY).toBe(geometry.zeroY);
    // The secondary group spans negative-to-positive, so its zero sits INSIDE
    // the plot and must differ from the primary one — substituting the primary
    // zero here has to fail.
    const secondaryZero = secondaryMarks[0]?.zeroY ?? Number.NaN;
    expect(secondaryZero).not.toBe(geometry.zeroY);
    expect(secondaryZero).toBeGreaterThan(CHART_GEOMETRY.plot.top);
    expect(secondaryZero).toBeLessThan(CHART_GEOMETRY.plot.bottom);
    for (const bar of secondaryMarks) expect(bar.zeroY).toBe(secondaryZero);
    // ...and the marks really straddle it: -100 grows down, 50 grows up.
    const negative = secondaryMarks.find((bar) => bar.value < 0);
    const positive = secondaryMarks.find((bar) => bar.value > 0);
    expect(negative?.y).toBeGreaterThanOrEqual(secondaryZero);
    expect((positive?.y ?? 0) + (positive?.height ?? 0)).toBeLessThanOrEqual(secondaryZero + 0.001);
  });

  it("keeps an overflowing-but-finite domain proportional (review P3)", () => {
    // A span that overflows to Infinity used to collapse the ladder to one tick
    // and flatten every bar to a stub — a regression against main's scaled path.
    const geometry = layoutBarChartGeometry({
      labels: ["a", "b"],
      series: [{ label: "s", values: [-1.7976931348623157e308, 1.7976931348623157e308] }],
    });
    expect(geometry.yTicks.length).toBeGreaterThan(1);
    for (const tick of geometry.yTicks) expect(Number.isFinite(tick.y)).toBe(true);
    const heights = geometry.bars.map((bar) => bar.height);
    expect(Math.max(...heights)).toBeGreaterThan(CHART_GEOMETRY.plot.height * 0.3);
  });

  it("keeps SMALL-magnitude tick labels inside the gutter too (review P2)", () => {
    // The faithful-decimal formatter is unbounded in width: 1e-7 rendered
    // "0.0000001" (54u) and ran past the left edge of a 44u gutter, where the
    // svg's overflow:hidden simply truncates it.
    for (const values of [
      [1e-7, 3e-7],
      [1e-9, 2e-9],
      [0.00002, 0.00005],
      [1e-4, 5e-4],
    ]) {
      const geometry = layoutBarChartGeometry({ labels: [], series: [{ label: "s", values }] });
      for (const tick of geometry.yTicks) {
        expect(
          tick.labelX - estimateChartLabelWidth(tick.label),
          `${tick.label} overflows the left gutter`,
        ).toBeGreaterThanOrEqual(0);
      }
      const secondary = layoutBarChartGeometry({
        labels: [],
        series: [
          { label: "p", values: [1, 2] },
          { label: "s", values, axis: "secondary" },
        ],
      });
      for (const tick of secondary.secondaryYTicks ?? []) {
        expect(
          tick.labelX + estimateChartLabelWidth(tick.label),
          `${tick.label} overflows the right gutter`,
        ).toBeLessThanOrEqual(CHART_GEOMETRY.viewBoxWidth);
      }
    }
  });

  it("draws a secondary series' MARKS against the secondary scale (review P2)", () => {
    // scaleForSeries is the only path putting a secondary series' points/bars on
    // the secondary scale; without mark-level assertions `return scales.primary`
    // flattens the secondary line while every tick assertion stays green.
    const line = layoutLineChartGeometry({
      labels: ["a", "b", "c"],
      series: [
        { label: "Clicks", values: [1, 2, 1] },
        { label: "Impressions", values: [5000, 20000, 10000], axis: "secondary" },
      ],
    });
    const impressions = line.lines.find((item) => item.label === "Impressions");
    expect(impressions).toBeDefined();
    const ys = (impressions?.points ?? []).map((point) => point.y);
    // Mapped against 0..20000 the three points must be clearly distinct and
    // spread across the plot — pinned to the primary 0..2 scale they would all
    // clamp to the plot top instead.
    expect(new Set(ys.map((y) => Math.round(y))).size).toBe(3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(CHART_GEOMETRY.plot.height * 0.4);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.top);
    expect(Math.max(...ys)).toBeLessThanOrEqual(CHART_GEOMETRY.plot.bottom);
    // The 20000 peak sits at the secondary maximum, i.e. the plot top.
    expect(ys.indexOf(Math.min(...ys))).toBe(1);

    const bar = layoutBarChartGeometry({
      labels: ["a", "b", "c"],
      series: [
        { label: "Clicks", values: [1, 2, 1] },
        { label: "Margin", values: [5000, 20000, 15000], axis: "secondary" },
      ],
    });
    const margins = bar.bars.filter((mark) => mark.seriesIndex === 1);
    expect(margins).toHaveLength(3);
    expect(new Set(margins.map((mark) => Math.round(mark.height))).size).toBe(3);
    for (const mark of margins) {
      expect(mark.height).toBeLessThan(CHART_GEOMETRY.plot.height);
    }
  });

  it("labels every tick with its own value, faithfully (review P2)", () => {
    // niceStep emits a 2.5x10^n ladder, so ticks land on values a fixed 1- or
    // 2-decimal rounding cannot represent: two gridlines printed the same label
    // and others stated a number up to 20% away from the line they sit on.
    for (const values of [
      [0.012],
      [0.11, 0.07],
      [1200],
      [1_250_000],
      [0.5, 2.5],
      // Magnitudes small enough to fall back to the exponent form: trimming the
      // mantissa must never touch the exponent (5e-10 once printed "5.00e-1").
      [1e-9, 2e-9],
      [1e-7, 3e-7],
      [1e-13, 5e-13],
    ]) {
      const geometry = layoutBarChartGeometry({
        labels: [],
        series: [{ label: "s", values }],
      });
      const labels = geometry.yTicks.map((tick) => tick.label);
      expect(new Set(labels).size, JSON.stringify(labels)).toBe(labels.length);
      for (const tick of geometry.yTicks) {
        const parsed = parseTickLabel(tick.label);
        const relative = tick.value === 0 ? Math.abs(parsed) : Math.abs(parsed / tick.value - 1);
        expect(relative, `${tick.label} vs ${String(tick.value)}`).toBeLessThan(0.005);
        expect(Number.isNaN(parsed), tick.label).toBe(false);
        const tolerance = Math.max(Math.abs(tick.value) * 0.001, 1e-12);
        expect(
          Math.abs(parsed - tick.value),
          `${tick.label} vs ${String(tick.value)}`,
        ).toBeLessThanOrEqual(tolerance);
      }
    }
    expect(formatChartTick(1250)).toBe("1.25K");
    expect(formatChartTick(1_250_000)).toBe("1.25M");
    expect(formatChartTick(0.0025)).toBe("0.0025");
    expect(formatChartTick(0.125)).toBe("0.125");
  });

  it("keeps every tick label inside its gutter (review P2)", () => {
    for (const values of [[0.012], [0.11], [1200], [1_250_000], [230]]) {
      const geometry = layoutBarChartGeometry({ labels: [], series: [{ label: "s", values }] });
      for (const tick of geometry.yTicks) {
        expect(
          estimateChartLabelWidth(tick.label),
          `${tick.label} exceeds the label gutter`,
        ).toBeLessThanOrEqual(CHART_GEOMETRY.yLabelX);
      }
    }
  });

  it("floors small NEGATIVE bars at MIN_BAR_HEIGHT too (review P2)", () => {
    const geometry = layoutBarChartGeometry({
      labels: [],
      series: [{ label: "delta", values: [-1, -2, 0, 230] }],
    });
    for (const bar of geometry.bars) {
      if (bar.value === 0) {
        expect(bar.height).toBe(0);
      } else {
        expect(bar.height, `value ${String(bar.value)}`).toBeGreaterThanOrEqual(MIN_BAR_HEIGHT);
      }
      // A negative bar grows downward from the zero line and stays in the plot.
      if (bar.value < 0) expect(bar.y).toBeGreaterThanOrEqual(bar.zeroY);
      expect(bar.y + bar.height).toBeLessThanOrEqual(CHART_GEOMETRY.plot.bottom + 0.001);
    }
  });

  it("scales an all-secondary chart from its own data, not a fabricated axis (review P2)", () => {
    // Every series opting into "secondary" left the PRIMARY group empty, and the
    // empty-group range fell back to 0..1 (line) / 0..0 (bar) — a left axis and
    // gridlines that match no data. One group ⇒ one scale.
    for (const kind of ["line", "bar"] as const) {
      const layout = kind === "line" ? layoutLineChartGeometry : layoutBarChartGeometry;
      const geometry = layout({
        labels: ["a", "b", "c"],
        series: [{ label: "Impressions", values: [45, 230, 400], axis: "secondary" }],
      });
      expect(geometry.secondaryYTicks).toBeUndefined();
      expect(geometry.yMax).toBeGreaterThanOrEqual(400);
      expect(geometry.yMin).toBeLessThanOrEqual(0);
      expect(geometry.yTicks.map((tick) => tick.label)).not.toEqual([
        "0",
        "0.2",
        "0.4",
        "0.6",
        "0.8",
        "1",
      ]);
      expect(geometry.yTicks.some((tick) => tick.value >= 400)).toBe(true);
    }
  });

  it("keeps small fractional tick labels distinct (review P2)", () => {
    // A hard toFixed(4) made sub-1e-4 ticks non-injective: five ticks all read "0".
    expect(formatChartTick(0.00025)).toBe("0.00025");
    expect(formatChartTick(0.005)).toBe("0.005");
    expect(formatChartTick(0.0025)).toBe("0.0025");
    const geometry = layoutBarChartGeometry({
      labels: ["a", "b"],
      series: [{ label: "rate", values: [0.00002, 0.00005] }],
    });
    const labels = geometry.yTicks.map((tick) => tick.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((label) => label === "0")).toHaveLength(1);
    for (const label of labels) expect(label).not.toMatch(/e[+-]/iu);
  });

  it("gives the secondary axis label gutter as much room as the primary (review P2)", () => {
    const leftGutter = CHART_GEOMETRY.yLabelX;
    const rightGutter = CHART_GEOMETRY.viewBoxWidth - CHART_GEOMETRY.secondaryYLabelX;
    expect(rightGutter).toBeGreaterThanOrEqual(leftGutter);
    // A widest realistic compact label must still fit inside the viewBox.
    expect(
      CHART_GEOMETRY.secondaryYLabelX + estimateChartLabelWidth(formatChartTick(1234567)),
    ).toBeLessThanOrEqual(CHART_GEOMETRY.viewBoxWidth);
  });

  it("keeps small non-zero bars visible against a much larger scale (review P2)", () => {
    // Mixed magnitudes on one scale: pre-fix the axis clearance subtracted the
    // whole bar for values inside the clearance window, emitting height-0
    // rects indistinguishable from a true zero.
    const geometry = layoutBarChartGeometry({
      labels: [],
      series: [
        { label: "Clicks", values: [1, 1, 2, 0, 1, 1] },
        { label: "Impressions", values: [230, 230, 230, 230, 230, 230] },
      ],
    });
    const clicks = geometry.bars.filter((bar) => bar.seriesIndex === 0);
    for (const bar of clicks) {
      if (bar.value === 0) {
        expect(bar.height).toBe(0);
      } else {
        expect(bar.height).toBeGreaterThanOrEqual(MIN_BAR_HEIGHT);
      }
    }
    const smallOnModerate = layoutBarChartGeometry({
      labels: [],
      series: [{ label: "S", values: [4, 100] }],
    });
    const small = smallOnModerate.bars.find((bar) => bar.value === 4);
    expect(small).toBeDefined();
    expect(small?.height ?? 0).toBeGreaterThanOrEqual(MIN_BAR_HEIGHT);
  });

  it("stays finite for near-MAX_VALUE finite chart values (review P2)", () => {
    // 1.7e308 is finite, passes core's chart-value gate, and pre-fix overflowed
    // the step-aligned bounds to ±Infinity/NaN ticks.
    for (const values of [
      [0, 1.7e308],
      [-1.7e308, 0],
      [-1.7e308, 1.7e308],
    ]) {
      const geometry = layoutLineChartGeometry({
        labels: [],
        series: [{ label: "hostile", values }],
      });
      expect(Number.isFinite(geometry.yMin)).toBe(true);
      expect(Number.isFinite(geometry.yMax)).toBe(true);
      expect(geometry.yTicks.length).toBeGreaterThan(0);
      for (const tick of geometry.yTicks) {
        expect(Number.isFinite(tick.value)).toBe(true);
        expect(Number.isFinite(tick.y)).toBe(true);
        expect(tick.label).not.toMatch(/∞|NaN|Infinity/u);
      }
      for (const line of geometry.lines) {
        for (const point of line.points) {
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
        }
      }
    }
  });

  it("gives the plot a decisively larger share of the figure", () => {
    const widthRatio = CHART_GEOMETRY.plot.width / CHART_GEOMETRY.viewBoxWidth;
    const heightRatio = CHART_GEOMETRY.plot.height / CHART_GEOMETRY.viewBoxHeight;
    // The plot still dominates the figure; the remaining width is spent on two
    // EQUAL label gutters wide enough for a signed label (review P2 traded 6u
    // of plot width so "-0.00125" keeps the precision "0.00125" already had).
    expect(widthRatio).toBeGreaterThanOrEqual(0.72);
    expect(heightRatio).toBeGreaterThanOrEqual(0.55);
    const leftGutter = CHART_GEOMETRY.yLabelX;
    const rightGutter = CHART_GEOMETRY.viewBoxWidth - CHART_GEOMETRY.secondaryYLabelX;
    expect(rightGutter).toBe(leftGutter);
    // Eight characters: the widest signed decimal the nice-step ladder emits.
    expect(leftGutter).toBeGreaterThanOrEqual(estimateChartLabelWidth("-0.00125"));
    // There is still room below the plot for x labels + the legend band.
    expect(CHART_GEOMETRY.xLabelY).toBeGreaterThan(CHART_GEOMETRY.plot.bottom);
    expect(CHART_GEOMETRY.legend.top).toBeGreaterThan(CHART_GEOMETRY.xLabelY);
    expect(CHART_GEOMETRY.viewBoxHeight).toBeGreaterThanOrEqual(
      CHART_GEOMETRY.legend.top + CHART_GEOMETRY.legend.rowHeight,
    );
  });

  it("chooses nice-step Y ticks instead of raw linear fractions", () => {
    // impressions-like [0..230] range -> step 50 -> 0/50/.../250, never 57.25.
    const geom = layoutLineChartGeometry({
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      series: [{ label: "Impressions", values: [45, 80, 230, 55, 50, 35, 20] }],
    });
    expect(geom.yTicks.map((tick) => tick.label)).toEqual(["0", "50", "100", "150", "200", "250"]);
    for (const tick of geom.yTicks) {
      // Every tick value lands on a multiple of the chosen step (50).
      expect(Math.abs(tick.value % 50)).toBeLessThan(1e-9);
      // No raw fractional labels like "57.25".
      expect(tick.label).not.toMatch(/\.\d{2,}/);
    }
    // First tick includes 0 (range includes 0); last tick covers the max.
    expect(geom.yTicks[0]?.value).toBe(0);
    expect(geom.yTicks.at(-1)?.value).toBeGreaterThanOrEqual(230);
  });

  it("formats tick values compactly for product ranges, never scientific", () => {
    expect(formatChartTick(0)).toBe("0");
    expect(formatChartTick(230)).toBe("230");
    expect(formatChartTick(999)).toBe("999");
    // Faithful to the value it labels: "1.2K" would state a number 2.8% away
    // from the tick it sits on (review P2).
    // The shortest FAITHFUL rendering — "1.23K" was a precision-cap artifact.
    expect(formatChartTick(1234)).toBe("1.234K");
    expect(formatChartTick(1200)).toBe("1.2K");
    expect(formatChartTick(1000)).toBe("1K");
    expect(formatChartTick(45_000)).toBe("45K");
    expect(formatChartTick(250_000)).toBe("250K");
    expect(formatChartTick(2_300_000)).toBe("2.3M");
    expect(formatChartTick(4_100_000_000)).toBe("4.1B");
    expect(formatChartTick(0.5)).toBe("0.5");
    for (const value of [0, 230, 1234, 45_000, 2_300_000, 4_100_000_000, 0.5]) {
      // Product-range values never render in scientific notation.
      expect(formatChartTick(value)).not.toContain("e+");
      expect(formatChartTick(value)).not.toContain("e-");
    }
  });

  it("maps each axis-assigned series against its own nice scale (dual-scale)", () => {
    const geom = layoutLineChartGeometry({
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      series: [
        { label: "Clicks", values: [1, 1, 2, 0, 1, 1, 0] },
        { label: "Impressions", values: [45, 80, 230, 55, 50, 35, 20], axis: "secondary" },
      ],
    });

    // Primary scale is driven by the clicks series only.
    // Both ladders share one level count so every right-edge label sits on a
    // drawn gridline; the primary domain gains one step of headroom to match.
    expect(geom.yTicks.map((tick) => tick.label)).toEqual(["0", "0.5", "1", "1.5", "2", "2.5"]);
    // Secondary tick set is present and driven by impressions only.
    expect(geom.secondaryYTicks).toBeDefined();
    expect(geom.secondaryYTicks?.map((tick) => tick.label)).toEqual([
      "0",
      "50",
      "100",
      "150",
      "200",
      "250",
    ]);
    // One step of headroom above the data max is the cost of a shared grid.
    expect(geom.yMax).toBeCloseTo(2.5, 6);
    expect(geom.yMax).toBeGreaterThanOrEqual(2);
    expect(geom.secondaryYTicks?.at(-1)?.value).toBeCloseTo(250, 6);

    // Primary ticks anchor at the left edge; secondary ticks at the right edge.
    for (const tick of geom.yTicks) {
      expect(tick.x).toBe(CHART_GEOMETRY.plot.left);
      expect(tick.labelX).toBeLessThanOrEqual(CHART_GEOMETRY.plot.left);
    }
    for (const tick of geom.secondaryYTicks ?? []) {
      expect(tick.x).toBe(CHART_GEOMETRY.plot.right);
      expect(tick.labelX).toBeGreaterThan(CHART_GEOMETRY.plot.right);
    }

    // The clicks series uses its OWN full-height scale: on a single combined
    // [0,250] scale its values (0..2) would occupy ~1px; here they span the plot.
    const clicksLine = geom.lines.find((line) => line.label === "Clicks");
    expect(clicksLine).toBeDefined();
    const clicksYs = (clicksLine?.points ?? []).map((point) => point.y);
    const clicksSpan = Math.max(...clicksYs) - Math.min(...clicksYs);
    expect(clicksSpan).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.height * 0.5);
  });

  it("is identical to single-scale output when no series is assigned secondary (OQ-2)", () => {
    const input = {
      labels: ["Mon", "Tue", "Wed", "Thu"],
      series: [
        { label: "Clicks", values: [1, 1, 2, 0] },
        { label: "Sessions", values: [3, 5, 4, 6] },
      ],
    } as const;
    const withoutAxis = layoutLineChartGeometry(input);
    const withPrimaryAxis = layoutLineChartGeometry({
      labels: [...input.labels],
      series: input.series.map((series) => ({ ...series, axis: "primary" as const })),
    });
    // Explicit "primary" is the same as omitting axis.
    expect(withPrimaryAxis.yTicks).toEqual(withoutAxis.yTicks);
    expect(withPrimaryAxis.yMin).toBe(withoutAxis.yMin);
    expect(withPrimaryAxis.yMax).toBe(withoutAxis.yMax);
    expect(withPrimaryAxis.lines).toEqual(withoutAxis.lines);
    // Zero secondary-assigned series => no secondary tick set at all.
    expect(withoutAxis.secondaryYTicks).toBeUndefined();
    expect(withPrimaryAxis.secondaryYTicks).toBeUndefined();
  });

  it("stays total for empty, all-equal, non-finite, and zero-member-secondary inputs", () => {
    // Empty series: no throw, still a usable tick set.
    const empty = layoutLineChartGeometry({ labels: [], series: [] });
    expect(empty.pointCount).toBe(0);
    expect(empty.yTicks.length).toBeGreaterThanOrEqual(1);
    expect(empty.secondaryYTicks).toBeUndefined();

    // All-equal values: no NaN, points inside the plot.
    const flat = layoutLineChartGeometry({
      labels: ["a", "b", "c"],
      series: [{ label: "Flat", values: [5, 5, 5] }],
    });
    for (const line of flat.lines) {
      for (const point of line.points) {
        expect(Number.isFinite(point.y)).toBe(true);
        expect(point.y).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.top);
        expect(point.y).toBeLessThanOrEqual(CHART_GEOMETRY.plot.bottom);
      }
    }

    // Non-finite extremes: single-tick fallback, bounded label, finite coords.
    const hostile = layoutBarChartGeometry({
      labels: ["x", "y"],
      series: [{ label: "Huge", values: [-Number.MAX_VALUE, Number.MAX_VALUE] }],
    });
    expect(hostile.yTicks.length).toBeGreaterThanOrEqual(1);
    for (const tick of hostile.yTicks) {
      expect(tick.label.length).toBeLessThanOrEqual(8);
      expect(Number.isFinite(tick.y)).toBe(true);
    }

    // NaN/Infinity leaking into geometry still yields finite coordinates.
    const nan = layoutLineChartGeometry({
      labels: ["a", "b", "c"],
      series: [{ label: "Bad", values: [Number.NaN, Number.POSITIVE_INFINITY, 5] }],
    });
    for (const line of nan.lines) {
      for (const point of line.points) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
    }

    // A secondary group with zero members contributes no secondary ticks.
    const primaryOnly = layoutBarChartGeometry({
      labels: ["a", "b"],
      series: [{ label: "P", values: [10, 20], axis: "primary" }],
    });
    expect(primaryOnly.secondaryYTicks).toBeUndefined();
  });

  it("produces a secondary tick set for dual-scale bar charts without throwing", () => {
    const geom = layoutBarChartGeometry({
      labels: ["a", "b", "c"],
      series: [
        { label: "Revenue", values: [10, 20, 15] },
        { label: "Margin", values: [200, 450, 380], axis: "secondary" },
      ],
    });
    expect(geom.secondaryYTicks).toBeDefined();
    expect(geom.secondaryYTicks?.length).toBeGreaterThanOrEqual(2);
    for (const bar of geom.bars) {
      expect(Number.isFinite(bar.y)).toBe(true);
      expect(Number.isFinite(bar.height)).toBe(true);
    }
  });
});
