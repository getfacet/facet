import type { TextAlign } from "./tokens.js";

export interface TableColumn {
  readonly key: string;
  readonly label: string;
  readonly align?: TextAlign;
  readonly sortable?: boolean;
}

export type TableCell = string | number | boolean;
export type TableRow = Readonly<Record<string, TableCell>>;

/**
 * The per-tree data warehouse (`FacetTree.data`). A closed, declarative section
 * of agent-authored data — the same trust tier as inline `rows`, just relocated
 * to a named section so many nodes can bind to one source (`node.from`). A
 * `DataCell` is a scalar only (no nested objects/arrays); a `DataRow` is a flat
 * scalar record; a `Dataset` is an array of rows; a `DataWarehouse` maps a
 * bounded dataset NAME to a dataset. There is no URL/source/resolver — `from` is
 * only a name (see `sanitizeDataWarehouse`/`resolveNodeData` in `data-binding.ts`).
 */
export type DataCell = string | number | boolean;
export type DataRow = Readonly<Record<string, DataCell>>;
export type Dataset = readonly DataRow[];
export type DataWarehouse = Readonly<Record<string, Dataset>>;
