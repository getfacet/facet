import type { SortDirection, TableColumn, TableRow } from "@facet/core";
import { safeOwnValue } from "./renderer-safe.js";

/**
 * Renderer-owned local table sort — a pure, closed, TOTAL, STABLE reorder of an
 * already-resolved+capped row set. Facet ships the sort MECHANISM only (this
 * comparator + `applySort`); the agent authors no sort logic — it opts a column
 * in with `sortable: true` and reads the resulting direction back off the `view`
 * snapshot. Nothing here reads `context`/the tree or mutates its input, so the
 * server stays the sole writer of `data`/`rows` (two-writers coherence).
 *
 * Closed cross-type rank so the order is TOTAL and the comparator NEVER throws:
 *
 *   numeric (finite) < string < boolean < empty
 *
 * where "empty" absorbs `undefined`, absent cells, `null`, `NaN`, non-finite
 * numbers, and any non-scalar value a hostile/mistyped tree might slip through.
 * Within a rank: numbers compare numerically, strings by code-unit order,
 * `false` before `true`; two empties tie. Ties are broken by ORIGINAL row index
 * so the sort is stable in BOTH directions (the index tie-break is never
 * negated — see `applySort`).
 */

const RANK_NUMBER = 0;
const RANK_STRING = 1;
const RANK_BOOLEAN = 2;
const RANK_EMPTY = 3;

function cellRank(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return RANK_NUMBER;
  if (typeof value === "string") return RANK_STRING;
  if (typeof value === "boolean") return RANK_BOOLEAN;
  return RANK_EMPTY;
}

/**
 * Total order over cell values: returns a negative number, `0`, or a positive
 * number. Deterministic and never-throwing for every pair — including mixed
 * types and non-scalar/hostile values (all funnel into the empty rank).
 */
export function compareCells(a: unknown, b: unknown): number {
  const rankA = cellRank(a);
  const rankB = cellRank(b);
  if (rankA !== rankB) return rankA - rankB;
  switch (rankA) {
    case RANK_NUMBER: {
      const na = a as number;
      const nb = b as number;
      return na < nb ? -1 : na > nb ? 1 : 0;
    }
    case RANK_STRING: {
      const sa = a as string;
      const sb = b as string;
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    }
    case RANK_BOOLEAN: {
      const ba = a === true ? 1 : 0;
      const bb = b === true ? 1 : 0;
      return ba - bb;
    }
    default:
      return 0; // both empty
  }
}

/**
 * Pure, guarded reorder. Returns the rows in NATURAL order (the SAME reference)
 * when the sort does not apply: `spec` undefined, its column absent from
 * `columns`, that column not `sortable: true`, or a malformed spec. Otherwise
 * returns a NEW array sorted by the named column's cell value (stable,
 * asc/desc). Never mutates `rows`; never throws.
 */
export function applySort(
  rows: readonly TableRow[],
  spec: { column: string; direction: SortDirection } | undefined,
  columns: readonly TableColumn[],
): readonly TableRow[] {
  if (spec === undefined) return rows;
  const { column, direction } = spec;
  if (typeof column !== "string") return rows;
  if (direction !== "asc" && direction !== "desc") return rows;
  const target = columns.find((c) => c.key === column);
  if (target === undefined || target.sortable !== true) return rows;

  const descending = direction === "desc";
  const decorated = rows.map((row, index) => ({ row, index }));
  decorated.sort((a, b) => {
    // Read cells through the same own-property guard the cell renderer uses
    // (safeOwnValue) so the sort key matches the DISPLAYED value and a throwing
    // getter/Proxy row can never unwind the render — the never-throws guarantee.
    const ordered = compareCells(safeOwnValue(a.row, column), safeOwnValue(b.row, column));
    const signed = descending ? -ordered : ordered;
    // Tie-break by ORIGINAL index (never negated) so ties keep source order in
    // both directions — the stability guarantee.
    return signed !== 0 ? signed : a.index - b.index;
  });
  return decorated.map((entry) => entry.row);
}
