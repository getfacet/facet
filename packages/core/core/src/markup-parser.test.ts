import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { AUTHOR_ERROR_CODES, type AuthorError, type AuthorErrorCode } from "./markup-errors.js";
import * as markupParser from "./markup-parser.js";
import {
  parseMarkup,
  type MarkupAst,
  type MarkupNode,
  type ParseMarkupResult,
} from "./markup-parser.js";

/**
 * Structural recogniser for a reported failure, used to *count* the errors a
 * result carries. The one-error rule is only meaningful if it is asserted as a
 * count: "an error exists" would pass just as happily against an error array.
 */
function isAuthorErrorShape(value: unknown): value is AuthorError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["code"] === "string" &&
    typeof candidate["cause"] === "string" &&
    typeof candidate["repair"] === "string" &&
    typeof candidate["location"] === "object" &&
    candidate["location"] !== null
  );
}

/** Counts every AuthorError-shaped value anywhere in a result graph. */
function countAuthorErrors(value: unknown): number {
  if (isAuthorErrorShape(value)) {
    return 1;
  }
  if (Array.isArray(value)) {
    return value.reduce<number>((total, item) => total + countAuthorErrors(item), 0);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (total, item) => total + countAuthorErrors(item),
      0,
    );
  }
  return 0;
}

/** Asserts the whole-result contract for a rejection and returns the one error. */
function expectSingleError(result: ParseMarkupResult, code: AuthorErrorCode): AuthorError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected a rejection");
  }
  expect(countAuthorErrors(result)).toBe(1);
  expect(Object.keys(result)).toEqual(["ok", "error"]);
  expect(result.error.code).toBe(code);
  expect(result.error.cause.length).toBeGreaterThan(0);
  expect(result.error.repair.length).toBeGreaterThan(0);
  expect(result.error.cause.length).toBeLessThanOrEqual(BOUNDS.frameworkCopyChars);
  expect(result.error.repair.length).toBeLessThanOrEqual(BOUNDS.frameworkCopyChars);
  return result.error;
}

