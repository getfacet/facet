import { describe, expect, it } from "vitest";

import { EMPTY_TREE, isTreeShaped } from "./tree.js";

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
