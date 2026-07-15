import { isPlainObject, nullMap, printableKey, printableValue, type IssueSink } from "./issues.js";
import {
  CHART_KINDS,
  TONES,
  type ChartKind,
  type ChartNode,
  type KeyValueItem,
  type KeyValueNode,
  type ListNode,
  type LoadingNode,
  type ProgressNode,
  type TableCell,
  type TableNode,
  type TableRow,
  type Tone,
} from "./nodes.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import { TEXT_ALIGNS } from "./tokens.js";
import {
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  MAX_LIST_ITEMS,
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  MAX_TABLE_CELL_CHARS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  boundedArray,
  boundedString,
  capArray,
  setFrom,
  setText,
  setTone,
  setVariant,
  tokenValue,
} from "./brick-validation-shared.js";

export function validateTable(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): TableNode {
  const columns = tableColumns(raw.columns, id, issues);
  const node: {
    id: string;
    type: "table";
    columns: typeof columns;
    rows: readonly TableRow[];
    caption?: string;
    variant?: string;
    from?: string;
  } = { id, type: "table", columns, rows: tableRows(raw.rows, columns, id, issues) };
  setText(raw.caption, id, "caption", node, "caption", MAX_NODE_LABEL_CHARS, issues);
  setVariant(raw.variant, id, node, issues);
  setFrom(raw, id, node, issues);
  return node;
}

export function validateChart(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): ChartNode {
  const kind = tokenValue<ChartKind>(raw.kind, CHART_KINDS) ?? "bar";
  const node: {
    id: string;
    type: "chart";
    kind: ChartKind;
    series: ReturnType<typeof chartSeries>;
    labels?: readonly string[];
    title?: string;
    variant?: string;
    from?: string;
  } = { id, type: "chart", kind, series: chartSeries(raw.series, id, issues) };
  const labels = stringList(raw.labels, id, "labels", issues);
  if (labels !== undefined) node.labels = labels;
  setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
  setVariant(raw.variant, id, node, issues);
  setFrom(raw, id, node, issues);
  return node;
}

export function validateList(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): ListNode {
  const node: {
    id: string;
    type: "list";
    items: ReturnType<typeof listItems>;
    variant?: string;
    from?: string;
  } = { id, type: "list", items: listItems(raw.items, id, issues) };
  setVariant(raw.variant, id, node, issues);
  setFrom(raw, id, node, issues);
  return node;
}

export function validateKeyValue(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): KeyValueNode {
  const items: KeyValueItem[] = [];
  for (const item of boundedArray(raw.items, id, "items", issues)) {
    if (!isPlainObject(item)) continue;
    const label = boundedString(item.label, id, "item label", MAX_NODE_LABEL_CHARS, issues);
    const value = boundedString(item.value, id, "item value", MAX_NODE_LABEL_CHARS, issues);
    if (label === undefined || value === undefined) continue;
    const next: { key?: string; label: string; value: string; tone?: Tone } = { label, value };
    if (typeof item.key === "string") next.key = item.key;
    const tone = tokenValue<Tone>(item.tone, TONES);
    if (tone !== undefined) next.tone = tone;
    items.push(next);
  }
  const node: {
    id: string;
    type: "keyValue";
    items: readonly KeyValueItem[];
    variant?: string;
    from?: string;
  } = { id, type: "keyValue", items };
  setVariant(raw.variant, id, node, issues);
  setFrom(raw, id, node, issues);
  return node;
}

export function validateProgress(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): ProgressNode {
  const node: {
    id: string;
    type: "progress";
    value: number;
    label?: string;
    tone?: Tone;
    variant?: string;
  } = { id, type: "progress", value: progressValue(raw.value, id, issues) };
  setText(raw.label, id, "label", node, "label", MAX_NODE_LABEL_CHARS, issues);
  setTone(raw.tone, id, node, issues, true);
  setVariant(raw.variant, id, node, issues);
  return node;
}

export function validateLoading(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): LoadingNode {
  const node: { id: string; type: "loading"; label?: string; variant?: string } = {
    id,
    type: "loading",
  };
  setText(raw.label, id, "label", node, "label", MAX_NODE_LABEL_CHARS, issues);
  setVariant(raw.variant, id, node, issues);
  return node;
}

