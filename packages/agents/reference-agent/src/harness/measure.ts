const UNSERIALIZABLE_VALUE_CHARS = 256;

export function measureChars(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === undefined) return 0;

  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized.length : UNSERIALIZABLE_VALUE_CHARS;
  } catch {
    return UNSERIALIZABLE_VALUE_CHARS;
  }
}
