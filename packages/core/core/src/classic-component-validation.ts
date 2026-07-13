import {
  isForbiddenKey,
  isPlainObject,
  nullMap,
  printableKey,
  printableValue,
  type IssueSink,
} from "./issues.js";
import {
  CHART_KINDS,
  TONES,
  type ChartKind,
  type ComponentNode,
  type FacetAction,
  type TableCell,
  type TableRow,
  type Tone,
} from "./nodes.js";
import { DATASET_NAME_RE, SLOT_NAME_RE } from "./slot-marker.js";
import { TEXT_ALIGNS } from "./tokens.js";

export const MAX_NODE_LABEL_CHARS = 200;
export const MAX_NODE_BODY_CHARS = 1000;
export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_CELL_CHARS = 200;
export const MAX_CHART_SERIES = 8;
export const MAX_CHART_POINTS = 200;
export const MAX_LIST_ITEMS = 50;
export const MAX_TABS_ITEMS = 12;

export function sanitizeClassicComponentNode(
  id: string,
  raw: Record<string, unknown>,
  type: string,
  issues: IssueSink,
): ComponentNode | undefined {
  const key = printableKey(id);
  switch (type) {
    case "button": {
      const label = boundedString(raw.label, id, "label", MAX_NODE_LABEL_CHARS, issues);
      if (label === undefined) {
        issues.push(`node "${key}": button has no string label`);
        return undefined;
      }
      const node: {
        id: string;
        type: "button";
        label: string;
        variant?: string;
        tone?: Tone;
        disabled?: boolean;
        onPress?: FacetAction;
        onHold?: FacetAction;
      } = { id, type: "button", label };
      setVariantToneActions(raw, id, node, issues);
      if (typeof raw.disabled === "boolean") node.disabled = raw.disabled;
      return node;
    }
    case "section": {
      const node: {
        id: string;
        type: "section";
        title?: string;
        eyebrow?: string;
        body?: string;
        variant?: string;
        children: string[];
      } = { id, type: "section", children: childRefs(raw.children) };
      setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
      setText(raw.eyebrow, id, "eyebrow", node, "eyebrow", MAX_NODE_LABEL_CHARS, issues);
      setText(raw.body, id, "body", node, "body", MAX_NODE_BODY_CHARS, issues);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    case "card": {
      const node: {
        id: string;
        type: "card";
        title?: string;
        body?: string;
        variant?: string;
        tone?: Tone;
        onPress?: FacetAction;
        onHold?: FacetAction;
        children: string[];
      } = { id, type: "card", children: childRefs(raw.children) };
      setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
      setText(raw.body, id, "body", node, "body", MAX_NODE_BODY_CHARS, issues);
      setVariantToneActions(raw, id, node, issues);
      return node;
    }
    case "tabs": {
      const items: { label: string; to: string }[] = [];
      if (Array.isArray(raw.items)) {
        for (const item of capArray(raw.items, MAX_TABS_ITEMS, id, "items", issues)) {
          if (!isPlainObject(item)) continue;
          const label = boundedString(item.label, id, "tab label", MAX_NODE_LABEL_CHARS, issues);
          if (label !== undefined && typeof item.to === "string")
            items.push({ label, to: item.to });
        }
      }
      const node: { id: string; type: "tabs"; items: typeof items; variant?: string } = {
        id,
        type: "tabs",
        items,
      };
      setVariant(raw.variant, id, node, issues);
      return node;
    }
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
      } = { id, type: "table", columns, rows: tableRows(raw.rows, columns, id, issues) };
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
      } = { id, type: "chart", kind, series: chartSeries(raw.series, id, issues) };
      const labels = stringList(raw.labels, id, "labels", issues);
      if (labels !== undefined) node.labels = labels;
      setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
      setVariant(raw.variant, id, node, issues);
      setFrom(raw, id, node, issues);
      return node;
    }
    case "stat":
      return metricNode(id, raw, issues);
    case "badge": {
      const label = boundedString(raw.label, id, "label", MAX_NODE_LABEL_CHARS, issues);
      if (label === undefined) {
        issues.push(`node "${key}": badge has no string label`);
        return undefined;
      }
      const node: { id: string; type: "badge"; label: string; tone?: Tone; variant?: string } = {
        id,
        type: "badge",
        label,
      };
      setTone(raw.tone, id, node, issues);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    case "progress": {
      const node: {
        id: string;
        type: "progress";
        value: number;
        label?: string;
        tone?: Tone;
        variant?: string;
      } = { id, type: "progress", value: progressValue(raw.value, id, issues) };
      setText(raw.label, id, "label", node, "label", MAX_NODE_LABEL_CHARS, issues);
      setTone(raw.tone, id, node, issues);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    case "alert": {
      const body = boundedString(raw.body, id, "body", MAX_NODE_BODY_CHARS, issues);
      if (body === undefined) {
        issues.push(`node "${key}": alert has no string body`);
        return undefined;
      }
      const node: {
        id: string;
        type: "alert";
        body: string;
        title?: string;
        tone?: Tone;
        variant?: string;
      } = { id, type: "alert", body };
      setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
      setTone(raw.tone, id, node, issues);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    case "list": {
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
    case "divider": {
      const node: { id: string; type: "divider"; label?: string; variant?: string } = {
        id,
        type: "divider",
      };
      setText(raw.label, id, "label", node, "label", MAX_NODE_LABEL_CHARS, issues);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    default:
      return undefined;
  }
}

function metricNode(
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
  setTone(raw.tone, id, node, issues);
  setVariant(raw.variant, id, node, issues);
  setFrom(raw, id, node, issues);
  setColumnRow(raw, node);
  return node;
}

function boundedString(
  value: unknown,
  id: string,
  field: string,
  max: number,
  issues: IssueSink,
): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length <= max) return value;
  issues.push(`node "${printableKey(id)}": ${field} truncated to ${String(max)} characters`);
  return value.slice(0, max);
}

function setText<T extends string>(
  value: unknown,
  id: string,
  label: string,
  node: Partial<Record<T, string>>,
  key: T,
  max: number,
  issues: IssueSink,
): void {
  const text = boundedString(value, id, label, max, issues);
  if (text !== undefined) node[key] = text;
}

function setVariant(
  value: unknown,
  id: string,
  node: { variant?: string },
  issues: IssueSink,
): void {
  if (value === undefined) return;
  if (typeof value === "string" && SLOT_NAME_RE.test(value)) node.variant = value;
  else issues.push(`node "${printableKey(id)}": malformed variant dropped`);
}

function setVariantTone(
  raw: Record<string, unknown>,
  id: string,
  node: { variant?: string; tone?: Tone },
  issues: IssueSink,
): void {
  setVariant(raw.variant, id, node, issues);
  setTone(raw.tone, id, node, issues);
}

function setTone(value: unknown, id: string, node: { tone?: Tone }, issues: IssueSink): void {
  if (value === undefined) return;
  const tone = tokenValue<Tone>(value, TONES);
  if (tone !== undefined) node.tone = tone;
  else issues.push(`node "${printableKey(id)}": unknown tone ${printableValue(value)} dropped`);
}

function setVariantToneActions(
  raw: Record<string, unknown>,
  id: string,
  node: { variant?: string; tone?: Tone; onPress?: FacetAction; onHold?: FacetAction },
  issues: IssueSink,
): void {
  setVariantTone(raw, id, node, issues);
  const onPress = actionValue(raw.onPress, id, "onPress", issues);
  if (onPress !== undefined) node.onPress = onPress;
  const onHold = actionValue(raw.onHold, id, "onHold", issues);
  if (onHold !== undefined) node.onHold = onHold;
}

function childRefs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((child): child is string => typeof child === "string")
    : [];
}

