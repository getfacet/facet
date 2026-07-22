// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { CHART_GEOMETRY, layoutBarChartGeometry } from "./chart-geometry.js";
import { StageRenderer } from "./StageRenderer.js";

function tree(nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree {
  return { root, nodes };
}

function render(tree: FacetTree, props: Partial<Parameters<typeof StageRenderer>[0]> = {}): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree, ...props }));
}

const box = (id: NodeId, children: readonly NodeId[]): FacetNode => ({
  id,
  type: "box",
  children,
});

const text = (id: NodeId, value: string): FacetNode => ({ id, type: "text", value });

function chartMarkup(node: FacetNode): string {
  return render(
    tree({
      root: box("root", [node.id]),
      [node.id]: node,
    }),
  );
}

function numberAttribute(element: Element | null | undefined, name: string): number {
  expect(element).toBeDefined();
  const value = element?.getAttribute(name);
  expect(value).not.toBeNull();
  return Number(value);
}

function translatedPoint(element: Element): { x: number; y: number } {
  const transform = element.getAttribute("transform") ?? "";
  const match = /^translate\(([-\d.]+) ([-\d.]+)\)$/.exec(transform);
  expect(match).not.toBeNull();
  return { x: Number(match?.[1]), y: Number(match?.[2]) };
}

