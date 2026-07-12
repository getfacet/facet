// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup } from "@testing-library/react";
import type { DataWarehouse, FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

afterEach(cleanup);

const here = dirname(fileURLToPath(import.meta.url));

function render(tree: FacetTree): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree }));
}

/** A single dataset every bound view resolves against (author once, bind many). */
const SALES: DataWarehouse = {
  sales: [
    { month: "Jan", revenue: 100, units: 5 },
    { month: "Feb", revenue: 200, units: 8 },
  ],
};

/** Root box wrapping the given brick nodes so the renderer reaches them. */
function stage(nodes: readonly FacetNode[], data?: DataWarehouse): FacetTree {
  const map: Record<NodeId, FacetNode> = {
    root: { id: "root", type: "box", children: nodes.map((node) => node.id) },
  };
  for (const node of nodes) map[node.id] = node;
  const tree: FacetTree = { root: "root", nodes: map };
  return data === undefined ? tree : { ...tree, data };
}

describe("StageRenderer data bindings (jsdom)", () => {
  // DC-001: one shared dataset, many bound views.
  it("resolves chart + metric/stat/list/keyValue from a shared data.sales", () => {
    const tree = stage(
      [
        { id: "chart", type: "chart", kind: "bar", series: [], from: "sales" },
        {
          id: "metric",
          type: "metric",
          label: "Revenue",
          value: "INLINE_IGNORED",
          from: "sales",
          column: "revenue",
          row: 0,
        },
        {
          id: "stat",
          type: "stat",
          label: "Revenue Feb",
          value: "INLINE_IGNORED",
          from: "sales",
          column: "revenue",
          row: 1,
        },
        { id: "list", type: "list", items: [], from: "sales" },
        { id: "kv", type: "keyValue", items: [], from: "sales" },
      ],
      SALES,
    );
    const html = render(tree);
    // chart: one series per numeric column → bars rendered.
    expect(html).toContain("<rect");
    // metric row 0 revenue and stat row 1 revenue (anchored to text nodes so a
    // stray digit inside a CSS value can't satisfy the assertion).
    expect(html).toContain(">100<");
    expect(html).toContain(">200<");
    // list: title from the first string column (month).
    expect(html).toContain(">Jan<");
    expect(html).toContain(">Feb<");
    // inline values are ignored when `from` is present.
    expect(html).not.toContain("INLINE_IGNORED");
  });

  // DC-003: dangling `from` renders empty, never throws.
  it("renders empty for a dangling from without throwing", () => {
    const tree = stage(
      [
        { id: "chart", type: "chart", kind: "bar", series: [], from: "missing" },
        {
          id: "metric",
          type: "metric",
          label: "DanglingLabel",
          value: "unused",
          from: "missing",
          column: "revenue",
        },
        { id: "list", type: "list", items: [], from: "missing" },
      ],
      SALES,
    );
    let html = "";
    expect(() => {
      html = render(tree);
    }).not.toThrow();
    // Empty node: no bars, and the metric collapses to nothing (no label shown).
    expect(html).not.toContain("<rect");
    expect(html).not.toContain("DanglingLabel");
  });

  // RISK-INV-5: the content gate must agree with the renderer. A from-bound table
  // renders a HEADER from its columns even while its dataset is dangling/loading —
  // so treeHasContent must count it as content (asserted in @facet/core tree.test);
  // here we pin the renderer half: the header renders and nothing throws.
  it("renders a from-bound table header while its dataset is dangling", () => {
    const tree = stage(
      [
        {
          id: "tbl",
          type: "table",
          columns: [{ key: "month", label: "Month" }],
          rows: [],
          from: "missing",
        },
      ],
      SALES,
    );
    let html = "";
    expect(() => {
      html = render(tree);
    }).not.toThrow();
    expect(html).toContain("<table");
    expect(html).toContain("Month"); // the column header is visible
  });

  // Totality on an UNSANITIZED tree: StageRenderer renders `initialTree` without
  // validateTree, so a warehouse with non-object rows must not crash the render.
  it("does not throw when a from-bound node resolves over non-object rows", () => {
    const tree = stage(
      [
        { id: "chart", type: "chart", kind: "bar", series: [], from: "sales" },
        { id: "list", type: "list", items: [], from: "sales" },
      ],
      { sales: [null, { month: "Jan", revenue: 5 }] } as unknown as DataWarehouse,
    );
    expect(() => render(tree)).not.toThrow();
  });

  // DC-005: precedence — a present `from` wins over inline.
  it("prefers the warehouse over inline arrays/values when from is present", () => {
    const tree = stage(
      [
        {
          id: "metric",
          type: "metric",
          label: "Revenue",
          value: "INLINE_VALUE",
          from: "sales",
          column: "revenue",
          row: 0,
        },
        {
          id: "list",
          type: "list",
          items: [{ title: "INLINE_ITEM" }],
          from: "sales",
        },
      ],
      SALES,
    );
    const html = render(tree);
    expect(html).toContain(">100<");
    expect(html).toContain(">Jan<");
    expect(html).not.toContain("INLINE_VALUE");
    expect(html).not.toContain("INLINE_ITEM");
  });

  // DC-006: resolution is read-only — no client-side data writer (the A2UI
  // dual-writer hazard). The data renderers must hold NO projected-data state.
  it("keeps resolution read-only (no data useState/useEffect)", () => {
    const dataSrc = readFileSync(join(here, "brick-renderer-data.tsx"), "utf8");
    const chartSrc = readFileSync(join(here, "brick-renderer-chart.tsx"), "utf8");
    expect(dataSrc).not.toMatch(/useState|useEffect/);
    expect(chartSrc).not.toMatch(/useState|useEffect/);
  });

  // DC-006: ctx `data` is the validated warehouse passed straight through — a
  // node bound to a dataset that IS present resolves it (no re-sanitize hook).
  it("passes tree.data through as the render context warehouse", () => {
    const tree = stage(
      [
        {
          id: "metric",
          type: "metric",
          label: "Revenue",
          value: "",
          from: "sales",
          column: "units",
          row: 1,
        },
      ],
      SALES,
    );
    expect(render(tree)).toContain(">8<");
  });
});