/** Asserts acceptance and returns the AST roots. */
function expectRoots(result: ParseMarkupResult): readonly MarkupNode[] {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.error.code}: ${result.error.cause}`);
  }
  expect(countAuthorErrors(result)).toBe(0);
  return result.ast.roots;
}

describe("parseMarkup — the accepted grammar", () => {
  it("parses a single self-closing element", () => {
    const roots = expectRoots(parseMarkup("<Text />"));
    expect(roots).toHaveLength(1);
    expect(roots[0]?.tag).toBe("Text");
    expect(roots[0]?.props).toEqual([]);
    expect(roots[0]?.children).toEqual([]);
    expect(roots[0]?.location).toEqual({ offset: 0, line: 1, column: 1 });
  });

  it("parses an element with an explicit closing tag", () => {
    const roots = expectRoots(parseMarkup("<Screen></Screen>"));
    expect(roots).toHaveLength(1);
    expect(roots[0]?.tag).toBe("Screen");
    expect(roots[0]?.children).toEqual([]);
  });

  it("parses nested component children", () => {
    const roots = expectRoots(parseMarkup("<Screen><Stack><Text /></Stack></Screen>"));
    const screen = roots[0];
    expect(screen?.tag).toBe("Screen");
    expect(screen?.children).toHaveLength(1);
    expect(screen?.children[0]?.tag).toBe("Stack");
    expect(screen?.children[0]?.children[0]?.tag).toBe("Text");
  });

  it("parses sibling roots", () => {
    const roots = expectRoots(parseMarkup("<Screen /><Screen />"));
    expect(roots.map((root) => root.tag)).toEqual(["Screen", "Screen"]);
  });

  it("treats whitespace between tags as insignificant", () => {
    const roots = expectRoots(parseMarkup("\n  <Screen>\n    <Text />\n  </Screen>\n  "));
    expect(roots).toHaveLength(1);
    expect(roots[0]?.children).toHaveLength(1);
  });

  it("parses a quoted scalar prop under either quote character", () => {
    const roots = expectRoots(parseMarkup(`<Text label="Revenue" tone='calm' />`));
    expect(roots[0]?.props).toEqual([
      {
        name: "label",
        value: { kind: "scalar", value: "Revenue" },
        location: { offset: 6, line: 1, column: 7 },
        valueLocation: { offset: 12, line: 1, column: 13 },
      },
      {
        name: "tone",
        value: { kind: "scalar", value: "calm" },
        location: { offset: 22, line: 1, column: 23 },
        valueLocation: { offset: 27, line: 1, column: 28 },
      },
    ]);
  });

  it("accepts an empty quoted scalar", () => {
    const roots = expectRoots(parseMarkup(`<Text label="" />`));
    expect(roots[0]?.props[0]?.value).toEqual({ kind: "scalar", value: "" });
  });

  it("keeps a scalar's inner whitespace and punctuation verbatim", () => {
    const roots = expectRoots(parseMarkup(`<Text label="  July 2026 — up 4%  " />`));
    expect(roots[0]?.props[0]?.value).toEqual({
      kind: "scalar",
      value: "  July 2026 — up 4%  ",
    });
  });

  it("parses the three reference schemes", () => {
    const roots = expectRoots(
      parseMarkup(
        `<Metric value="data:sales.rows.total" /><Button action="nav:overview" /><Button action="agent:refresh" />`,
      ),
    );
    expect(roots[0]?.props[0]?.value).toEqual({
      kind: "reference",
      scheme: "data",
      target: "sales.rows.total",
    });
    expect(roots[1]?.props[0]?.value).toEqual({
      kind: "reference",
      scheme: "nav",
      target: "overview",
    });
    expect(roots[2]?.props[0]?.value).toEqual({
      kind: "reference",
      scheme: "agent",
      target: "refresh",
    });
  });

  it("does not mistake an ordinary scalar containing a colon for a reference", () => {
    const roots = expectRoots(parseMarkup(`<Text label="Total: 5" />`));
    expect(roots[0]?.props[0]?.value).toEqual({ kind: "scalar", value: "Total: 5" });
  });

  it("accepts the reserved read-only id attribute, which the read grammar emits", () => {
    const roots = expectRoots(parseMarkup(`<Text id="n7" label="Revenue" />`));
    expect(roots[0]?.props[0]?.name).toBe("id");
  });

  it("reports the node count so a caller can measure a mutation", () => {
    const result = parseMarkup("<Screen><Stack><Text /><Text /></Stack></Screen>");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.ast.nodeCount).toBe(4);
  });

  it("returns a frozen AST the caller cannot mutate", () => {
    const result = parseMarkup(`<Screen><Text label="a" /></Screen>`);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(Object.isFrozen(result.ast)).toBe(true);
    expect(Object.isFrozen(result.ast.roots)).toBe(true);
    const screen = result.ast.roots[0];
    expect(Object.isFrozen(screen)).toBe(true);
    expect(Object.isFrozen(screen?.children)).toBe(true);
    expect(Object.isFrozen(screen?.props)).toBe(true);
    expect(Object.isFrozen(screen?.children[0]?.props[0])).toBe(true);
  });

  it("tracks line and column across newlines", () => {
    const roots = expectRoots(parseMarkup("<Screen>\n  <Text />\n</Screen>"));
    expect(roots[0]?.children[0]?.location).toEqual({ offset: 11, line: 2, column: 3 });
  });
});

describe("parseMarkup — the eight forbidden constructs, each exactly one error", () => {
  const forbidden: ReadonlyArray<{
    readonly construct: string;
    readonly source: string;
    readonly code: AuthorErrorCode;
  }> = [
    {
      construct: "raw text child",
      source: "<Stack>This month's revenue</Stack>",
      code: "raw-text-child",
    },
    {
      construct: "JSX expression child",
      source: "<Stack>{revenue}</Stack>",
      code: "jsx-expression",
    },
    {
      construct: "JSX expression prop value",
      source: "<Text label={revenue} />",
      code: "jsx-expression",
    },
    {
      construct: "event handler prop",
      source: `<Button onClick="runCode" />`,
      code: "event-handler",
    },
    {
      construct: "import statement",
      source: `import Button from "./button.js";\n<Button />`,
      code: "import-statement",
    },
    {
      construct: "spread",
      source: "<Stack {...props} />",
      code: "spread",
    },
    {
      construct: "script tag",
      source: "<script>alert(1)</script>",
      code: "raw-html",
    },
    {
      construct: "unquoted attribute value",
      source: "<Text label=Revenue />",
      code: "unquoted-value",
    },
    {
      construct: "unquoted numeric attribute value",
      source: "<Table pageSize=25 />",
      code: "unquoted-value",
    },
    {
      construct: "inline object JSON",
      source: `<Table config='{"unsafe":true}' />`,
      code: "inline-json",
    },
    {
      construct: "inline array JSON",
      source: `<Table rows='[1,2,3]' />`,
      code: "inline-json",
    },
  ];

  it.each(forbidden)("$construct is exactly one $code error", ({ source, code }) => {
    expectSingleError(parseMarkup(source), code);
  });

  it("rejects raw CSS through a style prop", () => {
    expectSingleError(parseMarkup(`<Text style="color: red" />`), "raw-css");
  });

  it("rejects a raw CSS block through the style tag", () => {
    expectSingleError(parseMarkup("<style>.a{color:red}</style>"), "raw-html");
  });

  it("rejects every lowercase HTML tag as a raw-HTML escape hatch", () => {
    for (const tag of ["div", "span", "iframe", "img", "a"]) {
      expectSingleError(parseMarkup(`<${tag}></${tag}>`), "raw-html");
    }
  });

  it("rejects the innerHTML escape hatch prop", () => {
    expectSingleError(parseMarkup(`<Text dangerouslySetInnerHTML="<b>x</b>" />`), "dangerous-prop");
  });

  it("rejects a spread in child position", () => {
    expectSingleError(parseMarkup("<Stack>{...children}</Stack>"), "spread");
  });

  it("rejects a valueless boolean-shorthand prop", () => {
    expectSingleError(parseMarkup("<Button disabled />"), "missing-prop-value");
  });

  it("rejects a duplicated prop rather than silently keeping one", () => {
    expectSingleError(parseMarkup(`<Text label="a" label="b" />`), "duplicate-prop");
  });

  it("rejects every handler-shaped prop name", () => {
    for (const name of ["onClick", "onChange", "onSubmit", "onKeyDown"]) {
      expectSingleError(parseMarkup(`<Button ${name}="x" />`), "event-handler");
    }
  });

  it("rejects an empty reference target", () => {
    for (const value of ["data:", "nav:", "agent:"]) {
      expectSingleError(parseMarkup(`<Button action="${value}" />`), "empty-reference");
    }
  });

  it("keeps a value delimited by one quote character able to carry the other verbatim", () => {
    const roots = expectRoots(parseMarkup(`<Text label='it says "hi"' />`));
    expect(roots[0]?.props[0]?.value).toEqual({ kind: "scalar", value: `it says "hi"` });
  });
});

describe("parseMarkup — malformed markup", () => {
  const malformed: ReadonlyArray<{
    readonly source: string;
    readonly code: AuthorErrorCode;
    readonly why: string;
  }> = [
    { source: "", code: "empty-markup", why: "an empty call carries no markup" },
    { source: "   \n  ", code: "empty-markup", why: "whitespace only is not markup" },
    { source: "<Text", code: "unterminated-tag", why: "the tag never ends" },
    {
      source: `<Text label="unterminated />`,
      code: "unterminated-value",
      why: "the quote never closes",
    },
    {
      source: "<Stack>{unterminated</Stack>",
      code: "unterminated-expression",
      why: "the brace never closes",
    },
    { source: "<Screen>", code: "unclosed-element", why: "the element is never closed" },
    {
      source: "<Screen><Stack></Screen>",
      code: "mismatched-closing-tag",
      why: "the closing tag names another element",
    },
    { source: "</Screen>", code: "stray-closing-tag", why: "there is nothing open to close" },
    {
      source: "<Screen /></Screen>",
      code: "stray-closing-tag",
      why: "the element already self-closed",
    },
    {
      source: "< Screen />",
      code: "invalid-tag-name",
      why: "a tag name must follow the angle bracket",
    },
    { source: "<1Screen />", code: "invalid-tag-name", why: "a tag name must start with a letter" },
    {
      source: `<Text 1label="a" />`,
      code: "invalid-prop-name",
      why: "a prop name must start with a letter",
    },
    {
      source: `<Text label:x="a" />`,
      code: "invalid-prop-name",
      why: "a colon is not part of a prop name",
    },
    {
      source: `<Text label="a" "b" />`,
      code: "unexpected-token",
      why: "a bare string is not a prop",
    },
    { source: `<Text = "a" />`, code: "unexpected-token", why: "an equals sign needs a prop name" },
    {
      source: "<Text @ />",
      code: "invalid-prop-name",
      why: "the character is outside the grammar",
    },
  ];

  it.each(malformed)("rejects $source as $code — $why", ({ source, code }) => {
    expectSingleError(parseMarkup(source), code);
  });

  it("rejects a tag name longer than B-06", () => {
    expectSingleError(
      parseMarkup(`<A${"z".repeat(BOUNDS.identifierChars)} />`),
      "invalid-tag-name",
    );
  });

  it("accepts a tag name of exactly B-06 characters", () => {
    const tag = `A${"z".repeat(BOUNDS.identifierChars - 1)}`;
    expect(expectRoots(parseMarkup(`<${tag} />`))[0]?.tag).toBe(tag);
  });

  it("rejects a prop name longer than B-06", () => {
    expectSingleError(
      parseMarkup(`<Text a${"z".repeat(BOUNDS.identifierChars)}="v" />`),
      "invalid-prop-name",
    );
  });

  it("accepts a prop name of exactly B-06 characters", () => {
    const name = `a${"z".repeat(BOUNDS.identifierChars - 1)}`;
    expect(expectRoots(parseMarkup(`<Text ${name}="v" />`))[0]?.props[0]?.name).toBe(name);
  });
});

