import { isPlainObject, printableKey, printableValue, type IssueSink } from "./issues.js";
import {
  CHART_KINDS,
  COMPONENT_NODE_TYPES,
  FIELD_INPUTS,
  INTRINSIC_COMPONENT_TYPES,
  PRIMITIVE_BRICK_TYPES,
  TONES,
  type ChartKind,
  type ComponentNode,
  type ComponentNodeType,
  type FacetAction,
  type FieldInput,
  type FilterBarFilter,
  type IntrinsicComponentType,
  type KeyValueItem,
  type ListItem,
  type NavItem,
  type PrimitiveBrickType,
  type TableCell,
  type TableColumn,
  type TableRow,
  type TabItem,
  type Tone,
} from "./nodes.js";

export const MAX_COMPONENT_ARRAY_ITEMS = 32;

const MAX_COMPONENT_LABEL_CHARS = 200;
const MAX_COMPONENT_BODY_CHARS = 1_000;
const MAX_COMPONENT_OPTIONS = 32;
const VARIANT_RE = /^[A-Za-z0-9_-]{1,64}$/;

const FORBIDDEN_COMPONENT_FIELDS = [
  "html",
  "rawHtml",
  "innerHTML",
  "script",
  "javascript",
  "js",
  "css",
  "fetch",
  "fetchUrl",
  "endpoint",
  "url",
  "dataSource",
  "query",
  "queryExpr",
  "expression",
  "resolver",
] as const;

export function isPrimitiveBrickType(value: unknown): value is PrimitiveBrickType {
  return typeof value === "string" && (PRIMITIVE_BRICK_TYPES as readonly string[]).includes(value);
}

export function isIntrinsicComponentType(value: unknown): value is IntrinsicComponentType {
  return (
    typeof value === "string" && (INTRINSIC_COMPONENT_TYPES as readonly string[]).includes(value)
  );
}

export function isComponentNodeType(value: unknown): value is ComponentNodeType {
  return typeof value === "string" && (COMPONENT_NODE_TYPES as readonly string[]).includes(value);
}

export function canonicalComponentType(value: unknown): IntrinsicComponentType | undefined {
  if (value === "stat") return "metric";
  return isIntrinsicComponentType(value) ? value : undefined;
}

export function sanitizeComponentNode(
  id: string,
  raw: unknown,
  issues: IssueSink,
): ComponentNode | undefined {
  const key = printableKey(id);
  if (!isPlainObject(raw)) {
    issues.push(`node "${key}": component is not an object`);
    return undefined;
  }
  const type = canonicalComponentType(raw.type);
  if (type === undefined) {
    issues.push(`node "${key}": unknown component type ${printableValue(raw.type)} dropped`);
    return undefined;
  }
  reportForbiddenFields(id, raw, issues);

  switch (type) {
    case "button":
      return buttonNode(id, raw, issues);
    case "section":
      return sectionNode(id, raw, issues);
    case "card":
      return cardNode(id, raw, issues);
    case "tabs":
      return tabsNode(id, raw, issues);
    case "nav":
      return navNode(id, raw, issues);
    case "table":
      return tableNode(id, raw, issues);
    case "chart":
      return chartNode(id, raw, issues);
    case "metric":
      return metricNode(id, raw, raw.type === "stat" ? "stat" : "metric", issues);
    case "keyValue":
      return keyValueNode(id, raw, issues);
    case "badge":
      return badgeNode(id, raw, issues);
    case "progress":
      return progressNode(id, raw, issues);
    case "alert":
      return alertNode(id, raw, issues);
    case "list":
      return listNode(id, raw, issues);
    case "divider":
      return dividerNode(id, raw, issues);
    case "form":
      return formNode(id, raw, issues);
    case "search":
      return searchNode(id, raw, issues);
    case "filterBar":
      return filterBarNode(id, raw, issues);
    case "emptyState":
      return emptyStateNode(id, raw, issues);
    case "loading":
      return loadingNode(id, raw, issues);
  }
}

function reportForbiddenFields(id: string, raw: Record<string, unknown>, issues: IssueSink): void {
  for (const field of FORBIDDEN_COMPONENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      issues.push(
        `node "${printableKey(id)}": ${field} is not allowed on component nodes; dropped`,
      );
    }
  }
}

function buttonNode(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): ComponentNode | undefined {
  const label = requiredText(raw.label, id, "label", issues);
  if (label === undefined) return undefined;
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
  setVariantTone(raw, id, node, issues);
  const disabled = boolValue(raw.disabled);
  if (disabled !== undefined) node.disabled = disabled;
  const onPress = actionValue(raw.onPress, id, "onPress", issues);
  if (onPress !== undefined) node.onPress = onPress;
  const onHold = actionValue(raw.onHold, id, "onHold", issues);
  if (onHold !== undefined) node.onHold = onHold;
  return node;
}

function sectionNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const node: {
    id: string;
    type: "section";
    title?: string;
    eyebrow?: string;
    body?: string;
    variant?: string;
    children: readonly string[];
  } = { id, type: "section", children: childRefs(raw.children) };
  setText(raw.title, id, "title", node, "title", MAX_COMPONENT_LABEL_CHARS, issues);
  setText(raw.eyebrow, id, "eyebrow", node, "eyebrow", MAX_COMPONENT_LABEL_CHARS, issues);
  setText(raw.body, id, "body", node, "body", MAX_COMPONENT_BODY_CHARS, issues);
  setVariant(raw, id, node, issues);
  return node;
}

function cardNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const node: {
    id: string;
    type: "card";
    title?: string;
    body?: string;
    variant?: string;
    tone?: Tone;
    onPress?: FacetAction;
    onHold?: FacetAction;
    children: readonly string[];
  } = { id, type: "card", children: childRefs(raw.children) };
  setText(raw.title, id, "title", node, "title", MAX_COMPONENT_LABEL_CHARS, issues);
  setText(raw.body, id, "body", node, "body", MAX_COMPONENT_BODY_CHARS, issues);
  setVariantTone(raw, id, node, issues);
  const onPress = actionValue(raw.onPress, id, "onPress", issues);
  if (onPress !== undefined) node.onPress = onPress;
  const onHold = actionValue(raw.onHold, id, "onHold", issues);
  if (onHold !== undefined) node.onHold = onHold;
  return node;
}

function tabsNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const items: TabItem[] = [];
  for (const item of boundedArray(raw.items, id, "items", issues)) {
    if (!isPlainObject(item)) continue;
    const label = textValue(item.label, id, "tab label", MAX_COMPONENT_LABEL_CHARS, issues);
    const to = typeof item.to === "string" ? item.to : undefined;
    if (label !== undefined && to !== undefined) items.push({ label, to });
  }
  const node: { id: string; type: "tabs"; items: readonly TabItem[]; variant?: string } = {
    id,
    type: "tabs",
    items,
  };
  setVariant(raw, id, node, issues);
  return node;
}

function navNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const items: NavItem[] = [];
  for (const item of boundedArray(raw.items, id, "items", issues)) {
    if (!isPlainObject(item)) continue;
    const label = textValue(item.label, id, "nav label", MAX_COMPONENT_LABEL_CHARS, issues);
    const to = typeof item.to === "string" ? item.to : undefined;
    if (label !== undefined && to !== undefined) items.push({ label, to });
  }
  const node: { id: string; type: "nav"; items: readonly NavItem[]; variant?: string } = {
    id,
    type: "nav",
    items,
  };
  setVariant(raw, id, node, issues);
  return node;
}

function tableNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const columns = tableColumns(raw.columns, id, issues);
  const node: {
    id: string;
    type: "table";
    columns: readonly TableColumn[];
    rows: readonly TableRow[];
    caption?: string;
    variant?: string;
  } = { id, type: "table", columns, rows: tableRows(raw.rows, id, issues) };
  setText(raw.caption, id, "caption", node, "caption", MAX_COMPONENT_LABEL_CHARS, issues);
  setVariant(raw, id, node, issues);
  return node;
}

function chartNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const kind = tokenValue<ChartKind>(raw.kind, CHART_KINDS) ?? "bar";
  const node: {
    id: string;
    type: "chart";
    kind: ChartKind;
    series: readonly { label: string; values: readonly number[] }[];
    labels?: readonly string[];
    title?: string;
    variant?: string;
  } = { id, type: "chart", kind, series: chartSeries(raw.series, id, issues) };
  const labels = stringList(raw.labels, id, "labels", issues);
  if (labels !== undefined) node.labels = labels;
  setText(raw.title, id, "title", node, "title", MAX_COMPONENT_LABEL_CHARS, issues);
  setVariant(raw, id, node, issues);
  return node;
}

function metricNode(
  id: string,
  raw: Record<string, unknown>,
  type: "metric" | "stat",
  issues: IssueSink,
): ComponentNode | undefined {
  const label = requiredText(raw.label, id, "label", issues);
  const value = requiredText(raw.value, id, "value", issues);
  if (label === undefined || value === undefined) return undefined;
  const node: {
    id: string;
    type: "metric" | "stat";
    label: string;
    value: string;
    delta?: string;
    tone?: Tone;
    variant?: string;
  } = { id, type, label, value };
  setText(raw.delta, id, "delta", node, "delta", MAX_COMPONENT_LABEL_CHARS, issues);
  setVariantTone(raw, id, node, issues);
  return node;
}

function keyValueNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const items: KeyValueItem[] = [];
  for (const item of boundedArray(raw.items, id, "items", issues)) {
    if (!isPlainObject(item)) continue;
    const label = textValue(item.label, id, "item label", MAX_COMPONENT_LABEL_CHARS, issues);
    const value = textValue(item.value, id, "item value", MAX_COMPONENT_LABEL_CHARS, issues);
    if (label === undefined || value === undefined) continue;
    const next: { key?: string; label: string; value: string; tone?: Tone } = { label, value };
    if (typeof item.key === "string") next.key = item.key;
    const tone = tokenValue<Tone>(item.tone, TONES);
    if (tone !== undefined) next.tone = tone;
    items.push(next);
  }
  const node: { id: string; type: "keyValue"; items: readonly KeyValueItem[]; variant?: string } = {
    id,
    type: "keyValue",
    items,
  };
  setVariant(raw, id, node, issues);
  return node;
}

function badgeNode(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): ComponentNode | undefined {
  const label = requiredText(raw.label, id, "label", issues);
  if (label === undefined) return undefined;
  const node: { id: string; type: "badge"; label: string; tone?: Tone; variant?: string } = {
    id,
    type: "badge",
    label,
  };
  setVariantTone(raw, id, node, issues);
  return node;
}

function progressNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const rawValue = typeof raw.value === "number" && Number.isFinite(raw.value) ? raw.value : 0;
  const value = Math.min(100, Math.max(0, rawValue));
  if (value !== rawValue) {
    issues.push(`node "${printableKey(id)}": progress value clamped to ${String(value)}`);
  }
  const node: {
    id: string;
    type: "progress";
    value: number;
    label?: string;
    tone?: Tone;
    variant?: string;
  } = { id, type: "progress", value };
  setText(raw.label, id, "label", node, "label", MAX_COMPONENT_LABEL_CHARS, issues);
  setVariantTone(raw, id, node, issues);
  return node;
}

function alertNode(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): ComponentNode | undefined {
  const body = requiredText(raw.body, id, "body", issues, MAX_COMPONENT_BODY_CHARS);
  if (body === undefined) return undefined;
  const node: {
    id: string;
    type: "alert";
    body: string;
    title?: string;
    tone?: Tone;
    variant?: string;
  } = { id, type: "alert", body };
  setText(raw.title, id, "title", node, "title", MAX_COMPONENT_LABEL_CHARS, issues);
  setVariantTone(raw, id, node, issues);
  return node;
}

function listNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const items: ListItem[] = [];
  for (const item of boundedArray(raw.items, id, "items", issues)) {
    if (typeof item === "string") {
      items.push({ title: item.slice(0, MAX_COMPONENT_LABEL_CHARS) });
      continue;
    }
    if (!isPlainObject(item)) continue;
    const title = textValue(item.title, id, "item title", MAX_COMPONENT_LABEL_CHARS, issues);
    if (title === undefined) continue;
    const next: { title: string; body?: string } = { title };
    const body = textValue(item.body, id, "item body", MAX_COMPONENT_BODY_CHARS, issues);
    if (body !== undefined) next.body = body;
    items.push(next);
  }
  const node: { id: string; type: "list"; items: readonly ListItem[]; variant?: string } = {
    id,
    type: "list",
    items,
  };
  setVariant(raw, id, node, issues);
  return node;
}

function dividerNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const node: { id: string; type: "divider"; label?: string; variant?: string } = {
    id,
    type: "divider",
  };
  setText(raw.label, id, "label", node, "label", MAX_COMPONENT_LABEL_CHARS, issues);
  setVariant(raw, id, node, issues);
  return node;
}

function formNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const node: {
    id: string;
    type: "form";
    title?: string;
    body?: string;
    submitLabel?: string;
    variant?: string;
    onSubmit?: FacetAction;
    children: readonly string[];
  } = { id, type: "form", children: childRefs(raw.children) };
  setText(raw.title, id, "title", node, "title", MAX_COMPONENT_LABEL_CHARS, issues);
  setText(raw.body, id, "body", node, "body", MAX_COMPONENT_BODY_CHARS, issues);
  setText(
    raw.submitLabel,
    id,
    "submitLabel",
    node,
    "submitLabel",
    MAX_COMPONENT_LABEL_CHARS,
    issues,
  );
  setVariant(raw, id, node, issues);
  const onSubmit = actionValue(raw.onSubmit, id, "onSubmit", issues);
  if (onSubmit !== undefined) node.onSubmit = onSubmit;
  return node;
}

