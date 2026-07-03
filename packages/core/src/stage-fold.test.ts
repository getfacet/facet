import { describe, expect, it } from "vitest";
import { EMPTY_TREE, type FacetTree } from "./tree.js";
import type { JsonPatchOperation } from "./patch.js";
import { foldPatchIntoStage } from "./stage-fold.js";

const rootBox: FacetTree = {
  root: "root",
  nodes: { root: { id: "root", type: "box", style: {}, children: [] } },
};

/** Fold a single batch — the exact call both the server store and the client make. */
const fold = (stage: FacetTree, patches: readonly JsonPatchOperation[]): FacetTree =>
  foldPatchIntoStage(stage, patches).tree;

describe("foldPatchIntoStage — convergence by construction", () => {
  // The redesign's core claim: the SAME pure fold runs on the server (stored
  // stage) and the client (rendered tree), so given identical inputs they
  // produce identical trees — there is nothing left to diverge. Each case below
  // is a former divergence trigger; a "server" and a "client" fold the same
  // input and must deep-equal.
  const converges = (stage: FacetTree, patches: readonly JsonPatchOperation[]): FacetTree => {
    const server = fold(stage, patches);
    const client = fold(stage, patches);
    expect(client).toEqual(server);
    return server;
  };

  it("(a) mixed batch: salvages the good op, drops the throwing one with a bounded issue", () => {
    const patches: JsonPatchOperation[] = [
      { op: "remove", path: "/nodes/ghost/children/0" }, // stale → throws
      { op: "add", path: "/nodes/good", value: { id: "good", type: "text", value: "kept" } },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree.nodes["good"]).toBeDefined(); // good op salvaged
    expect(issues.some((i) => i.includes("dropped an unapplicable patch op"))).toBe(true);
    expect(converges(rootBox, patches).nodes["good"]).toBeDefined();
  });

  it("bounds the dropped-op note — a hostile op path is never echoed verbatim", () => {
    // A pointer into a nonexistent parent throws in applyPatch; the huge path is
    // what describeDroppedOp would echo — it must be collapsed by the key cap.
    const bigPath = "/ghost/" + "z".repeat(10_000_000);
    const patches = [{ op: "remove", path: bigPath }] as unknown as JsonPatchOperation[];
    const { issues } = foldPatchIntoStage(rootBox, patches);
    const joined = issues.join("\n");
    expect(joined.includes("<key too long>")).toBe(true);
    expect(joined.includes(bigPath)).toBe(false);
    expect(joined.length).toBeLessThan(200);
  });

  it("(b) replace /nodes/root with a text node → normalized to EMPTY_TREE", () => {
    const patches: JsonPatchOperation[] = [
      { op: "replace", path: "/nodes/root", value: { id: "root", type: "text", value: "hi" } },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree).toEqual(EMPTY_TREE);
    expect(issues.some((i) => i.includes("root node must be a box"))).toBe(true);
    expect(converges(rootBox, patches)).toEqual(EMPTY_TREE);
  });

  it('(c) replace "" with a root:"root" text-node tree → normalized to EMPTY_TREE', () => {
    const patches: JsonPatchOperation[] = [
      {
        op: "replace",
        path: "",
        value: { root: "root", nodes: { root: { id: "root", type: "text", value: "hi" } } },
      },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree).toEqual(EMPTY_TREE);
    expect(issues.some((i) => i.includes("root node must be a box"))).toBe(true);
    expect(converges(rootBox, patches)).toEqual(EMPTY_TREE);
  });

  it("(d) a text node as a screens target → the screen is dropped", () => {
    const patches: JsonPatchOperation[] = [
      {
        op: "replace",
        path: "",
        value: {
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["txt"] },
            txt: { id: "txt", type: "text", value: "not a screen root" },
          },
          screens: { promo: "txt" },
          entry: "promo",
        },
      },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree.screens).toBeUndefined();
    expect(issues.some((i) => i.includes("is not a box"))).toBe(true);
    expect(converges(rootBox, patches).screens).toBeUndefined();
  });

  it("(e) cross-parent shared child within one screen → collapsed to the first parent", () => {
    const patches: JsonPatchOperation[] = [
      {
        op: "replace",
        path: "",
        value: {
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["b1", "b2"] },
            b1: { id: "b1", type: "box", children: ["shared"] },
            b2: { id: "b2", type: "box", children: ["shared"] },
            shared: { id: "shared", type: "text", value: "hi" },
          },
        },
      },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect((tree.nodes["b1"] as unknown as { children: string[] }).children).toEqual(["shared"]);
    expect((tree.nodes["b2"] as unknown as { children: string[] }).children).toEqual([]);
    expect(issues.some((i) => i.includes("removed shared child"))).toBe(true);
    expect(
      (converges(rootBox, patches).nodes["b2"] as unknown as { children: string[] }).children,
    ).toEqual([]);
  });

  it("(f) replace /root with a dangling id (a node keyed 'root' exists) → falls back to 'root'", () => {
    const patches: JsonPatchOperation[] = [{ op: "replace", path: "/root", value: "ghost" }];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree.root).toBe("root");
    expect(issues.some((i) => i.includes("fell back to"))).toBe(true);
    expect(converges(rootBox, patches).root).toBe("root");
  });
});

describe("foldPatchIntoStage — fail-safe posture", () => {
  it("returns a validated tree and a flag issue when patches is not an array", () => {
    const { tree, issues } = foldPatchIntoStage(rootBox, "not-an-array" as unknown as []);
    expect(tree.nodes["root"]).toBeDefined(); // stage preserved, validated
    expect(issues.some((i) => i.includes("not an array"))).toBe(true);
  });

  it("never throws on a fully-throwing batch (nothing salvaged, stage validated)", () => {
    const patches: JsonPatchOperation[] = [
      { op: "remove", path: "/nodes/ghost/children/0" },
      { op: "remove", path: "/nodes/also-ghost" },
    ];
    const run = (): unknown => foldPatchIntoStage(rootBox, patches);
    expect(run).not.toThrow();
    const { tree } = foldPatchIntoStage(rootBox, patches);
    expect(tree.nodes["root"]).toBeDefined(); // unchanged, still valid
  });

  it("always returns a guaranteed-valid tree even from a root-replace to null", () => {
    const { tree } = foldPatchIntoStage(rootBox, [{ op: "replace", path: "", value: null }]);
    expect(tree).toEqual(EMPTY_TREE);
  });
});
