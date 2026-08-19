import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import * as markupErrors from "./markup-errors.js";
import {
  AUTHOR_ERROR_CODES,
  authorError,
  firstError,
  type AuthorError,
  type AuthorErrorCode,
  type SourceLocation,
} from "./markup-errors.js";

const at = (offset: number, line = 1, column = 1): SourceLocation => ({ offset, line, column });

const make = (
  code: AuthorErrorCode,
  location: SourceLocation,
  cause = "cause",
  repair = "repair",
): AuthorError => authorError({ code, location, cause, repair });

/**
 * Every code, mapped to the layer that raises it.
 *
 * This is the closure proof, and it works in both directions. A key here that is
 * not in `AuthorErrorCode` is a compile error, and a union member missing from
 * here is one too, because the annotation is an exhaustive `Record` over the
 * union — so this object's keys *are* the union's members, enumerated at
 * runtime. Comparing them against `AUTHOR_ERROR_CODES` below therefore pins the
 * union and the array — which are two separate declarations, see the note on
 * `AuthorErrorCode` — as the same set: a code that reaches only one side fails.
 * So the vocabulary cannot grow a code that no layer claims, and no layer can
 * claim a code the vocabulary does not declare.
 *
 * `"parse"` codes are raised by the lexer and parser in this package and are
 * proven reachable in `markup-parser.test.ts`. `"validation"` codes are raised
 * by document validation against the catalog and the Data Model; this module
 * owns their names and their rank, not the checks that raise them.
 */
const RAISED_BY: Readonly<Record<AuthorErrorCode, "parse" | "validation">> = Object.freeze({
  "invalid-source": "parse",
  "empty-markup": "parse",
  "markup-too-large": "parse",
  "too-many-nodes": "parse",
  "too-deep": "parse",
  "too-many-props": "parse",
  "value-too-long": "parse",
  "import-statement": "parse",
  "raw-html": "parse",
  "raw-css": "parse",
  "dangerous-prop": "parse",
  "event-handler": "parse",
  spread: "parse",
  "jsx-expression": "parse",
  "inline-json": "parse",
  "raw-text-child": "parse",
  "unquoted-value": "parse",
  "missing-prop-value": "parse",
  "duplicate-prop": "parse",
  "empty-reference": "parse",
  "invalid-tag-name": "parse",
  "invalid-prop-name": "parse",
  "unexpected-token": "parse",
  "stray-closing-tag": "parse",
  "mismatched-closing-tag": "parse",
  "unclosed-element": "parse",
  "unterminated-tag": "parse",
  "unterminated-value": "parse",
  "unterminated-expression": "parse",
  "malformed-document": "validation",
  "misplaced-structural-tag": "validation",
  "too-many-screens": "validation",
  "unknown-tag": "validation",
  "children-not-accepted": "validation",
  "slot-not-accepted": "validation",
  "missing-child-slot": "validation",
  "unknown-slot": "validation",
  "slot-tag-not-allowed": "validation",
  "missing-slot-children": "validation",
  "too-many-slot-children": "validation",
  "reserved-attribute": "validation",
  "undeclared-prop": "validation",
  "missing-required-prop": "validation",
  "invalid-value": "validation",
  "inline-structure": "validation",
  "unknown-scheme": "validation",
  "binding-not-allowed": "validation",
  "unresolved-binding": "validation",
  "unknown-screen": "validation",
  "invalid-action": "validation",
});

/** The codes document validation raises, read from the one declaration above. */
const VALIDATION_CODES: readonly AuthorErrorCode[] = (
  Object.keys(RAISED_BY) as readonly AuthorErrorCode[]
).filter((code) => RAISED_BY[code] === "validation");

