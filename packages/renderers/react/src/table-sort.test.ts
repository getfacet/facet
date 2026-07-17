import { describe, expect, it } from "vitest";
import type { SortDirection, TableColumn, TableRow } from "@facet/core";
import { compareCells, applySort } from "./table-sort.js";

// A representative cell value from each rank plus the empty/absent forms. The
// comparator must place EVERY pair deterministically without throwing (DC-004).
const SAMPLES: readonly unknown[] = [
  2,
  -5,
  3.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "apple",
  "banana",
  "",
  true,
  false,
  undefined,
  null,
];

const columns: readonly TableColumn[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "age", label: "Age", sortable: true },
  { key: "city", label: "City" }, // present but NOT sortable
];

const rows: readonly TableRow[] = [
  { name: "Carol", age: 30, city: "A" },
  { name: "Alice", age: 25, city: "B" },
  { name: "Bob", age: 25, city: "C" },
];

describe("compareCells (total, closed, never throws)", () => {
  it("is antisymmetric and total over every cross-type pair", () => {
    for (const a of SAMPLES) {
      for (const b of SAMPLES) {
        const ab = compareCells(a, b);
        const ba = compareCells(b, a);
        expect([-1, 0, 1]).toContain(Math.sign(ab));
        // Antisymmetry: sign(compare(a,b)) === -sign(compare(b,a)). The `+ 0`
        // normalizes -0 → 0 so `toBe` (Object.is) does not split them.
        expect(Math.sign(ab)).toBe(-Math.sign(ba) + 0);
      }
      // Reflexive: a value compares equal to itself.
      expect(compareCells(a, a)).toBe(0);
    }
  });

  it("orders cross-type by the closed rank numeric < string < boolean < empty", () => {
    expect(Math.sign(compareCells(1, "a"))).toBe(-1); // number < string
    expect(Math.sign(compareCells("a", true))).toBe(-1); // string < boolean
    expect(Math.sign(compareCells(true, undefined))).toBe(-1); // boolean < empty
    expect(Math.sign(compareCells(undefined, 1))).toBe(1); // empty > number
    // Non-finite numbers and null fall into the empty rank (kept total).
    expect(compareCells(Number.NaN, undefined)).toBe(0);
    expect(compareCells(null, undefined)).toBe(0);
    expect(Math.sign(compareCells(Number.NaN, 1))).toBe(1);
  });

  it("orders within a rank deterministically", () => {
    expect(Math.sign(compareCells(1, 2))).toBe(-1);
    expect(Math.sign(compareCells(2, 1))).toBe(1);
    expect(Math.sign(compareCells("apple", "banana"))).toBe(-1);
    expect(compareCells(false, true)).toBe(-1);
    expect(compareCells(true, false)).toBe(1);
    expect(compareCells("x", "x")).toBe(0);
  });

  it("never throws on hostile / non-scalar cell values", () => {
    const hostile: readonly unknown[] = [{}, [], () => 0, Symbol("s"), 10n];
    for (const a of hostile) {
      for (const b of [...hostile, 1, "s", true, undefined]) {
        expect(() => compareCells(a, b)).not.toThrow();
      }
    }
  });
});

describe("applySort (pure, guarded)", () => {
  it("returns the SAME reference (natural order) for an undefined spec", () => {
    expect(applySort(rows, undefined, columns)).toBe(rows);
  });

  it("returns natural order for a non-sortable column", () => {
    expect(applySort(rows, { column: "city", direction: "asc" }, columns)).toBe(rows);
  });

  it("returns natural order for a column absent from the schema", () => {
    expect(applySort(rows, { column: "nope", direction: "asc" }, columns)).toBe(rows);
  });

  it("returns natural order for a malformed spec (bad direction)", () => {
    const malformed = { column: "age", direction: "sideways" as SortDirection };
    expect(applySort(rows, malformed, columns)).toBe(rows);
  });

  it("sorts ascending, stably, without mutating the input", () => {
    const out = applySort(rows, { column: "age", direction: "asc" }, columns);
    expect(out).not.toBe(rows);
    // 25s (Alice idx1, Bob idx2) keep original order ahead of Carol (30).
    expect(out.map((r) => r["name"])).toEqual(["Alice", "Bob", "Carol"]);
    // Input untouched.
    expect(rows.map((r) => r["name"])).toEqual(["Carol", "Alice", "Bob"]);
  });

  it("sorts descending while keeping ties in original order (stable)", () => {
    const out = applySort(rows, { column: "age", direction: "desc" }, columns);
    // Carol (30) first; the two 25s stay in original order Alice, Bob.
    expect(out.map((r) => r["name"])).toEqual(["Carol", "Alice", "Bob"]);
  });

  it("keeps local sorting independent from style-shaped row data", () => {
    const styledRows: readonly TableRow[] = [
      { score: 20, style: { color: "danger" }, status: "warning" },
      { score: 5, style: { color: "success" }, status: "success" },
    ] as unknown as readonly TableRow[];
    const styledColumns: readonly TableColumn[] = [
      { key: "score", label: "Score", sortable: true },
    ];

    const out = applySort(styledRows, { column: "score", direction: "asc" }, styledColumns);

    expect(out.map((row) => row["score"])).toEqual([5, 20]);
    expect(styledRows.map((row) => row["score"])).toEqual([20, 5]);
  });

  it("sorts a mixed-type column via the total comparator without throwing", () => {
    const mixed = [
      { v: 3 },
      { v: "x" },
      { v: true },
      { v: undefined },
      {}, // absent cell
    ] as unknown as readonly TableRow[];
    const cols: readonly TableColumn[] = [{ key: "v", label: "V", sortable: true }];
    let out: readonly TableRow[] = mixed;
    expect(() => {
      out = applySort(mixed, { column: "v", direction: "asc" }, cols);
    }).not.toThrow();
    // number < string < boolean < empty; the two empties keep original order.
    expect(out.map((r) => r["v"])).toEqual([3, "x", true, undefined, undefined]);
  });

  it("handles an empty rows array without throwing", () => {
    const cols: readonly TableColumn[] = [{ key: "v", label: "V", sortable: true }];
    expect(applySort([], { column: "v", direction: "asc" }, cols)).toEqual([]);
  });

  it("never throws when a row's sorted cell is a throwing getter (fail-safe)", () => {
    // An in-process tree (agent SDK/CLI/tests) can slip a row whose sorted-column
    // property is a getter that throws — it must never unwind the render. The
    // comparator reads the throwing cell through safeOwnValue, so it degrades to
    // the empty rank (sorted last) instead of propagating the throw.
    const boom = {
      get v(): unknown {
        throw new Error("boom");
      },
    } as unknown as TableRow;
    const rowA = { v: 2 } as unknown as TableRow;
    const rowB = { v: 1 } as unknown as TableRow;
    const rows2: readonly TableRow[] = [rowA, boom, rowB];
    const cols: readonly TableColumn[] = [{ key: "v", label: "V", sortable: true }];
    let out: readonly TableRow[] = rows2;
    expect(() => {
      out = applySort(rows2, { column: "v", direction: "asc" }, cols);
    }).not.toThrow();
    // Finite numbers (rowB=1, rowA=2) rank ahead of the throwing (empty-rank) row,
    // which sorts last. Compare object identity — reading boom.v would re-throw.
    expect(out).toEqual([rowB, rowA, boom]);
  });
});
