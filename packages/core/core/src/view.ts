import { isPlainObject } from "./issues.js";
import { MAX_FIELD_VALUE_CHARS } from "./protocol.js";

/**
 * Closed viewport-width classes a browser may report on an event. A closed
 * enum on purpose (like the style tokens): the agent adapts layout via
 * patches, so the vocabulary must stay small and validated — never a raw
 * pixel width.
 */
export const VIEWPORTS = ["narrow", "medium", "wide"] as const;
export type Viewport = (typeof VIEWPORTS)[number];

/** Closed color-scheme classes a browser may report on an event. */
export const SCHEMES = ["light", "dark"] as const;
export type Scheme = (typeof SCHEMES)[number];

/**
 * Closed set of directions a locally-sorted table column may report. A closed
 * enum on purpose (like the style tokens and the enums above): the browser sorts
 * a rendered table as pure view-state, so the vocabulary the agent reads back
 * must stay small and validated — never a raw comparator or expression.
 */
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * Shared cap on the NUMBER of `toggled` entries a view snapshot may carry —
 * enforced by `sanitizeView` at every untrusted boundary (server `/event`,
 * ag-ui input, persisted-storage read). Mirrors `MAX_FIELDS_KEYS`: a real page
 * toggles a handful of nodes; this is a defense-in-depth bound. Beyond the cap
 * the OLDEST (first-inserted) entries are dropped and the most recent kept.
 */
export const MAX_VIEW_TOGGLED_KEYS = 256;

/**
 * Shared cap on the NUMBER of `sort` entries a view snapshot may carry — one per
 * locally-sorted table node, enforced by `sanitizeView` at every untrusted
 * boundary. Mirrors `MAX_VIEW_TOGGLED_KEYS`: a real page sorts a handful of
 * tables; this is a defense-in-depth bound. Beyond the cap the OLDEST
 * (first-inserted) entries are dropped and the most recent kept.
 */
export const MAX_VIEW_SORT_KEYS = 256;

/**
 * The visitor's browser-owned view-state, reported read-only on an outgoing
 * event (`ClientEvent`/`CollectedEvent` `view?`). Inert data riding the event —
 * never part of the stage tree, never interpreted or rendered back by Facet;
 * the agent reads it to target its next patch (e.g. the screen the visitor is
 * actually on). `screen`/`toggled` keys are agent-authored screen names and
 * node ids; `viewport`/`scheme` are the closed enums above.
 */
export interface ViewSnapshot {
  readonly screen?: string;
  readonly toggled?: Readonly<Record<string, "shown" | "hidden">>;
  readonly sort?: Readonly<
    Record<string, { readonly column: string; readonly direction: SortDirection }>
  >;
  readonly viewport?: Viewport;
  readonly scheme?: Scheme;
}

/**
 * FILTERING boundary clamp for an untrusted `view` value (precedent:
 * `sanitizeActionPayload`). Returns a cleaned `ViewSnapshot`, or `undefined`
 * when the input is not a plain object or nothing valid remains — the caller
 * then omits `view` and processes the event as if it never carried one.
 *
 * Rules: `screen` must be a string of at most `MAX_FIELD_VALUE_CHARS` (dropped
 * otherwise); `viewport`/`scheme` outside the closed enums are dropped;
 * `toggled` keeps only entries whose key is a string within
 * `MAX_FIELD_VALUE_CHARS` and whose value is `"shown"`/`"hidden"`, capped at
 * `MAX_VIEW_TOGGLED_KEYS` by dropping the OLDEST (first-inserted) entries.
 * `sort` keeps only entries whose key (a table node id) is a string within
 * `MAX_FIELD_VALUE_CHARS` and whose value is a plain object with a string
 * `column` within `MAX_FIELD_VALUE_CHARS` and a `direction` in `SORT_DIRECTIONS`,
 * capped at `MAX_VIEW_SORT_KEYS` the same drop-oldest way. It
 * reads only these known flat fields — it never recurses into nested objects
 * and never throws, so a deeply nested or cyclic payload yields at most a
 * cleaned flat snapshot.
 *
 * Pure and dependency-free (no `window`/`localStorage`/Node APIs): the same
 * function runs in the browser, the server boundary, and the ag-ui adapter, so
 * the bounds cannot drift.
 */
export function sanitizeView(value: unknown): ViewSnapshot | undefined {
  try {
    if (!isPlainObject(value)) return undefined;
    const cleaned: {
      screen?: string;
      toggled?: Record<string, "shown" | "hidden">;
      sort?: Record<string, { column: string; direction: SortDirection }>;
      viewport?: Viewport;
      scheme?: Scheme;
    } = {};

    const screen = value["screen"];
    if (typeof screen === "string" && screen.length <= MAX_FIELD_VALUE_CHARS) {
      cleaned.screen = screen;
    }

    const viewport = value["viewport"];
    if (typeof viewport === "string" && (VIEWPORTS as readonly string[]).includes(viewport)) {
      cleaned.viewport = viewport as Viewport;
    }

    const scheme = value["scheme"];
    if (typeof scheme === "string" && (SCHEMES as readonly string[]).includes(scheme)) {
      cleaned.scheme = scheme as Scheme;
    }

    const toggled = value["toggled"];
    if (isPlainObject(toggled)) {
      const entries: [string, "shown" | "hidden"][] = [];
      for (const [key, raw] of Object.entries(toggled)) {
        if (key.length > MAX_FIELD_VALUE_CHARS) continue;
        if (raw !== "shown" && raw !== "hidden") continue;
        entries.push([key, raw]);
      }
      const kept =
        entries.length > MAX_VIEW_TOGGLED_KEYS
          ? entries.slice(entries.length - MAX_VIEW_TOGGLED_KEYS)
          : entries;
      if (kept.length > 0) {
        cleaned.toggled = Object.fromEntries(kept);
      }
    }

    const sort = value["sort"];
    if (isPlainObject(sort)) {
      const entries: [string, { column: string; direction: SortDirection }][] = [];
      for (const [key, raw] of Object.entries(sort)) {
        if (key.length > MAX_FIELD_VALUE_CHARS) continue;
        if (!isPlainObject(raw)) continue;
        const column = raw["column"];
        const direction = raw["direction"];
        if (typeof column !== "string" || column.length > MAX_FIELD_VALUE_CHARS) continue;
        if (
          typeof direction !== "string" ||
          !(SORT_DIRECTIONS as readonly string[]).includes(direction)
        ) {
          continue;
        }
        entries.push([key, { column, direction: direction as SortDirection }]);
      }
      const kept =
        entries.length > MAX_VIEW_SORT_KEYS
          ? entries.slice(entries.length - MAX_VIEW_SORT_KEYS)
          : entries;
      if (kept.length > 0) {
        cleaned.sort = Object.fromEntries(kept);
      }
    }

    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  } catch {
    return undefined;
  }
}
