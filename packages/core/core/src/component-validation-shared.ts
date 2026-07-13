import { isForbiddenKey, printableKey, printableValue, type IssueSink } from "./issues.js";
import { DATASET_NAME_RE, SLOT_NAME_RE } from "./slot-marker.js";
import { TONES, type Tone } from "./nodes.js";

export const MAX_COMPONENT_ARRAY_ITEMS = 32;
export const MAX_NODE_LABEL_CHARS = 200;
export const MAX_NODE_BODY_CHARS = 1000;
export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_CELL_CHARS = 200;
export const MAX_CHART_SERIES = 8;
export const MAX_CHART_POINTS = 200;
export const MAX_LIST_ITEMS = 50;
export const MAX_TABS_ITEMS = 12;

export function boundedString(
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

export function requiredText(
  value: unknown,
  id: string,
  field: string,
  issues: IssueSink,
  max = MAX_NODE_LABEL_CHARS,
): string | undefined {
  const text = boundedString(value, id, field, max, issues);
  if (text === undefined) issues.push(`node "${printableKey(id)}": ${field} must be a string`);
  return text;
}

export function setText<T extends string>(
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

export function setVariant(
  value: unknown,
  id: string,
  node: { variant?: string },
  issues: IssueSink,
): void {
  if (value === undefined) return;
  if (typeof value === "string" && SLOT_NAME_RE.test(value)) node.variant = value;
  else issues.push(`node "${printableKey(id)}": malformed variant dropped`);
}

export function setTone(
  value: unknown,
  id: string,
  node: { tone?: Tone },
  issues: IssueSink,
  reportInvalid: boolean,
): void {
  if (value === undefined) return;
  const tone = tokenValue<Tone>(value, TONES);
  if (tone !== undefined) node.tone = tone;
  else if (reportInvalid)
    issues.push(`node "${printableKey(id)}": unknown tone ${printableValue(value)} dropped`);
}

export function childRefs(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((child): child is string => typeof child === "string")
    : [];
}

/** Copy a bounded dataset-name binding onto a data-bearing node. */
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

/** Copy the closed metric/stat cell selector used with `from`. */
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

export function capArray<T>(
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

export function boundedArray(
  value: unknown,
  id: string,
  field: string,
  issues: IssueSink,
  max = MAX_COMPONENT_ARRAY_ITEMS,
): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  const out: unknown[] = [];
  const limit = Math.min(value.length, max);
  for (let index = 0; index < limit; index += 1) out.push(value[index]);
  if (value.length > max) {
    issues.push(`node "${printableKey(id)}": ${field} exceeded the ${String(max)}-item cap`);
  }
  return out;
}

export function tokenValue<T extends string>(
  value: unknown,
  allowed: readonly string[],
): T | undefined {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : undefined;
}

export function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
