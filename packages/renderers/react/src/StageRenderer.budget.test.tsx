// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import { MOTION_EXIT_MS } from "./motion.js";

afterEach(cleanup);

/** A valid, flat tree: one root box with `count` text-node children. */
function flatTree(count: number): FacetTree {
  const nodes: Record<NodeId, FacetNode> = {
    root: { id: "root", type: "box", children: [] },
  };
  const children: NodeId[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `t${String(i)}`;
    children.push(id);
    nodes[id] = { id, type: "text", value: `n${String(i)}` };
  }
  nodes.root = { id: "root", type: "box", children };
  return { root: "root", nodes };
}

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
      nodes[`f${String(i)}_a`] = { id: `f${String(i)}_a`, type: "input", name: "shared" };
      nodes[`f${String(i)}_b`] = { id: `f${String(i)}_b`, type: "input", name: "shared" };
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
  }, 15_000);

  it("renders a valid tree in FULL under StrictMode (budget is not shared across renders)", () => {
    // 3000 text nodes — well under RENDER_BUDGET (5000). React StrictMode
    // double-invokes each component render; if the budget were a shared render-
    // phase mutation it would be decremented twice per node and the effective cap
    // would halve to ~2500 (only 2499 <p> would render). With renderNode a plain
    // function called from StageRenderer's body, each StrictMode invocation makes
    // its own fresh budget, so all 3000 nodes render.
    const { container } = render(
      <StrictMode>
        <StageRenderer tree={flatTree(3000)} onAction={vi.fn()} />
      </StrictMode>,
    );
    expect(container.querySelectorAll("p").length).toBe(3000);
  });

  it("bounds a huge dangling child array without hanging", () => {
    const children = Array.from({ length: 200_000 }, (_, index) => `missing-${String(index)}`);
    const hostile: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children },
      },
    };
    let container: HTMLElement | undefined;

    expect(() => {
      ({ container } = render(<StageRenderer tree={hostile} onAction={vi.fn()} />));
    }).not.toThrow();
    expect(container!.querySelectorAll("div").length).toBeLessThan(10);
  });

  it("keeps nested native box containers on the shared render budget", () => {
    const children = Array.from({ length: 200_000 }, (_, index) => `missing-${String(index)}`);
    const hostile: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["panel"] },
        panel: { id: "panel", type: "box", children },
      },
    };
    let container: HTMLElement | undefined;

    expect(() => {
      ({ container } = render(<StageRenderer tree={hostile} onAction={vi.fn()} />));
    }).not.toThrow();
    expect(container!.querySelectorAll("div")).toHaveLength(3);
    expect(container!.querySelectorAll("*").length).toBeLessThan(20);
  });

  it("keeps collect bounded on a huge dangling child array", () => {
    const onAction = vi.fn();
    const children = Array.from({ length: 200_000 }, (_, index) => `missing-${String(index)}`);
    const hostile: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["form", "submit"] },
        form: { id: "form", type: "box", children },
        submit: {
          id: "submit",
          type: "box",
          onPress: { kind: "agent", name: "submit", collect: "form" },
          children: ["label"],
        },
        label: { id: "label", type: "text", value: "Submit" },
      },
    };

    render(<StageRenderer tree={hostile} onAction={onAction} />);
    expect(() => {
      fireEvent.click(screen.getByRole("button"));
    }).not.toThrow();
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, {});
  });

  it("keeps a collect press bounded on a shared-child subtree (gather budget)", () => {
    const onAction = vi.fn();
    // 2^20 root-to-leaf paths still exceeds the 5,000-node gather budget by
    // orders of magnitude, while keeping this adversarial check stable on
    // resource-constrained development machines.
    const lattice = latticeTree(20, true);
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
  }, 10_000);

  it("keeps exit snapshot rendering bounded for a removed hostile subtree", () => {
    vi.useFakeTimers();
    try {
      const lattice = latticeTree(40);
      const initial: FacetTree = {
        root: "wrap",
        nodes: {
          ...lattice.nodes,
          wrap: { id: "wrap", type: "box", children: ["root", "stay"] },
          stay: { id: "stay", type: "text", value: "still here" },
        },
      };
      const next: FacetTree = {
        root: "wrap",
        nodes: {
          wrap: { id: "wrap", type: "box", children: ["stay"] },
          stay: { id: "stay", type: "text", value: "still here" },
        },
      };
      const { container, rerender } = render(
        <StageRenderer tree={initial} transition={{ revision: 0, rootReplaced: false }} />,
      );

      expect(() => {
        rerender(<StageRenderer tree={next} transition={{ revision: 1, rootReplaced: false }} />);
      }).not.toThrow();
      expect(screen.getByText("still here")).toBeTruthy();
      expect(container.querySelectorAll("div").length).toBeLessThan(6000);

      act(() => {
        vi.advanceTimersByTime(MOTION_EXIT_MS);
      });
      expect(screen.getByText("still here")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);
});
