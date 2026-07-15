/**
 * The ONE data-binding module for `@facet/core`. It owns BOTH:
 *
 *  - `sanitizeDataWarehouse` — the hostile-input validator for the per-tree
 *    `data` warehouse (agent-authored declared data, the same trust tier as
 *    inline `rows`). Pure, non-recursive, bounded, forbidden-key-safe; NEVER
 *    throws, drops bad datasets/rows/cells and keeps survivors.
 *  - `resolveNodeData` — the ONE shared precedence-and-projection helper that
 *    BOTH the content gate (`tree.ts`) and every renderer (`@facet/react`) call,
 *    so "shows something" and the actual render can never diverge (RISK-INV-5).
 *
 * Precedence is static: a node that declares a `from` string projects the named
 * warehouse dataset (ignoring inline); a node without `from` returns its inline
 * value. A `from` naming an absent/empty/malformed dataset yields the node
 * type's EMPTY value. Projection is fixed — no DSL or computed columns; the
 * minimal `column`/`row` selector applies only to bound text. `from` is a NAME
 * only: there is no URL/source/resolver/fetch anywhere here.
 */

import {
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  MAX_LIST_ITEMS,
  MAX_TABLE_CELL_CHARS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
} from "./brick-validation-shared.js";
import type {
  ChartNode,
  ChartSeries,
  KeyValueItem,
  KeyValueNode,
  ListItem,
  ListNode,
  TableNode,
  TextNode,
} from "./nodes.js";
import type { DataCell, DataRow, Dataset, DataWarehouse, TableRow } from "./data-types.js";
import {
  FORBIDDEN_DATA_KEYS,
  isForbiddenKey,
  isPlainObject,
  nullMap,
  printableKey,
  type IssueSink,
} from "./issues.js";
import { DATASET_NAME_RE, SLOT_NAME_RE } from "./slot-marker.js";
import { BRICK_REGISTRY } from "./brick-registry.js";

// Public re-export (barrel compat): the regex lives in the leaf `slot-marker`
// module to keep this module's dependency on the brick validators one-way.
export { DATASET_NAME_RE } from "./slot-marker.js";

/** Max distinct datasets kept per tree (mirrors the small brick-array cap). */
export const MAX_DATASETS = 32;

/** Max dataset-name length (mirrors the 64-char slot-name / key-echo bound). */
export const MAX_DATASET_NAME_CHARS = 64;

// =========================================================================
// sanitizeDataWarehouse
// =========================================================================

/**
 * Validate an untrusted `data` value into a `DataWarehouse` (or `undefined` when
 * nothing valid remains). Pure, non-recursive, NEVER throws. `issues` is
 * optional — the WU-2 `validateTree` path passes a sink; standalone callers
 * (and the renderer/content gate) pass none.
 */
export function sanitizeDataWarehouse(
  value: unknown,
  issues?: IssueSink,
): DataWarehouse | undefined {
  if (!isPlainObject(value)) {
    if (value !== undefined) issues?.push("data is not an object; dropped");
    return undefined;
  }

  const out = nullMap<Dataset>();
  let kept = 0;
  for (const name of Object.keys(value)) {
    if (kept >= MAX_DATASETS) {
      issues?.push(`data exceeded the ${String(MAX_DATASETS)}-dataset cap; extra datasets dropped`);
      break;
    }
    if (
      isForbiddenKey(name) ||
      name.length > MAX_DATASET_NAME_CHARS ||
      !DATASET_NAME_RE.test(name)
    ) {
      issues?.push(`dataset "${printableKey(name)}" has an invalid name; dropped`);
      continue;
    }
    const rawDataset = value[name];
    if (!Array.isArray(rawDataset)) {
      issues?.push(`dataset "${printableKey(name)}" is not an array; dropped`);
      continue;
    }
    out[name] = sanitizeDataset(rawDataset, name, issues);
    kept += 1;
  }

  return kept > 0 ? out : undefined;
}

