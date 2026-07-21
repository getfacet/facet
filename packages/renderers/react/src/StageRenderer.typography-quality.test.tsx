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
