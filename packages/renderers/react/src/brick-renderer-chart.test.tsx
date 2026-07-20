// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

function tree(nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree {
  return { root, nodes };
}

function render(tree: FacetTree): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree }));
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
    expect(bar).toContain(">Jan<");
    expect(bar).toContain(">Feb<");
    expect(bar).toContain(">Mar<");
    expect(bar).toContain(">0<");
    expect(bar).toContain(">200<");
    expect(bar).toContain(">Revenue<");
    expect(bar).toContain(">Costs<");

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
          { label: "Kept", values: [10, "bad", Number.POSITIVE_INFINITY, -5] },
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
    expect(html).not.toContain("<script");
  });
});
