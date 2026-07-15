import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MAX_TABLE_ROWS } from "./brick-validation-shared.js";
import type {
  ChartNode,
  DataWarehouse,
  KeyValueNode,
  ListNode,
  TableNode,
  TextNode,
} from "./nodes.js";
import {
  DATASET_NAME_RE,
  MAX_DATASET_NAME_CHARS,
  MAX_DATASETS,
  resolveNodeData,
  sanitizeDataWarehouse,
} from "./data-binding.js";

// --- fixtures -------------------------------------------------------------

function tableNode(overrides: Partial<TableNode> = {}): TableNode {
  return {
    id: "t1",
    type: "table",
    columns: [
      { key: "month", label: "Month" },
      { key: "revenue", label: "Revenue" },
    ],
    rows: [{ month: "inline", revenue: 1 }],
    ...overrides,
  };
}

function chartNode(overrides: Partial<ChartNode> = {}): ChartNode {
  return {
    id: "c1",
    type: "chart",
    kind: "bar",
    series: [{ label: "inline", values: [9] }],
    ...overrides,
  };
}

function listNode(overrides: Partial<ListNode> = {}): ListNode {
  return { id: "l1", type: "list", items: [{ title: "inline" }], ...overrides };
}

function keyValueNode(overrides: Partial<KeyValueNode> = {}): KeyValueNode {
  return {
    id: "k1",
    type: "keyValue",
    items: [{ label: "inline", value: "x" }],
    ...overrides,
  };
}

function textNode(overrides: Partial<TextNode> = {}): TextNode {
  return { id: "tx1", type: "text", value: "inline", ...overrides };
}

describe("final data brick binding surface", () => {
  it("binds only final data bricks without metric or stat aliases", () => {
    const warehouse = sanitizeDataWarehouse({
      sales: [
        { month: "Jan", revenue: 100 },
        { month: "Feb", revenue: 120 },
      ],
    })!;

    expect(resolveNodeData(tableNode({ from: "sales" }), warehouse)).toEqual([
      { month: "Jan", revenue: 100 },
      { month: "Feb", revenue: 120 },
    ]);
    expect(resolveNodeData(chartNode({ from: "sales" }), warehouse)).toEqual([
      { label: "revenue", values: [100, 120] },
    ]);
    expect(resolveNodeData(listNode({ from: "sales" }), warehouse)).toEqual([
      { title: "Jan" },
      { title: "Feb" },
    ]);
    expect(resolveNodeData(keyValueNode({ from: "sales" }), warehouse)).toEqual([
      { label: "Jan", value: "100" },
      { label: "Feb", value: "120" },
    ]);
    expect(resolveNodeData(textNode({ from: "sales", column: "revenue", row: 1 }), warehouse)).toBe(
      "120",
    );

    const bindingSource = readFileSync(new URL("./data-binding.ts", import.meta.url), "utf8");
    expect(bindingSource).not.toContain("component-nodes");
    expect(bindingSource).not.toContain("component-validation-shared");
    expect(bindingSource).not.toMatch(/\b(?:MetricNode|StatNode|metric|stat)\b/); // composition-hard-cut: allowed-negative

    const treeSource = readFileSync(new URL("./tree.ts", import.meta.url), "utf8");
    for (const retiredPath of [
      "TREE_RENDERABLE_MAX_TABS_ITEMS", // composition-hard-cut: allowed-negative
      "TREE_RENDERABLE_MAX_FILTERS",
      "rendersButton",
      "rendersTabsNav",
      "rendersMetricStat",
      "rendersForm",
      "rendersFilterBar",
      "fromMetricStat",
      "isRenderableTabItem",
      "isRenderableFilter",
    ]) {
      expect(treeSource).not.toContain(retiredPath);
    }

    expect(existsSync(new URL("./component-validation.ts", import.meta.url))).toBe(false);
    expect(existsSync(new URL("./component-validation-control.ts", import.meta.url))).toBe(false);
  });
});

// =========================================================================
// DC-004 — sanitizeDataWarehouse hostile input
// =========================================================================

