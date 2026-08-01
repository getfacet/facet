const DEFAULT_STORAGE_KEY = "facet:session";

function randomId(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === "function") {
    return source.randomUUID();
  }
  const rand = new Uint8Array(16);
  if (typeof source?.getRandomValues === "function") {
    source.getRandomValues(rand);
    if (rand.some((byte) => byte !== 0)) {
      return `v-${Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  throw new Error(
    "Facet browser session keys require crypto.randomUUID or crypto.getRandomValues.",
  );
}

/**
 * A stable, unguessable anonymous session key for the current browser:
 * read from `localStorage`, or generated and stored on first visit so the same
 * person maps to the same Facet session on return.
 *
 * SECURITY: this value IS the session key, and the reference `@facet/server` does not
 * authenticate it — anyone who presents an id gets that session's stage + chat.
 * The default here (a 128-bit random UUID) is unguessable, which is the right
 * choice for anonymous pages. Do NOT pass a *guessable/enumerable* id (a raw
 * sequential user id) unless your own layer authenticates the request first —
 * otherwise one visitor can read another's page and history.
 */
export function browserSessionKey(storageKey: string = DEFAULT_STORAGE_KEY): string {
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
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      // Strict privacy modes may allow reads but reject writes. Keep the
      // generated bearer fresh and secure rather than retrying or crashing.
    }
    return id;
  } catch {
    return randomId();
  }
}
