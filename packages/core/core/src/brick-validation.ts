import { isPlainObject, nullMap, printableKey, printableValue, type IssueSink } from "./issues.js";
import {
  CHART_KINDS,
  type ChartStyle,
  type ChartKind,
  type ChartNode,
  type KeyValueItem,
  type KeyValueNode,
  type KeyValueStyle,
  type ListNode,
  type ListStyle,
  type LoadingNode,
  type LoadingStyle,
  type ProgressNode,
  type ProgressStyle,
  type TableCell,
  type TableNode,
  type TableRow,
  type TableStyle,
} from "./nodes.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import {
  CHART_AXES,
  COLUMN_WIDTHS,
  LINE_STYLES,
  TEXT_ALIGNS,
  type ChartAxis,
  type ColumnWidth,
  type LineStyle,
  type TextAlign,
} from "./tokens.js";
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
  tokenValue,
} from "./brick-validation-shared.js";
import { sanitizeBrickStyle } from "./style-validation.js";

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
    emptyLabel?: string;
    from?: string;
    style?: TableStyle;
  } = { id, type: "table", columns, rows: tableRows(raw.rows, columns, id, issues) };
  setText(raw.caption, id, "caption", node, "caption", MAX_NODE_LABEL_CHARS, issues);
  setText(raw.emptyLabel, id, "emptyLabel", node, "emptyLabel", MAX_NODE_LABEL_CHARS, issues);
  setFrom(raw, id, node, issues);
  const style = sanitizeBrickStyle("table", raw.style, { nodeId: id, issues });
  if (style !== undefined) node.style = style;
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
    from?: string;
    style?: ChartStyle;
  } = { id, type: "chart", kind, series: chartSeries(raw.series, id, issues) };
  const labels = stringList(raw.labels, id, "labels", issues);
  if (labels !== undefined) node.labels = labels;
  setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
  setFrom(raw, id, node, issues);
  const style = sanitizeBrickStyle("chart", raw.style, { nodeId: id, issues });
  if (style !== undefined) node.style = style;
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
    from?: string;
    style?: ListStyle;
  } = { id, type: "list", items: listItems(raw.items, id, issues) };
  setFrom(raw, id, node, issues);
  const style = sanitizeBrickStyle("list", raw.style, { nodeId: id, issues });
  if (style !== undefined) node.style = style;
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
    const next: { key?: string; label: string; value: string } = { label, value };
    if (typeof item.key === "string") next.key = item.key;
    items.push(next);
  }
  const node: {
    id: string;
    type: "keyValue";
    items: readonly KeyValueItem[];
    from?: string;
    style?: KeyValueStyle;
  } = { id, type: "keyValue", items };
  setFrom(raw, id, node, issues);
  const style = sanitizeBrickStyle("keyValue", raw.style, { nodeId: id, issues });
  if (style !== undefined) node.style = style;
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
    style?: ProgressStyle;
  } = { id, type: "progress", value: progressValue(raw.value, id, issues) };
  setText(raw.label, id, "label", node, "label", MAX_NODE_LABEL_CHARS, issues);
  const style = sanitizeBrickStyle("progress", raw.style, { nodeId: id, issues });
  if (style !== undefined) node.style = style;
  return node;
}

export function validateLoading(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): LoadingNode {
  const node: { id: string; type: "loading"; label?: string; style?: LoadingStyle } = {
    id,
    type: "loading",
  };
  setText(raw.label, id, "label", node, "label", MAX_NODE_LABEL_CHARS, issues);
  const style = sanitizeBrickStyle("loading", raw.style, { nodeId: id, issues });
  if (style !== undefined) node.style = style;
  return node;
}

function tableColumns(value: unknown, id: string, issues: IssueSink) {
  if (!Array.isArray(value)) return [];
  const columns: {
    key: string;
    label: string;
    align?: TextAlign;
    width?: ColumnWidth;
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
      align?: TextAlign;
      width?: ColumnWidth;
      sortable?: boolean;
    } = { key, label };
    if (raw.align !== undefined) {
      const align = tokenValue<TextAlign>(raw.align, TEXT_ALIGNS);
      if (align !== undefined) column.align = align;
      else
        issues.push(
          `node "${printableKey(id)}": invalid table column align ${printableValue(raw.align)} dropped`,
        );
    }
    if (raw.width !== undefined) {
      const width = tokenValue<ColumnWidth>(raw.width, COLUMN_WIDTHS);
      if (width !== undefined) column.width = width;
      else
        issues.push(
          `node "${printableKey(id)}": invalid table column width ${printableValue(raw.width)} dropped`,
        );
    }
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
  const out: {
    label: string;
    values: readonly number[];
    lineStyle?: LineStyle;
    axis?: ChartAxis;
  }[] = [];
  for (const raw of capArray(value, MAX_CHART_SERIES, id, "series", issues)) {
    if (!isPlainObject(raw)) continue;
    const label = boundedString(raw.label, id, "series label", MAX_NODE_LABEL_CHARS, issues);
    if (label === undefined || !Array.isArray(raw.values)) continue;
    const values = capArray(raw.values, MAX_CHART_POINTS, id, "points", issues).filter(
      (point): point is number => typeof point === "number" && Number.isFinite(point),
    );
    const series: {
      label: string;
      values: readonly number[];
      lineStyle?: LineStyle;
      axis?: ChartAxis;
    } = {
      label,
      values,
    };
    if (raw.lineStyle !== undefined) {
      const lineStyle = tokenValue<LineStyle>(raw.lineStyle, LINE_STYLES);
      if (lineStyle !== undefined) series.lineStyle = lineStyle;
      else
        issues.push(
          `node "${printableKey(id)}": invalid chart lineStyle ${printableValue(raw.lineStyle)} dropped`,
        );
    }
    if (raw.axis !== undefined) {
      const axis = tokenValue<ChartAxis>(raw.axis, CHART_AXES);
      if (axis !== undefined) series.axis = axis;
      else
        issues.push(
          `node "${printableKey(id)}": invalid chart axis ${printableValue(raw.axis)} dropped`,
        );
    }
    out.push(series);
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