describe("parseMarkup — the one deterministic first error (DC-005)", () => {
  /** The intake's Example 4, verbatim: four faults, one reported error. */
  const example4 = [
    "<Stack>",
    "  This month's revenue",
    `  <UnknownWidget onClick="{runCode()}" config='{"unsafe":true}' />`,
    `  <Metric label="Missing total" value="data:missing.total" />`,
    "</Stack>",
  ].join("\n");

  it("reports the raw text child — the first fault in source order — and nothing else", () => {
    const error = expectSingleError(parseMarkup(example4), "raw-text-child");
    expect(error.location).toEqual({
      offset: example4.indexOf("This month"),
      line: 2,
      column: 3,
    });
  });

  it("does not aggregate the later handler, inline-JSON and unknown-tag faults", () => {
    const result = parseMarkup(example4);
    expect(countAuthorErrors(result)).toBe(1);
    expect(JSON.stringify(result)).not.toContain("onClick");
    expect(JSON.stringify(result)).not.toContain("unsafe");
  });

  it("surfaces the next first error once the earlier fault is repaired", () => {
    const repaired = example4.replace("  This month's revenue\n", "");
    const error = expectSingleError(parseMarkup(repaired), "event-handler");
    expect(error.location.offset).toBe(repaired.indexOf("onClick"));
  });

  const multiFault: ReadonlyArray<{
    readonly source: string;
    readonly code: AuthorErrorCode;
    readonly why: string;
  }> = [
    {
      source: "<Stack>text {expr}</Stack>",
      code: "raw-text-child",
      why: "the text precedes the expression",
    },
    {
      source: "<Stack>{expr} text</Stack>",
      code: "jsx-expression",
      why: "the expression precedes the text",
    },
    {
      source: `<Text onClick="a" style="b" />`,
      code: "event-handler",
      why: "the handler prop precedes the style prop",
    },
    {
      source: `<Text style="b" onClick="a" />`,
      code: "raw-css",
      why: "the style prop precedes the handler prop",
    },
    {
      source: `<script>x</script><Stack>text</Stack>`,
      code: "raw-html",
      why: "the script tag precedes the raw text",
    },
    {
      source: `<Text label=raw config='{"a":1}' />`,
      code: "unquoted-value",
      why: "the unquoted value precedes the inline JSON",
    },
    {
      source: `<Text config='{"a":1}' label=raw />`,
      code: "inline-json",
      why: "the inline JSON precedes the unquoted value",
    },
  ];

  it.each(multiFault)("reports $code for $source — $why", ({ source, code }) => {
    expectSingleError(parseMarkup(source), code);
  });

  it("reports a code drawn from the closed AUTHOR_ERROR_CODES universe", () => {
    for (const { source } of multiFault) {
      const result = parseMarkup(source);
      expect(result.ok).toBe(false);
      if (result.ok) {
        continue;
      }
      expect(AUTHOR_ERROR_CODES).toContain(result.error.code);
    }
  });
});

