/**
 * A bounded, string-keyed map with least-recently-used eviction.
 *
 * It exists because two packages need the *same* bounded cache and a per-package
 * copy is exactly the drift a shared core prevents: `@facet/runtime`'s turn gate
 * retains the receipt for a settled turn against its client-stable trigger id, so
 * a retransmitted `eventId` or `messageId` returns the same answer instead of
 * running a second turn, and `@facet/react` collapses redelivered conversation
 * messages by `messageId`. Both are per-session caches over ids a client mints,
 * which is precisely the case that must never grow without a ceiling.
 *
 * **A hit is a touch; a miss is not.** `get` and `has` both move a key they find
 * to the newest position, because for a dedupe cache the question *is* the use —
 * a hot, repeatedly retried id that never refreshed would age out at the moment
 * it matters most. `keysOldestFirst` is the one exception: it is a pure read, so
 * a caller (or a test) can observe eviction order without changing it.
 *
 * **The capacity is the caller's, and it is never a limit from `BOUNDS`.** The
 * bounds table governs payloads an agent or a visitor can influence; this cap
 * governs a process-local cache, and the runtime's 256-entry choice belongs to
 * the turn gate that makes it. Any capacity that is not a positive count — 0, a
 * negative, `NaN`, and `Infinity` in particular — normalises to **0**, a map that
 * holds nothing. That is deliberate: a value read as "unlimited" would turn a
 * bounded cache into an unbounded one, which is the failure this module exists
 * to make impossible.
 *
 * Every operation is **total**: none throws for any input, including a key that
 * names object machinery, a value whose getters throw, and a capacity of 0 or 1.
 * Keys go through a `Map`, so `__proto__` is an ordinary key and nothing can
 * reach `Object.prototype`; values are stored in a private slot and never read
 * into, so a hostile value is inert. Presence is answered by `has` rather than by
 * an `undefined` sentinel, so a stored `undefined` is a stored value.
 *
 * Keys are strings because both consumers key by a client-minted id. A key type
 * parameter would be a purely additive change if a third consumer ever needs one.
 */

/**
 * A bounded map holding at most `capacity` entries, evicting the
 * least-recently-used key first.
 */
export interface BoundedMap<V> {
  /** The normalised ceiling. At most this many entries are ever held. */
  readonly capacity: number;
  /** The current entry count, never above `capacity`. */
  readonly size: number;
  /** Whether `key` is present. A hit is a use, and refreshes recency. */
  has(key: string): boolean;
  /**
   * The value for `key`, or `undefined` when it is absent. A hit refreshes
   * recency. When the value type admits `undefined`, ask `has` — the two cases
   * are distinguishable there and only there.
   */
  get(key: string): V | undefined;
  /** Inserts or replaces `key`, refreshing recency and evicting past the cap. */
  set(key: string, value: V): void;
  /** Removes `key`; answers whether it was present, as `Map.delete` does. */
  delete(key: string): boolean;
  /**
   * A frozen snapshot of the keys in eviction order, oldest first. A pure read:
   * unlike `get` and `has`, it refreshes nothing.
   */
  keysOldestFirst(): readonly string[];
}

/**
 * One stored value, wrapped so presence is a property of the slot rather than of
 * the value. Without the wrapper a `V` that admits `undefined` would be
 * indistinguishable from an absent key, and the map would quietly stop being
 * total for that type.
 */
interface Slot<V> {
  readonly value: V;
}

/**
 * The ceiling a caller's number actually buys. Anything that is not a positive
 * count becomes 0; a fraction floors. Never throws, and never yields a value
 * that means "unlimited".
 */
function normalizeCapacity(capacity: number): number {
  if (!Number.isFinite(capacity)) {
    return 0;
  }
  const floored = Math.floor(capacity);
  return floored > 0 ? floored : 0;
}

/** Creates a bounded map holding at most `capacity` entries. */
export function createBoundedMap<V>(capacity: number): BoundedMap<V> {
  const limit = normalizeCapacity(capacity);
  // A Map iterates in insertion order, so re-inserting a key on every touch
  // keeps the oldest key first and makes eviction an O(1) look at the front.
  const entries = new Map<string, Slot<V>>();

  const touch = (key: string, slot: Slot<V>): void => {
    entries.delete(key);
    entries.set(key, slot);
  };

  return Object.freeze({
    capacity: limit,
    get size(): number {
      return entries.size;
    },
    has(key: string): boolean {
      const slot = entries.get(key);
      if (slot === undefined) {
        return false;
      }
      touch(key, slot);
      return true;
    },
    get(key: string): V | undefined {
      const slot = entries.get(key);
      if (slot === undefined) {
        return undefined;
      }
      touch(key, slot);
      return slot.value;
    },
    set(key: string, value: V): void {
      if (limit === 0) {
        return;
      }
      touch(key, { value });
      // `set` is the only path that grows the map, so one eviction is always
      // enough; the loop states the invariant rather than relying on that.
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done === true) {
          break;
        }
        entries.delete(oldest.value);
      }
    },
    delete(key: string): boolean {
      return entries.delete(key);
    },
    keysOldestFirst(): readonly string[] {
      return Object.freeze([...entries.keys()]);
    },
  });
}
