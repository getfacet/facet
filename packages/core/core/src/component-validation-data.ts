import { isPlainObject, nullMap, printableKey, printableValue, type IssueSink } from "./issues.js";
import {
  CHART_KINDS,
  TONES,
  type ChartKind,
  type ComponentNode,
  type KeyValueItem,
  type TableCell,
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
  requiredText,
  setColumnRow,
  setFrom,
  setText,
  setTone,
  setVariant,
  tokenValue,
} from "./component-validation-shared.js";

export type DataComponentType = "table" | "chart" | "stat" | "metric" | "keyValue" | "list";

export function sanitizeDataComponentNode(
  id: string,
  raw: Record<string, unknown>,
  type: DataComponentType,
  issues: IssueSink,
): ComponentNode | undefined {
  switch (type) {
    case "table": {
      const columns = tableColumns(raw.columns, id, issues);
      const node: {
        id: string;
        type: "table";
        columns: typeof columns;
        rows: readonly TableRow[];
        caption?: string;
        variant?: string;
        from?: string;
      } = { id, type, columns, rows: tableRows(raw.rows, columns, id, issues) };
      setText(raw.caption, id, "caption", node, "caption", MAX_NODE_LABEL_CHARS, issues);
      setVariant(raw.variant, id, node, issues);
      setFrom(raw, id, node, issues);
      return node;
    }
    case "chart": {
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
      } = { id, type, kind, series: chartSeries(raw.series, id, issues) };
      const labels = stringList(raw.labels, id, "labels", issues);
      if (labels !== undefined) node.labels = labels;
      setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
      setVariant(raw.variant, id, node, issues);
      setFrom(raw, id, node, issues);
      return node;
    }
    case "stat":
      return statNode(id, raw, issues);
    case "metric":
      return metricNode(id, raw, issues);
    case "keyValue": {
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
      } = { id, type, items };
      setVariant(raw.variant, id, node, issues);
      setFrom(raw, id, node, issues);
      return node;
    }
    case "list": {
      const node: {
        id: string;
        type: "list";
        items: ReturnType<typeof listItems>;
        variant?: string;
        from?: string;
      } = { id, type, items: listItems(raw.items, id, issues) };
      setVariant(raw.variant, id, node, issues);
      setFrom(raw, id, node, issues);
      return node;
    }
  }
}

function statNode(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): ComponentNode | undefined {
  const label = boundedString(raw.label, id, "label", MAX_NODE_LABEL_CHARS, issues);
  const value = boundedString(raw.value, id, "value", MAX_NODE_LABEL_CHARS, issues);
  if (label === undefined || value === undefined) {
    issues.push(`node "${printableKey(id)}": stat needs string label and value`);
    return undefined;
  }
  const node: {
    id: string;
    type: "stat";
    label: string;
    value: string;
    delta?: string;
    tone?: Tone;
    variant?: string;
    from?: string;
    column?: string;
    row?: number;
  } = { id, type: "stat", label, value };
  setText(raw.delta, id, "delta", node, "delta", MAX_NODE_LABEL_CHARS, issues);
  setTone(raw.tone, id, node, issues, true);
  setVariant(raw.variant, id, node, issues);
  setFrom(raw, id, node, issues);
  setColumnRow(raw, node);
  return node;
}

function metricNode(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): ComponentNode | undefined {
  const label = requiredText(raw.label, id, "label", issues);
  const value = requiredText(raw.value, id, "value", issues);
  if (label === undefined || value === undefined) return undefined;
  const node: {
    id: string;
    type: "metric";
    label: string;
    value: string;
    delta?: string;
    tone?: Tone;
    variant?: string;
    from?: string;
    column?: string;
    row?: number;
  } = { id, type: "metric", label, value };
  setText(raw.delta, id, "delta", node, "delta", MAX_NODE_LABEL_CHARS, issues);
  setVariant(raw.variant, id, node, issues);
  setTone(raw.tone, id, node, issues, false);
  setFrom(raw, id, node, issues);
  setColumnRow(raw, node);
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