/**
 * Copy a validated `from` dataset-NAME binding onto a data-bearing node. `from`
 * is a bounded NAME only (`DATASET_NAME_RE`) — never a URL/source/resolver
 * (RISK-INV-2). A present-but-malformed `from` is dropped WITH an issue; the node
 * stays and simply falls back to its inline value. Shared by the classic
 * (table/chart/list/stat) and component (metric/keyValue) sanitizers so the one
 * name rule can never drift between the two per-node paths.
 */
export function setFrom(
  raw: Record<string, unknown>,
  id: string,
  node: { from?: string },
  issues: IssueSink,
): void {
  if (raw.from === undefined) return;
  if (typeof raw.from === "string" && DATASET_NAME_RE.test(raw.from)) {
    node.from = raw.from;
    return;
  }
  issues.push(`node "${printableKey(id)}": malformed from dropped`);
}

/**
 * Copy the closed metric/stat cell selector used ONLY with `from`: `column` (a
 * bounded slot-name naming the dataset column that supplies the value) and `row`
 * (a finite non-negative integer index, default 0 at resolve time). Non-conforming
 * values are dropped — the node then resolves an empty value rather than throwing.
 * These are the only fields beyond `from`; neither is an expression/DSL.
 */
export function setColumnRow(
  raw: Record<string, unknown>,
  node: { column?: string; row?: number },
): void {
  if (
    typeof raw.column === "string" &&
    !isForbiddenKey(raw.column) &&
    SLOT_NAME_RE.test(raw.column)
  ) {
    node.column = raw.column;
  }
  if (typeof raw.row === "number" && Number.isInteger(raw.row) && raw.row >= 0) {
    node.row = raw.row;
  }
}