describe("parseMarkup — determinism", () => {
  /**
   * Each entry pins the outcome as well as the source. Byte-identity alone is
   * satisfied by any constant function, so the expected code is asserted in the
   * same test: the contract is a byte-identical *first error*, not merely a
   * byte-identical answer. `null` marks the one entry that is accepted.
   */
  const corpus: ReadonlyArray<{
    readonly source: string;
    readonly code: AuthorErrorCode | null;
  }> = [
    { source: "<Stack>This month's revenue</Stack>", code: "raw-text-child" },
    { source: "<Stack>{revenue}</Stack>", code: "jsx-expression" },
    { source: `<Button onClick="runCode" />`, code: "event-handler" },
    { source: `import Button from "./button.js";\n<Button />`, code: "import-statement" },
    { source: "<Stack {...props} />", code: "spread" },
    { source: "<script>alert(1)</script>", code: "raw-html" },
    { source: "<Text label=Revenue />", code: "unquoted-value" },
    { source: `<Table config='{"unsafe":true}' />`, code: "inline-json" },
    { source: "<Screen>", code: "unclosed-element" },
    { source: "</Screen>", code: "stray-closing-tag" },
    { source: "", code: "empty-markup" },
    { source: `<Screen><Text label="ok" /></Screen>`, code: null },
  ];

  it.each(corpus)(
    "yields byte-identical output across repeat runs for $source",
    ({ source, code }) => {
      if (code === null) {
        expect(expectRoots(parseMarkup(source))).not.toHaveLength(0);
      } else {
        expectSingleError(parseMarkup(source), code);
      }
      const runs = Array.from({ length: 5 }, () => JSON.stringify(parseMarkup(source)));
      expect(new Set(runs).size).toBe(1);
      expect(runs[0]).toBe(JSON.stringify(parseMarkup(source)));
    },
  );

  it("is stateless — interleaving other parses does not change a result", () => {
    const target = `<Table config='{"unsafe":true}' />`;
    expectSingleError(parseMarkup(target), "inline-json");
    const before = JSON.stringify(parseMarkup(target));
    for (const { source } of corpus) {
      parseMarkup(source);
    }
    expect(JSON.stringify(parseMarkup(target))).toBe(before);
    expectSingleError(parseMarkup(target), "inline-json");
  });

  it("keeps the error key order fixed so the serialized bytes are stable", () => {
    const result = parseMarkup("<Stack>text</Stack>");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(Object.keys(result.error)).toEqual(["code", "location", "cause", "repair"]);
    expect(Object.keys(result.error.location)).toEqual(["offset", "line", "column"]);
  });
});

