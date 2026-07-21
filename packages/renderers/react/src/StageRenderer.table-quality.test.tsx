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