function sanitizeDataset(rawRows: readonly unknown[], name: string, issues?: IssueSink): Dataset {
  const rows: DataRow[] = [];
  let capped = rawRows;
  if (rawRows.length > MAX_TABLE_ROWS) {
    issues?.push(
      `dataset "${printableKey(name)}" exceeded the ${String(MAX_TABLE_ROWS)}-row cap; extra rows dropped`,
    );
    capped = rawRows.slice(0, MAX_TABLE_ROWS);
  }
  for (const rawRow of capped) {
    const row = sanitizeRow(rawRow, name, issues);
    if (row !== undefined) rows.push(row);
  }
  return rows;
}

function sanitizeRow(rawRow: unknown, name: string, issues?: IssueSink): DataRow | undefined {
  if (!isPlainObject(rawRow)) return undefined;
  const row = nullMap<DataCell>();
  let cols = 0;
  for (const key of Object.keys(rawRow)) {
    if (cols >= MAX_TABLE_COLUMNS) {
      issues?.push(
        `dataset "${printableKey(name)}" row exceeded the ${String(MAX_TABLE_COLUMNS)}-column cap; extra columns dropped`,
      );
      break;
    }
    if (isForbiddenKey(key) || FORBIDDEN_DATA_KEYS.has(key) || !SLOT_NAME_RE.test(key)) {
      continue;
    }
    const cell = sanitizeCell(rawRow[key]);
    if (cell === undefined) continue;
    row[key] = cell;
    cols += 1;
  }
  return cols > 0 ? row : undefined;
}

function sanitizeCell(value: unknown): DataCell | undefined {
  if (typeof value === "string") {
    return value.length <= MAX_TABLE_CELL_CHARS ? value : value.slice(0, MAX_TABLE_CELL_CHARS);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  return undefined;
}

// =========================================================================
// resolveNodeData — precedence + Projection Contract
// =========================================================================

export function resolveNodeData(
  node: TableNode,
  warehouse: DataWarehouse | undefined,
): readonly TableRow[];
export function resolveNodeData(
  node: ChartNode,
  warehouse: DataWarehouse | undefined,
): readonly ChartSeries[];
export function resolveNodeData(
  node: ListNode,
  warehouse: DataWarehouse | undefined,
): readonly ListItem[];
export function resolveNodeData(
  node: KeyValueNode,
  warehouse: DataWarehouse | undefined,
): readonly KeyValueItem[];
export function resolveNodeData(node: TextNode, warehouse: DataWarehouse | undefined): string;
export function resolveNodeData(
  node: TableNode | ChartNode | ListNode | KeyValueNode | TextNode,
  warehouse: DataWarehouse | undefined,
):
  | readonly TableRow[]
  | readonly ChartSeries[]
  | readonly ListItem[]
  | readonly KeyValueItem[]
  | string {
  // Registry lookup replaces the former per-type switch: every data-bearing
  // brick declares its `resolve` handler in `brick-registry.ts`. `resolve` is
  // present for exactly the data-bearing types (the exhaustiveness test guards
  // this), and `node` is one of them here.
  return BRICK_REGISTRY[node.type].resolve!(node, warehouse);
}

/**
 * Safe own-property dataset lookup: forbidden names and non-arrays yield
 * `undefined`. Also drops non-object rows (null / undefined / sparse holes) so
 * every projection helper below is TOTAL even on an UNSANITIZED warehouse — the
 * renderer calls `resolveNodeData` on unvalidated trees (host `initialTree`,
 * direct `StageRenderer tree={…}`, the CLI render path) and must never throw
 * (fail-safe invariant). A sanitized warehouse is already object-only, so this
 * returns the same rows; cell values are re-checked at each read site.
 */
function lookupDataset(warehouse: DataWarehouse | undefined, name: string): Dataset | undefined {
  if (warehouse === undefined || isForbiddenKey(name)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(warehouse, name)) return undefined;
  const dataset = warehouse[name];
  if (!Array.isArray(dataset)) return undefined;
  return dataset.filter((row) => isPlainObject(row)) as Dataset;
}

export function resolveTable(
  node: TableNode,
  warehouse: DataWarehouse | undefined,
): readonly TableRow[] {
  if (node.from === undefined) return node.rows;
  return lookupDataset(warehouse, node.from) ?? [];
}

export function resolveChart(
  node: ChartNode,
  warehouse: DataWarehouse | undefined,
): readonly ChartSeries[] {
  if (node.from === undefined) return node.series;
  const dataset = lookupDataset(warehouse, node.from);
  if (dataset === undefined || dataset.length === 0) return [];
  return projectSeries(dataset);
}

export function resolveList(
  node: ListNode,
  warehouse: DataWarehouse | undefined,
): readonly ListItem[] {
  if (node.from === undefined) return node.items;
  const dataset = lookupDataset(warehouse, node.from);
  if (dataset === undefined || dataset.length === 0) return [];
  return projectList(dataset);
}

export function resolveKeyValue(
  node: KeyValueNode,
  warehouse: DataWarehouse | undefined,
): readonly KeyValueItem[] {
  if (node.from === undefined) return node.items;
  const dataset = lookupDataset(warehouse, node.from);
  if (dataset === undefined || dataset.length === 0) return [];
  return projectKeyValue(dataset);
}

export function resolveScalar(node: TextNode, warehouse: DataWarehouse | undefined): string {
  if (node.from === undefined) return node.value;
  const dataset = lookupDataset(warehouse, node.from);
  if (dataset === undefined) return "";
  const { column } = node;
  if (typeof column !== "string" || isForbiddenKey(column)) return "";
  const index = normalizeRowIndex(node.row);
  if (index === undefined) return "";
  const row = dataset[index];
  if (row === undefined) return "";
  const cell = row[column];
  return cell === undefined ? "" : cellToString(cell);
}

/** Column keys across a dataset, in first-seen order. */
function columnOrder(dataset: Dataset): readonly string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const row of dataset) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  return order;
}