describe("sanitizeDataWarehouse (DC-004 hostile input)", () => {
  it("returns undefined for non-object input and never throws", () => {
    expect(sanitizeDataWarehouse(undefined)).toBeUndefined();
    expect(sanitizeDataWarehouse(null)).toBeUndefined();
    expect(sanitizeDataWarehouse(42)).toBeUndefined();
    expect(sanitizeDataWarehouse("nope")).toBeUndefined();
    expect(sanitizeDataWarehouse([1, 2, 3])).toBeUndefined();
  });

  it("drops datasets whose value is not an array", () => {
    const out = sanitizeDataWarehouse({ sales: 42, ok: [{ a: 1 }] });
    expect(out?.sales).toBeUndefined();
    expect(out?.ok).toEqual([{ a: 1 }]);
  });

  it("drops junk rows [42, null] but keeps valid rows", () => {
    const out = sanitizeDataWarehouse({ sales: [42, null, { a: 1, b: "two" }] });
    expect(out?.sales).toEqual([{ a: 1, b: "two" }]);
  });

  it("drops nested-object and array cells, keeping scalar cells", () => {
    const out = sanitizeDataWarehouse({
      sales: [{ a: 1, nested: { x: 1 }, arr: [1], ok: "yes", flag: true }],
    });
    expect(out?.sales).toEqual([{ a: 1, ok: "yes", flag: true }]);
  });

  it("drops non-finite number cells", () => {
    const out = sanitizeDataWarehouse({ sales: [{ a: Number.NaN, b: Infinity, c: 3 }] });
    expect(out?.sales).toEqual([{ c: 3 }]);
  });

  it("drops forbidden proto keys and fetch-like column keys", () => {
    const out = sanitizeDataWarehouse({
      sales: [{ __proto__: "x", constructor: "y", url: "http://x", fetch: "z", ok: 1 }],
    });
    const row = out?.sales?.[0];
    expect(row).toEqual({ ok: 1 });
    expect(Object.getPrototypeOf(row)).toBeNull();
  });

  it("drops rows that end up empty after cell filtering", () => {
    const out = sanitizeDataWarehouse({ sales: [{ nested: { x: 1 } }, { a: 1 }] });
    expect(out?.sales).toEqual([{ a: 1 }]);
  });

  it("clamps over-cap rows to MAX_TABLE_ROWS", () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 50 }, (_, i) => ({ a: i }));
    const out = sanitizeDataWarehouse({ big: rows });
    expect(out?.big).toHaveLength(MAX_TABLE_ROWS);
  });

  it("drops over-length and non-conforming dataset names", () => {
    const tooLong = "a".repeat(MAX_DATASET_NAME_CHARS + 1);
    const out = sanitizeDataWarehouse({
      [tooLong]: [{ a: 1 }],
      "bad name": [{ a: 1 }],
      __proto__: [{ a: 1 }],
      good: [{ a: 1 }],
    });
    expect(out?.[tooLong]).toBeUndefined();
    expect(out?.["bad name"]).toBeUndefined();
    expect(out?.good).toEqual([{ a: 1 }]);
    expect(Object.getPrototypeOf(out)).toBeNull();
  });

  it("caps the number of datasets at MAX_DATASETS", () => {
    const input: Record<string, unknown> = {};
    for (let i = 0; i < MAX_DATASETS + 10; i++) input[`d${String(i)}`] = [{ a: i }];
    const out = sanitizeDataWarehouse(input);
    expect(Object.keys(out ?? {})).toHaveLength(MAX_DATASETS);
  });

  it("returns undefined when nothing valid remains", () => {
    expect(sanitizeDataWarehouse({ bad: 1, "also bad": "x" })).toBeUndefined();
    expect(sanitizeDataWarehouse({})).toBeUndefined();
  });

  it("DATASET_NAME_RE matches slot-style names only", () => {
    expect(DATASET_NAME_RE.test("sales")).toBe(true);
    expect(DATASET_NAME_RE.test("sales_2024-q1")).toBe(true);
    expect(DATASET_NAME_RE.test("_leading")).toBe(false);
    expect(DATASET_NAME_RE.test("has space")).toBe(false);
    expect(DATASET_NAME_RE.test("")).toBe(false);
  });
});

// =========================================================================
// DC-005 — resolveNodeData precedence + projection
// =========================================================================