describe("parseMarkup — totality", () => {
  const nonStrings: readonly unknown[] = [
    undefined,
    null,
    0,
    42,
    NaN,
    true,
    false,
    {},
    [],
    ["<Text />"],
    Symbol("<Text />"),
    () => "<Text />",
    new Date(0),
    Object.create(null),
  ];

  it("never throws on non-string input and rejects it instead", () => {
    for (const source of nonStrings) {
      expect(() => parseMarkup(source)).not.toThrow();
      expectSingleError(parseMarkup(source), "invalid-source");
    }
  });

  it("never throws on adversarial input that stays inside B-01", () => {
    const adversarial: readonly string[] = [
      "<".repeat(1_000),
      ">".repeat(1_000),
      "{".repeat(1_000),
      `"`.repeat(1_000),
      "<Screen>".repeat(1_000),
      "</Screen>".repeat(1_000),
      "<Text ".repeat(1_000),
      "<Text=/>",
      "<Text ='v' />",
    ];
    for (const source of adversarial) {
      expect(source.length).toBeLessThanOrEqual(BOUNDS.markupSourceChars);
      expect(() => parseMarkup(source)).not.toThrow();
      expect(parseMarkup(source).ok).toBe(false);
    }
  });

  it("accepts insignificant whitespace anywhere a token boundary allows it", () => {
    for (const source of [" <Text />", "<Text  />", "<Text\n/>", "<Text\tlabel = 'v' />"]) {
      expect(expectRoots(parseMarkup(source))).toHaveLength(1);
    }
  });

  it("terminates on deeply nested markup instead of overflowing the stack", () => {
    const depth = BOUNDS.elementDepth * 10;
    const source = `${"<Stack>".repeat(depth)}${"</Stack>".repeat(depth)}`;
    expect(source.length).toBeLessThanOrEqual(BOUNDS.markupSourceChars);
    expect(() => parseMarkup(source)).not.toThrow();
    expectSingleError(parseMarkup(source), "too-deep");
  });

  it("accepts nesting at exactly B-03 and rejects one level past it", () => {
    const nest = (depth: number): string => `${"<Stack>".repeat(depth)}${"</Stack>".repeat(depth)}`;
    expect(expectRoots(parseMarkup(nest(BOUNDS.elementDepth)))).toHaveLength(1);
    expectSingleError(parseMarkup(nest(BOUNDS.elementDepth + 1)), "too-deep");
  });
});

