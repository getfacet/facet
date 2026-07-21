import { describe, expect, it } from "vitest";
import {
  BAR_AXIS_CLEARANCE,
  CHART_GEOMETRY,
  estimateChartLabelWidth,
  layoutBarChartGeometry,
  layoutChartLegend,
  layoutLineChartGeometry,
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
      series: [
        { label: "Actual", values: [-12, 4, 18, 6, 22, 13, 31, 28, 36, 40, 44, 50] },
      ],
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
