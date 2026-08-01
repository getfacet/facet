import { BOUNDS } from "./bounds.js";
import { isArrayValue } from "./json-shape.js";

export type DataValueShape = "null" | "string" | "number" | "boolean" | "array" | "object";

export type DataValueCountPolicy = "entries" | "presence";

export interface DataValueDescriptor {
  readonly path: string;
  readonly shape: DataValueShape;
  readonly fields: readonly string[];
  readonly count: number;
}

export interface DescribeDataValueOptions {
  readonly count?: DataValueCountPolicy;
}

export function describeDataValue(
  path: string,
  value: unknown,
  options: DescribeDataValueOptions = {},
): DataValueDescriptor {
  const countPolicy = options.count ?? "entries";
  return Object.freeze({
    path,
    shape: dataValueShape(value),
    fields: dataValueFields(value),
    count: countPolicy === "presence" ? dataValuePresenceCount(value) : dataValueEntryCount(value),
  });
}

export function dataValueShape(value: unknown): DataValueShape {
  if (value === null) return "null";
  if (isArrayValue(value)) return "array";
  if (isRecord(value)) return "object";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

export function dataValueFields(value: unknown): readonly string[] {
  if (isArrayValue(value)) {
    const fields = new Set<string>();
    const length = Math.min(safeArrayLength(value), BOUNDS.dataModelArrayLength);
    for (let index = 0; index < length; index += 1) {
      const item = safeArrayItem(value, index);
      if (!isRecord(item)) continue;
      for (const key of safeKeys(item)) fields.add(key);
    }
    return Object.freeze([...fields].sort());
  }
  if (isRecord(value)) {
    return Object.freeze(safeKeys(value).sort());
  }
  return Object.freeze([]);
}

export function dataValueEntryCount(value: unknown): number {
  if (isArrayValue(value)) return safeArrayLength(value);
  if (isRecord(value)) return safeKeys(value).length;
  return 1;
}

export function dataValuePresenceCount(value: unknown): number {
  if (isArrayValue(value) || isRecord(value)) {
    return dataValueEntryCount(value) === 0 ? 0 : 1;
  }
  return value === undefined ? 0 : 1;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  try {
    return typeof value === "object" && value !== null && !isArrayValue(value);
  } catch {
    return false;
  }
}

function safeArrayLength(value: readonly unknown[]): number {
  try {
    return Number.isSafeInteger(value.length) && value.length > 0 ? value.length : 0;
  } catch {
    return 0;
  }
}

function safeArrayItem(value: readonly unknown[], index: number): unknown {
  try {
    return value[index];
  } catch {
    return undefined;
  }
}

function safeKeys(value: Readonly<Record<string, unknown>>): string[] {
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}
