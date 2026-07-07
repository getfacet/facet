import { describe, expect, it } from "vitest";
import { applyOpInPlace, applyPatch, MAX_PATCH_OPS, type JsonPatchOperation } from "./patch.js";
import { EMPTY_TREE, type FacetTree } from "./tree.js";

describe("applyPatch (RFC 6902)", () => {
  it("replace at the root path swaps the whole tree", () => {
    const next = {
      root: "root",
      nodes: { root: { id: "root", type: "box" as const, children: [] } },
    };
    const out = applyPatch(EMPTY_TREE, [{ op: "replace", path: "", value: next }]);
    expect(out).toEqual(next);
  });

  it("add upserts a node by id", () => {
    const out = applyPatch(EMPTY_TREE, [
      { op: "add", path: "/nodes/a", value: { id: "a", type: "text", value: "hi" } },
    ]);
    expect(out.nodes["a"]).toMatchObject({ value: "hi" });
  });

  it("append = add node + add id to parent children", () => {
    const out = applyPatch(EMPTY_TREE, [
      { op: "add", path: "/nodes/c", value: { id: "c", type: "text", value: "x" } },
      { op: "add", path: "/nodes/root/children/-", value: "c" },
    ]);
    const root = out.nodes["root"] as unknown as { children: string[] };
    expect(root.children).toContain("c");
  });

  it("remove deletes a node", () => {
    const added = applyPatch(EMPTY_TREE, [
      { op: "add", path: "/nodes/a", value: { id: "a", type: "text", value: "x" } },
    ]);
    const out = applyPatch(added, [{ op: "remove", path: "/nodes/a" }]);
    expect(out.nodes["a"]).toBeUndefined();
  });

  it("is pure — never mutates the input tree", () => {
    const before = JSON.stringify(EMPTY_TREE);
    applyPatch(EMPTY_TREE, [
      { op: "add", path: "/nodes/a", value: { id: "a", type: "text", value: "x" } },
    ]);
    expect(JSON.stringify(EMPTY_TREE)).toBe(before);
  });

  it("never mutates the OPERATIONS — applying the same batch twice yields identical trees", () => {
    // add a box, then append a child into it: without value-cloning the second
    // op would mutate the first op's value in place (server apply would corrupt
    // the outgoing message; the client would then double-append).
    const batch = [
      { op: "add" as const, path: "/nodes/boxA", value: { id: "boxA", type: "box", children: [] } },
      { op: "add" as const, path: "/nodes/boxA/children/-", value: "c" },
    ];
    const before = JSON.stringify(batch);
    const serverSide = applyPatch(EMPTY_TREE, batch);
    expect(JSON.stringify(batch)).toBe(before); // ops untouched by the first apply
    const clientSide = applyPatch(EMPTY_TREE, batch);
    expect(clientSide).toEqual(serverSide); // second apply gives the same result
    const boxA = clientSide.nodes["boxA"] as unknown as { children: string[] };
    expect(boxA.children).toEqual(["c"]); // exactly once, not ["c", "c"]
  });

  it("throws on an unknown op instead of returning undefined", () => {
    const bogus = { op: "append", path: "/nodes/a", value: "x" } as unknown as Parameters<
      typeof applyPatch
    >[1][number];
    expect(() => applyPatch(EMPTY_TREE, [bogus])).toThrow(/unknown patch op/);
  });

  it("rejects prototype-polluting pointer tokens", () => {
    for (const path of ["/__proto__/polluted", "/nodes/__proto__", "/constructor/prototype/x"]) {
      expect(() => applyPatch(EMPTY_TREE, [{ op: "add", path, value: "HACKED" }])).toThrow(
        /forbidden pointer token/,
      );
    }
    expect({} as { polluted?: unknown }).not.toHaveProperty("polluted"); // globals untouched
  });

  it("move relocates a node", () => {
    const seeded = applyPatch(EMPTY_TREE, [
      { op: "add", path: "/nodes/a", value: { id: "a", type: "text", value: "x" } },
    ]);
    const out = applyPatch(seeded, [{ op: "move", from: "/nodes/a", path: "/nodes/b" }]);
    expect(out.nodes["a"]).toBeUndefined();
    expect(out.nodes["b"]).toMatchObject({ value: "x" });
  });

  it("copy duplicates a node (deep clone)", () => {
    const seeded = applyPatch(EMPTY_TREE, [
      { op: "add", path: "/nodes/a", value: { id: "a", type: "text", value: "x" } },
    ]);
    const out = applyPatch(seeded, [{ op: "copy", from: "/nodes/a", path: "/nodes/b" }]);
    expect(out.nodes["a"]).toMatchObject({ value: "x" });
    expect(out.nodes["b"]).toMatchObject({ value: "x" });
  });

  it("test passes on a match and throws on a mismatch", () => {
    expect(() =>
      applyPatch(EMPTY_TREE, [{ op: "test", path: "/root", value: "root" }]),
    ).not.toThrow();
    expect(() => applyPatch(EMPTY_TREE, [{ op: "test", path: "/root", value: "nope" }])).toThrow();
  });

  it("test op passes on deep-equal values regardless of key order", () => {
    const seeded = applyPatch(EMPTY_TREE, [
      { op: "add", path: "/nodes/a", value: { id: "a", type: "text", value: "hi" } },
    ]);
    // Same value, keys in a DIFFERENT order. JSON.stringify equality rejects
    // this (text differs); RFC 6902 compares values, so deep equality accepts.
    expect(() =>
      applyPatch(seeded, [
        { op: "test", path: "/nodes/a", value: { value: "hi", id: "a", type: "text" } },
      ]),
    ).not.toThrow();
  });

  it("test op deep-equals nested arrays and objects (key order aside)", () => {
    const seeded = applyPatch(EMPTY_TREE, [
      {
        op: "add",
        path: "/nodes/a",
        value: {
          id: "a",
          type: "box",
          children: ["x", "y"],
          style: { gap: "md", direction: "col" },
        },
      },
    ]);
    // Nested object keys reordered — still deep-equal.
    expect(() =>
      applyPatch(seeded, [
        {
          op: "test",
          path: "/nodes/a",
          value: {
            type: "box",
            children: ["x", "y"],
            id: "a",
            style: { direction: "col", gap: "md" },
          },
        },
      ]),
    ).not.toThrow();
    // A genuine array-element difference still fails.
    expect(() =>
      applyPatch(seeded, [{ op: "test", path: "/nodes/a/children", value: ["x", "z"] }]),
    ).toThrow();
    // A differing array length still fails.
    expect(() =>
      applyPatch(seeded, [{ op: "test", path: "/nodes/a/children", value: ["x"] }]),
    ).toThrow();
  });

  it("throws on an op whose parent path is missing (the documented contract)", () => {
    expect(() =>
      applyPatch(EMPTY_TREE, [{ op: "add", path: "/nodes/missing/children/-", value: "x" }]),
    ).toThrow();
  });
});

