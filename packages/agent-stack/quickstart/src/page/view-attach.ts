import type { ViewSnapshot } from "@facet/core";

/**
 * Pure host-side attach of the browser's view snapshot onto an OUTGOING event —
 * the `view` counterpart of how `fields` rides a tap (spec WU-7). Conditional
 * spread on purpose: with `exactOptionalPropertyTypes` an absent snapshot must
 * keep `view` absent, never an explicit `view: undefined`. An `undefined` or
 * empty snapshot returns the input event untouched (same reference), and a
 * present one composes a NEW event object — the input is never mutated
 * (DC-001). Report-only: this function only shapes the event the host already
 * decided to send; it never sends, persists, or throws.
 */
export function withView<E extends { readonly view?: ViewSnapshot }>(
  event: E,
  snap?: ViewSnapshot,
): E {
  if (snap === undefined || Object.keys(snap).length === 0) {
    return event;
  }
  return { ...event, view: snap };
}