function searchNode(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): ComponentNode | undefined {
  const name = requiredText(raw.name, id, "name", issues);
  if (name === undefined) return undefined;
  const node: {
    id: string;
    type: "search";
    name: string;
    label?: string;
    placeholder?: string;
    value?: string;
    submitLabel?: string;
    variant?: string;
    onSubmit?: FacetAction;
  } = { id, type: "search", name };
  setText(raw.label, id, "label", node, "label", MAX_COMPONENT_LABEL_CHARS, issues);
  setText(
    raw.placeholder,
    id,
    "placeholder",
    node,
    "placeholder",
    MAX_COMPONENT_LABEL_CHARS,
    issues,
  );
  setText(raw.value, id, "value", node, "value", MAX_COMPONENT_LABEL_CHARS, issues);
  setText(
    raw.submitLabel,
    id,
    "submitLabel",
    node,
    "submitLabel",
    MAX_COMPONENT_LABEL_CHARS,
    issues,
  );
  setVariant(raw, id, node, issues);
  const onSubmit = actionValue(raw.onSubmit, id, "onSubmit", issues);
  if (onSubmit !== undefined) node.onSubmit = onSubmit;
  return node;
}

function filterBarNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const filters: FilterBarFilter[] = [];
  for (const item of boundedArray(raw.filters, id, "filters", issues)) {
    if (!isPlainObject(item)) continue;
    const name = textValue(item.name, id, "filter name", MAX_COMPONENT_LABEL_CHARS, issues);
    const label = textValue(item.label, id, "filter label", MAX_COMPONENT_LABEL_CHARS, issues);
    if (name === undefined || label === undefined) continue;
    const filter: {
      name: string;
      label: string;
      input?: FieldInput;
      options?: readonly string[];
      value?: string | number | boolean;
    } = { name, label };
    const input = tokenValue<FieldInput>(item.input, FIELD_INPUTS);
    if (input !== undefined) filter.input = input;
    const options = stringList(item.options, id, "filter options", issues, MAX_COMPONENT_OPTIONS);
    if (options !== undefined) filter.options = options;
    if (isScalar(item.value)) filter.value = item.value;
    filters.push(filter);
  }
  const node: {
    id: string;
    type: "filterBar";
    filters: readonly FilterBarFilter[];
    variant?: string;
    onChange?: FacetAction;
  } = { id, type: "filterBar", filters };
  setVariant(raw, id, node, issues);
  const onChange = actionValue(raw.onChange, id, "onChange", issues);
  if (onChange !== undefined) node.onChange = onChange;
  return node;
}

function emptyStateNode(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): ComponentNode {
  const node: {
    id: string;
    type: "emptyState";
    title?: string;
    body?: string;
    actionLabel?: string;
    variant?: string;
    onPress?: FacetAction;
  } = { id, type: "emptyState" };
  setText(raw.title, id, "title", node, "title", MAX_COMPONENT_LABEL_CHARS, issues);
  setText(raw.body, id, "body", node, "body", MAX_COMPONENT_BODY_CHARS, issues);
  setText(
    raw.actionLabel,
    id,
    "actionLabel",
    node,
    "actionLabel",
    MAX_COMPONENT_LABEL_CHARS,
    issues,
  );
  setVariant(raw, id, node, issues);
  const onPress = actionValue(raw.onPress, id, "onPress", issues);
  if (onPress !== undefined) node.onPress = onPress;
  return node;
}

function loadingNode(id: string, raw: Record<string, unknown>, issues: IssueSink): ComponentNode {
  const node: { id: string; type: "loading"; label?: string; variant?: string } = {
    id,
    type: "loading",
  };
  setText(raw.label, id, "label", node, "label", MAX_COMPONENT_LABEL_CHARS, issues);
  setVariant(raw, id, node, issues);
  return node;
}

function requiredText(
  value: unknown,
  id: string,
  field: string,
  issues: IssueSink,
  cap = MAX_COMPONENT_LABEL_CHARS,
): string | undefined {
  const text = textValue(value, id, field, cap, issues);
  if (text === undefined) {
    issues.push(`node "${printableKey(id)}": ${field} must be a string`);
  }
  return text;
}

function textValue(
  value: unknown,
  id: string,
  field: string,
  cap: number,
  issues: IssueSink,
): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length <= cap) return value;
  issues.push(`node "${printableKey(id)}": ${field} truncated to ${String(cap)} characters`);
  return value.slice(0, cap);
}