describe("applyPatch — strict RFC 6901 array indices", () => {
  const seeded = applyPatch(EMPTY_TREE, [
    { op: "add", path: "/nodes/root/children/-", value: "a" },
    { op: "add", path: "/nodes/root/children/-", value: "b" },
  ]);
  const childrenOf = (tree: typeof seeded): string[] =>
    (tree.nodes["root"] as unknown as { children: string[] }).children;

  for (const bad of ["-1", "", "1.5", "01"]) {
    it(`add rejects a malformed array index "${bad}"`, () => {
      expect(() =>
        applyPatch(seeded, [{ op: "add", path: `/nodes/root/children/${bad}`, value: "z" }]),
      ).toThrow(/invalid array index/);
    });
  }

  it("add rejects an out-of-range index (> length)", () => {
    // length is 2, so index 3 would leave a gap.
    expect(() =>
      applyPatch(seeded, [{ op: "add", path: "/nodes/root/children/3", value: "z" }]),
    ).toThrow(/out of range/);
  });

  it("add allows index == length (the boundary) and `-` append", () => {
    const viaIndex = applyPatch(seeded, [
      { op: "add", path: "/nodes/root/children/2", value: "z" },
    ]);
    expect(childrenOf(viaIndex)).toEqual(["a", "b", "z"]);
    const viaAppend = applyPatch(seeded, [
      { op: "add", path: "/nodes/root/children/-", value: "z" },
    ]);
    expect(childrenOf(viaAppend)).toEqual(["a", "b", "z"]);
  });

  it("remove/replace require index < length (reject == length and `-`)", () => {
    expect(() => applyPatch(seeded, [{ op: "remove", path: "/nodes/root/children/2" }])).toThrow(
      /out of range/,
    );
    expect(() =>
      applyPatch(seeded, [{ op: "replace", path: "/nodes/root/children/2", value: "z" }]),
    ).toThrow(/out of range/);
    expect(() => applyPatch(seeded, [{ op: "remove", path: "/nodes/root/children/-" }])).toThrow(
      /invalid array index/,
    );
  });

  it("remove/replace accept a valid in-range index", () => {
    const removed = applyPatch(seeded, [{ op: "remove", path: "/nodes/root/children/0" }]);
    expect(childrenOf(removed)).toEqual(["b"]);
    const replaced = applyPatch(seeded, [
      { op: "replace", path: "/nodes/root/children/1", value: "z" },
    ]);
    expect(childrenOf(replaced)).toEqual(["a", "z"]);
  });

  it("traversal through a malformed array index throws", () => {
    const nested = applyPatch(EMPTY_TREE, [
      { op: "add", path: "/nodes/a", value: { id: "a", type: "box", children: ["x"] } },
    ]);
    expect(() =>
      applyPatch(nested, [{ op: "test", path: "/nodes/a/children/01", value: "x" }]),
    ).toThrow(/invalid array index/);
  });
});