describe("AUTHOR_ERROR_CODES — the closed code universe and its rank order", () => {
  it("is frozen so the rank order cannot drift at runtime", () => {
    expect(Object.isFrozen(AUTHOR_ERROR_CODES)).toBe(true);
  });

  it("lists every code exactly once — a duplicate would make the tiebreak ambiguous", () => {
    expect(new Set(AUTHOR_ERROR_CODES).size).toBe(AUTHOR_ERROR_CODES.length);
  });

  it("is non-empty", () => {
    expect(AUTHOR_ERROR_CODES.length).toBeGreaterThan(0);
  });

  it("is closed — the declared array and the AuthorErrorCode union name the same codes", () => {
    // `Object.keys(RAISED_BY)` enumerates the union's members (the Record is
    // exhaustive over it), so this is a set-equality between the two separate
    // declarations. A code added to only one of them fails here.
    expect([...AUTHOR_ERROR_CODES].sort()).toEqual(Object.keys(RAISED_BY).sort());
  });

  it("spells every code in one kebab-case convention, parse and validation alike", () => {
    for (const code of AUTHOR_ERROR_CODES) {
      expect(code).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
  });

  it("ranks every code — no code falls outside the total order firstError depends on", () => {
    for (const code of Object.keys(RAISED_BY) as readonly AuthorErrorCode[]) {
      expect(AUTHOR_ERROR_CODES.indexOf(code)).toBeGreaterThanOrEqual(0);
    }
  });

  it("covers semantic validation, so that layer needs no parallel vocabulary", () => {
    expect(VALIDATION_CODES.length).toBeGreaterThan(0);
    for (const code of VALIDATION_CODES) {
      expect(AUTHOR_ERROR_CODES).toContain(code);
    }
  });

  /**
   * A document is only validated once it parses, so when a grammar fault and a
   * semantic fault could both describe the same position, the grammar one is the
   * earlier answer. Ranking the whole grammar group ahead of the whole semantic
   * group is what makes `firstError` agree with that.
   */
  it("ranks every grammar code ahead of every semantic one", () => {
    const rank = (code: AuthorErrorCode): number => AUTHOR_ERROR_CODES.indexOf(code);
    const parseRanks = (Object.keys(RAISED_BY) as readonly AuthorErrorCode[])
      .filter((code) => RAISED_BY[code] === "parse")
      .map(rank);
    const validationRanks = VALIDATION_CODES.map(rank);
    expect(Math.max(...parseRanks)).toBeLessThan(Math.min(...validationRanks));
  });

  it("builds a well-formed error for every code, validation codes included", () => {
    for (const code of AUTHOR_ERROR_CODES) {
      const error = make(code, at(0));
      expect(error.code).toBe(code);
      expect(Object.isFrozen(error)).toBe(true);
    }
  });

  it("resolves a tie across the whole vocabulary to the first-ranked code", () => {
    const [head, ...tail] = AUTHOR_ERROR_CODES.map((code) => make(code, at(10)));
    if (!head) {
      throw new Error("the vocabulary is empty");
    }
    // Reversed as well, so the winner is the declared rank and not the order the
    // candidates happened to arrive in.
    expect(firstError(head, ...tail).code).toBe(AUTHOR_ERROR_CODES[0]);
    const [last, ...rest] = [...AUTHOR_ERROR_CODES].reverse().map((code) => make(code, at(10)));
    if (!last) {
      throw new Error("the vocabulary is empty");
    }
    expect(firstError(last, ...rest).code).toBe(AUTHOR_ERROR_CODES[0]);
  });
});

describe("markup-errors — the module surface", () => {
  /**
   * `AuthorError`, `AuthorErrorCode` and `SourceLocation` are the public surface;
   * they are types and leave no runtime binding. The four helpers below are
   * internal to `@facet/core` — the lexer, the parser and document validation
   * import them, but they are not barrel-exported and are not package API. This
   * asserts nothing further has leaked out.
   */
  it("exports exactly the four package-internal helpers at runtime", () => {
    expect(Object.keys(markupErrors).sort()).toEqual([
      "AUTHOR_ERROR_CODES",
      "authorError",
      "firstError",
      "truncate",
    ]);
  });
});

describe("authorError — shape", () => {
  it("carries exactly location, cause and repair alongside the code, in a fixed key order", () => {
    const error = make("raw-text-child", at(5, 2, 3), "why", "how");
    expect(Object.keys(error)).toEqual(["code", "location", "cause", "repair"]);
    expect(error).toEqual({
      code: "raw-text-child",
      location: { offset: 5, line: 2, column: 3 },
      cause: "why",
      repair: "how",
    });
  });

  it("freezes the error and its location so a consumer cannot mutate a reported failure", () => {
    const error = make("raw-text-child", at(0));
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.location)).toBe(true);
  });

  it("keeps the location key order fixed too, so serialization is byte-stable", () => {
    const error = make("raw-text-child", at(7, 3, 4));
    expect(Object.keys(error.location)).toEqual(["offset", "line", "column"]);
  });
});