describe("StageRenderer chart readability", () => {
  it("renders chart axes labels and legend", () => {
    const bar = chartMarkup({
      id: "bar",
      type: "chart",
      title: "Pipeline",
      kind: "bar",
      labels: ["Jan", "Feb", "Mar"],
      series: [
        { label: "Revenue", values: [100, 200, 150] },
        { label: "Costs", values: [40, 80, 70] },
      ],
    });

    expect(bar).toContain('data-facet-chart-axis="x"');
    expect(bar).toContain('data-facet-chart-axis="y"');
    expect(bar).toContain('data-facet-chart-legend="true"');
    expect(bar).toContain('y1="121"');
    expect(bar).toContain('y2="121"');
    expect(bar).toContain('stroke-linecap="square"');
    expect(bar).toContain(">Jan<");
    expect(bar).toContain(">Feb<");
    expect(bar).toContain(">Mar<");
    expect(bar).toContain(">0<");
    expect(bar).toContain(">200<");
    expect(bar).toContain(">Revenue<");
    expect(bar).toContain(">Costs<");

    const host = document.createElement("div");
    host.innerHTML = bar;
    const janLabel = [...host.querySelectorAll("text")].find(
      (element) => element.textContent === "Jan",
    );
    const barRects = [...host.querySelectorAll("rect[y]")];
    const firstRevenueBar = barRects.at(0);
    const firstCostBar = barRects.at(3);
    expect(janLabel).toBeDefined();
    expect(firstRevenueBar).toBeDefined();
    expect(firstCostBar).toBeDefined();
    expect(firstRevenueBar?.hasAttribute("stroke")).toBe(false);
    const firstGroupCenter =
      (Number(firstRevenueBar?.getAttribute("x")) +
        Number(firstRevenueBar?.getAttribute("width")) / 2 +
        Number(firstCostBar?.getAttribute("x")) +
        Number(firstCostBar?.getAttribute("width")) / 2) /
      2;
    expect(Number(janLabel?.getAttribute("x"))).toBeCloseTo(firstGroupCenter);

    const line = chartMarkup({
      id: "line",
      type: "chart",
      title: "Trend",
      kind: "line",
      labels: ["Week 1", "Week 2", "Week 3", "Week 4"],
      series: [
        { label: "Signups", values: [8, 14, 10, 24] },
        { label: "Trials", values: [2, 4, 7, 9] },
      ],
    });

    expect(line).toContain('data-facet-chart-axis="x"');
    expect(line).toContain('data-facet-chart-axis="y"');
    expect(line).toContain('data-facet-chart-legend="true"');
    expect(line).toContain(">Week 1<");
    expect(line).toContain(">Week 4<");
    expect(line).toContain(">0<");
    expect(line).toContain(">25<");
    expect(line).toContain(">Signups<");
    expect(line).toContain(">Trials<");
  });

  it("keeps dense bar charts inside the plot area", () => {
    const labels = Array.from({ length: 200 }, (_, index) => `P${String(index + 1)}`);
    const series = Array.from({ length: 6 }, (_, seriesIndex) => ({
      label: `Series ${String(seriesIndex + 1)}`,
      values: labels.map((_, valueIndex) => valueIndex + seriesIndex + 1),
    }));
    const dense = chartMarkup({
      id: "dense",
      type: "chart",
      kind: "bar",
      labels,
      series,
    });

    const host = document.createElement("div");
    host.innerHTML = dense;
    const barRects = [...host.querySelectorAll("rect[y]")];
    expect(barRects.length).toBe(1200);
    for (const rect of barRects) {
      const x = Number(rect.getAttribute("x"));
      const width = Number(rect.getAttribute("width"));
      expect(x).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.left);
      expect(x + width).toBeLessThanOrEqual(CHART_GEOMETRY.plot.right);
      expect(rect.hasAttribute("stroke")).toBe(false);
    }
  });

  it("keeps grouped bars clear of axes and readable ticks", () => {
    const labels = Array.from({ length: 18 }, (_, index) => `Week ${String(index + 1)}`);
    const series = Array.from({ length: 5 }, (_, seriesIndex) => ({
      label: `Segment ${String(seriesIndex + 1)}`,
      values: labels.map((_, valueIndex) => (seriesIndex + 1) * (valueIndex + 2)),
    }));
    const grouped = chartMarkup({
      id: "grouped",
      type: "chart",
      kind: "bar",
      title: "Weekly segments",
      labels,
      series,
    });

    const host = document.createElement("div");
    host.innerHTML = grouped;
    const svg = host.querySelector("svg");
    const viewBox = (svg?.getAttribute("viewBox") ?? "").split(" ").map(Number);
    expect(viewBox).toHaveLength(4);
    const viewBoxWidth = viewBox[2] ?? 0;
    const viewBoxHeight = viewBox[3] ?? 0;
    const xAxisLine = host.querySelector('[data-facet-chart-axis="x"] line');
    const axisY = numberAttribute(xAxisLine, "y1");
    const bars = [...host.querySelectorAll("rect[y]")];
    expect(bars.length).toBe(labels.length * series.length);
    for (const bar of bars) {
      const x = numberAttribute(bar, "x");
      const y = numberAttribute(bar, "y");
      const width = numberAttribute(bar, "width");
      const height = numberAttribute(bar, "height");
      expect(x).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.left);
      expect(x + width).toBeLessThanOrEqual(CHART_GEOMETRY.plot.right);
      expect(y + height).toBeLessThanOrEqual(axisY - 4);
    }

    const ticks = [...host.querySelectorAll('[data-facet-chart-axis="x"] text')];
    expect(ticks.length).toBeLessThan(labels.length);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    const tickPositions = ticks.map((tick) => numberAttribute(tick, "x"));
    expect(tickPositions[0]).toBeGreaterThanOrEqual(CHART_GEOMETRY.plot.left);
    expect(tickPositions.at(-1)).toBeLessThanOrEqual(CHART_GEOMETRY.plot.right);
    for (let index = 1; index < tickPositions.length; index += 1) {
      const current = tickPositions[index];
      const previous = tickPositions[index - 1];
      expect(current).toBeDefined();
      expect(previous).toBeDefined();
      expect((current ?? 0) - (previous ?? 0)).toBeGreaterThanOrEqual(34);
    }

    const legendItems = [...host.querySelectorAll('[data-facet-chart-legend="true"] > g')];
    expect(legendItems).toHaveLength(series.length);
    for (const item of legendItems) {
      const { x, y } = translatedPoint(item);
      const label = item.querySelector("text")?.textContent ?? "";
      expect(x).toBeGreaterThanOrEqual(34);
      expect(x + 16 + label.length * 7).toBeLessThanOrEqual(viewBoxWidth - 8);
      expect(y + 12).toBeLessThanOrEqual(viewBoxHeight - 4);
    }

    const line = chartMarkup({
      id: "line-contained",
      type: "chart",
      kind: "line",
      labels,
      series: [{ label: "Actual", values: [-12, 4, 18, 6, 22, 13, 31, 28, 36, 40, 44, 50] }],
    });
    host.innerHTML = line;
    const lineViewBox = (host.querySelector("svg")?.getAttribute("viewBox") ?? "")
      .split(" ")
      .map(Number);
    const lineWidth = lineViewBox[2] ?? 0;
    const lineHeight = lineViewBox[3] ?? 0;
    const polyline = host.querySelector("polyline");
    expect(polyline).toBeDefined();
    const points = (polyline?.getAttribute("points") ?? "").split(" ");
    expect(points.length).toBe(12);
    for (const point of points) {
      const [x = 0, y = 0] = point.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(lineWidth);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(lineHeight);
    }
  });

  it("draws negative bar values below the zero baseline", () => {
    const mixed = chartMarkup({
      id: "mixed",
      type: "chart",
      kind: "bar",
      labels: ["Loss", "Gain"],
      series: [{ label: "Net", values: [-10, 20] }],
    });

    expect(mixed).toContain(">-10<");
    expect(mixed).toContain(">20<");

    const host = document.createElement("div");
    host.innerHTML = mixed;
    const zeroLine = host.querySelector('[data-facet-chart-axis="zero"]');
    const bars = [...host.querySelectorAll("rect[y]")];
    expect(zeroLine).toBeDefined();
    expect(bars).toHaveLength(2);

    const zeroY = numberAttribute(zeroLine, "y1");
    const negativeBar = bars[0];
    const positiveBar = bars[1];
    const negativeY = numberAttribute(negativeBar, "y");
    const negativeHeight = numberAttribute(negativeBar, "height");
    const positiveY = numberAttribute(positiveBar, "y");
    const positiveHeight = numberAttribute(positiveBar, "height");

    expect(negativeY).toBeGreaterThanOrEqual(zeroY + 4);
    expect(negativeY + negativeHeight).toBeGreaterThan(zeroY);
    expect(positiveY).toBeLessThan(zeroY);
    expect(positiveY + positiveHeight).toBeLessThanOrEqual(zeroY - 4);
  });

  it("does not emit invalid SVG values for extreme finite chart data", () => {
    const line = chartMarkup({
      id: "extreme-line",
      type: "chart",
      kind: "line",
      labels: ["Low", "High"],
      series: [{ label: "Range", values: [-Number.MAX_VALUE, Number.MAX_VALUE] }],
    });
    expect(line).not.toContain("NaN");
    expect(line).not.toContain("Infinity");
    // The redundant "+" is dropped so an exponent label buys a character of
    // mantissa precision inside the same gutter (review P2).
    // The wider label gutter buys a mantissa digit here too (review P2).
    expect(line).toContain(">-1.8e308<");
    expect(line).not.toContain("e+");

    const tiny = chartMarkup({
      id: "tiny-line",
      type: "chart",
      kind: "line",
      labels: ["Low", "High"],
      series: [{ label: "Range", values: [-0.005, 0.004] }],
    });
    expect(tiny).not.toContain("NaN");
    expect(tiny).not.toContain("Infinity");
    expect(tiny).not.toContain("e-3<");
    expect(tiny).toContain(">0.25<");

    const donut = chartMarkup({
      id: "extreme-donut",
      type: "chart",
      kind: "donut",
      series: [{ label: "Huge", values: [Number.MAX_VALUE, Number.MAX_VALUE] }],
    });
    expect(donut).not.toContain("NaN");
    expect(donut).not.toContain("Infinity");
    expect(donut).not.toContain('stroke-dasharray="0.00 ');
  });

  it("uses the resolved color mode for chart labels", () => {
    const dark = render(
      tree({
        root: box("root", ["bar"]),
        bar: {
          id: "bar",
          type: "chart",
          title: "Pipeline",
          kind: "bar",
          labels: ["Jan"],
          series: [{ label: "Revenue", values: [100] }],
        },
      }),
      { colorMode: "dark" },
    );

    expect(dark).toContain('fill="#a1a1aa"');
  });

  it("uses chart line styles and plot color tokens", () => {
    const styled = chartMarkup({
      id: "styled-line",
      type: "chart",
      kind: "line",
      title: "Plan vs actual",
      labels: ["Jan", "Feb", "Mar"],
      style: {
        plot: {
          axisColor: "danger",
          gridColor: "accent",
          labelColor: "success",
        },
      },
      series: [
        { label: "Actual", values: [12, 18, 16], lineStyle: "solid" },
        { label: "Forecast", values: [10, 20, 22], lineStyle: "dashed" },
        { label: "Target", values: [14, 21, 25], lineStyle: "dotted" },
      ],
    });

    const host = document.createElement("div");
    host.innerHTML = styled;
    const xAxisLine = host.querySelector('[data-facet-chart-axis="x"] line');
    const gridLines = [...host.querySelectorAll('[data-facet-chart-grid="true"] line')];
    const labels = [...host.querySelectorAll("[data-facet-chart-axis] text")];
    const lines = [...host.querySelectorAll("polyline")];

    expect(xAxisLine?.getAttribute("stroke")).toBe("#b91c1c");
    expect(gridLines.length).toBeGreaterThan(2);
    expect(gridLines.every((line) => line.getAttribute("stroke") === "#4f46e5")).toBe(true);
    expect(labels.length).toBeGreaterThan(2);
    expect(labels.every((label) => label.getAttribute("fill") === "#15803d")).toBe(true);
    expect(lines).toHaveLength(3);
    // Layering (DC-002): non-solid comparison lines paint first (under), solid last.
    expect(lines[0]?.getAttribute("stroke-dasharray")).toBe("6 4");
    expect(lines[1]?.getAttribute("stroke-dasharray")).toBe("1 5");
    expect(lines[2]?.hasAttribute("stroke-dasharray")).toBe(false);
  });

  it("degrades safely for empty and malformed chart data", () => {
    expect(
      chartMarkup({
        id: "empty",
        type: "chart",
        kind: "bar",
        series: [],
      }),
    ).not.toContain("<svg");

    const hostile = tree({
      root: box("root", ["bad", "safe"]),
      bad: {
        id: "bad",
        type: "chart",
        kind: "line",
        title: { nope: true },
        labels: ["Only one", { nope: true }, "<script>alert(1)</script>"],
        series: [
          { label: "Kept", values: [10, "bad", Number.POSITIVE_INFINITY, -5], lineStyle: {} },
          { label: { nope: true }, values: [1, 2, 3] },
        ],
      } as unknown as FacetNode,
      safe: text("safe", "safe child"),
    });

    expect(() => render(hostile)).not.toThrow();
    const html = render(hostile);
    expect(html).toContain("safe child");
    expect(html).toContain(">Kept<");
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("stroke-dasharray");
    expect(html).not.toContain("<script");
  });
});