function capArray<T>(
  values: readonly T[],
  max: number,
  id: string,
  field: string,
  issues: IssueSink,
): readonly T[] {
  if (values.length <= max) return values;
  issues.push(
    `node "${printableKey(id)}": ${field} exceeded the ${String(max)}-item cap; extra items dropped`,
  );
  return values.slice(0, max);
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
    } = {
      key,
      label,
    };
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

function stringList(value: unknown, id: string, field: string, issues: IssueSink) {
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

function actionValue(
  value: unknown,
  id: string,
  field: "onPress" | "onHold",
  issues: IssueSink,
): FacetAction | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    issues.push(`node "${printableKey(id)}": ${field} is not an action object`);
    return undefined;
  }
  if (value.kind === undefined || value.kind === "agent") {
    if (typeof value.name !== "string") {
      issues.push(`node "${printableKey(id)}": ${field} agent action has no string name`);
      return undefined;
    }
    const action: {
      kind: "agent";
      name: string;
      payload?: Record<string, string | number | boolean>;
      collect?: string;
    } = {
      kind: "agent",
      name: value.name,
    };
    const payload = primitiveRecord(value.payload);
    if (payload !== undefined) action.payload = payload;
    if (typeof value.collect === "string") action.collect = value.collect;
    else if (value.collect !== undefined) {
      issues.push(`node "${printableKey(id)}": ${field} collect is not a string; dropped`);
    }
    return action;
  }
  if (value.kind === "navigate" && typeof value.to === "string")
    return { kind: "navigate", to: value.to };
  if (value.kind === "toggle" && typeof value.target === "string")
    return { kind: "toggle", target: value.target };
  if (value.kind === "navigate") {
    issues.push(`node "${printableKey(id)}": ${field} navigate action needs a string "to"`);
  } else if (value.kind === "toggle") {
    issues.push(`node "${printableKey(id)}": ${field} toggle action needs a string "target"`);
  } else {
    issues.push(
      `node "${printableKey(id)}": unknown ${field} kind ${printableValue(value.kind)} dropped`,
    );
  }
  return undefined;
}

function primitiveRecord(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      out[key] = item;
  }
  return out;
}

function tokenValue<T extends string>(value: unknown, allowed: readonly string[]): T | undefined {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : undefined;
}
