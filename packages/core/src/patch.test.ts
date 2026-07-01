import { describe, expect, it } from "vitest";
import { applyPatch } from "./patch.js";
import { EMPTY_TREE } from "./tree.js";

describe("applyPatch (RFC 6902)", () => {
  it("replace at the root path swaps the whole tree", () => {
    const next = { root: "root", nodes: { root: { id: "root", type: "box" as const, children: [] } } };
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
    applyPatch(EMPTY_TREE, [{ op: "add", path: "/nodes/a", value: { id: "a", type: "text", value: "x" } }]);
    expect(JSON.stringify(EMPTY_TREE)).toBe(before);
  });
});
