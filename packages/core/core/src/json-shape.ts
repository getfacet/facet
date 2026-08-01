/**
 * Total JSON container shape checks. `Array.isArray` and
 * `Object.getPrototypeOf` can both throw on revoked or hostile proxies, so every
 * JSON model/binding classifier uses these predicates instead of raw built-ins.
 */
export function isArrayValue(value: unknown): value is readonly unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null || isArrayValue(value)) {
      return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}
