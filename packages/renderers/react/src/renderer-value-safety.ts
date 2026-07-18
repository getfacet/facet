export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

export function safeOwnValue(record: unknown, key: string): unknown {
  if (!isObjectRecord(record)) return undefined;
  try {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
    return record[key];
  } catch {
    return undefined;
  }
}

export function cappedArray(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  try {
    return value.slice(0, max);
  } catch {
    return [];
  }
}

export function cappedString(value: unknown, max: number): string | undefined {
  const text = typeof value === "string" ? value : undefined;
  return text === undefined ? undefined : text.slice(0, max);
}

export function styleOf<T extends object>(style: unknown): T | undefined {
  if (!isObjectRecord(style)) return undefined;
  try {
    return { ...style } as T;
  } catch {
    return undefined;
  }
}
