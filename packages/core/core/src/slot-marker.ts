export const SLOT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/**
 * A bounded dataset NAME (the `from` binding target and a `data` warehouse key):
 * a name, never a URL/source/path/resolver (invariant #1). Lives here beside
 * `SLOT_NAME_RE` — a leaf module both the data-binding helper and brick
 * validators import, so neither has to import the other (no cross-module cycle).
 */
export const DATASET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
