const DEFAULT_STORAGE_KEY = "facet:visitor";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Defensive fallback for environments without crypto.randomUUID (e.g. http on
  // a non-localhost host). Not as strong, but still hard to guess.
  const rand = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(rand);
  }
  return `v-${Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A stable, unguessable anonymous visitor id for the current browser: read from
 * `localStorage`, or generated and stored on first visit so the same person maps
 * to the same session (and page) on return.
 *
 * SECURITY: the id IS the session key, and the reference `@facet/server` does not
 * authenticate it — anyone who presents an id gets that session's stage + chat.
 * The default here (a 128-bit random UUID) is unguessable, which is the right
 * choice for anonymous pages. Do NOT pass a *guessable/enumerable* id (a raw
 * sequential user id) unless your own layer authenticates the request first —
 * otherwise one visitor can read another's page and history.
 */
export function browserVisitorId(storageKey: string = DEFAULT_STORAGE_KEY): string {
  // localStorage can be undefined (SSR), throw on ACCESS (sandboxed iframes with
  // storage blocked), or throw on WRITE (quota / strict privacy modes). Any of
  // those degrades to a fresh per-call id rather than crashing the page.
  try {
    if (typeof localStorage === "undefined") {
      return randomId();
    }
    const existing = localStorage.getItem(storageKey);
    if (existing !== null && existing.length > 0) {
      return existing;
    }
    const id = randomId();
    localStorage.setItem(storageKey, id);
    return id;
  } catch {
    return randomId();
  }
}
