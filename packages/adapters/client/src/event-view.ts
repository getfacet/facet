import type { CollectedEvent, ViewSnapshot } from "@facet/core";

/**
 * Attach the latest browser-owned view snapshot to an outgoing event without
 * mutating it. Empty, absent, or hostile snapshots leave the event unchanged,
 * preserving exact optional-property semantics.
 */
export function withView<E extends CollectedEvent>(
  event: E,
  snapshot?: ViewSnapshot,
): E & { readonly view?: ViewSnapshot } {
  if (snapshot === undefined) return event;
  try {
    if (Object.keys(snapshot).length === 0) return event;
    return { ...event, view: snapshot };
  } catch {
    return event;
  }
}
