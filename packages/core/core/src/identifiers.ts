/**
 * The identifier and data-path grammars.
 *
 * Both are closed and conservative: an identifier is ASCII, starts with a
 * letter, and continues with letters, digits, `_` or `-`. Nothing else is
 * admitted — in particular no `.` (the data-path separator), no `:` (reserved
 * for the `data:`, `nav:` and `agent:` reference prefixes), no whitespace,
 * no control characters, and no non-ASCII scripts. Because the first character
 * must be a letter, prototype-shaped names such as `__proto__` are rejected by
 * construction.
 *
 * Both functions are **total**: they never throw, for any input of any type.
 * Validation is a fail-safe boundary, so an unexpected value is a rejection,
 * never an exception.
 */

import { BOUNDS } from "./bounds.js";

/** Anchored, non-global (so it holds no `lastIndex` state) and backtracking-free. */
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const PATH_SEPARATOR = ".";

/**
 * The longest string that could still be a legal path: B-14 maximal segments
 * of B-06 characters, joined by separators. Checked before splitting so that
 * a pathological input is rejected in constant work.
 */
const MAX_DATA_PATH_CHARS =
  BOUNDS.dataPathDepth * BOUNDS.identifierChars + (BOUNDS.dataPathDepth - 1);

/** A validated data path: a frozen, non-empty list of named key segments. */
export type DataPath = readonly [string, ...string[]];

/**
 * Whether `value` is a legal Facet identifier — a tag, prop, screen, event,
 * field or data-segment name of at most B-06 characters.
 */
export function isFacetIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= BOUNDS.identifierChars &&
    IDENTIFIER_PATTERN.test(value)
  );
}

/**
 * Parses a dotted data path into its segments, or returns `null` if the input
 * is not a legal path.
 *
 * Segments are **named keys only** (D-06): every segment must be a Facet
 * identifier, so an index segment such as `sales.rows.4200` is rejected —
 * positional addressing into the Data Model is not part of the grammar. Depth
 * is bounded by B-14 and each segment by B-06.
 *
 * `null` is the entire rejection vocabulary; there is no error hierarchy. The
 * caller decides what an unresolvable reference means in its own layer.
 */
export function parseDataPath(value: unknown): DataPath | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.length === 0 || value.length > MAX_DATA_PATH_CHARS) {
    return null;
  }
  const segments = value.split(PATH_SEPARATOR);
  if (segments.length > BOUNDS.dataPathDepth) {
    return null;
  }
  for (const segment of segments) {
    if (!isFacetIdentifier(segment)) {
      return null;
    }
  }
  const path = segments as [string, ...string[]];
  return Object.freeze(path);
}