describe("StageRenderer chart dual-axis (analytics-data-surface)", () => {
  const gscLike = (impressionsAxis?: string): FacetNode =>
    ({
      id: "gsc",
      type: "chart",
      kind: "line",
      title: "Search performance",
      labels: ["Mon", "Tue", "Wed"],
      series: [
        { label: "Clicks", values: [120, 180, 150] },
        {
          label: "Impressions",
          values: [12000, 18000, 15000],
          ...(impressionsAxis === undefined ? {} : { axis: impressionsAxis }),
        },
      ],
    }) as unknown as FacetNode;

  it("renders a right-edge secondary axis for an axis:'secondary' series", () => {
    const html = chartMarkup(gscLike("secondary"));
    const host = document.createElement("div");
    host.innerHTML = html;

    const secondary = host.querySelector('[data-facet-chart-axis="secondary"]');
    expect(secondary).not.toBeNull();

    // Right-edge axis line pinned at the plot's right edge.
    const secondaryLine = secondary?.querySelector("line");
    expect(numberAttribute(secondaryLine, "x1")).toBe(CHART_GEOMETRY.plot.right);
    expect(numberAttribute(secondaryLine, "x2")).toBe(CHART_GEOMETRY.plot.right);

    // Secondary tick labels sit outside the plot right edge, left-anchored.
    const secondaryLabels = [...(secondary?.querySelectorAll("text") ?? [])];
    expect(secondaryLabels.length).toBeGreaterThanOrEqual(2);
    for (const label of secondaryLabels) {
      expect(label.getAttribute("text-anchor")).toBe("start");
      expect(numberAttribute(label, "x")).toBe(CHART_GEOMETRY.secondaryYLabelX);
    }
    const secondaryText = secondaryLabels.map((label) => label.textContent);
    expect(secondaryText).toContain("5K");
    expect(secondaryText).toContain("20K");

    // Primary axis stays on the clicks scale, un-inflated by impressions.
    const primaryText = [...host.querySelectorAll('[data-facet-chart-axis="y"] text')].map(
      (label) => label.textContent,
    );
    expect(primaryText).toContain("50");
    expect(primaryText).toContain("150");
    expect(primaryText).not.toContain("20K");
  });

  it("omits every secondary-axis marking when no series is assigned (OQ-2)", () => {
    const html = chartMarkup(gscLike(undefined));
    expect(html).not.toContain('data-facet-chart-axis="secondary"');

    const host = document.createElement("div");
    host.innerHTML = html;
    // Both series share the single primary scale (impressions dominate the range).
    const primaryText = [...host.querySelectorAll('[data-facet-chart-axis="y"] text')].map(
      (label) => label.textContent,
    );
    expect(primaryText).toContain("20K");
    expect(host.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("treats an unknown axis value as primary with siblings intact (DC-005)", () => {
    const html = chartMarkup(gscLike("top"));
    expect(html).not.toContain('data-facet-chart-axis="secondary"');

    const host = document.createElement("div");
    host.innerHTML = html;
    // Unknown axis dropped ⇒ impressions folds into the primary scale, both lines render.
    expect(host.querySelectorAll("polyline")).toHaveLength(2);
    expect(html).toContain(">Clicks<");
    expect(html).toContain(">Impressions<");
    const primaryText = [...host.querySelectorAll('[data-facet-chart-axis="y"] text')].map(
      (label) => label.textContent,
    );
    expect(primaryText).toContain("20K");
  });

  it("paints non-solid comparison lines under solid lines (DC-002 layering)", () => {
    const html = chartMarkup({
      id: "layered",
      type: "chart",
      kind: "line",
      labels: ["Jan", "Feb", "Mar"],
      series: [
        { label: "Actual", values: [12, 18, 16], lineStyle: "solid" },
        { label: "Forecast", values: [10, 20, 22], lineStyle: "dashed" },
        { label: "Target", values: [14, 21, 25], lineStyle: "dotted" },
      ],
    });

    const host = document.createElement("div");
    host.innerHTML = html;
    const polylines = [...host.querySelectorAll("polyline")];
    expect(polylines).toHaveLength(3);
    const dasharrays = polylines.map((line) => line.getAttribute("stroke-dasharray"));
    // Document order = paint order: dashed/dotted first (under), solid last (on top).
    expect(dasharrays[0]).toBe("6 4");
    expect(dasharrays[1]).toBe("1 5");
    expect(dasharrays[2]).toBeNull();

    // Review P2: the reorder must not desynchronize color from series. Render
    // the same series all-solid (document order = series order) and require the
    // partitioned render to keep each series' own stroke.
    const allSolidHtml = chartMarkup({
      id: "layered-solid",
      type: "chart",
      kind: "line",
      labels: ["Jan", "Feb", "Mar"],
      series: [
        { label: "Actual", values: [12, 18, 16], lineStyle: "solid" },
        { label: "Forecast", values: [10, 20, 22], lineStyle: "solid" },
        { label: "Target", values: [14, 21, 25], lineStyle: "solid" },
      ],
    });
    const solidHost = document.createElement("div");
    solidHost.innerHTML = allSolidHtml;
    const strokesBySeries = [...solidHost.querySelectorAll("polyline")].map((line) =>
      line.getAttribute("stroke"),
    );
    expect(new Set(strokesBySeries).size).toBe(3);
    // Reordered render: dashed Forecast is series 1, dotted Target is series 2,
    // solid Actual is series 0 — each keeps its own series color.
    expect(polylines[0]?.getAttribute("stroke")).toBe(strokesBySeries[1]);
    expect(polylines[1]?.getAttribute("stroke")).toBe(strokesBySeries[2]);
    expect(polylines[2]?.getAttribute("stroke")).toBe(strokesBySeries[0]);
  });

  it("draws a baseline for every bar anchor, not just the primary one (review P2)", () => {
    // A mixed-sign secondary group sits on its own zero; with only the primary
    // rule painted those bars hung off a line that was never drawn.
    const html = chartMarkup({
      id: "mixed",
      type: "chart",
      kind: "bar",
      labels: ["a", "b"],
      series: [
        { label: "Revenue", values: [80, 100] },
        { label: "Delta", values: [-40, 30], axis: "secondary" },
      ],
    });
    const host = document.createElement("div");
    host.innerHTML = html;
    const zeroLines = [...host.querySelectorAll('[data-facet-chart-axis="zero"]')];
    expect(zeroLines.length).toBeGreaterThan(0);
    const ys = zeroLines.map((line) => Number(line.getAttribute("y1")));
    for (const y of ys) {
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThan(CHART_GEOMETRY.plot.top);
      expect(y).toBeLessThan(CHART_GEOMETRY.plot.bottom);
    }
    // The secondary group's own anchor must be among the drawn baselines.
    const geometry = layoutBarChartGeometry({
      labels: ["a", "b"],
      series: [
        { label: "Revenue", values: [80, 100] },
        { label: "Delta", values: [-40, 30], axis: "secondary" },
      ],
    });
    const secondaryZero = geometry.bars.find((bar) => bar.seriesIndex === 1)?.zeroY;
    expect(secondaryZero).toBeDefined();
    expect(ys).toContain(secondaryZero);
    // A non-primary rule spans only its own marks, never the whole plot.
    const secondaryLine = zeroLines.find(
      (line) => Number(line.getAttribute("y1")) === secondaryZero,
    );
    expect(Number(secondaryLine?.getAttribute("x1"))).toBeGreaterThan(CHART_GEOMETRY.plot.left);
  });

  it("keeps a single full-width zero rule when there is no secondary scale (review P2)", () => {
    const html = chartMarkup({
      id: "single",
      type: "chart",
      kind: "bar",
      labels: ["a", "b"],
      series: [{ label: "Delta", values: [-4, 6] }],
    });
    const host = document.createElement("div");
    host.innerHTML = html;
    const zeroLines = [...host.querySelectorAll('[data-facet-chart-axis="zero"]')];
    expect(zeroLines).toHaveLength(1);
    expect(Number(zeroLines[0]?.getAttribute("x1"))).toBe(CHART_GEOMETRY.plot.left);
    expect(Number(zeroLines[0]?.getAttribute("x2"))).toBe(CHART_GEOMETRY.plot.right);
  });

  it("centres the donut ring inside the current plot box (review P2)", () => {
    // The ring used hardcoded 360x180-era coordinates, so the figure resize left
    // it as a small circle in the top-left corner.
    const html = chartMarkup({
      id: "donut",
      type: "chart",
      kind: "donut",
      series: [{ label: "Share", values: [30, 45, 25] }],
    });
    const host = document.createElement("div");
    host.innerHTML = html;
    const circles = [...host.querySelectorAll("circle")];
    expect(circles.length).toBeGreaterThan(0);
    const expectedCx = CHART_GEOMETRY.plot.left + CHART_GEOMETRY.plot.width / 2;
    const expectedCy = CHART_GEOMETRY.plot.top + CHART_GEOMETRY.plot.height / 2;
    for (const circle of circles) {
      const cx = Number(circle.getAttribute("cx"));
      const cy = Number(circle.getAttribute("cy"));
      const r = Number(circle.getAttribute("r"));
      expect(cx).toBe(expectedCx);
      expect(cy).toBe(expectedCy);
      // The ring must fill a real share of the plot, not a corner sliver.
      expect(r * 2).toBeGreaterThan(CHART_GEOMETRY.plot.height * 0.6);
      expect(cx + r).toBeLessThanOrEqual(CHART_GEOMETRY.plot.right);
      expect(cy + r).toBeLessThanOrEqual(CHART_GEOMETRY.viewBoxHeight);
      expect(circle.getAttribute("transform")).toBe(
        `rotate(-90 ${String(expectedCx)} ${String(expectedCy)})`,
      );
    }
  });

  it("never throws on fuzzed hostile dual-axis chart nodes (DC-007)", () => {
    const hostile = tree({
      root: box("root", ["bad", "safe"]),
      bad: {
        id: "bad",
        type: "chart",
        kind: "line",
        labels: ["A", "B"],
        series: [
          // Throwing getter on the new `axis` field must degrade to primary.
          Object.defineProperty({ label: "Throws", values: [1, 2] }, "axis", {
            get() {
              throw new Error("hostile axis");
            },
            enumerable: true,
          }),
          { label: "NonFinite", values: [Number.NaN, Number.POSITIVE_INFINITY, 5] },
          { label: "Weird", values: [1, 2, 3], axis: { nope: true } },
        ],
      } as unknown as FacetNode,
      safe: text("safe", "safe child"),
    });

    expect(() => render(hostile)).not.toThrow();
    const html = render(hostile);
    expect(html).toContain("safe child");
    expect(html).not.toContain('data-facet-chart-axis="secondary"');
    expect(html).not.toContain("[object Object]");
  });
});