function tableColumns(value: unknown, id: string, issues: IssueSink) {
  if (!Array.isArray(value)) return [];
  const columns: {
    key: string;
    label: string;
    align?: "start" | "center" | "end";
    sortable?: boolean;
  }[] = [];
  for (const raw of capArray(value, MAX_TABLE_COLUMNS, id, "columns", issues)) {
    if (!isPlainObject(raw)) continue;
    const key = typeof raw.key === "string" && SLOT_NAME_RE.test(raw.key) ? raw.key : undefined;
    const label = boundedString(raw.label, id, "column label", MAX_NODE_LABEL_CHARS, issues);
    if (key === undefined || label === undefined) continue;
    const column: {
      key: string;
      label: string;
      align?: "start" | "center" | "end";
      sortable?: boolean;
    } = { key, label };
    const align = tokenValue<"start" | "center" | "end">(raw.align, TEXT_ALIGNS);
    if (align !== undefined) column.align = align;
    if (raw.sortable !== undefined) {
      if (typeof raw.sortable === "boolean") column.sortable = raw.sortable;
      else
        issues.push(
          `node "${printableKey(id)}": non-boolean sortable ${printableValue(raw.sortable)} dropped`,
        );
    }
    columns.push(column);
  }
  return columns;
}

function tableRows(
  value: unknown,
  columns: readonly { key: string }[],
  id: string,
  issues: IssueSink,
) {
  if (!Array.isArray(value) || columns.length === 0) return [];
  const rows: TableRow[] = [];
  for (const raw of capArray(value, MAX_TABLE_ROWS, id, "rows", issues)) {
    if (!isPlainObject(raw)) continue;
    const row = nullMap<TableCell>();
    for (const column of columns) {
      const cell = tableCell(raw[column.key], id, issues);
      if (cell !== undefined) row[column.key] = cell;
    }
    rows.push(row);
  }
  return rows;
}

function tableCell(value: unknown, id: string, issues: IssueSink): TableCell | undefined {
  if (typeof value === "string") {
    if (value.length <= MAX_TABLE_CELL_CHARS) return value;
    issues.push(
      `node "${printableKey(id)}": table cell truncated to ${String(MAX_TABLE_CELL_CHARS)} characters`,
    );
    return value.slice(0, MAX_TABLE_CELL_CHARS);
  }
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "boolean"
      ? value
      : undefined;
}

function chartSeries(value: unknown, id: string, issues: IssueSink) {
  if (!Array.isArray(value)) return [];
  const out: { label: string; values: readonly number[] }[] = [];
  for (const raw of capArray(value, MAX_CHART_SERIES, id, "series", issues)) {
    if (!isPlainObject(raw)) continue;
    const label = boundedString(raw.label, id, "series label", MAX_NODE_LABEL_CHARS, issues);
    if (label === undefined || !Array.isArray(raw.values)) continue;
    const values = capArray(raw.values, MAX_CHART_POINTS, id, "points", issues).filter(
      (point): point is number => typeof point === "number" && Number.isFinite(point),
    );
    out.push({ label, values });
  }
  return out;
}

function stringList(
  value: unknown,
  id: string,
  field: string,
  issues: IssueSink,
): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = capArray(value, MAX_CHART_POINTS, id, field, issues).flatMap((raw) => {
    const text = boundedString(raw, id, field, MAX_NODE_LABEL_CHARS, issues);
    return text === undefined ? [] : [text];
  });
  return kept.length > 0 ? kept : undefined;
}

function listItems(value: unknown, id: string, issues: IssueSink) {
  if (!Array.isArray(value)) return [];
  const items: { title: string; body?: string }[] = [];
  for (const raw of capArray(value, MAX_LIST_ITEMS, id, "items", issues)) {
    if (typeof raw === "string") {
      items.push({ title: raw.slice(0, MAX_NODE_LABEL_CHARS) });
      continue;
    }
    if (!isPlainObject(raw)) continue;
    const title = boundedString(raw.title, id, "item title", MAX_NODE_LABEL_CHARS, issues);
    if (title === undefined) continue;
    const item: { title: string; body?: string } = { title };
    const body = boundedString(raw.body, id, "item body", MAX_NODE_BODY_CHARS, issues);
    if (body !== undefined) item.body = body;
    items.push(item);
  }
  return items;
}

function progressValue(value: unknown, id: string, issues: IssueSink): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const clamped = Math.min(100, Math.max(0, raw));
  if (clamped !== raw) {
    issues.push(`node "${printableKey(id)}": progress value clamped to ${String(clamped)}`);
  }
  return clamped;
}
