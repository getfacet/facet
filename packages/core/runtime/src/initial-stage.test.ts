import { describe, expect, it } from "vitest";
import { treeHasContent, validateTree, type FacetTree } from "@facet/core";
import { isSeedableTree, withInitialStage } from "./initial-stage.js";
import { MemoryStageStore } from "./stage-store.js";

// =========================================================================
// WU-7 / RISK-API-1 (DC-007): the runtime SEED gate is a behavior-changed
// consumer of core's `treeHasContent` (via `isSeedableTree`). WU-2 corrected
// that predicate to resolve a node's `from` against `tree.data`. These are
// characterization/regression tests: GREEN on write (behavior delivered by
// WU-2), guarding the seed gate against future drift.
//
// Why they genuinely exercise the data path — each fixture rides `validateTree`
// (as a real seed does). Pre-WU-2 that validation STRIPPED `data` off the tree
// and the content gate read the inline arrays only, so a from-bound node with
// no inline rows scored as EMPTY: the populated-data-bound tree below would
// have been NON-seedable and the assertions here would have FAILED.
// =========================================================================

/**
 * A tree whose ONLY content is a table bound to a populated `data.sales`
 * dataset — inline `rows` are omitted (RISK-API-2 (a): the sanitizer defaults
 * them to `[]`), so solely the resolved warehouse makes this content.
 */
const populatedDataBoundTree = (): FacetTree =>
  validateTree({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["t"] },
      t: {
        id: "t",
        type: "table",
        columns: [
          { key: "month", label: "Month" },
          { key: "revenue", label: "Revenue" },
        ],
        from: "sales",
      },
    },
    data: { sales: [{ month: "Jan", revenue: 100 }] },
  }).tree;

/** Same shape, but `from` names an ABSENT dataset — a dangling binding. */
const danglingFromTree = (): FacetTree =>
  validateTree({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["t"] },
      t: {
        id: "t",
        type: "table",
        columns: [{ key: "month", label: "Month" }],
        from: "sales",
      },
    },
    data: { other: [{ month: "Jan" }] },
  }).tree;

/** A plain inline-only tree — the back-compat control (must be unchanged). */
const inlineOnlyTree = (): FacetTree =>
  validateTree({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["t1"] },
      t1: { id: "t1", type: "text", value: "hello" },
    },
  }).tree;

describe("isSeedableTree with data-bound trees (WU-7 / DC-007)", () => {
  it("a populated data-bound tree IS seedable", () => {
    const tree = populatedDataBoundTree();
    // Guard the fixture: `data` and `from` actually survived validation.
    expect(tree.data?.["sales"]).toEqual([{ month: "Jan", revenue: 100 }]);
    expect(isSeedableTree(tree)).toBe(true);
  });

  it("a dangling-only `from` tree is NOT seedable", () => {
    expect(isSeedableTree(danglingFromTree())).toBe(false);
  });

  it("an inline-only tree is unchanged (still seedable)", () => {
    expect(isSeedableTree(inlineOnlyTree())).toBe(true);
  });
});

describe("withInitialStage honors the corrected seed predicate (WU-7 / DC-007)", () => {
  it("seeds a fresh session with a populated data-bound stage", async () => {
    const seed = populatedDataBoundTree();
    const base = new MemoryStageStore();
    const store = withInitialStage(base, seed);
    // Seedable ⇒ the store is DECORATED (not passed through).
    expect(store).not.toBe(base);

    const session = await store.open("a", { visitorId: "v" });
    expect(session.stage).toEqual(seed);
    // The warehouse rides the seeded stage, so the visitor's page has content.
    expect(session.stage.data?.["sales"]).toEqual([{ month: "Jan", revenue: 100 }]);
    // Consume-once seed signal fires exactly once for the fresh session.
    expect(store.takeSeeded?.("a", "v")).toBe(true);
    expect(store.takeSeeded?.("a", "v")).toBe(false);
  });

  it("does not seed a dangling-only data-bound stage (store passes through)", async () => {
    const base = new MemoryStageStore();
    const store = withInitialStage(base, danglingFromTree());
    // Non-seedable ⇒ the SAME store is returned untouched.
    expect(store).toBe(base);

    const session = await store.open("a", { visitorId: "v" });
    expect(treeHasContent(session.stage)).toBe(false);
  });
});