describe("authorError — B-24 truncation table", () => {
  const limit = BOUNDS.frameworkCopyChars;

  const table: ReadonlyArray<{
    readonly field: "cause" | "repair";
    readonly length: number;
    readonly truncated: boolean;
    readonly why: string;
  }> = [
    { field: "cause", length: 0, truncated: false, why: "an empty cause is left alone" },
    { field: "cause", length: limit - 1, truncated: false, why: "one character below B-24" },
    { field: "cause", length: limit, truncated: false, why: "exactly B-24 is accepted as-is" },
    { field: "cause", length: limit + 1, truncated: true, why: "one character past B-24" },
    { field: "cause", length: limit * 4, truncated: true, why: "far past B-24" },
    { field: "repair", length: limit, truncated: false, why: "exactly B-24 is accepted as-is" },
    { field: "repair", length: limit + 1, truncated: true, why: "one character past B-24" },
  ];

  it.each(table)("$field of $length characters — $why", ({ field, length, truncated }) => {
    const text = "z".repeat(length);
    const error =
      field === "cause"
        ? make("raw-text-child", at(0), text, "repair")
        : make("raw-text-child", at(0), "cause", text);
    const value = error[field];

    expect(value.length).toBeLessThanOrEqual(limit);
    if (truncated) {
      expect(value.length).toBe(limit);
      expect(value.endsWith("…")).toBe(true);
    } else {
      expect(value).toBe(text);
    }
  });

  it("counts the visible truncation marker inside B-24 rather than appending past it", () => {
    const error = make("raw-text-child", at(0), "z".repeat(limit + 100), "repair");
    expect(error.cause.length).toBe(limit);
    expect(error.cause).toBe(`${"z".repeat(limit - 1)}…`);
  });

  it("never splits a surrogate pair when it truncates", () => {
    // A run of astral characters (2 code units each) crossing the limit on an odd boundary.
    const error = make("raw-text-child", at(0), "🙂".repeat(limit), "repair");
    expect(error.cause.length).toBeLessThanOrEqual(limit);
    expect([...error.cause].every((char) => char === "🙂" || char === "…")).toBe(true);
    expect(error.cause.endsWith("…")).toBe(true);
  });

  it("is deterministic — truncating the same text twice yields byte-identical copy", () => {
    const text = "z".repeat(limit * 3);
    const a = make("raw-text-child", at(0), text, text);
    const b = make("raw-text-child", at(0), text, text);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("firstError — the deterministic ordering rule", () => {
  it("orders by source offset first — the earliest fault wins", () => {
    const early = make("raw-text-child", at(3));
    const late = make("jsx-expression", at(40));
    expect(firstError(late, early)).toBe(early);
    expect(firstError(early, late)).toBe(early);
  });

  it("ignores line and column when the offset already decides", () => {
    const early = make("raw-text-child", at(3, 9, 9));
    const late = make("raw-text-child", at(4, 1, 1));
    expect(firstError(late, early)).toBe(early);
  });

  it("breaks an offset tie by the AUTHOR_ERROR_CODES rank, not by argument order", () => {
    const one = make("raw-text-child", at(10));
    const other = make("jsx-expression", at(10));
    const rankOfOne = AUTHOR_ERROR_CODES.indexOf(one.code);
    const rankOfOther = AUTHOR_ERROR_CODES.indexOf(other.code);
    expect(rankOfOne).toBeGreaterThanOrEqual(0);
    expect(rankOfOther).toBeGreaterThanOrEqual(0);
    const expected = rankOfOne < rankOfOther ? one : other;
    expect(firstError(one, other)).toBe(expected);
    expect(firstError(other, one)).toBe(expected);
  });

  it("breaks an offset-and-code tie by cause, comparing code units rather than locale", () => {
    const a = make("raw-text-child", at(10), "a cause");
    const b = make("raw-text-child", at(10), "b cause");
    expect(firstError(b, a)).toBe(a);
    expect(firstError(a, b)).toBe(a);
  });

  it("breaks a cause tie by repair", () => {
    const a = make("raw-text-child", at(10), "same", "a repair");
    const b = make("raw-text-child", at(10), "same", "b repair");
    expect(firstError(b, a)).toBe(a);
  });

  it("is stable — fully equal candidates resolve to the first argument", () => {
    const a = make("raw-text-child", at(10), "same", "same");
    const b = make("raw-text-child", at(10), "same", "same");
    expect(firstError(a, b)).toBe(a);
    expect(firstError(b, a)).toBe(b);
  });

  it("returns its only candidate when there is one", () => {
    const only = make("spread", at(2));
    expect(firstError(only)).toBe(only);
  });

  it("is order-independent — every permutation of the same candidates yields the same winner", () => {
    const a = make("raw-text-child", at(30));
    const b = make("jsx-expression", at(10));
    const c = make("spread", at(20));
    const permutations: ReadonlyArray<readonly [AuthorError, AuthorError, AuthorError]> = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    for (const [x, y, z] of permutations) {
      expect(firstError(x, y, z)).toBe(b);
    }
  });

  it("yields byte-identical output across repeat runs", () => {
    const a = make("raw-text-child", at(30));
    const b = make("jsx-expression", at(10));
    const c = make("spread", at(20));
    const runs = Array.from({ length: 5 }, () => JSON.stringify(firstError(a, b, c)));
    expect(new Set(runs).size).toBe(1);
  });
});