describe("parseMarkup — bounds are read from BOUNDS, never re-typed", () => {
  const padTo = (source: string, length: number): string =>
    source + " ".repeat(length - source.length);

  it("B-01: accepts markup of exactly the source-character limit and rejects one past it", () => {
    const base = "<Screen>\n  <Text />\n</Screen>";
    expect(expectRoots(parseMarkup(padTo(base, BOUNDS.markupSourceChars)))).toHaveLength(1);
    expectSingleError(parseMarkup(padTo(base, BOUNDS.markupSourceChars + 1)), "markup-too-large");
  });

  it("B-02: accepts exactly the per-mutation node limit and rejects one past it", () => {
    const wrap = (leaves: number): string => `<Screen>${"<Text />".repeat(leaves)}</Screen>`;
    const atLimit = parseMarkup(wrap(BOUNDS.nodesPerMutation - 1));
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) {
      expect(atLimit.ast.nodeCount).toBe(BOUNDS.nodesPerMutation);
    }
    expectSingleError(parseMarkup(wrap(BOUNDS.nodesPerMutation)), "too-many-nodes");
  });

  /** `count` author-declared props, written out one by one. */
  const authorProps = (count: number): string =>
    Array.from({ length: count }, (_, index) => `p${index}="v"`).join(" ");

  it("B-04: accepts exactly the per-element prop limit and rejects one past it", () => {
    const element = (count: number): string => `<Text ${authorProps(count)} />`;
    expect(expectRoots(parseMarkup(element(BOUNDS.propsPerElement)))[0]?.props).toHaveLength(
      BOUNDS.propsPerElement,
    );
    expectSingleError(parseMarkup(element(BOUNDS.propsPerElement + 1)), "too-many-props");
  });

  /**
   * B-04 counts what the *author* declared. The serializer stamps the reserved
   * read-only `id` on every element so a document round-trips, so an element
   * written at exactly the limit would otherwise fail to read back. Exactly one
   * `id` is excluded from the count, in any position.
   */
  it("B-04: excludes the one reserved id, so the limit round-trips through serialization", () => {
    for (const source of [
      `<Text id="n1" ${authorProps(BOUNDS.propsPerElement)} />`,
      `<Text ${authorProps(BOUNDS.propsPerElement)} id="n1" />`,
    ]) {
      const props = expectRoots(parseMarkup(source))[0]?.props;
      expect(props).toHaveLength(BOUNDS.propsPerElement + 1);
      expect(props?.filter((prop) => prop.name === "id")).toHaveLength(1);
    }
  });

  it("B-04: still rejects one author prop past the limit when a reserved id is present", () => {
    expectSingleError(
      parseMarkup(`<Text id="n1" ${authorProps(BOUNDS.propsPerElement + 1)} />`),
      "too-many-props",
    );
  });

  it("B-04: excludes at most one id, so a repeated id cannot buy extra prop budget", () => {
    expectSingleError(
      parseMarkup(`<Text id="n1" ${authorProps(BOUNDS.propsPerElement)} id="n2" />`),
      "too-many-props",
    );
  });

  it("B-04: rejects a duplicated id like any other duplicated attribute", () => {
    expectSingleError(parseMarkup(`<Text id="n1" id="n2" />`), "duplicate-prop");
  });

  it("B-05: accepts an attribute value of exactly the limit and rejects one past it", () => {
    const element = (length: number): string => `<Text label="${"z".repeat(length)}" />`;
    const atLimit = expectRoots(parseMarkup(element(BOUNDS.attributeValueChars)));
    expect(atLimit[0]?.props[0]?.value).toEqual({
      kind: "scalar",
      value: "z".repeat(BOUNDS.attributeValueChars),
    });
    expectSingleError(parseMarkup(element(BOUNDS.attributeValueChars + 1)), "value-too-long");
  });

  it("B-24: bounds both halves of the reported copy even for a maximal offending value", () => {
    const error = expectSingleError(
      parseMarkup(`<Text label=${"z".repeat(BOUNDS.attributeValueChars)} />`),
      "unquoted-value",
    );
    expect(error.cause.length).toBeLessThanOrEqual(BOUNDS.frameworkCopyChars);
    expect(error.repair.length).toBeLessThanOrEqual(BOUNDS.frameworkCopyChars);
  });
});

