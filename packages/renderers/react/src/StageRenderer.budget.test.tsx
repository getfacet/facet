// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MAX_RENDER_NODES, type FacetNode, type FacetTree, type NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import { MOTION_EXIT_MS } from "./motion.js";
import { renderNode } from "./renderer-render.js";
import { RENDER_BUDGET } from "./renderer-safe.js";
import { resolveTheme } from "./theme.js";

afterEach(cleanup);

const HOSTILE_LATTICE_LEVELS = 7;
const TEST_RENDER_BUDGET = 64;
const OVER_BUDGET_REF_COUNT = MAX_RENDER_NODES + 1;
const STRICT_MODE_NODE_COUNT = 64;

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

function renderWithBudget(tree: FacetTree, left = TEST_RENDER_BUDGET) {
  const budget: { left: number; refsLeft: number; warned?: boolean } = {
    left,
    refsLeft: left,
  };
  const result = render(
    <>
      {renderNode({
        tree,
        id: tree.root,
        onPress: vi.fn(),
        visibilityOverrides: new Map(),
        theme: resolveTheme(),
        budget,
        stageCssSeen: { appear: false, collapse: false },
        depth: 0,
        renderMode: "live",
        motionClassById: new Map(),
        exitRecordsByParent: new Map(),
        activeScreen: null,
      })}
    </>,
  );
  return { ...result, budget };
}

describe("StageRenderer render budget (fail-safe against shared-child explosion)", () => {
  it("renders a hostile shared-child lattice in bounded element count without hanging", () => {
    // Inject a small per-pass budget into the same recursive renderer. This
    // crosses the guard without materializing 5,000 DOM nodes in every test run.
    const { container, budget } = renderWithBudget(latticeTree(HOSTILE_LATTICE_LEVELS));
    expect(budget.warned).toBe(true);
    expect(container.querySelectorAll("div").length).toBeLessThanOrEqual(TEST_RENDER_BUDGET);
    expect(RENDER_BUDGET).toBe(MAX_RENDER_NODES);
  });

  it("renders a valid tree in FULL under StrictMode (budget is not shared across renders)", () => {
    // A representative valid tree stays complete across StrictMode's repeated
    // render phase; the full cap is pinned separately above.
    const { container } = render(
      <StrictMode>
        <StageRenderer tree={flatTree(STRICT_MODE_NODE_COUNT)} onAction={vi.fn()} />
      </StrictMode>,
    );
    expect(container.querySelectorAll("p").length).toBe(STRICT_MODE_NODE_COUNT);
  });

  it("bounds a huge dangling child array without hanging", () => {
    const children = Array.from(
      { length: OVER_BUDGET_REF_COUNT },
      (_, index) => `missing-${String(index)}`,
    );
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
    const children = Array.from(
      { length: OVER_BUDGET_REF_COUNT },
      (_, index) => `missing-${String(index)}`,
    );
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
    const children = Array.from(
      { length: OVER_BUDGET_REF_COUNT },
      (_, index) => `missing-${String(index)}`,
    );
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
    const lattice = latticeTree(HOSTILE_LATTICE_LEVELS, true);
    // Keep the hostile collect target unreachable from the rendered button so
    // this test measures the gather budget without first mounting 5,000 boxes.
    const tree: FacetTree = {
      root: "wrap",
      nodes: {
        ...lattice.nodes,
        wrap: {
          id: "wrap",
          type: "box",
          onPress: { kind: "agent", name: "submit", collect: "root" },
          children: ["label"],
        },
        label: { id: "label", type: "text", value: "Submit" },
      },
    };
    render(<StageRenderer tree={tree} onAction={onAction} />);
    expect(() => {
      fireEvent.click(screen.getByRole("button"));
    }).not.toThrow();
    // The press fired (the gather walk terminated under its own budget).
    expect(onAction).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("keeps exit snapshot rendering finite for a removed shared-child subtree", () => {
    vi.useFakeTimers();
    try {
      const lattice = latticeTree(HOSTILE_LATTICE_LEVELS);
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
      expect(screen.getAllByText("still here").length).toBeGreaterThan(0);
      expect(container.querySelectorAll("div").length).toBeLessThan(600);

      act(() => {
        vi.advanceTimersByTime(MOTION_EXIT_MS);
      });
      expect(screen.getAllByText("still here").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
