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
