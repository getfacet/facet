// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render as mountClient, screen } from "@testing-library/react";
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
  it("resolves chart + text/list/keyValue from a shared data.sales", () => {
    const tree = stage(
      [
        { id: "chart", type: "chart", kind: "bar", series: [], from: "sales" },
        {
          id: "units-jan",
          type: "text",
          value: "INLINE_IGNORED",
          from: "sales",
          column: "units",
          row: 0,
        },
        {
          id: "units-feb",
          type: "text",
          value: "INLINE_IGNORED",
          from: "sales",
          column: "units",
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
    // Bound text projects the third column, which list/keyValue do not use.
    expect(html).toContain(">5<");
    expect(html).toContain(">8<");
    // list: title from the first string column (month).
    expect(html).toContain(">Jan<");
    expect(html).toContain(">Feb<");
    // keyValue renders its own semantic definition list.
    expect(html).toContain("<dl");
    // inline values are ignored when `from` is present.
    expect(html).not.toContain("INLINE_IGNORED");
  });

  // DC-003: dangling `from` renders empty, never throws.
  it("renders empty for a dangling from without throwing", () => {
    const tree = stage(
      [
        { id: "chart", type: "chart", kind: "bar", series: [], from: "missing" },
        {
          id: "copy",
          type: "text",
          value: "INLINE_IGNORED",
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
    // Empty projection: no bars and no inline text fallback.
    expect(html).not.toContain("<rect");
    expect(html).not.toContain("INLINE_IGNORED");
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
          id: "revenue",
          type: "text",
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
          id: "units",
          type: "text",
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

// Enabler A (WU-4): `text` supports `from`/`column`/`row`, projected through
// the ONE shared `resolveNodeData` at the core walker's `text` case — `from`
// wins over the inline `value`, a dangling ref yields empty, and a text WITHOUT
// `from` is byte-identical to today.
describe("StageRenderer store-bound text (jsdom)", () => {
  const boundText = (
    id: NodeId,
    value: string,
    binding: { from?: string; column?: string; row?: number },
  ): FacetNode => ({ id, type: "text", value, ...binding }) as unknown as FacetNode;

  // DC-001: a store-bound text renders the cell, overriding the inline `value`.
  it("renders the store cell and ignores the inline value (DC-001)", () => {
    const html = render(
      stage(
        [boundText("t", "INLINE_IGNORED", { from: "sales", column: "revenue", row: 0 })],
        SALES,
      ),
    );
    expect(html).toContain(">100<");
    expect(html).not.toContain("INLINE_IGNORED");
  });

  // DC-002: a dangling `from` (or absent column) yields empty text, never throws.
  it("renders empty for a dangling from without throwing (DC-002)", () => {
    let html = "";
    expect(() => {
      html = render(
        stage([boundText("t", "INLINE_IGNORED", { from: "missing", column: "revenue" })], SALES),
      );
    }).not.toThrow();
    expect(html).not.toContain("INLINE_IGNORED");
    expect(html).toContain("<p"); // the node still renders (as an empty paragraph)
  });

  // DC-008: a text WITHOUT `from` renders byte-identically to a text authored
  // with no binding fields at all — the enabler is a pure additive optional.
  it("renders a text without from byte-identically to today (DC-008)", () => {
    const plain = render(stage([{ id: "t", type: "text", value: "hello" }]));
    const withUnusedFields = render(stage([boundText("t", "hello", {})]));
    expect(withUnusedFields).toBe(plain);
    expect(plain).toContain(">hello<");
  });

  // DC-003: a server `data` patch re-renders EVERY bound text (two texts, one
  // dataset) with no re-emit — the renderer never caches the projected cell.
  it("re-renders two store-bound texts on a data patch (DC-003)", () => {
    const build = (data: DataWarehouse): FacetTree =>
      stage(
        [
          boundText("a", "", { from: "sales", column: "revenue", row: 0 }),
          boundText("b", "", { from: "sales", column: "revenue", row: 1 }),
        ],
        data,
      );
    const { rerender } = mountClient(createElement(StageRenderer, { tree: build(SALES) }));
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByText("200")).toBeTruthy();

    // A server data patch swaps the dataset; both bound texts re-project.
    rerender(
      createElement(StageRenderer, {
        tree: build({
          sales: [
            { month: "Jan", revenue: 111, units: 5 },
            { month: "Feb", revenue: 222, units: 8 },
          ],
        }),
      }),
    );
    expect(screen.getByText("111")).toBeTruthy();
    expect(screen.getByText("222")).toBeTruthy();
    expect(screen.queryByText("100")).toBeNull();
  });
});

describe("StageRenderer data and feedback styles (jsdom)", () => {
  it("styles every data and feedback target", () => {
    const hostileProgress = {
      id: "progress",
      type: "progress",
      label: "Migration",
      value: 50,
      style: {
        width: "full",
        gap: "md",
        label: { color: "danger", fontWeight: "bold" },
        track: {
          background: "warningSurface",
          height: "lg",
          borderColor: "warning",
          borderWidth: "medium",
          borderRadius: "lg",
        },
        // Width is renderer-owned even when stale/bypassed input carries one.
        fill: {
          background: "info",
          backgroundGradient: "success",
          borderRadius: "sm",
          width: "full",
        },
      },
    } as unknown as FacetNode;
    const hostileList = {
      id: "list",
      type: "list",
      items: [{ title: "Next", body: "Call customer" }],
      style: {
        gap: "lg",
        padding: "md",
        background: "accentSurface",
        item: { gap: "xs", padding: "xs", background: "surface", 0: { color: "danger" } },
        title: { fontSize: "xl", fontWeight: "bold" },
        body: { color: "info" },
        marker: { color: "warning", fontSize: "lg", fontWeight: "bold" },
      },
    } as unknown as FacetNode;
    const { container } = mountClient(
      createElement(StageRenderer, {
        tree: stage([
          {
            id: "chart",
            type: "chart",
            title: "Revenue",
            kind: "line",
            series: [{ label: "ARR", values: [10, 20] }],
            style: {
              padding: "xl",
              background: "infoSurface",
              borderRadius: "lg",
              title: { fontSize: "xl", color: "danger" },
              plot: { background: "dangerSurface", borderRadius: "md" },
              series: { color1: "success", thickness: "lg" },
            },
          },
          hostileList,
          {
            id: "kv",
            type: "keyValue",
            items: [{ label: "Owner", value: "Design" }],
            style: {
              gap: "lg",
              padding: "lg",
              background: "mutedSurface",
              item: { gap: "sm", padding: "sm", borderWidth: "medium" },
              label: { fontSize: "xs", color: "warning" },
              value: { fontSize: "lg", color: "success" },
            },
          },
          hostileProgress,
          {
            id: "loading",
            type: "loading",
            label: "Loading accounts",
            style: {
              direction: "column",
              gap: "lg",
              alignItems: "end",
              indicator: { size: "lg", color: "success", animation: "pulse" },
              label: { fontSize: "xl", color: "info" },
            },
          },
        ]),
      }),
    );

    const chart = screen.getByRole("img", { name: "Revenue" });
    const figure = chart.closest("figure") as HTMLElement;
    const caption = figure.querySelector("figcaption") as HTMLElement;
    const line = chart.querySelector("polyline") as SVGPolylineElement;
    expect(figure.style.padding).toBe("40px");
    expect(figure.style.borderRadius).toBe("16px");
    expect(caption.style.fontSize).toBe("28px");
    expect(chart.style.background).not.toBe("");
    expect(line.getAttribute("stroke")).toBe("#15803d");
    expect(line.getAttribute("stroke-width")).toBe("4px");

    const list = screen.getByRole("list");
    const listItem = list.querySelector("li") as HTMLElement;
    const listTitle = screen.getByText("Next");
    const listBody = screen.getByText("Call customer");
    expect(list.style.gap).toBe("24px");
    expect(list.style.padding).toBe("16px");
    expect(listItem.style.padding).toBe("4px");
    expect(listItem.style.fontSize).toBe("20px");
    expect(listTitle.style.fontSize).toBe("28px");
    expect(listBody.style.color).not.toBe("");
    expect(listItem.getAttribute("style")).not.toContain("position");

    const details = container.querySelector("dl") as HTMLElement;
    const detailItem = details.querySelector("div") as HTMLElement;
    const detailLabel = screen.getByText("Owner");
    const detailValue = screen.getByText("Design");
    expect(details.style.padding).toBe("24px");
    expect(detailItem.style.padding).toBe("8px");
    expect(detailLabel.style.fontSize).toBe("12px");
    expect(detailValue.style.fontSize).toBe("20px");

    const progress = screen.getByRole("progressbar");
    const progressRoot = progress.parentElement as HTMLElement;
    const fill = progress.firstElementChild as HTMLElement;
    expect(progressRoot.style.gap).toBe("16px");
    expect(screen.getByText("Migration").style.fontWeight).toBe("700");
    expect(progress.style.height).toBe("12px");
    expect(fill.style.width).toBe("50%");
    expect(fill.style.backgroundImage).not.toBe("");
    expect(fill.style.borderRadius).toBe("6px");

    const loading = screen.getByRole("status");
    const indicator = loading.querySelector('[aria-hidden="true"]') as HTMLElement;
    const loadingLabel = screen.getByText("Loading accounts");
    expect(loading.style.flexDirection).toBe("column");
    expect(loading.style.gap).toBe("24px");
    expect(loading.style.alignItems).toBe("flex-end");
    expect(indicator.style.width).toBe("20px");
    expect(indicator.style.height).toBe("20px");
    expect(indicator.className).toContain("facet-loading-pulse");
    const styleText = Array.from(
      container.querySelectorAll("style"),
      (style) => style.textContent ?? "",
    ).join("\n");
    expect(styleText).toContain("@media (prefers-reduced-motion: reduce)");
    expect(loadingLabel.style.fontSize).toBe("28px");
    expect(container.textContent).not.toContain("tone");
  });
});
