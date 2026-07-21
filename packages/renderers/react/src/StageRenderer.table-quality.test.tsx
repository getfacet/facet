// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render as mountClient, screen } from "@testing-library/react";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

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
    expect(table.style.minWidth).toBe("max-content");

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
    expect(denseTable?.style.minWidth).toBe("max-content");
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