function setText<T extends string>(
  value: unknown,
  id: string,
  label: string,
  node: Partial<Record<T, string>>,
  key: T,
  cap: number,
  issues: IssueSink,
): void {
  const text = textValue(value, id, label, cap, issues);
  if (text !== undefined) node[key] = text;
}

function setVariant(
  raw: Record<string, unknown>,
  id: string,
  node: { variant?: string },
  issues: IssueSink,
): void {
  if (raw.variant === undefined) return;
  if (typeof raw.variant === "string" && VARIANT_RE.test(raw.variant)) {
    node.variant = raw.variant;
    return;
  }
  issues.push(`node "${printableKey(id)}": malformed variant dropped`);
}

function setVariantTone(
  raw: Record<string, unknown>,
  id: string,
  node: { variant?: string; tone?: Tone },
  issues: IssueSink,
): void {
  setVariant(raw, id, node, issues);
  const tone = tokenValue<Tone>(raw.tone, TONES);
  if (tone !== undefined) node.tone = tone;
}

function tokenValue<T extends string>(value: unknown, allowed: readonly string[]): T | undefined {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function childRefs(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((child): child is string => typeof child === "string")
    : [];
}

function boundedArray(
  value: unknown,
  id: string,
  field: string,
  issues: IssueSink,
  cap = MAX_COMPONENT_ARRAY_ITEMS,
): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  const out: unknown[] = [];
  const limit = Math.min(value.length, cap);
  for (let i = 0; i < limit; i += 1) {
    out.push(value[i]);
  }
  if (value.length > cap) {
    issues.push(`node "${printableKey(id)}": ${field} exceeded the ${String(cap)}-item cap`);
  }
  return out;
}

function stringList(
  value: unknown,
  id: string,
  field: string,
  issues: IssueSink,
  cap = MAX_COMPONENT_ARRAY_ITEMS,
): readonly string[] | undefined {
  const out: string[] = [];
  for (const item of boundedArray(value, id, field, issues, cap)) {
    const text = textValue(item, id, field, MAX_COMPONENT_LABEL_CHARS, issues);
    if (text !== undefined) out.push(text);
  }
  return out.length > 0 ? out : undefined;
}

function tableColumns(value: unknown, id: string, issues: IssueSink): readonly TableColumn[] {
  const columns: TableColumn[] = [];
  for (const item of boundedArray(value, id, "columns", issues)) {
    if (!isPlainObject(item)) continue;
    const key = typeof item.key === "string" ? item.key : undefined;
    const label = textValue(item.label, id, "column label", MAX_COMPONENT_LABEL_CHARS, issues);
    if (key !== undefined && label !== undefined) columns.push({ key, label });
  }
  return columns;
}

function tableRows(value: unknown, id: string, issues: IssueSink): readonly TableRow[] {
  const rows: TableRow[] = [];
  for (const item of boundedArray(value, id, "rows", issues)) {
    if (!isPlainObject(item)) continue;
    const row: Record<string, TableCell> = {};
    for (const [key, cell] of Object.entries(item)) {
      if (isScalar(cell)) row[key] = cell;
    }
    rows.push(row);
  }
  return rows;
}

function chartSeries(
  value: unknown,
  id: string,
  issues: IssueSink,
): readonly { label: string; values: readonly number[] }[] {
  const series: { label: string; values: readonly number[] }[] = [];
  for (const item of boundedArray(value, id, "series", issues)) {
    if (!isPlainObject(item)) continue;
    const label = textValue(item.label, id, "series label", MAX_COMPONENT_LABEL_CHARS, issues);
    if (label === undefined) continue;
    const values: number[] = [];
    for (const point of boundedArray(item.values, id, "points", issues)) {
      if (typeof point === "number" && Number.isFinite(point)) values.push(point);
    }
    series.push({ label, values });
  }
  return series;
}

function actionValue(
  value: unknown,
  id: string,
  field: string,
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
    } = { kind: "agent", name: value.name };
    const payload = primitiveRecord(value.payload);
    if (payload !== undefined) action.payload = payload;
    if (typeof value.collect === "string") action.collect = value.collect;
    return action;
  }
  if (value.kind === "navigate" && typeof value.to === "string") {
    return { kind: "navigate", to: value.to };
  }
  if (value.kind === "toggle" && typeof value.target === "string") {
    return { kind: "toggle", target: value.target };
  }
  issues.push(`node "${printableKey(id)}": ${field} action dropped`);
  return undefined;
}

function primitiveRecord(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isScalar(item)) out[key] = item;
  }
  return out;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
