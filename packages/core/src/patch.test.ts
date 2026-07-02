import { describe, expect, it } from "vitest";
import { applyPatch } from "./patch.js";
import { EMPTY_TREE } from "./tree.js";

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

  it("throws on an op whose parent path is missing (the documented contract)", () => {
    expect(() =>
      applyPatch(EMPTY_TREE, [{ op: "add", path: "/nodes/missing/children/-", value: "x" }]),
    ).toThrow();
  });
});
