// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
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
    expect(bar).toContain('y1="120"');
    expect(bar).toContain('y2="120"');
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
    expect(line).toContain(">24<");
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
      expect(x).toBeGreaterThanOrEqual(34);
      expect(x + width).toBeLessThanOrEqual(320);
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
      expect(x).toBeGreaterThanOrEqual(34);
      expect(x + width).toBeLessThanOrEqual(320);
      expect(y + height).toBeLessThanOrEqual(axisY - 4);
    }

    const ticks = [...host.querySelectorAll('[data-facet-chart-axis="x"] text')];
    expect(ticks.length).toBeLessThan(labels.length);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    const tickPositions = ticks.map((tick) => numberAttribute(tick, "x"));
    expect(tickPositions[0]).toBeGreaterThanOrEqual(34);
    expect(tickPositions.at(-1)).toBeLessThanOrEqual(320);
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
    expect(line).toContain(">1.80e+308<");

    const tiny = chartMarkup({
      id: "tiny-line",
      type: "chart",
      kind: "line",
      labels: ["Low", "High"],
      series: [{ label: "Range", values: [-0.005, 0.004] }],
    });
    expect(tiny).not.toContain("NaN");
    expect(tiny).not.toContain("Infinity");
    expect(tiny).toContain(">-5.00e-3<");

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
    expect(lines[0]?.hasAttribute("stroke-dasharray")).toBe(false);
    expect(lines[1]?.getAttribute("stroke-dasharray")).toBe("6 4");
    expect(lines[2]?.getAttribute("stroke-dasharray")).toBe("1 5");
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
