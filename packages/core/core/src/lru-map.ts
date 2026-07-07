/**
 * A bounded, string-keyed map with least-recently-used eviction: past `maxSize`
 * entries, the least-recently-touched key is dropped. A "touch" (any `get` hit,
 * `set`, or `getOrCreate`) moves the key to the newest position, so eviction
 * always removes the coldest entry.
 *
 * Consolidates the identical hand-rolled idiom at three call sites: the
 * read-through session cache in `@facet/runtime`'s `FileStageStore` (cachePut),
 * the per-visitor `--resume` id map in `@facet/bridge` (touchSessionId), and the
 * per-visitor frame log in `@facet/server` (logFor). Each rebuilt the same
 * `Map.delete` + `Map.set` + evict-oldest dance by hand.
 *
 * Implementation note: a `Map` iterates in insertion order, so re-inserting a
 * key on every touch keeps the oldest key first and makes eviction O(1). Values
 * are expected to be non-`undefined` (all consumers store objects or strings);
 * a stored `undefined` would be indistinguishable from an absent key.
 */
export interface LruMap<V extends NonNullable<unknown>> {
  /** Value for `key`, or `undefined` if absent. A hit counts as a touch. */
  get(key: string): V | undefined;
  /** Insert or replace `key`; touches it and evicts the oldest past the cap. */
  set(key: string, value: V): void;
  /**
   * Value for `key`, minting one via `make()` when absent. Present or freshly
   * made, the entry is touched; a fresh entry may evict the oldest past the cap.
   */
  getOrCreate(key: string, make: () => V): V;
  /** Remove `key`; returns whether it was present (like `Map.delete`). */
  delete(key: string): boolean;
  /** Current entry count. */
  readonly size: number;
}

export function createLruMap<V extends NonNullable<unknown>>(maxSize: number): LruMap<V> {
  // Fail fast on a nonsensical cap, matching createSemaphore's posture: a bad
  // bound is a programming error, not something to silently clamp.
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new RangeError(`createLruMap: maxSize must be an integer >= 1, got ${String(maxSize)}`);
  }
  const map = new Map<string, V>();

  // Move `key` to the newest position (Map iterates oldest-first, so a
  // delete + set re-inserts it last).
  const touch = (key: string, value: V): void => {
    map.delete(key);
    map.set(key, value);
  };

  // Drop the oldest entry when we've grown past the cap. Called after any insert.
  const evictIfFull = (): void => {
    if (map.size > maxSize) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  };

  return {
    get(key) {
      const value = map.get(key);
      if (value === undefined) return undefined;
      touch(key, value);
      return value;
    },
    set(key, value) {
      touch(key, value);
      evictIfFull();
    },
    getOrCreate(key, make) {
      const existing = map.get(key);
      if (existing !== undefined) {
        touch(key, existing);
        return existing;
      }
      const created = make();
      map.set(key, created);
      evictIfFull();
      return created;
    },
    delete(key) {
      return map.delete(key);
    },
    get size() {
      return map.size;
    },
  };
}