describe("parseMarkup — every parse code is reachable", () => {
  /** `count` distinct author props, written out one by one. */
  const props = (count: number): string =>
    Array.from({ length: count }, (_, index) => `p${index}="v"`).join(" ");

  const nest = (depth: number): string =>
    `${"<Stack>".repeat(depth)}<Text />${"</Stack>".repeat(depth)}`;

  /**
   * One source per code the lexer and parser can raise. Together with the
   * closure assertion below, this is what makes the shared vocabulary honest:
   * every code this layer owns is provably produced by some input, so a code can
   * neither be declared and never raised nor raised and never declared.
   */
  const reachable: ReadonlyArray<{
    readonly code: AuthorErrorCode;
    readonly source: unknown;
  }> = [
    { code: "invalid-source", source: 42 },
    { code: "empty-markup", source: "" },
    { code: "markup-too-large", source: "z".repeat(BOUNDS.markupSourceChars + 1) },
    {
      code: "too-many-nodes",
      source: `<Screen>${"<Text />".repeat(BOUNDS.nodesPerMutation)}</Screen>`,
    },
    { code: "too-deep", source: nest(BOUNDS.elementDepth + 1) },
    { code: "too-many-props", source: `<Text ${props(BOUNDS.propsPerElement + 1)} />` },
    {
      code: "value-too-long",
      source: `<Text a="${"z".repeat(BOUNDS.attributeValueChars + 1)}" />`,
    },
    { code: "import-statement", source: `import Button from "./b.js";\n<Button />` },
    { code: "raw-html", source: "<div />" },
    { code: "raw-css", source: `<Text style="color:red" />` },
    { code: "dangerous-prop", source: `<Text dangerouslySetInnerHTML="<b>x</b>" />` },
    { code: "event-handler", source: `<Button onClick="run" />` },
    { code: "spread", source: "<Text {...props} />" },
    { code: "jsx-expression", source: "<Stack>{revenue}</Stack>" },
    { code: "inline-json", source: `<Text config='{"a":1}' />` },
    { code: "raw-text-child", source: "<Stack>revenue</Stack>" },
    { code: "unquoted-value", source: "<Text label=raw />" },
    { code: "missing-prop-value", source: "<Text label />" },
    { code: "duplicate-prop", source: `<Text label="a" label="b" />` },
    { code: "empty-reference", source: `<Button action="agent:" />` },
    { code: "invalid-tag-name", source: "< Text />" },
    { code: "invalid-prop-name", source: `<Text 1label="a" />` },
    { code: "unexpected-token", source: `<Text = "a" />` },
    { code: "stray-closing-tag", source: "</Screen>" },
    { code: "mismatched-closing-tag", source: "<Screen><Stack></Screen>" },
    { code: "unclosed-element", source: "<Screen>" },
    { code: "unterminated-tag", source: "<Text" },
    { code: "unterminated-value", source: `<Text label="never closed />` },
    { code: "unterminated-expression", source: "<Stack>{never closed</Stack>" },
  ];

  /**
   * The codes document validation raises against the catalog and the Data Model.
   * They share this one vocabulary — there is no second rejection type — but no
   * input can produce them here, because this layer validates shape only.
   */
  const raisedElsewhere: readonly AuthorErrorCode[] = [
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
  ];

  it.each(reachable)("raises $code", ({ code, source }) => {
    expectSingleError(parseMarkup(source), code);
  });

  it("raises every code the vocabulary does not assign to document validation", () => {
    const raisedHere = reachable.map((entry) => entry.code);
    expect(new Set(raisedHere).size).toBe(raisedHere.length);
    expect([...raisedHere, ...raisedElsewhere].sort()).toEqual([...AUTHOR_ERROR_CODES].sort());
  });
});

