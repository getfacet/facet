/**
 * The author-facing failure vocabulary.
 *
 * A rejected mutation produces **exactly one** `AuthorError` — the first fault
 * in deterministic source order — carrying where it is, what is wrong, and how
 * to fix it. There is no error array, no recovery, and no aggregation across
 * layers: the agent repairs one thing and retries, and the next call surfaces
 * the next first error.
 *
 * Determinism is the load-bearing property. `firstError` is a **total order**
 * over candidates, so the same input always names the same fault no matter what
 * order the checks happen to produce candidates in, and both copy fields are
 * clamped to `B-24` the same way every time. Nothing here reads a clock, a
 * random source, or a locale.
 *
 * **Surface.** `AuthorError`, `AuthorErrorCode` and `SourceLocation` are the
 * public contract — a consumer names them, and every layer that can reject an
 * authored mutation reports in exactly these terms. `AUTHOR_ERROR_CODES`,
 * `truncate`, `authorError` and `firstError` are package-internal: they are
 * exported only so the lexer, the parser and document validation can raise a
 * failure through the one builder that applies the `B-24` clamp, and they are
 * neither barrel-exported nor part of `@facet/core`'s API.
 */

import { BOUNDS } from "./bounds.js";

/**
 * The closed universe of author failures, in rank order.
 *
 * One vocabulary covers **both** layers that can reject an authored mutation —
 * the grammar (this package's lexer and parser) and semantic validation against
 * the active catalog and Data Model. A second vocabulary with a second rejection
 * shape would give the agent two ways to be told it was wrong, two field names
 * for the same location, and two rank orders that could disagree about which
 * fault comes first; the whole point of `AuthorError` is that there is one.
 *
 * The list is both the code vocabulary and the tiebreak used when two faults are
 * reported at the same source offset: earlier in this list wins. Ranking by a
 * declared list rather than by string comparison keeps the tiebreak stable when
 * a code is renamed. The two groups below are ordered grammar-first because a
 * document is only validated once it parses, so a grammar fault is always the
 * earlier answer when both could apply.
 *
 * The annotation is the array's half of the pin described on `AuthorErrorCode`:
 * a code listed here that the union does not declare is a compile error.
 *
 * @internal Package-internal; not part of `@facet/core`'s public surface.
 */
export const AUTHOR_ERROR_CODES: readonly AuthorErrorCode[] = Object.freeze([
  // Grammar: raised while reading the source into an ast.
  "invalid-source",
  "empty-markup",
  "markup-too-large",
  "too-many-nodes",
  "too-deep",
  "too-many-props",
  "value-too-long",
  "import-statement",
  "raw-html",
  "raw-css",
  "dangerous-prop",
  "event-handler",
  "spread",
  "jsx-expression",
  "inline-json",
  "raw-text-child",
  "unquoted-value",
  "missing-prop-value",
  "duplicate-prop",
  "empty-reference",
  "invalid-tag-name",
  "invalid-prop-name",
  "unexpected-token",
  "stray-closing-tag",
  "mismatched-closing-tag",
  "unclosed-element",
  "unterminated-tag",
  "unterminated-value",
  "unterminated-expression",

  // Semantic validation: raised once the markup parses, against the active
  // catalog and the Data Model. Ordered from the whole document inward — its
  // shape, then the tag, then the prop, then the value, then what the value
  // refers to — so the earlier code is the one that makes the later check
  // meaningless rather than merely the one a check happened to run first.
  "malformed-document",
  "misplaced-structural-tag",
  "too-many-screens",
  "unknown-tag",
  "children-not-accepted",
  "reserved-attribute",
  "undeclared-prop",
  "missing-required-prop",
  "invalid-value",
  "inline-structure",
  "unknown-scheme",
  "binding-not-allowed",
  "unresolved-binding",
  "unknown-screen",
  "invalid-action",
] as const);

/**
 * One member of the closed failure vocabulary.
 *
 * Spelled out as a literal union rather than derived from `AUTHOR_ERROR_CODES`.
 * The array is deliberately absent from `index.ts`, so `(typeof
 * AUTHOR_ERROR_CODES)[number]` would emit a public declaration naming a value a
 * consumer cannot import — a type that resolves inside this package and fails
 * at the package boundary. Writing the literals makes the emitted declaration
 * carry the codes themselves and name nothing off-barrel.
 *
 * The cost is two declarations of one vocabulary, so they are pinned against
 * each other in both directions. The array is annotated `readonly
 * AuthorErrorCode[]`, which rejects a code the union does not declare; and
 * `markup-errors.test.ts` compares the two as sets through a `Record` that is
 * exhaustive over this union, which rejects a code that reached only one side.
 */