/** One series per NUMERIC column (all present cells finite numbers), capped. */
function projectSeries(dataset: Dataset): readonly ChartSeries[] {
  const series: ChartSeries[] = [];
  for (const key of columnOrder(dataset)) {
    if (series.length >= MAX_CHART_SERIES) break;
    const values: number[] = [];
    let numeric = true;
    let hasValue = false;
    for (const row of dataset) {
      const cell = row[key];
      if (cell === undefined) continue;
      hasValue = true;
      if (typeof cell === "number" && Number.isFinite(cell)) {
        if (values.length < MAX_CHART_POINTS) values.push(cell);
      } else {
        numeric = false;
        break;
      }
    }
    if (numeric && hasValue) series.push({ label: key, values });
  }
  return series;
}

/** One item per row: title/body from the first two string-valued columns. */
function projectList(dataset: Dataset): readonly ListItem[] {
  const stringColumns = columnOrder(dataset).filter((key) =>
    dataset.some((row) => typeof row[key] === "string"),
  );
  const titleKey = stringColumns[0];
  if (titleKey === undefined) return [];
  const bodyKey = stringColumns[1];
  const items: ListItem[] = [];
  for (const row of dataset) {
    if (items.length >= MAX_LIST_ITEMS) break;
    const title = row[titleKey];
    if (typeof title !== "string") continue;
    const item: { title: string; body?: string } = { title };
    if (bodyKey !== undefined) {
      const body = row[bodyKey];
      if (typeof body === "string") item.body = body;
    }
    items.push(item);
  }
  return items;
}

/** One `{label, value}` per row from the first two columns; both-empty rows dropped. */
function projectKeyValue(dataset: Dataset): readonly KeyValueItem[] {
  const order = columnOrder(dataset);
  const labelKey = order[0];
  const valueKey = order[1];
  const items: KeyValueItem[] = [];
  for (const row of dataset) {
    if (items.length >= MAX_TABLE_ROWS) break;
    const labelCell = labelKey === undefined ? undefined : row[labelKey];
    const valueCell = valueKey === undefined ? undefined : row[valueKey];
    if (labelCell === undefined && valueCell === undefined) continue;
    items.push({
      label: labelCell === undefined ? "" : cellToString(labelCell),
      value: valueCell === undefined ? "" : cellToString(valueCell),
    });
  }
  return items;
}

/** Normalize a `row` selector to an in-window index, or `undefined` (⇒ empty). */
function normalizeRowIndex(raw: number | undefined): number | undefined {
  if (raw === undefined) return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const index = Math.floor(raw);
  if (index < 0) return 0;
  if (index >= MAX_TABLE_ROWS) return undefined;
  return index;
}

function cellToString(cell: DataCell): string {
  return typeof cell === "string" ? cell : String(cell);
}
