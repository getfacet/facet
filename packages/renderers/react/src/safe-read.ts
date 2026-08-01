export function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

export function isArrayValue(value: unknown): value is readonly unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

export function readArrayLength(value: readonly unknown[]): number {
  try {
    return Number.isSafeInteger(value.length) && value.length > 0 ? value.length : 0;
  } catch {
    return 0;
  }
}

export function readArrayItem(value: readonly unknown[], index: number): unknown {
  try {
    return value[index];
  } catch {
    return undefined;
  }
}

/**
 * Reads one own property without ever throwing, so a hostile container is inert.
 * The guard covers the whole read because a revoked proxy can throw while
 * checking shape or own-property membership, before any value is touched.
 */
export function readOwn(container: unknown, key: string): unknown {
  try {
    if (!isRecord(container) || !Object.prototype.hasOwnProperty.call(container, key)) {
      return undefined;
    }
    return container[key];
  } catch {
    return undefined;
  }
}
