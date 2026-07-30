import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { isFacetIdentifier, parseDataPath } from "./identifiers.js";

/** Inputs that are not strings at all — the grammar must stay total on them. */
const NON_STRINGS: readonly unknown[] = [
  undefined,
  null,
  0,
  42,
  NaN,
  true,
  false,
  {},
  [],
  ["sales", "rows"],
  Symbol("sales"),
  () => "sales",
  new Date(0),
  Object.create(null),
];

describe("isFacetIdentifier — accepted grammar", () => {
  const accepted: ReadonlyArray<{ readonly input: string; readonly why: string }> = [
    { input: "a", why: "a single letter is the shortest identifier" },
    { input: "Card", why: "a capitalised component tag" },
    { input: "maxHeight", why: "a camelCase prop name" },
    { input: "sales_rows", why: "an underscore separator" },
    { input: "data-id", why: "a hyphen separator" },
    { input: "x1", why: "digits after the first letter" },
    { input: "Screen2_a-b", why: "letters, digits and both separators" },
    { input: "z".repeat(64), why: "exactly B-06 characters" },
  ];

  it.each(accepted)("accepts $input — $why", ({ input }) => {
    expect(isFacetIdentifier(input)).toBe(true);
  });
});

describe("isFacetIdentifier — rejected grammar", () => {
  const rejected: ReadonlyArray<{ readonly input: string; readonly why: string }> = [
    { input: "", why: "empty is not an identifier" },
    { input: "1abc", why: "must start with a letter, not a digit" },
    { input: "-abc", why: "must start with a letter, not a separator" },
    { input: "_abc", why: "must start with a letter, not an underscore" },
    { input: "__proto__", why: "prototype-shaped names start with _" },
    { input: "a b", why: "whitespace is outside the closed grammar" },
    { input: " a", why: "leading whitespace is not trimmed away" },
    { input: "a\n", why: "control characters are rejected" },
    {
      input: "a.b",
      why: "a dot is the data-path separator, never part of a segment",
    },
    {
      input: "data:sales",
      why: "a colon is reserved for data:/nav:/agent: references",
    },
    { input: "a/b", why: "path separators are outside the grammar" },
    { input: "a$b", why: "punctuation is outside the closed grammar" },
    { input: "a*", why: "wildcards are outside the closed grammar" },
    { input: "café", why: "non-ASCII letters are outside the grammar" },
    { input: "日本語", why: "non-ASCII scripts are outside the grammar" },
    { input: "a\u0000b", why: "a NUL byte is rejected" },
    { input: "z".repeat(65), why: "one character past B-06" },
  ];

  it.each(rejected)("rejects $input — $why", ({ input }) => {
    expect(isFacetIdentifier(input)).toBe(false);
  });

  it("is total — returns false rather than throwing on non-string input", () => {
    for (const input of NON_STRINGS) {
      expect(() => isFacetIdentifier(input)).not.toThrow();
      expect(isFacetIdentifier(input)).toBe(false);
    }
  });

  it("is stateless across repeated calls on the same input", () => {
    const identifier = "sales_rows";
    expect(isFacetIdentifier(identifier)).toBe(true);
    expect(isFacetIdentifier(identifier)).toBe(true);
    expect(isFacetIdentifier(identifier)).toBe(true);
  });
});

describe("parseDataPath — accepted paths", () => {
  it("parses a single named segment", () => {
    expect(parseDataPath("sales")).toEqual(["sales"]);
  });

  it("parses a dotted chain of named keys", () => {
    expect(parseDataPath("sales.rows.total")).toEqual(["sales", "rows", "total"]);
  });

  it("accepts every separator the identifier grammar allows inside a segment", () => {
    expect(parseDataPath("sales_2024.line-items")).toEqual(["sales_2024", "line-items"]);
  });

  it("returns a frozen segment list the caller cannot mutate", () => {
    const path = parseDataPath("sales.rows");
    expect(path).not.toBeNull();
    expect(Object.isFrozen(path)).toBe(true);
  });
});

describe("parseDataPath — rejected paths (D-06: named keys only)", () => {
  it("rejects an index segment — sales.rows.4200 is not a data path, because D-06 admits named keys only", () => {
    expect(parseDataPath("sales.rows.4200")).toBeNull();
  });

  it("rejects a bare numeric index as the only segment", () => {
    expect(parseDataPath("0")).toBeNull();
  });

  it("rejects bracket index syntax", () => {
    expect(parseDataPath("sales.rows[0]")).toBeNull();
    expect(parseDataPath("sales.rows[0].total")).toBeNull();
  });

  it("rejects a negative or float-looking segment", () => {
    expect(parseDataPath("sales.-1")).toBeNull();
    expect(parseDataPath("sales.1.5")).toBeNull();
  });

  const malformed: ReadonlyArray<{
    readonly input: string;
    readonly why: string;
  }> = [
    { input: "", why: "empty is not a path" },
    { input: ".", why: "a lone separator has no named key" },
    { input: ".sales", why: "a leading dot makes an empty segment" },
    { input: "sales.", why: "a trailing dot makes an empty segment" },
    { input: "sales..rows", why: "a doubled dot makes an empty segment" },
    { input: " sales.rows", why: "whitespace is not trimmed away" },
    { input: "sales.rows ", why: "trailing whitespace is not trimmed away" },
    { input: "data:sales.rows", why: "the reference prefix is not a segment" },
    { input: "sales.*", why: "wildcards are outside the grammar" },
    { input: "sales/rows", why: "slash is not the path separator" },
    { input: "sales.__proto__", why: "prototype-shaped segments are rejected" },
    { input: "sales.rows\u0000", why: "a NUL byte is rejected" },
  ];

  it.each(malformed)("rejects $input — $why", ({ input }) => {
    expect(parseDataPath(input)).toBeNull();
  });

  it("rejects a segment longer than B-06 even within the depth bound", () => {
    expect(parseDataPath(`sales.${"z".repeat(65)}`)).toBeNull();
  });

  it("is total — returns null rather than throwing on non-string input", () => {
    for (const input of NON_STRINGS) {
      expect(() => parseDataPath(input)).not.toThrow();
      expect(parseDataPath(input)).toBeNull();
    }
  });

  it("is total on pathologically long input", () => {
    const huge = "sales.".repeat(100_000);
    expect(() => parseDataPath(huge)).not.toThrow();
    expect(parseDataPath(huge)).toBeNull();
    const wide = "z".repeat(1_000_000);
    expect(() => parseDataPath(wide)).not.toThrow();
    expect(parseDataPath(wide)).toBeNull();
  });
});

describe("parseDataPath — bound wiring", () => {
  it("reads its depth limit from BOUNDS rather than a local copy", () => {
    const atLimit = Array.from({ length: BOUNDS.dataPathDepth }, (_, index) => `k${index}`);
    expect(parseDataPath(atLimit.join("."))).toEqual(atLimit);
    expect(parseDataPath([...atLimit, "extra"].join("."))).toBeNull();
  });

  it("reads its segment length limit from BOUNDS", () => {
    const atLimit = "z".repeat(BOUNDS.identifierChars);
    expect(parseDataPath(atLimit)).toEqual([atLimit]);
    expect(parseDataPath("z".repeat(BOUNDS.identifierChars + 1))).toBeNull();
  });
});
