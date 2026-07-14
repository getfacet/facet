import { describe, expect, it } from "vitest";
import type { CompositionRef, FacetComposition } from "./composition-validation.js";
import type { FacetNode } from "./nodes.js";
import {
  MAX_COMPOSITION_GRAPH_NEST_DEPTH,
  MAX_COMPOSITION_GRAPH_NODES,
  validateCompositionGraph,
} from "./composition-graph.js";

/**
 * Build a minimal already-validated-shaped composition: a `box` root whose
 * children are one `{ use }` reference node per entry in `refs`, plus `filler`
 * extra text nodes so a test can push transitive node counts over the cap.
 */
function comp(name: string, refs: readonly string[] = [], filler = 0): FacetComposition {
  const nodes: Record<string, FacetNode | CompositionRef> = {};
  const childIds: string[] = [];
  refs.forEach((use, i) => {
    const id = `ref${i}`;
    childIds.push(id);
    nodes[id] = { use } satisfies CompositionRef;
  });
  for (let i = 0; i < filler; i++) {
    const id = `t${i}`;
    childIds.push(id);
    nodes[id] = { id, type: "text", value: "x" };
  }
  nodes.root = { id: "root", type: "box", children: childIds };
  return { name, root: "root", nodes };
}

function acceptedNames(comps: readonly FacetComposition[]): string[] {
  return comps.map((c) => c.name).sort();
}

describe("validateCompositionGraph", () => {
  it("accepts a valid acyclic graph unchanged (card -> badge, badge exists)", () => {
    const badge = comp("badge");
    const card = comp("card", ["badge"]);
    const result = validateCompositionGraph([card, badge]);
    expect(result.issues).toEqual([]);
    expect(acceptedNames(result.accepted)).toEqual(["badge", "card"]);
  });

  it("refuses both compositions on a cycle (a -> b -> a) with a bounded issue", () => {
    const a = comp("a", ["b"]);
    const b = comp("b", ["a"]);
    const result = validateCompositionGraph([a, b]);
    expect(result.accepted).toEqual([]);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.length).toBeLessThanOrEqual(66);
    expect(result.issues.some((m) => /a/.test(m) && /cycle/i.test(m))).toBe(true);
    expect(result.issues.some((m) => /b/.test(m) && /cycle/i.test(m))).toBe(true);
  });

  it("refuses a self-referencing composition (a -> a)", () => {
    const a = comp("a", ["a"]);
    const result = validateCompositionGraph([a]);
    expect(result.accepted).toEqual([]);
    expect(result.issues.some((m) => /cycle/i.test(m))).toBe(true);
  });

  it("refuses a composition with a dangling reference (card -> ghost, no ghost)", () => {
    const card = comp("card", ["ghost"]);
    const result = validateCompositionGraph([card]);
    expect(result.accepted).toEqual([]);
    expect(result.issues.some((m) => /card/.test(m))).toBe(true);
  });

  it("refuses the referrer of a refused composition to a fixpoint", () => {
    // outer -> card -> ghost(dangling): card refused for dangling, outer refused
    // transitively; a clean sibling survives.
    const outer = comp("outer", ["card"]);
    const card = comp("card", ["ghost"]);
    const clean = comp("clean");
    const result = validateCompositionGraph([outer, card, clean]);
    expect(acceptedNames(result.accepted)).toEqual(["clean"]);
    expect(result.issues.some((m) => /outer/.test(m))).toBe(true);
    expect(result.issues.some((m) => /card/.test(m))).toBe(true);
  });

  it("refuses an over-depth reference chain (> MAX_COMPOSITION_GRAPH_NEST_DEPTH)", () => {
    // Build a chain c0 -> c1 -> ... -> cN with N+1 = cap + 1 compositions so the
    // head exceeds the nesting-depth cap; the tail stays within it.
    const length = MAX_COMPOSITION_GRAPH_NEST_DEPTH + 1;
    const chain: FacetComposition[] = [];
    for (let i = 0; i < length; i++) {
      chain.push(i < length - 1 ? comp(`c${i}`, [`c${i + 1}`]) : comp(`c${i}`));
    }
    const result = validateCompositionGraph(chain);
    const accepted = acceptedNames(result.accepted);
    expect(accepted).not.toContain("c0");
    expect(accepted).toContain(`c${length - 1}`);
    expect(result.issues.some((m) => /c0/.test(m) && /depth/i.test(m))).toBe(true);
  });

  it("refuses a graph whose transitive expansion exceeds the node cap", () => {
    const half = Math.ceil(MAX_COMPOSITION_GRAPH_NODES / 2) + 10;
    const big1 = comp("big1", ["big2"], half);
    const big2 = comp("big2", [], half);
    const result = validateCompositionGraph([big1, big2]);
    const accepted = acceptedNames(result.accepted);
    // big1's transitive count (own + big2) exceeds the cap → refused; big2 alone
    // is under the cap → kept.
    expect(accepted).toContain("big2");
    expect(accepted).not.toContain("big1");
    expect(result.issues.some((m) => /big1/.test(m))).toBe(true);
  });

  it("never throws on hostile input (non-array, junk, throwing getters)", () => {
    expect(() => validateCompositionGraph(undefined as never)).not.toThrow();
    expect(() => validateCompositionGraph(null as never)).not.toThrow();
    expect(() => validateCompositionGraph("nope" as never)).not.toThrow();
    expect(() => validateCompositionGraph(42 as never)).not.toThrow();
    expect(validateCompositionGraph(undefined as never).accepted).toEqual([]);

    const junk = [
      null,
      42,
      "str",
      {},
      { name: 123, nodes: {} },
      { name: "x", nodes: null },
      { name: "y", nodes: { a: null, b: 7, c: { use: {} } } },
    ] as unknown as readonly FacetComposition[];
    expect(() => validateCompositionGraph(junk)).not.toThrow();

    // A node value with a throwing getter must not blow up the pass.
    const hostileNodes: Record<string, unknown> = {};
    Object.defineProperty(hostileNodes, "boom", {
      enumerable: true,
      get() {
        throw new Error("hostile getter");
      },
    });
    const hostile = { name: "h", root: "root", nodes: hostileNodes } as unknown as FacetComposition;
    expect(() => validateCompositionGraph([hostile])).not.toThrow();
  });

  it("bounds the issue list on a large refused catalog", () => {
    // Many self-cycles → one issue each, but the list stays bounded.
    const many: FacetComposition[] = [];
    for (let i = 0; i < 500; i++) many.push(comp(`self${i}`, [`self${i}`]));
    const result = validateCompositionGraph(many);
    expect(result.accepted).toEqual([]);
    expect(result.issues.length).toBeLessThanOrEqual(66);
  });
});
