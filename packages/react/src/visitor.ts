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
 * Bring your own id instead when your app already knows who the visitor is — pass
 * a logged-in user id (or an actor id) as `visitorId` and this helper is unused.
 * The random id doubles as a first line of defense against impersonation; add a
 * verified/signed id only when an anonymous page carries sensitive data.
 */
export function browserVisitorId(storageKey: string = DEFAULT_STORAGE_KEY): string {
  if (typeof localStorage === "undefined") {
    // No persistent storage (SSR / private modes): a fresh id per call.
    return randomId();
  }
  const existing = localStorage.getItem(storageKey);
  if (existing !== null && existing.length > 0) {
    return existing;
  }
  const id = randomId();
  localStorage.setItem(storageKey, id);
  return id;
}
