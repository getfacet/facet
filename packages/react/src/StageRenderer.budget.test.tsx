// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

afterEach(cleanup);

/**
 * A hostile shared-child lattice built DIRECTLY (bypassing validateTree, as a raw
 * live patch would): both boxes at level i list both boxes at level i+1. Acyclic
 * and depth-bounded, but the number of root-to-node PATHS is 2^levels — a naive
 * renderer instantiates one subtree per path and hangs the tab. `leafFields`
 * hangs a field off each leaf so the collect walk sees the same explosion.
 */
function latticeTree(levels: number, leafFields = false): FacetTree {
  const nodes: Record<NodeId, FacetNode> = {
    root: { id: "root", type: "box", children: ["L0_a", "L0_b"] },
  };
  for (let i = 0; i < levels; i += 1) {
    const last = i === levels - 1;
    const children = last
      ? leafFields
        ? [`f${String(i)}_a`, `f${String(i)}_b`]
        : []
      : [`L${String(i + 1)}_a`, `L${String(i + 1)}_b`];
    nodes[`L${String(i)}_a`] = { id: `L${String(i)}_a`, type: "box", children: [...children] };
    nodes[`L${String(i)}_b`] = { id: `L${String(i)}_b`, type: "box", children: [...children] };
    if (last && leafFields) {
      nodes[`f${String(i)}_a`] = { id: `f${String(i)}_a`, type: "field", name: "shared" };
      nodes[`f${String(i)}_b`] = { id: `f${String(i)}_b`, type: "field", name: "shared" };
    }
  }
  return { root: "root", nodes };
}

describe("StageRenderer render budget (fail-safe against shared-child explosion)", () => {
  it("renders a hostile shared-child lattice in bounded element count without hanging", () => {
    // Depth ~40 ⇒ 2^40 paths through the DAG; the per-render budget caps total
    // instantiated elements so this returns quickly instead of exhausting memory.
    let container: HTMLElement | undefined;
    expect(() => {
      ({ container } = render(<StageRenderer tree={latticeTree(40)} onAction={vi.fn()} />));
    }).not.toThrow();
    // Bounded: the budget is 5000, so the DOM can't hold anywhere near 2^40 divs.
    expect(container!.querySelectorAll("div").length).toBeLessThan(6000);
  });

  it("keeps a collect press bounded on a shared-child subtree (gather budget)", () => {
    const onAction = vi.fn();
    const lattice = latticeTree(40, true);
    // Wrap the lattice under a pressable box that collects its subtree's fields.
    const tree: FacetTree = {
      root: "wrap",
      nodes: {
        ...lattice.nodes,
        wrap: {
          id: "wrap",
          type: "box",
          onPress: { kind: "agent", name: "submit", collect: "root" },
          children: ["root"],
        },
      },
    };
    render(<StageRenderer tree={tree} onAction={onAction} />);
    expect(() => {
      fireEvent.click(screen.getByRole("button"));
    }).not.toThrow();
    // The press fired (the gather walk terminated under its own budget).
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