describe("resolveNodeData (DC-005 precedence + projection)", () => {
  const warehouse: DataWarehouse = sanitizeDataWarehouse({
    sales: [
      { month: "Jan", revenue: 100, cost: 40 },
      { month: "Feb", revenue: 120, cost: 50 },
    ],
  })!;

  it("from present wins over inline (table)", () => {
    const rows = resolveNodeData(tableNode({ from: "sales" }), warehouse);
    expect(rows).toEqual([
      { month: "Jan", revenue: 100, cost: 40 },
      { month: "Feb", revenue: 120, cost: 50 },
    ]);
  });

  it("from absent returns the node's inline value", () => {
    expect(resolveNodeData(tableNode(), warehouse)).toEqual([{ month: "inline", revenue: 1 }]);
    expect(resolveNodeData(chartNode(), warehouse)).toEqual([{ label: "inline", values: [9] }]);
    expect(resolveNodeData(listNode(), warehouse)).toEqual([{ title: "inline" }]);
    expect(resolveNodeData(keyValueNode(), warehouse)).toEqual([{ label: "inline", value: "x" }]);
    expect(resolveNodeData(textNode(), warehouse)).toBe("inline");
  });

  it("chart projects one series per numeric column, ignoring non-numeric", () => {
    const series = resolveNodeData(chartNode({ from: "sales" }), warehouse);
    expect(series).toEqual([
      { label: "revenue", values: [100, 120] },
      { label: "cost", values: [40, 50] },
    ]);
  });

  it("list projects title/body from the first two string columns", () => {
    const wh = sanitizeDataWarehouse({
      items: [
        { name: "Widget", note: "small", qty: 3 },
        { name: "Gadget", note: "large", qty: 1 },
      ],
    })!;
    const items = resolveNodeData(listNode({ from: "items" }), wh);
    expect(items).toEqual([
      { title: "Widget", body: "small" },
      { title: "Gadget", body: "large" },
    ]);
  });

  it("keyValue projects label/value from the first two columns by order", () => {
    const wh = sanitizeDataWarehouse({
      kv: [
        { k: "CPU", v: 91, extra: "x" },
        { k: "MEM", v: 42, extra: "y" },
      ],
    })!;
    const items = resolveNodeData(keyValueNode({ from: "kv" }), wh);
    expect(items).toEqual([
      { label: "CPU", value: "91" },
      { label: "MEM", value: "42" },
    ]);
  });

  it("dangling/empty from yields the node's empty shape", () => {
    expect(resolveNodeData(tableNode({ from: "nope" }), warehouse)).toEqual([]);
    expect(resolveNodeData(chartNode({ from: "nope" }), warehouse)).toEqual([]);
    expect(resolveNodeData(listNode({ from: "nope" }), warehouse)).toEqual([]);
    expect(resolveNodeData(keyValueNode({ from: "nope" }), warehouse)).toEqual([]);
    expect(resolveNodeData(textNode({ from: "nope", column: "total" }), warehouse)).toBe("");
    expect(resolveNodeData(tableNode({ from: "sales" }), undefined)).toEqual([]);
  });

  it("is TOTAL on an UNSANITIZED warehouse with non-object rows — never throws (fail-safe)", () => {
    // The renderer calls resolveNodeData on unvalidated trees (host initialTree,
    // direct StageRenderer tree={…}, CLI path), so a warehouse whose rows are
    // null/undefined/sparse-holes must not crash any projection. Bypass
    // sanitizeDataWarehouse deliberately to feed the raw shape.
    const raw = { sales: [null, undefined, { month: "Jan", revenue: 5 }] } as unknown as Parameters<
      typeof resolveNodeData
    >[1];
    // A genuine sparse array (index 0 is a hole), built programmatically to avoid
    // a sparse-array literal — for-of yields `undefined` for the hole.
    const sparseRows: unknown[] = [];
    sparseRows[1] = { a: "x", b: "y" };
    const sparse = { sales: sparseRows } as unknown as typeof raw;
    for (const wh of [raw, sparse]) {
      expect(() => resolveNodeData(chartNode({ from: "sales" }), wh)).not.toThrow();
      expect(() => resolveNodeData(listNode({ from: "sales" }), wh)).not.toThrow();
      expect(() => resolveNodeData(keyValueNode({ from: "sales" }), wh)).not.toThrow();
      expect(() =>
        resolveNodeData(textNode({ from: "sales", column: "revenue" }), wh),
      ).not.toThrow();
      expect(() => resolveNodeData(tableNode({ from: "sales" }), wh)).not.toThrow();
    }
    // The valid row still projects; the null/hole rows are simply dropped.
    expect(resolveNodeData(chartNode({ from: "sales" }), raw)).toEqual([
      { label: "revenue", values: [5] },
    ]);
    expect(resolveNodeData(tableNode({ from: "sales" }), raw)).toEqual([
      { month: "Jan", revenue: 5 },
    ]);
  });
});

// =========================================================================
// DC-001 — projection happy path
// =========================================================================