describe("markup-parser — the module surface", () => {
  /**
   * `parseMarkup` is the only value; `MarkupAst`, `MarkupNode` and
   * `ParseMarkupResult` are the types a consumer needs to name a result and walk
   * it. The prop, value and scheme shapes are written out inside `MarkupNode`,
   * so a consumer reaches every one of them structurally and this module's
   * surface cannot widen by accident.
   */
  it("exports exactly one value", () => {
    expect(Object.keys(markupParser)).toEqual(["parseMarkup"]);
  });

  it("returns a result a consumer can name and narrow in both directions", () => {
    const accepted: ParseMarkupResult = parseMarkup("<Text />");
    const rejected: ParseMarkupResult = parseMarkup("<Stack>text</Stack>");
    expect(accepted.ok).toBe(true);
    expect(rejected.ok).toBe(false);
    if (accepted.ok) {
      const ast: MarkupAst = accepted.ast;
      const node: MarkupNode | undefined = ast.roots[0];
      expect(node?.tag).toBe("Text");
    }
  });

  /**
   * The prop record, the value union and the scheme literals live *inside* the
   * exported `MarkupNode` declaration, so a consumer walks the whole chain —
   * `ast` → `roots` → `props` → `value` → `scheme` — through plain property
   * access and never names a type this module does not export. This asserts that
   * chain is actually reachable, which is what makes writing the shape out
   * rather than exporting three aliases cost the consumer nothing.
   */
  it("walks props, values and reference schemes through plain property access", () => {
    const result: ParseMarkupResult = parseMarkup(`<Text label="Revenue" action="nav:home" />`);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const node: MarkupNode | undefined = result.ast.roots[0];
    const label = node?.props[0];
    const action = node?.props[1];

    expect(label?.name).toBe("label");
    expect(label?.value.kind).toBe("scalar");
    if (label?.value.kind === "scalar") {
      expect(label.value.value).toBe("Revenue");
    }
    expect(action?.value.kind).toBe("reference");
    if (action?.value.kind === "reference") {
      expect(action.value.scheme).toBe("nav");
      expect(action.value.target).toBe("home");
    }
  });

  /**
   * The runtime half of the scheme pin.
   *
   * Writing the scheme literals into `MarkupNode` means the vocabulary is
   * declared twice: as that union, and as the parser's `REFERENCE_SCHEMES`
   * array. The array is annotated `readonly ReferenceScheme[]`, which is the
   * compile-time direction — an entry the union does not declare is a compile
   * error. This is the other direction. `SCHEME_PROBE` is annotated as a
   * `Record` exhaustive over the union read structurally off `MarkupNode`, so
   * its keys *are* the union's members enumerated at runtime; driving the parser
   * with each one proves the array recognises every scheme the union declares. A
   * scheme added to only one side fails here or fails to compile.
   */
  it("recognises every reference scheme the MarkupNode union declares", () => {
    type Scheme = Extract<
      MarkupNode["props"][number]["value"],
      { readonly kind: "reference" }
    >["scheme"];

    const SCHEME_PROBE: Readonly<Record<Scheme, string>> = Object.freeze({
      data: "sales.total",
      nav: "overview",
      agent: "refresh",
    });

    const schemes = Object.keys(SCHEME_PROBE) as readonly Scheme[];
    expect(schemes.length).toBeGreaterThan(0);

    for (const scheme of schemes) {
      const target = SCHEME_PROBE[scheme];
      const roots = expectRoots(parseMarkup(`<Text prop="${scheme}:${target}" />`));
      // A scheme the array does not recognise parses as a scalar, not a reference.
      expect(roots[0]?.props[0]?.value).toEqual({ kind: "reference", scheme, target });
    }
  });
});
