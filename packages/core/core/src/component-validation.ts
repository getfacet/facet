import {
  FORBIDDEN_DATA_KEYS,
  isPlainObject,
  printableKey,
  printableValue,
  type IssueSink,
} from "./issues.js";
import {
  sanitizeClassicComponentNode,
  setColumnRow,
  setFrom,
} from "./classic-component-validation.js";
import {
  COMPONENT_NODE_TYPES,
  FIELD_INPUTS,
  INTRINSIC_COMPONENT_TYPES,
  PRIMITIVE_BRICK_TYPES,
  TONES,
  type ComponentNode,
  type ComponentNodeType,
  type FacetAction,
  type FieldInput,
  type FilterBarFilter,
  type IntrinsicComponentType,
  type KeyValueItem,
  type NavItem,
  type PrimitiveBrickType,
  type Tone,
} from "./nodes.js";

export const MAX_COMPONENT_ARRAY_ITEMS = 32;

const MAX_COMPONENT_LABEL_CHARS = 200;
const MAX_COMPONENT_BODY_CHARS = 1_000;
const MAX_COMPONENT_OPTIONS = 32;
const VARIANT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CLASSIC_COMPONENT_TYPES = new Set([
  "button",
  "section",
  "card",
  "tabs",
  "table",
  "chart",
  "stat",
  "badge",
  "progress",
  "alert",
  "list",
  "divider",
]);

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
  capturedType?: ComponentNodeType,
): ComponentNode | undefined {
  const key = printableKey(id);
  if (!isPlainObject(raw)) {
    issues.push(`node "${key}": component is not an object`);
    return undefined;
  }
  const rawType = capturedType ?? raw.type;
  if (typeof rawType === "string" && CLASSIC_COMPONENT_TYPES.has(rawType)) {
    return sanitizeClassicComponentNode(id, raw, rawType, issues);
  }
  const type = canonicalComponentType(rawType);
  if (type === undefined) {
    issues.push(`node "${key}": unknown component type ${printableValue(rawType)} dropped`);
    return undefined;
  }
  reportForbiddenFields(id, raw, issues);

  switch (type) {
    case "nav":
      return navNode(id, raw, issues);
    case "metric":
      return metricNode(id, raw, "metric", issues);
    case "keyValue":
      return keyValueNode(id, raw, issues);
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
  for (const field of FORBIDDEN_DATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      issues.push(
        `node "${printableKey(id)}": ${field} is not allowed on component nodes; dropped`,
      );
    }
  }
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
    from?: string;
    column?: string;
    row?: number;
  } = { id, type, label, value };
  setText(raw.delta, id, "delta", node, "delta", MAX_COMPONENT_LABEL_CHARS, issues);
  setVariantTone(raw, id, node, issues);
  setFrom(raw, id, node, issues);
  setColumnRow(raw, node);
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
  const node: {
    id: string;
    type: "keyValue";
    items: readonly KeyValueItem[];
    variant?: string;
    from?: string;
  } = {
    id,
    type: "keyValue",
    items,
  };
  setVariant(raw, id, node, issues);
  setFrom(raw, id, node, issues);
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
