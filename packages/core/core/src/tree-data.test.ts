import { describe, expect, it } from "vitest";

import type { ChartNode, KeyValueNode, ListNode, TableNode, TextNode } from "./nodes.js";
import { foldPatchIntoStage } from "./stage-fold.js";
import { treeHasContent } from "./tree.js";
import { validateTree } from "./validate.js";

// =========================================================================
// DC-001 — validateTree accepts + KEEPS `data` and node `from`; fold round-trip
// =========================================================================

describe("validateTree keeps data + from (DC-001)", () => {
  const input = {
    root: "root",
    nodes: {
      root: {
        id: "root",
        type: "box",
        children: ["tbl", "cht", "lst", "kv", "latest", "first"],
      },
      tbl: {
        id: "tbl",
        type: "table",
        columns: [
          { key: "month", label: "Month" },
          { key: "revenue", label: "Revenue" },
        ],
        from: "sales",
      },
      cht: { id: "cht", type: "chart", kind: "bar", from: "sales" },
      lst: { id: "lst", type: "list", from: "sales" },
      kv: { id: "kv", type: "keyValue", from: "sales" },
      // Text keeps its required inline fallback while `from` projects one cell.
      latest: {
        id: "latest",
        type: "text",
        value: "-",
        from: "sales",
        column: "revenue",
        row: 1,
      },
      first: {
        id: "first",
        type: "text",
        value: "-",
        from: "sales",
        column: "revenue",
        row: 0,
      },
    },
    data: {
      sales: [
        { month: "Jan", revenue: 100 },
        { month: "Feb", revenue: 120 },
      ],
    },
  };

  it("keeps the sanitized data warehouse on the returned tree", () => {
    const { tree } = validateTree(input);
    expect(tree.data?.["sales"]).toEqual([
      { month: "Jan", revenue: 100 },
      { month: "Feb", revenue: 120 },
    ]);
  });

  it("keeps a conforming `from` on every data-bearing node", () => {
    const { tree } = validateTree(input);
    expect((tree.nodes["tbl"] as TableNode).from).toBe("sales");
    expect((tree.nodes["cht"] as ChartNode).from).toBe("sales");
    expect((tree.nodes["lst"] as ListNode).from).toBe("sales");
    expect((tree.nodes["kv"] as KeyValueNode).from).toBe("sales");
    const latest = tree.nodes["latest"] as TextNode;
    expect(latest.from).toBe("sales");
    expect(latest.column).toBe("revenue");
    expect(latest.row).toBe(1);
    const first = tree.nodes["first"] as TextNode;
    expect(first.from).toBe("sales");
    expect(first.column).toBe("revenue");
    expect(first.row).toBe(0);
  });

  it("survives a re-validate (fold) round-trip unchanged", () => {
    const first = validateTree(input).tree;
    const second = validateTree(first).tree;
    expect(second).toEqual(first);
    // A no-op fold folds through the SAME validateTree both sides run.
    const folded = foldPatchIntoStage(first, []);
    expect(folded.tree.data).toEqual(first.data);
    expect((folded.tree.nodes["tbl"] as TableNode).from).toBe("sales");
  });

  it("drops a non-conforming `from` (not a bounded name) with the node kept", () => {
    const { tree } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["tbl"] },
        tbl: {
          id: "tbl",
          type: "table",
          columns: [{ key: "month", label: "Month" }],
          rows: [{ month: "Jan" }],
          from: "https://evil.example/data.json",
        },
      },
    });
    const tbl = tree.nodes["tbl"] as TableNode;
    expect(tbl.from).toBeUndefined();
    expect(tbl.rows).toEqual([{ month: "Jan" }]);
  });
});

// =========================================================================
// DC-004 — malformed `data` sanitized INSIDE validateTree
// =========================================================================

describe("validateTree sanitizes malformed data (DC-004)", () => {
  it("drops bad datasets, keeps valid, strips fetch-like column keys", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
      data: {
        sales: [{ a: 1 }],
        bad: 42,
        "bad name": [{ a: 1 }],
        another: [{ url: "http://x", fetch: "y", ok: 2 }],
      },
    });
    expect(tree.data?.["sales"]).toEqual([{ a: 1 }]);
    expect(tree.data?.["bad"]).toBeUndefined();
    expect(tree.data?.["bad name"]).toBeUndefined();
    expect(tree.data?.["another"]).toEqual([{ ok: 2 }]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("drops `data` whole when it is not an object", () => {
    const { tree } = validateTree({
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
      data: 42,
    });
    expect(tree.data).toBeUndefined();
  });

  it("never throws on hostile data and returns a valid tree", () => {
    expect(() =>
      validateTree({
        root: "root",
        nodes: { root: { id: "root", type: "box", children: [] } },
        data: { x: [{ nested: { deep: 1 } }], __proto__: [{ a: 1 }] },
      }),
    ).not.toThrow();
  });
});

// =========================================================================
// DC-007 — inline-only tree with no `data` validates additively, stably
// =========================================================================

describe("validateTree is additive for inline-only trees (DC-007)", () => {
  const inline = {
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["t"] },
      t: {
        id: "t",
        type: "table",
        columns: [{ key: "month", label: "Month" }],
        rows: [{ month: "Jan" }],
      },
    },
  };

  it("injects no `data` property when the input has none", () => {
    const { tree } = validateTree(inline);
    expect(Object.prototype.hasOwnProperty.call(tree, "data")).toBe(false);
    expect(tree.data).toBeUndefined();
  });

  it("serializes byte-identically across a re-validate", () => {
    const first = validateTree(inline).tree;
    const second = validateTree(first).tree;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

// =========================================================================
// DC-008 — buffered forward reference: node kept, later /data patch resolves
// =========================================================================

describe("buffered forward reference (DC-008)", () => {
  it("keeps a from node with no matching dataset; a later /data patch makes it content", () => {
    // A chart renders nothing until its series resolve, so it cleanly exercises
    // the "non-content until the data lands" transition (a table would show a
    // header from its columns and be content immediately — covered in tree.test).
    const { tree } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["cht"] },
        cht: {
          id: "cht",
          type: "chart",
          kind: "bar",
          series: [],
          from: "sales",
        },
      },
      // `other` exists so `/data` is present, but `cht` is not bound to it.
      data: { other: [{ x: 1 }] },
    });

    expect((tree.nodes["cht"] as ChartNode).from).toBe("sales");
    expect(tree.data?.["other"]).toEqual([{ x: 1 }]);
    // Bound to an absent dataset ⇒ non-content until the data lands.
    expect(treeHasContent(tree)).toBe(false);

    const folded = foldPatchIntoStage(tree, [
      { op: "add", path: "/data/sales", value: [{ month: "Jan", revenue: 10 }] },
    ]);

    expect(folded.tree.data?.["sales"]).toEqual([{ month: "Jan", revenue: 10 }]);
    expect(treeHasContent(folded.tree)).toBe(true);
  });
});
