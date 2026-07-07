import { describe, expect, it } from "vitest";

import { EMPTY_TREE, isTreeShaped, treeHasContent } from "./tree.js";
import type { FacetTree } from "./tree.js";

describe("isTreeShaped", () => {
  it("accepts a well-formed tree (including EMPTY_TREE)", () => {
    expect(isTreeShaped(EMPTY_TREE)).toBe(true);
    expect(isTreeShaped({ root: "root", nodes: {} })).toBe(true);
  });

  it("rejects non-objects and arrays", () => {
    expect(isTreeShaped(undefined)).toBe(false);
    expect(isTreeShaped(null)).toBe(false);
    expect(isTreeShaped("x")).toBe(false);
    expect(isTreeShaped([{ root: "root", nodes: {} }])).toBe(false);
  });

  it("requires a string root", () => {
    expect(isTreeShaped({ nodes: {} })).toBe(false);
    expect(isTreeShaped({ root: 1, nodes: {} })).toBe(false);
  });

  it("requires nodes to be a non-null, non-array object", () => {
    expect(isTreeShaped({ root: "root" })).toBe(false);
    expect(isTreeShaped({ root: "root", nodes: null })).toBe(false);
    expect(isTreeShaped({ root: "root", nodes: [] })).toBe(false);
    expect(isTreeShaped({ root: "root", nodes: "x" })).toBe(false);
  });

  it("stays shallow: does not require root to name an existing node", () => {
    // The stricter layers (root-node existence, box-ness, child resolution)
    // belong to callers — this base guard only checks the outer shape.
    expect(isTreeShaped({ root: "missing", nodes: {} })).toBe(true);
  });
});

describe("treeHasContent", () => {
  const tree = (nodes: unknown, screens?: unknown): FacetTree =>
    ({ root: "r", nodes, ...(screens !== undefined ? { screens } : {}) }) as unknown as FacetTree;

  it("true when the root box has children", () => {
    expect(treeHasContent(tree({ r: { id: "r", type: "box", children: ["a"] } }))).toBe(true);
  });

  it("false for an empty children array", () => {
    expect(treeHasContent(tree({ r: { id: "r", type: "box", children: [] } }))).toBe(false);
  });

  it("false — and does NOT throw — for a foreign box root with no children field", () => {
    // Exactly the shape FileStageStore's isTreeShaped admits; must fail safe.
    const t = tree({ r: { id: "r", type: "box" } });
    expect(() => treeHasContent(t)).not.toThrow();
    expect(treeHasContent(t)).toBe(false);
  });

  it("false — and does NOT throw — for a foreign box root with non-array children", () => {
    const t = tree({ r: { id: "r", type: "box", children: "not-array" } });
    expect(() => treeHasContent(t)).not.toThrow();
    expect(treeHasContent(t)).toBe(false);
  });

  it("false for a non-container (text) root", () => {
    expect(treeHasContent(tree({ r: { id: "r", type: "text", value: "x" } }))).toBe(false);
  });

  it("false when the root node is missing", () => {
    expect(treeHasContent(tree({}))).toBe(false);
  });

  it("true when screens is non-empty even with an empty root box", () => {
    expect(treeHasContent(tree({ r: { id: "r", type: "box", children: [] } }, { home: "r" }))).toBe(
      true,
    );
  });

  it("false — and does NOT throw — when a foreign tree has null screens", () => {
    const t = tree({ r: { id: "r", type: "box", children: [] } }, null);
    expect(() => treeHasContent(t)).not.toThrow();
    expect(treeHasContent(t)).toBe(false);
  });

  it("false for non-object screens on a foreign tree", () => {
    expect(treeHasContent(tree({ r: { id: "r", type: "box", children: [] } }, "home"))).toBe(false);
  });

  it("false — and does NOT throw — for array-valued screens on a foreign tree", () => {
    const t = tree({ r: { id: "r", type: "box", children: [] } }, ["home"]);
    expect(() => treeHasContent(t)).not.toThrow();
    expect(treeHasContent(t)).toBe(false);
  });
});