describe("applyPatch — move/copy against array indices", () => {
  // move/copy are the only ops whose target uses the "add" (insert) mode AND
  // whose source reads an array element — so their setMember/childOf wiring is
  // observable only through arrays (with object keys, add vs replace coincide).
  const seeded = applyPatch(EMPTY_TREE, [
    { op: "add", path: "/nodes/root/children/-", value: "a" },
    { op: "add", path: "/nodes/root/children/-", value: "b" },
    { op: "add", path: "/nodes/root/children/-", value: "c" },
  ]);
  const childrenOf = (tree: typeof seeded): string[] =>
    (tree.nodes["root"] as unknown as { children: string[] }).children;

  it("in-array move reorders children (target inserts, does not overwrite)", () => {
    // remove index 2 → ["a","b"], then insert "c" at index 0 → ["c","a","b"].
    // If the target used "replace" mode it would overwrite index 0 → ["c","b"].
    const out = applyPatch(seeded, [
      { op: "move", from: "/nodes/root/children/2", path: "/nodes/root/children/0" },
    ]);
    expect(childrenOf(out)).toEqual(["c", "a", "b"]);
  });

  it("copy to `-` appends the copied element", () => {
    const out = applyPatch(seeded, [
      { op: "copy", from: "/nodes/root/children/0", path: "/nodes/root/children/-" },
    ]);
    expect(childrenOf(out)).toEqual(["a", "b", "c", "a"]);
  });

  it("move-from an out-of-range index throws", () => {
    expect(() =>
      applyPatch(seeded, [
        { op: "move", from: "/nodes/root/children/5", path: "/nodes/root/children/0" },
      ]),
    ).toThrow(/out of range/);
  });

  it("copy-from `-` throws (access mode rejects the append token)", () => {
    expect(() =>
      applyPatch(seeded, [
        { op: "copy", from: "/nodes/root/children/-", path: "/nodes/root/children/-" },
      ]),
    ).toThrow(/invalid array index/);
  });
});

describe("applyOpInPlace (non-cloning primitive)", () => {
  const base: FacetTree = {
    root: "root",
    nodes: {
      root: { id: "root", type: "box", style: {}, children: ["a", "b"] },
      a: { id: "a", type: "text", value: "A", style: {} },
      b: { id: "b", type: "text", value: "B", style: {} },
    },
  };
  const childrenOf = (tree: FacetTree): string[] =>
    (tree.nodes["root"] as unknown as { children: string[] }).children;

  it("mutates the given tree in place and returns the same root for a non-root op", () => {
    const tree = structuredClone(base);
    const out = applyOpInPlace(tree, {
      op: "add",
      path: "/nodes/x",
      value: { id: "x", type: "text", value: "X" },
    });
    expect(out).toBe(tree); // same reference — no clone
    expect(tree.nodes["x"]).toBeDefined();
  });

  it("leaves the tree byte-identical when a move's destination is invalid (atomic)", () => {
    // The source is removed before the destination pointer is resolved; a failed
    // destination must NOT strand the tree with the source gone.
    const tree = structuredClone(base);
    expect(() =>
      applyOpInPlace(tree, {
        op: "move",
        from: "/nodes/root/children/0",
        path: "/nodes/ghost/children/0", // parent "ghost" does not exist → throws
      }),
    ).toThrow();
    expect(childrenOf(tree)).toEqual(["a", "b"]); // source "a" restored
  });

  it("leaves the tree byte-identical when a move's destination index is out of range (atomic)", () => {
    const tree = structuredClone(base);
    expect(() =>
      applyOpInPlace(tree, {
        op: "move",
        from: "/nodes/root/children/0",
        path: "/nodes/root/children/9", // out of range after the source removal
      }),
    ).toThrow();
    expect(childrenOf(tree)).toEqual(["a", "b"]);
  });
});

describe("MAX_PATCH_OPS", () => {
  it("is a positive integer cap", () => {
    expect(MAX_PATCH_OPS).toBe(1024);
  });

  it("applyPatch itself imposes no op-count cap (the cap lives at the fold/wire boundary)", () => {
    // A batch well over MAX_PATCH_OPS still applies through applyPatch; the cap is
    // a fold/server concern, not applyPatch's contract.
    const ops: JsonPatchOperation[] = Array.from({ length: MAX_PATCH_OPS + 10 }, () => ({
      op: "add" as const,
      path: "/nodes/a",
      value: { id: "a", type: "text" as const, value: "x" },
    }));
    expect(() => applyPatch(EMPTY_TREE, ops)).not.toThrow();
  });
});
