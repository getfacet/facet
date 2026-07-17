import { sanitizeView, type ViewSnapshot } from "@facet/core";

const KEY_PREFIX = "facet:view:";

function storageKey(agentId: string): string {
  return `${KEY_PREFIX}${agentId}`;
}

/**
 * Persist the last-known view snapshot for one agent link under
 * `facet:view:<agentId>`, so a returning visitor's `visit` event can be seeded
 * with where they left off. Framework-neutral (imports only `@facet/core`).
 *
 * `localStorage` can be undefined (SSR), throw on ACCESS (sandboxed iframes with
 * storage blocked), or throw on WRITE (quota / strict privacy modes). Any of
 * those degrades to a silent no-op — the live snapshot still rides the event —
 * rather than crashing the page or spamming the console (mirrors `visitor.ts`).
 */
export function persistView(agentId: string, snap: ViewSnapshot): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(storageKey(agentId), JSON.stringify(snap));
  } catch {
    // swallow: persistence is best-effort, never fatal.
  }
}

/**
 * Read the persisted view snapshot for one agent link, or `undefined` when
 * nothing is stored, storage is unavailable/throwing, or the stored payload is
 * corrupt. The stored value is untrusted (any script sharing the origin can
 * write it), so it is validated through core `sanitizeView` before being
 * returned — garbage or an over-cap payload yields `undefined`/a cleaned
 * snapshot, never a crash. Degrades silently, like `persistView`.
 */
export function loadPersistedView(agentId: string): ViewSnapshot | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(storageKey(agentId));
    if (raw === null || raw.length === 0) return undefined;
    return sanitizeView(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