describe("resolveNodeData (DC-001 projection happy path)", () => {
  it("projects one dataset into table rows AND chart series shapes", () => {
    const wh = sanitizeDataWarehouse({
      sales: [
        { quarter: "Q1", revenue: 100, profit: 30 },
        { quarter: "Q2", revenue: 150, profit: 55 },
        { quarter: "Q3", revenue: 130, profit: 40 },
      ],
    })!;

    const rows = resolveNodeData(tableNode({ from: "sales" }), wh);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ quarter: "Q1", revenue: 100, profit: 30 });

    const series = resolveNodeData(chartNode({ from: "sales" }), wh);
    expect(series).toEqual([
      { label: "revenue", values: [100, 150, 130] },
      { label: "profit", values: [30, 55, 40] },
    ]);
  });
});

// =========================================================================
// DC-004 — hostile text selectors (never throws, clamps/empties)
// =========================================================================

describe("resolveNodeData text selectors (DC-004 hostile)", () => {
  const wh: DataWarehouse = sanitizeDataWarehouse({
    values: [
      { total: 100, label: "a" },
      { total: 200, label: "b" },
    ],
  })!;

  it("clamps negative row to 0", () => {
    expect(resolveNodeData(textNode({ from: "values", column: "total", row: -1 }), wh)).toBe("100");
  });

  it("floors a non-integer row", () => {
    expect(resolveNodeData(textNode({ from: "values", column: "total", row: 1.5 }), wh)).toBe(
      "200",
    );
  });

  it("yields empty for NaN / Infinity / out-of-window row", () => {
    expect(
      resolveNodeData(textNode({ from: "values", column: "total", row: Number.NaN }), wh),
    ).toBe("");
    expect(resolveNodeData(textNode({ from: "values", column: "total", row: Infinity }), wh)).toBe(
      "",
    );
    expect(resolveNodeData(textNode({ from: "values", column: "total", row: 1e9 }), wh)).toBe("");
  });

  it("yields empty for missing / forbidden / non-string column, never throws", () => {
    expect(resolveNodeData(textNode({ from: "values" }), wh)).toBe("");
    expect(resolveNodeData(textNode({ from: "values", column: "missing" }), wh)).toBe("");
    expect(resolveNodeData(textNode({ from: "values", column: "__proto__" }), wh)).toBe("");
    expect(
      resolveNodeData(textNode({ from: "values", column: 123 as unknown as string }), wh),
    ).toBe("");
    expect(resolveNodeData(textNode({ from: "values", column: "total" }), undefined)).toBe("");
  });
});

// =========================================================================
// text from — enabler A store-bound text (DC-001, DC-002, DC-008)
// =========================================================================

describe("text from", () => {
  const wh: DataWarehouse = sanitizeDataWarehouse({
    metrics: [
      { total: 100, label: "a" },
      { total: 200, label: "b" },
    ],
  })!;

  it("returns the store cell for a from-bound text (DC-001)", () => {
    expect(resolveNodeData(textNode({ from: "metrics", column: "total" }), wh)).toBe("100");
    expect(resolveNodeData(textNode({ from: "metrics", column: "total", row: 1 }), wh)).toBe("200");
  });

  it("from wins over the inline value (DC-002)", () => {
    expect(
      resolveNodeData(textNode({ value: "inline", from: "metrics", column: "total" }), wh),
    ).toBe("100");
  });

  it("dangling from / absent column / bad row → '', never throws (DC-002)", () => {
    expect(() => resolveNodeData(textNode({ from: "nope", column: "total" }), wh)).not.toThrow();
    expect(resolveNodeData(textNode({ from: "nope", column: "total" }), wh)).toBe("");
    expect(resolveNodeData(textNode({ from: "metrics" }), wh)).toBe("");
    expect(resolveNodeData(textNode({ from: "metrics", column: "missing" }), wh)).toBe("");
    expect(resolveNodeData(textNode({ from: "metrics", column: "__proto__" }), wh)).toBe("");
    expect(resolveNodeData(textNode({ from: "metrics", column: "total", row: 1e9 }), wh)).toBe("");
    expect(resolveNodeData(textNode({ from: "metrics", column: "total" }), undefined)).toBe("");
  });

  it("a plain text with no from returns its inline value, unchanged (DC-008)", () => {
    expect(resolveNodeData(textNode({ value: "hello" }), wh)).toBe("hello");
    expect(resolveNodeData(textNode(), wh)).toBe("inline");
  });
});