export type AuthorErrorCode =
  // Grammar, in rank order.
  | "invalid-source"
  | "empty-markup"
  | "markup-too-large"
  | "too-many-nodes"
  | "too-deep"
  | "too-many-props"
  | "value-too-long"
  | "import-statement"
  | "raw-html"
  | "raw-css"
  | "dangerous-prop"
  | "event-handler"
  | "spread"
  | "jsx-expression"
  | "inline-json"
  | "raw-text-child"
  | "unquoted-value"
  | "missing-prop-value"
  | "duplicate-prop"
  | "empty-reference"
  | "invalid-tag-name"
  | "invalid-prop-name"
  | "unexpected-token"
  | "stray-closing-tag"
  | "mismatched-closing-tag"
  | "unclosed-element"
  | "unterminated-tag"
  | "unterminated-value"
  | "unterminated-expression"
  // Semantic validation, in rank order.
  | "malformed-document"
  | "misplaced-structural-tag"
  | "too-many-screens"
  | "unknown-tag"
  | "children-not-accepted"
  | "reserved-attribute"
  | "undeclared-prop"
  | "missing-required-prop"
  | "invalid-value"
  | "inline-structure"
  | "unknown-scheme"
  | "binding-not-allowed"
  | "unresolved-binding"
  | "unknown-screen"
  | "invalid-action";

/** A position in the author's markup source. `line` and `column` are 1-based. */
export interface SourceLocation {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/**
 * The single structured failure returned for a rejected authored mutation:
 * where it happened, what is wrong, and what to do about it. Both copy fields
 * are bounded by `B-24`.
 */
export interface AuthorError {
  readonly code: AuthorErrorCode;
  readonly location: SourceLocation;
  readonly cause: string;
  readonly repair: string;
}

/**
 * The visible marker a truncated string ends with. It is counted **inside** the
 * bound, so a clamped string is never longer than the bound it was clamped to.
 */
const TRUNCATION_MARKER = "…";

const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;

/**
 * Clamps `text` to `limit` characters, ending with the visible marker when it
 * had to cut. A cut that would split a surrogate pair backs off one unit, so
 * the result is always well-formed text and never a lone surrogate.
 *
 * @internal Package-internal; not part of `@facet/core`'s public surface.
 */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  let cut = limit - TRUNCATION_MARKER.length;
  const last = text.charCodeAt(cut - 1);
  if (last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST) {
    cut -= 1;
  }
  return `${text.slice(0, cut)}${TRUNCATION_MARKER}`;
}

/**
 * Builds one author failure. Both copy fields are clamped to `B-24` here — the
 * single place that produces an `AuthorError` — so no caller can widen the
 * bound by composing a longer message. Grammar faults and semantic-validation
 * faults are built the same way, which is what keeps the two layers reporting
 * one shape rather than two that merely look alike.
 *
 * @internal Package-internal; not part of `@facet/core`'s public surface.
 */
export function authorError(input: {
  readonly code: AuthorErrorCode;
  readonly location: SourceLocation;
  readonly cause: string;
  readonly repair: string;
}): AuthorError {
  return Object.freeze({
    code: input.code,
    location: Object.freeze({
      offset: input.location.offset,
      line: input.location.line,
      column: input.location.column,
    }),
    cause: truncate(input.cause, BOUNDS.frameworkCopyChars),
    repair: truncate(input.repair, BOUNDS.frameworkCopyChars),
  });
}

/**
 * The total order over candidate failures: source offset, then the declared
 * code rank, then the copy fields compared by code unit (never by locale, which
 * would make the answer depend on the host's collation).
 */
function compare(left: AuthorError, right: AuthorError): number {
  if (left.location.offset !== right.location.offset) {
    return left.location.offset - right.location.offset;
  }
  const leftRank = AUTHOR_ERROR_CODES.indexOf(left.code);
  const rightRank = AUTHOR_ERROR_CODES.indexOf(right.code);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  if (left.cause !== right.cause) {
    return left.cause < right.cause ? -1 : 1;
  }
  if (left.repair !== right.repair) {
    return left.repair < right.repair ? -1 : 1;
  }
  return 0;
}

/**
 * Picks the one failure to report from candidates discovered together — the
 * earliest under the total order above. Ties resolve to the first argument, so
 * the answer never depends on argument order for distinguishable candidates and
 * is stable for indistinguishable ones. At least one candidate is required, so
 * there is no "no error" case to handle at a call site that already has a fault.
 *
 * @internal Package-internal; not part of `@facet/core`'s public surface.
 */
export function firstError(first: AuthorError, ...rest: readonly AuthorError[]): AuthorError {
  let winner = first;
  for (const candidate of rest) {
    if (compare(candidate, winner) < 0) {
      winner = candidate;
    }
  }
  return winner;
}
