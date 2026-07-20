// @vitest-environment jsdom
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

function stage(nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree {
  return { root, nodes };
}

const box = (id: NodeId, children: readonly NodeId[]): FacetNode => ({
  id,
  type: "box",
  children,
});

describe("StageRenderer data Brick rendering quality", () => {
  it("renders aligned list progress value and compact keyValue", () => {
    const { container } = render(
      createElement(StageRenderer, {
        tree: stage({
          root: box("root", ["list", "progress", "details"]),
          list: {
            id: "list",
            type: "list",
            items: [
              {
                title: "Long follow-up",
                body: "This body wraps onto another line and should stay aligned under the content column rather than drifting under the marker.",
              },
            ],
          },
          progress: { id: "progress", type: "progress", label: "Coverage", value: 72 },
          details: {
            id: "details",
            type: "keyValue",
            items: [
              {
                label: "Owner",
                value: "Design Systems",
              },
            ],
          },
        }),
      }),
    );

    const list = screen.getByRole("list");
    expect(list.style.listStylePosition).not.toBe("inside");
    expect(list.querySelector('[data-facet-list-marker="true"]')).not.toBeNull();
    expect(list.querySelector('[data-facet-list-content="true"]')).not.toBeNull();

    const progress = screen.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("72");
    expect((progress.firstElementChild as HTMLElement).style.width).toBe("72%");
    expect(screen.getByText("72%")).toBeDefined();

    const keyValueItem = container.querySelector('[data-facet-key-value-item="true"]');
    expect(keyValueItem).not.toBeNull();
    expect((keyValueItem as HTMLElement).style.justifyContent).not.toBe("space-between");
    expect((keyValueItem as HTMLElement).style.gridTemplateColumns).toBe("auto minmax(0, 1fr)");
  });
});
