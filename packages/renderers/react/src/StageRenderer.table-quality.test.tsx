// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render as mountClient, screen } from "@testing-library/react";
import { MAX_NODE_LABEL_CHARS, type FacetNode, type FacetTree, type NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import { TABLE_STICKY_MAX_HEIGHT } from "./layout-contract.js";
import { tableStickyHeaderCellStyle } from "./brick-style-layout.js";
import { resolveTheme } from "./theme.js";

afterEach(cleanup);

function stage(nodes: readonly FacetNode[]): FacetTree {
  const map: Record<NodeId, FacetNode> = {
    root: { id: "root", type: "box", children: nodes.map((node) => node.id) },
  };
  for (const node of nodes) map[node.id] = node;
  return { root: "root", nodes: map };
}

describe("StageRenderer table quality", () => {
  it("renders aligned dense data-grid columns", () => {
    mountClient(
      createElement(StageRenderer, {
        tree: stage([
          {
            id: "grid",
            type: "table",
            caption: "Search analytics",
            columns: [
              { key: "query", label: "Query", sortable: true },
              { key: "clicks", label: "Clicks", align: "end", sortable: true },
              { key: "ctr", label: "CTR", align: "center" },
            ],
            rows: [
              {
                query: "ama2 messenger for agent teams",
                clicks: 128,
                ctr: "4.2%",
              },
            ],
            style: {
              width: "full",
              header: { padding: "xs", textWrap: "nowrap" },
              cell: { padding: "xs", textWrap: "wrap", lineClamp: 2 },
            },
          },
        ]),
      }),
    );

    const table = screen.getByRole("table", { name: "Search analytics" });
    const scroller = table.parentElement as HTMLElement;
    expect(scroller.style.overflowX).toBe("auto");
    expect(scroller.style.maxWidth).toBe("100%");
    // Review P2: minWidth:max-content would defeat textWrap/lineClamp — the
    // no-wrap scroller behavior now comes from the cells' nowrap default.
    expect(table.style.minWidth).not.toBe("max-content");

    const clicksHeader = screen.getByRole("columnheader", { name: "Clicks" });
    expect(clicksHeader.style.textAlign).toBe("right");
    expect(clicksHeader.style.whiteSpace).toBe("nowrap");
    expect(clicksHeader.style.padding).toBe("4px");

    const ctrHeader = screen.getByRole("columnheader", { name: "CTR" });
    expect(ctrHeader.style.textAlign).toBe("center");

    const queryCell = screen.getByText("ama2 messenger for agent teams").closest("td");
    expect(queryCell?.style.whiteSpace).toBe("normal");
    expect(queryCell?.style.overflowWrap).toBe("break-word");
    expect(queryCell?.style.display).not.toBe("-webkit-box");
    expect(queryCell?.style.padding).toBe("4px");
    expect(queryCell?.style.position).not.toBe("absolute");
    expect(screen.getByText("ama2 messenger for agent teams").style.display).toBe("-webkit-box");
    expect(screen.getByText("ama2 messenger for agent teams").style.webkitLineClamp).toBe("2");

    const clicksCell = screen.getByText("128").closest("td");
    expect(clicksCell?.style.textAlign).toBe("right");
    const ctrCell = screen.getByText("4.2%").closest("td");
    expect(ctrCell?.style.textAlign).toBe("center");
  });

  // ── analytics-data-surface (WU-5): containment, sticky header, per-column
  // widths, dividers, authored empty label — every new read fail-safe. ──
  describe("analytics-data-surface table renderer", () => {
    it("falls back to 'No rows' for a blank authored emptyLabel (review P3)", () => {
      for (const emptyLabel of ["", "   "]) {
        cleanup();
        mountClient(
          createElement(StageRenderer, {
            tree: stage([
              {
                id: "blank-empty",
                type: "table",
                columns: [{ key: "a", label: "A" }],
                rows: [],
                emptyLabel,
                style: { width: "full" },
              },
            ]),
          }),
        );
        // A blank label is not a label — the visitor must never get an
        // unexplained empty row.
        expect(screen.getByText("No rows"), JSON.stringify(emptyLabel)).toBeTruthy();
      }
    });

    it("clips its own children at the rounded table frame (review P2)", () => {
      // Scroll ownership moved to the inner wrapper; without an overflow clip on
      // the ROOT, header and row backgrounds paint square across the default
      // theme's rounded, bordered frame.
      mountClient(
        createElement(StageRenderer, {
          tree: stage([
            {
              id: "framed",
              type: "table",
              columns: [{ key: "a", label: "A" }],
              rows: [{ a: "1" }],
              style: { width: "full" },
            },
          ]),
        }),
      );
      const table = document.querySelector("table");
      const root = table?.parentElement?.parentElement as HTMLElement | null;
      expect(root).not.toBeNull();
      expect(root?.style.borderRadius).not.toBe("");
      // Any non-visible overflow clips at the radius; the root must not be the
      // scroll container (that is the inner wrapper's job).
      expect(root?.style.overflow).toBe("hidden");
    });

    it("applies dividers to header cells as well as body cells (review P3)", () => {
      const modes = ["none", "rows", "grid"] as const;
      const header: Record<string, string | undefined> = {};
      for (const dividers of modes) {
        cleanup();
        mountClient(
          createElement(StageRenderer, {
            tree: stage([
              {
                id: `divider-${dividers}`,
                type: "table",
                columns: [
                  { key: "a", label: "A" },
                  { key: "b", label: "B" },
                ],
                rows: [{ a: "1", b: "2" }],
                style: {
                  width: "full",
                  dividers,
                  header: { borderColor: "border", borderWidth: "thin" },
                  cell: { borderColor: "border", borderWidth: "thin" },
                },
              },
            ]),
          }),
        );
        const th = screen.getByText("A").closest("th") as HTMLElement;
        const td = screen.getByText("1").closest("td") as HTMLElement;
        header[dividers] = th.style.borderBottomWidth;
        if (dividers === "none") {
          expect(th.style.borderBottomWidth, dividers).toBe("");
          expect(td.style.borderBottomWidth, dividers).toBe("");
        } else {
          expect(th.style.borderBottomWidth, dividers).not.toBe("");
          expect(td.style.borderBottomWidth, dividers).not.toBe("");
        }
        // Only "grid" adds the vertical column separator, on BOTH row bands.
        expect(th.style.borderRightWidth === "", `th ${dividers}`).toBe(dividers !== "grid");
        expect(td.style.borderRightWidth === "", `td ${dividers}`).toBe(dividers !== "grid");
      }
      expect(header["none"]).not.toBe(header["grid"]);
    });

    it("resolves an opaque sticky header background through the whole fallback chain (review P3)", () => {
      // Rows must never show through a pinned header. The bundled theme always
      // gives the header its own paint, so the root/theme fallbacks are covered
      // by calling the resolver directly.
      const theme = resolveTheme();
      expect(
        tableStickyHeaderCellStyle({}, { background: "accentSurface" }, theme).background,
      ).toBe(theme.color.accentSurface);
      expect(tableStickyHeaderCellStyle({ background: "mutedSurface" }, {}, theme).background).toBe(
        theme.color.mutedSurface,
      );
      expect(tableStickyHeaderCellStyle({}, {}, theme).background).toBe(theme.color.surface);
      expect(tableStickyHeaderCellStyle({}, {}, theme).position).toBe("sticky");

      mountClient(
        createElement(StageRenderer, {
          tree: stage([
            {
              id: "root-bg",
              type: "table",
              columns: [{ key: "a", label: "A" }],
              rows: [{ a: "1" }],
              style: { width: "full", stickyHeader: true, background: "accentSurface" },
            },
          ]),
        }),
      );
      const header = screen.getByText("A").closest("th");
      expect(header?.style.position).toBe("sticky");
      expect(header?.style.background).not.toBe("");
      expect(header?.style.background).not.toBe("transparent");
    });

    it("keeps the sorted-column tint under a sticky header (review P3)", () => {
      // The sticky style contributes an opaque background FALLBACK; it must not
      // overwrite the resolved sorted-column paint.
      mountClient(
        createElement(StageRenderer, {
          tree: stage([
            {
              id: "sorted-sticky",
              type: "table",
              columns: [
                { key: "q", label: "Query", sortable: true },
                { key: "n", label: "Clicks", align: "end", sortable: true },
              ],
              rows: [
                { q: "b", n: "2" },
                { q: "a", n: "1" },
              ],
              style: {
                width: "full",
                stickyHeader: true,
                header: { background: "surface", sorted: { background: "accentSurface" } },
              },
            },
          ]),
        }),
      );
      const header = screen.getByText("Query").closest("th");
      expect(header).not.toBeNull();
      const before = header?.style.background;
      fireEvent.click(header as HTMLElement);
      const sorted = screen.getByText(/Query/u).closest("th");
      expect(sorted?.style.position).toBe("sticky");
      expect(sorted?.style.background).not.toBe("");
      expect(sorted?.style.background).not.toBe(before);
    });

    it("keeps a clamped caption a real table-caption (review P2)", () => {
      mountClient(
        createElement(StageRenderer, {
          tree: stage([
            {
              id: "cap-table",
              type: "table",
              caption: "A very long caption that the author clamps to one line",
              columns: [{ key: "a", label: "A" }],
              rows: [{ a: "1" }],
              style: { caption: { lineClamp: 1, textWrap: "wrap" } },
            },
          ]),
        }),
      );
      const caption = document.querySelector("caption");
      expect(caption).not.toBeNull();
      // The clamp's -webkit-box display must never replace display:table-caption
      // (CSS would re-wrap the caption as an anonymous table row).
      expect(caption?.style.display).not.toBe("-webkit-box");
      const content = caption?.querySelector('[data-facet-table-caption-content="true"]');
      expect(content).not.toBeNull();
      expect((content as HTMLElement | null)?.style.display).toBe("-webkit-box");
      expect((content as HTMLElement | null)?.style.webkitLineClamp).toBe("1");
    });

    const single = (
      table: Record<string, unknown>,
      extraNodes: readonly FacetNode[] = [],
    ): FacetTree =>
      stage([{ id: "grid", type: "table", ...table } as unknown as FacetNode, ...extraNodes]);

    it("wraps the table in its OWN bounded horizontal scroll region without a parent scroll box", () => {
      mountClient(
        createElement(StageRenderer, {
          tree: single({
            caption: "Analytics",
            columns: [{ key: "query", label: "Query" }],
            rows: [{ query: "a" }],
          }),
        }),
      );
      const table = screen.getByRole("table", { name: "Analytics" });
      const wrapper = table.parentElement as HTMLElement;
      // Always owns horizontal scroll and never pushes parent/page width (DC-006).
      expect(wrapper.style.overflowX).toBe("auto");
      expect(wrapper.style.maxWidth).toBe("100%");
      expect(wrapper.style.minWidth).toBe("0px");
      // Without stickyHeader there is NO vertical bounding — today's flow height.
      expect(wrapper.style.overflowY).toBe("");
      expect(wrapper.style.maxHeight).toBe("");
      // The clamped-cell fix (636caa9) lives in the content span; the table no
      // longer forces max-content width so wrap/clamp cells can actually clamp.
      expect(table.style.minWidth).not.toBe("max-content");
      // No sticky pinning without the flag (byte-identical old behavior).
      const th = screen.getByRole("columnheader", { name: "Query" });
      expect(th.style.position).not.toBe("sticky");
    });

    it("keeps the table inside its own bounded scroll region WITHIN a parent scroll box", () => {
      mountClient(
        createElement(StageRenderer, {
          tree: {
            root: "root",
            nodes: {
              root: { id: "root", type: "box", children: ["scrollBox"] },
              scrollBox: {
                id: "scrollBox",
                type: "box",
                style: { scroll: "vertical" },
                children: ["grid"],
              },
              grid: {
                id: "grid",
                type: "table",
                caption: "Nested",
                columns: [{ key: "query", label: "Query" }],
                rows: [{ query: "a" }],
              },
            },
          } as unknown as FacetTree,
        }),
      );
      const table = screen.getByRole("table", { name: "Nested" });
      const wrapper = table.parentElement as HTMLElement;
      expect(wrapper.style.overflowX).toBe("auto");
      expect(wrapper.style.maxWidth).toBe("100%");
      expect(wrapper.style.minWidth).toBe("0px");
    });

    it("owns a bounded vertical scroll region and pins thead cells when stickyHeader is set", () => {
      mountClient(
        createElement(StageRenderer, {
          tree: single({
            caption: "Sticky",
            columns: [{ key: "query", label: "Query" }],
            rows: [{ query: "a" }],
            style: { stickyHeader: true },
          }),
        }),
      );
      const table = screen.getByRole("table", { name: "Sticky" });
      const wrapper = table.parentElement as HTMLElement;
      // The SAME wrapper owns the vertical scroll region + a framework max-height.
      expect(wrapper.style.overflowY).toBe("auto");
      expect(wrapper.style.maxHeight).toBe(TABLE_STICKY_MAX_HEIGHT);
      const th = screen.getByRole("columnheader", { name: "Query" });
      expect(th.style.position).toBe("sticky");
      expect(th.style.top).toBe("0px");
      expect(Number(th.style.zIndex)).toBeGreaterThan(0);
      // Opaque background so scrolled rows never show through the pinned header.
      expect(th.style.background).not.toBe("");
    });

    it("allocates renderer-owned per-column widths from the closed name set", () => {
      mountClient(
        createElement(StageRenderer, {
          tree: single({
            caption: "Widths",
            columns: [
              { key: "n", label: "Narrow", width: "narrow" },
              { key: "m", label: "Medium", width: "medium" },
              { key: "w", label: "Wide", width: "wide" },
              { key: "a", label: "Auto", width: "auto" },
              { key: "x", label: "Absent" },
              { key: "bad", label: "Bad", width: "250px" },
            ],
            rows: [{ n: 1, m: 2, w: 3, a: 4, x: 5, bad: 6 }],
          }),
        }),
      );
      expect(screen.getByRole("columnheader", { name: "Narrow" }).style.width).toBe("8rem");
      expect(screen.getByRole("columnheader", { name: "Medium" }).style.width).toBe("14rem");
      expect(screen.getByRole("columnheader", { name: "Wide" }).style.width).toBe("24rem");
      // auto / absent / unknown → today's behavior (no renderer-imposed width).
      expect(screen.getByRole("columnheader", { name: "Auto" }).style.width).toBe("");
      expect(screen.getByRole("columnheader", { name: "Absent" }).style.width).toBe("");
      expect(screen.getByRole("columnheader", { name: "Bad" }).style.width).toBe("");
    });

    it("renders row-only dividers, a full grid, or suppresses them per the dividers style", () => {
      mountClient(
        createElement(StageRenderer, {
          tree: stage([
            {
              id: "rowsT",
              type: "table",
              columns: [{ key: "a", label: "RA" }],
              rows: [{ a: "x" }],
              style: { preset: "compact", dividers: "rows" },
            },
            {
              id: "gridT",
              type: "table",
              columns: [{ key: "a", label: "GA" }],
              rows: [{ a: "y" }],
              style: { preset: "compact", dividers: "grid" },
            },
            {
              id: "noneT",
              type: "table",
              columns: [{ key: "a", label: "NA" }],
              rows: [{ a: "z" }],
              style: { preset: "compact", dividers: "none" },
            },
          ] as unknown as FacetNode[]),
        }),
      );
      const rowsCell = screen.getByText("x").closest("td");
      expect(rowsCell?.style.borderBottomStyle).toBe("solid");
      expect(rowsCell?.style.borderRightStyle).toBe("");

      const gridCell = screen.getByText("y").closest("td");
      expect(gridCell?.style.borderBottomStyle).toBe("solid");
      expect(gridCell?.style.borderRightStyle).toBe("solid");

      const noneCell = screen.getByText("z").closest("td");
      expect(noneCell?.style.borderBottomStyle).toBe("");
      expect(noneCell?.style.borderRightStyle).toBe("");
    });

    it("renders the authored empty label for zero inline rows AND a dangling from binding", () => {
      mountClient(
        createElement(StageRenderer, {
          tree: stage([
            {
              id: "inlineEmpty",
              type: "table",
              columns: [{ key: "a", label: "A" }],
              rows: [],
              emptyLabel: "No queries yet",
            },
            {
              id: "danglingEmpty",
              type: "table",
              columns: [{ key: "a", label: "A" }],
              from: "missing-dataset",
              emptyLabel: "No data available",
            },
          ] as unknown as FacetNode[]),
        }),
      );
      expect(screen.getByText("No queries yet")).toBeDefined();
      expect(screen.getByText("No data available")).toBeDefined();
    });

    it("falls back to the default label when emptyLabel is absent", () => {
      mountClient(
        createElement(StageRenderer, {
          tree: single({ columns: [{ key: "a", label: "A" }], rows: [] }),
        }),
      );
      expect(screen.getByText("No rows")).toBeDefined();
    });

    it("clamps an overlong empty label to the bounded length", () => {
      mountClient(
        createElement(StageRenderer, {
          tree: single({
            columns: [{ key: "a", label: "A" }],
            rows: [],
            emptyLabel: "n".repeat(MAX_NODE_LABEL_CHARS + 300),
          }),
        }),
      );
      const cell = screen.getByRole("cell");
      expect(cell.textContent?.length).toBe(MAX_NODE_LABEL_CHARS);
    });

    it("never throws on hostile width / emptyLabel / style getters and still renders rows", () => {
      const hostileColumn: Record<string, unknown> = { key: "a", label: "A" };
      Object.defineProperty(hostileColumn, "width", {
        enumerable: true,
        get() {
          throw new Error("hostile width");
        },
      });
      const hostileNode: Record<string, unknown> = {
        id: "grid",
        type: "table",
        columns: [hostileColumn],
        rows: [{ a: "cell-value" }],
      };
      Object.defineProperty(hostileNode, "emptyLabel", {
        enumerable: true,
        get() {
          throw new Error("hostile emptyLabel");
        },
      });
      Object.defineProperty(hostileNode, "style", {
        enumerable: true,
        get() {
          throw new Error("hostile style");
        },
      });
      expect(() =>
        mountClient(
          createElement(StageRenderer, {
            tree: stage([hostileNode as unknown as FacetNode]),
          }),
        ),
      ).not.toThrow();
      expect(screen.getByText("cell-value")).toBeDefined();
    });

    it("keeps local sort working alongside the new width columns", () => {
      mountClient(
        createElement(StageRenderer, {
          tree: single({
            columns: [
              { key: "name", label: "Name", sortable: true, width: "wide" },
              { key: "score", label: "Score", width: "narrow" },
            ],
            rows: [
              { name: "Charlie", score: 2 },
              { name: "Alice", score: 3 },
              { name: "Bob", score: 1 },
            ],
          }),
        }),
      );
      const first = (): string[] =>
        Array.from(
          document.querySelectorAll("tbody tr"),
          (tr) => tr.querySelector("td")?.textContent ?? "",
        );
      expect(first()).toEqual(["Charlie", "Alice", "Bob"]);
      // The active sort appends an inline direction glyph, so match by pattern.
      fireEvent.click(screen.getByRole("columnheader", { name: /Name/ }));
      expect(first()).toEqual(["Alice", "Bob", "Charlie"]);
      // The wide column still carries its renderer-owned width after a sort.
      expect(screen.getByRole("columnheader", { name: /Name/ }).style.width).toBe("24rem");
    });
  });

  it("renders dense table chrome without escaping containment", () => {
    mountClient(
      createElement(StageRenderer, {
        tree: stage([
          {
            id: "dense",
            type: "table",
            caption: "Accounts",
            columns: [
              { key: "account", label: "Account", sortable: true },
              { key: "plan", label: "Plan" },
              { key: "status", label: "Status" },
            ],
            rows: [
              {
                account: "enterprise-team-with-a-long-name",
                plan: "Business",
                status: "Live",
              },
            ],
            style: { preset: "compact" },
          },
          {
            id: "empty",
            type: "table",
            columns: [
              { key: "account", label: "Account" },
              { key: "plan", label: "Plan" },
              { key: "status", label: "Status" },
            ],
            rows: [],
            style: { preset: "compact" },
          },
        ]),
      }),
    );

    const [denseTable, emptyTable] = screen.getAllByRole("table");
    expect(denseTable).toBeDefined();
    expect(emptyTable).toBeDefined();

    const denseScroller = denseTable?.parentElement;
    expect(denseScroller?.style.overflowX).toBe("auto");
    expect(denseScroller?.style.maxWidth).toBe("100%");
    expect(denseScroller?.style.minWidth).toBe("0px");
    expect(denseTable?.style.width).toBe("100%");
    expect(denseTable?.style.minWidth).not.toBe("max-content");
    expect(denseTable?.style.borderCollapse).toBe("separate");
    expect(denseTable?.style.tableLayout).toBe("auto");

    const accountHeader = screen.getAllByRole("columnheader", { name: "Account" })[0];
    expect(accountHeader?.style.whiteSpace).toBe("nowrap");
    expect(accountHeader?.style.overflowWrap).toBe("normal");
    expect(accountHeader?.style.borderBottomStyle).toBe("solid");
    expect(accountHeader?.style.borderBottomWidth).toBe("1px");

    const accountCell = screen.getByText("enterprise-team-with-a-long-name").closest("td");
    expect(accountCell?.style.whiteSpace).toBe("nowrap");
    expect(accountCell?.style.overflowWrap).toBe("normal");
    expect(accountCell?.style.verticalAlign).toBe("top");
    expect(accountCell?.style.borderBottomStyle).toBe("solid");
    expect(accountCell?.style.borderBottomWidth).toBe("1px");

    const emptyCell = screen.getByText("No rows").closest("td");
    expect(emptyCell?.getAttribute("colspan")).toBe("3");
    expect(emptyCell?.style.textAlign).toBe("center");
    expect(emptyCell?.style.fontStyle).toBe("italic");
  });
});
