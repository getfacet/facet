import type { ClientEvent, VisitorContext } from "@facet/core";

/** FIFO cap on parked timed-out/dropped turns awaiting a late result. Beyond it
 * the oldest entry is dropped and its eventual /agent/control is a silent no-op —
 * the late-delivery guarantee is deliberately bounded. */
export const LATE_WINDOW_LIMIT = 100;

/** A parked turn's origin, kept so a timed-out/dropped request can be re-applied
 * late: a later /agent/control for this id re-injects its messages through the
 * runtime. */
export interface ParkedTurn {
  readonly visitor: VisitorContext;
  readonly event: ClientEvent;
  // The per-visitor arrival index of this turn's event, used to detect a NEWER turn
  // that has already applied before a late result lands (see `lastApplied`).
  readonly index: number;
  // The frame-log era at park time. The index space is only meaningful within one
  // era; a re-mint (restart/LRU eviction) invalidates a parked index (see
  // `isStaleLateResult`), so the era is parked alongside it.
  readonly era: string;
}

/** Parked turns (timed out or dropped) awaiting a late /agent/control result,
 * keyed by requestId and FIFO-bounded. */
export interface LateWindow {
  /** Park a turn's origin for the bounded late-delivery window (FIFO). */
  park(requestId: number, turn: ParkedTurn): void;
  /** Take (and remove) a parked turn, or `undefined` if it was never parked or has
   * already been evicted/consumed. */
  take(requestId: number): ParkedTurn | undefined;
  /** Current parked count (for tests). */
  readonly size: number;
}

export function createLateWindow(limit: number): LateWindow {
  // Mirrors createLruMap's posture: a nonsensical bound (<= 0 would evict every
  // just-parked turn, silently disabling late delivery) is a config bug.
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `createLateWindow: limit must be a positive integer (got ${String(limit)})`,
    );
  }
  const window = new Map<number, ParkedTurn>();
  return {
    park(requestId, turn) {
      window.set(requestId, turn);
      if (window.size > limit) {
        const oldest = window.keys().next().value;
        if (oldest !== undefined) window.delete(oldest);
      }
    },
    take(requestId) {
      const turn = window.get(requestId);
      if (turn !== undefined) window.delete(requestId);
      return turn;
    },
    get size() {
      return window.size;
    },
  };
}

/** Staleness decision for a late (post-timeout) agent result. Lives in this
 * non-barreled module so it is importable by the unit tests WITHOUT joining the
 * package's public surface (`index.ts` re-exports only `server.js`). Two reasons
 * a parked result is stale, both fail-safe (drop the stale stage mutation, keep
 * the say):
 *  - era mismatch: the frame log was re-minted (restart or LRU eviction) since the
 *    turn parked, so its per-visitor index counters no longer refer to the same
 *    space — a counter reset could otherwise let a genuinely-stale result through,
 *    so any mismatch is treated as stale;
 *  - a newer turn already mutated the stage for this visitor (`lastApplied` past the
 *    parked index) — applying now would overwrite it (Stage `render` = root replace).
 * The accepted degradation is a FALSE stale (a still-valid result loses its patch
 * after an eviction), never a stale result overwriting a newer stage. */
export function isStaleLateResult(
  parked: { readonly era: string; readonly index: number },
  log: { readonly era: string; readonly lastApplied: number },
): boolean {
  return parked.era !== log.era || log.lastApplied > parked.index;
}
