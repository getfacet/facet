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

describe("StageRenderer typography quality", () => {
  it("applies wrap and line clamp without layout escape", () => {
    const { container } = mountClient(
      createElement(StageRenderer, {
        tree: stage([
          {
            id: "nowrap",
            type: "text",
            value: "Single line label",
            style: { textWrap: "nowrap" },
          },
          {
            id: "clamp",
            type: "text",
            value:
              "A longer summary that should clamp after exactly two lines without requiring authored CSS.",
            style: { lineClamp: 2 },
          },
          {
            id: "list",
            type: "list",
            items: [{ title: "Insight title", body: "Long insight body copy" }],
            style: { title: { lineClamp: 1 }, body: { textWrap: "wrap", lineClamp: 3 } },
          },
          {
            id: "rich",
            type: "richtext",
            style: { textWrap: "balance", lineClamp: "none" },
            blocks: [{ type: "paragraph", runs: [{ text: "Balanced rich prose" }] }],
          },
        ]),
      }),
    );

    const nowrap = screen.getByText("Single line label");
    expect(nowrap.style.whiteSpace).toBe("nowrap");
    expect(nowrap.style.overflowWrap).toBe("normal");
    expect(nowrap.style.position).not.toBe("absolute");

    const clamp = screen.getByText(
      "A longer summary that should clamp after exactly two lines without requiring authored CSS.",
    );
    expect(clamp.style.display).toBe("-webkit-box");
    expect(clamp.style.overflow).toBe("hidden");
    expect(clamp.style.webkitBoxOrient).toBe("vertical");
    expect(clamp.style.webkitLineClamp).toBe("2");
    expect(clamp.style.position).not.toBe("absolute");

    const listTitle = screen.getByText("Insight title");
    expect(listTitle.style.webkitLineClamp).toBe("1");
    const listBody = screen.getByText("Long insight body copy");
    expect(listBody.style.whiteSpace).toBe("normal");
    expect(listBody.style.webkitLineClamp).toBe("3");

    const richRoot = screen.getByText("Balanced rich prose").parentElement;
    expect((richRoot as HTMLElement | null)?.style.getPropertyValue("text-wrap")).toBe("balance");
    expect(container.innerHTML).not.toContain("position:absolute");
    expect(container.innerHTML).not.toContain("display:contents");
  });

  it("renders rich text list indentation and text wrapping", () => {
    mountClient(
      createElement(StageRenderer, {
        tree: stage([
          {
            id: "rich",
            type: "richtext",
            blocks: [
              {
                type: "listItem",
                depth: 1,
                runs: [
                  {
                    text: "A very long list item body should wrap under the body column rather than drifting under the bullet marker.",
                  },
                ],
              },
            ],
          },
          {
            id: "copy",
            type: "text",
            value: "averyveryveryveryveryveryveryverylongunbrokenidentifier",
          },
        ]),
      }),
    );

    const listItem = document.querySelector("[data-facet-list-item]");
    expect(listItem).toBeDefined();
    expect((listItem as HTMLElement | null)?.style.display).toBe("grid");
    expect((listItem as HTMLElement | null)?.style.gridTemplateColumns).toBe(
      "max-content minmax(0, 1fr)",
    );
    expect((listItem as HTMLElement | null)?.style.columnGap).toBe("8px");
    expect((listItem as HTMLElement | null)?.style.marginInlineStart).toContain("calc(");

    const body = document.querySelector("[data-facet-list-body]");
    expect(body).toBeDefined();
    expect((body as HTMLElement | null)?.style.minWidth).toBe("0px");
    expect((body as HTMLElement | null)?.style.overflowWrap).toBe("anywhere");

    const text = screen.getByText("averyveryveryveryveryveryveryverylongunbrokenidentifier");
    expect(text.style.minWidth).toBe("0px");
    expect(text.style.maxWidth).toBe("100%");
    expect(text.style.overflowWrap).toBe("break-word");
    expect(text.style.wordBreak).toBe("normal");
  });
});
