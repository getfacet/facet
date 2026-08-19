/**
 * The markup parser — markup as **data**, never as code.
 *
 * `parseMarkup` reads a source string into a tree of tags, props and quoted
 * values. It admits component tags, declared props, quoted scalars and the
 * four explicit reference schemes, and nothing else: raw text children, JSX
 * expressions, spreads, event handlers, `import` statements, raw HTML tags, raw
 * CSS, unquoted values and inline structured JSON are each rejected outright,
 * never sanitized and accepted.
 *
 * Three rules define the contract:
 *
 * 1. **One error.** A rejection carries exactly one `AuthorError` — never a
 *    list. The parser stops at the first fault; it does not recover, does not
 *    continue, and does not merge in faults that a later validation layer would
 *    have found.
 * 2. **First in source order.** The scan is a single forward pass, so the fault
 *    it stops at is the earliest one. Where several faults are discovered at
 *    one position, `firstError` resolves them under one total order.
 * 3. **Total.** `parseMarkup` never throws, for any input of any type. Depth is
 *    bounded by `B-03` and the walk is iterative, so no input can exhaust the
 *    stack.
 *
 * This module validates **shape only**. Whether a tag is registered, whether a
 * prop is declared, and whether a value satisfies its schema are decided later,
 * against the session's immutable catalog — reported in the same `AuthorError`
 * vocabulary, so the agent is told it was wrong in one way rather than two.
 *
 * **Surface.** `parseMarkup`, `ParseMarkupResult`, `MarkupAst` and `MarkupNode`
 * — and nothing else. The prop record and the closed value union are written out
 * inside `MarkupNode` rather than factored into exported aliases, so every
 * emitted public declaration reaches only public names, primitives and built-ins.
 * `MarkupProp`, `MarkupValue` and `ReferenceScheme` exist below as private
 * aliases *derived back out of* `MarkupNode` by indexed access; they are
 * implementation shorthand, never a declaration a consumer has to resolve.
 */

import { BOUNDS } from "./bounds.js";
import { isFacetIdentifier } from "./identifiers.js";
import { tokenize, type Token } from "./markup-lexer.js";
import {
  authorError,
  firstError,
  truncate,
  type AuthorError,
  type SourceLocation,
} from "./markup-errors.js";

export interface MarkupNode {
  readonly tag: string;
  /** The named region this direct child fills. Never part of `props`. */
  readonly slot?: string;
  /**
   * The element's props, in source order.
   *
   * The prop record and the closed value union are spelled out here rather than
   * referred to by name. `MarkupNode` is exported and the prop, value and scheme
   * aliases are not, so naming one of them here would emit a public declaration
   * that reaches a name a consumer cannot import — a type that resolves inside
   * this package and dangles at the package boundary. Written out, the
   * declaration carries its own structure and this is the single place the shape
   * exists; the aliases below are derived back out of it.
   */
  readonly props: readonly {
    readonly name: string;
    /** A literal quoted scalar, or one of the four explicit references. */
    readonly value:
      | { readonly kind: "scalar"; readonly value: string }
      | {
          readonly kind: "reference";
          /** `data:` reads data, `asset:` names media, and `nav:`/`agent:` are actions. */
          readonly scheme: "data" | "nav" | "agent" | "asset";
          readonly target: string;
        };
    /** Where the prop name starts. */
    readonly location: SourceLocation;
    /** Where the value starts, for a layer that rejects the value rather than the prop. */
    readonly valueLocation: SourceLocation;
  }[];
  readonly children: readonly MarkupNode[];
  readonly location: SourceLocation;
}

/**
 * Implementation shorthand for the shapes `MarkupNode` declares.
 *
 * Each is derived from the public declaration by indexed access rather than
 * being the source the public declaration points at, so it can never appear in
 * an emitted public declaration and can never drift from what `MarkupNode` says.
 * They stay unexported: a consumer reaches every one of them structurally by
 * walking a narrowed `ParseMarkupResult`, and never has to write their names.
 */
type MarkupProp = MarkupNode["props"][number];
type MarkupValue = MarkupProp["value"];
type ReferenceScheme = Extract<MarkupValue, { readonly kind: "reference" }>["scheme"];

/**
 * The four explicit reference schemes an author may write, in match order.
 *
 * The vocabulary is now written twice — as the literal union inside
 * `MarkupNode` and as this runtime array — so the two are pinned against each
 * other in both directions. The annotation rejects an entry here that the union
 * does not declare; `markup-parser.test.ts` drives the parser with an exhaustive
 * `Record` over the union read off `MarkupNode`, which rejects a scheme the
 * union declares but this array does not recognise.
 */
const REFERENCE_SCHEMES: readonly ReferenceScheme[] = Object.freeze([
  "data",
  "nav",
  "agent",
  "asset",
]);

export interface MarkupAst {
  readonly roots: readonly MarkupNode[];
  /** Nodes this markup would create, measured against `B-02`. */
  readonly nodeCount: number;
}

/**
 * What `parseMarkup` returns: the ast, or the one first failure.
 *
 * It is named and exported because a consumer has to be able to *write* it —
 * hold a result, pass it on, or narrow it in a helper of its own. A public
 * function whose return type has no name forces every such consumer to restate
 * the shape or reach for `ReturnType<...>`, and the two drift.
 */
export type ParseMarkupResult =
  | { readonly ok: true; readonly ast: MarkupAst }
  | { readonly ok: false; readonly error: AuthorError };

/** A React-shaped event handler prop: `on` followed by a capital. */
const HANDLER_PATTERN = /^on[A-Z]/;

/** Props whose whole purpose is to inject raw markup. */
const DANGEROUS_PROPS = new Set(["dangerouslySetInnerHTML", "innerHTML", "outerHTML"]);

/** The one prop name that would carry raw CSS. */
const STYLE_PROP = "style";

/**
 * The reserved read-only attribute Facet stamps on a serialized element.
 *
 * It is excluded from the `B-04` count — **once per element** — because the
 * grammar has to parse Facet's own output: an element authored at exactly the
 * limit gains this attribute on the way out, and the read back must not reject
 * what the write produced. The exclusion is a counting rule and nothing more.
 * Whether an *author* may write `id` is not decided here; that is an atomic
 * reject in document validation, against the catalog.
 */
const ID_PROP = "id";

/** The reserved direct-child region attribute, extracted from ordinary props. */
const SLOT_PROP = "slot";

/** How much of an offending fragment is quoted back in a message. */
const EXCERPT_CHARS = 40;

const ORIGIN: SourceLocation = Object.freeze({ offset: 0, line: 1, column: 1 });

/** A single-line, bounded quotation of an offending fragment. */
function excerpt(text: string): string {
  return truncate(text.trim().replace(/\s+/g, " "), EXCERPT_CHARS);
}

function locate(token: Token): SourceLocation {
  return { offset: token.offset, line: token.line, column: token.column };
}

function reject(error: AuthorError): ParseMarkupResult {
  return { ok: false, error };
}

/** A component tag is capitalised; a lowercase tag is a raw HTML element. */
function isComponentTag(tag: string): boolean {
  const first = tag.charCodeAt(0);
  return first >= 0x41 && first <= 0x5a;
}

/** Stray text between tags — or the `import` statement it most often is. */
function describeText(token: Token): AuthorError {
  const quoted = excerpt(token.text);
  const leadingWord = token.text.trimStart().split(/\s+/)[0] ?? "";
  if (leadingWord === "import") {
    return authorError({
      code: "import-statement",
      location: locate(token),
      cause: `\`${quoted}\` is an import statement. Markup is data; it declares no modules.`,
      repair: "Delete the import. Components come from the registered catalog, not from a module.",
    });
  }
  return authorError({
    code: "raw-text-child",
    location: locate(token),
    cause: `\`${quoted}\` is a bare text child. Text is not a node.`,
    repair: "Wrap the words in a component that takes them as a prop, such as `<Text ... />`.",
  });
}

/** A braced run — a spread, or any other JSX expression. */
function describeExpression(token: Token): AuthorError {
  const quoted = excerpt(token.text);
  if (token.text.trimStart().startsWith("...")) {
    return authorError({
      code: "spread",
      location: locate(token),
      cause: `\`{${quoted}}\` is a spread. Props must be written out one by one.`,
      repair: "Replace the spread with the explicit props the component declares.",
    });
  }
  return authorError({
    code: "jsx-expression",
    location: locate(token),
    cause: `\`{${quoted}}\` is a JSX expression. Markup is parsed as data and never evaluated.`,
    repair: "Use a quoted scalar, or bind published data with a `data:` reference.",
  });
}

type ValueOutcome =
  | { readonly ok: true; readonly value: MarkupValue }
  | { readonly ok: false; readonly error: AuthorError };

/** Classifies a quoted value as a scalar or one of the four references. */
function classifyValue(token: Token): ValueOutcome {
  const raw = token.text;
  const lead = raw.trimStart();
  if (lead.startsWith("{") || lead.startsWith("[")) {
    return {
      ok: false,
      error: authorError({
        code: "inline-json",
        location: locate(token),
        cause: `\`${excerpt(raw)}\` is inline structured JSON. A prop takes one scalar, not a payload.`,
        repair:
          "Publish the structure as data and bind it with a `data:` reference, or use the component's simple props.",
      }),
    };
  }
  for (const scheme of REFERENCE_SCHEMES) {
    const prefix = `${scheme}:`;
    if (!raw.startsWith(prefix)) {
      continue;
    }
    const target = raw.slice(prefix.length);
    if (target.length === 0) {
      return {
        ok: false,
        error: authorError({
          code: "empty-reference",
          location: locate(token),
          cause: `\`${prefix}\` names no target.`,
          repair: `Write the target after the prefix, such as \`${prefix}${scheme === "data" ? "sales.total" : "overview"}\`.`,
        }),
      };
    }
    return { ok: true, value: Object.freeze({ kind: "reference", scheme, target }) };
  }
  return { ok: true, value: Object.freeze({ kind: "scalar", value: raw }) };
}

/**
 * Reads the token in value position. A value is a quoted string and nothing
 * else: an expression is code, and a bare word is an unquoted value.
 */
function readPropValue(nameToken: Token, valueToken: Token): ValueOutcome {
  if (valueToken.kind === "expression") {
    return { ok: false, error: describeExpression(valueToken) };
  }
  if (valueToken.kind === "word") {
    return {
      ok: false,
      error: authorError({
        code: "unquoted-value",
        location: locate(valueToken),
        cause: `The value of \`${nameToken.text}\` is unquoted.`,
        repair: `Quote it: \`${nameToken.text}="${excerpt(valueToken.text)}"\`.`,
      }),
    };
  }
  if (valueToken.kind !== "string") {
    return {
      ok: false,
      error: authorError({
        code: "unexpected-token",
        location: locate(valueToken),
        cause: `\`${excerpt(valueToken.text)}\` is not a prop value.`,
        repair: `Write a quoted value after \`${nameToken.text}=\`.`,
      }),
    };
  }
  return classifyValue(valueToken);
}

/**
 * Every fault a prop name carries. All share the name's position, so the
 * reported one is decided by the declared code rank rather than check order.
 *
 * `authorPropCount` is the element's author-declared prop tally including this
 * one, which is what `B-04` bounds — see `ID_PROP`.
 */
function propNameFaults(
  token: Token,
  seen: ReadonlySet<string>,
  authorPropCount: number,
): AuthorError[] {
  const name = token.text;
  const faults: AuthorError[] = [];
  const location = locate(token);
  if (authorPropCount > BOUNDS.propsPerElement) {
    faults.push(
      authorError({
        code: "too-many-props",
        location,
        cause: `This element declares more than ${BOUNDS.propsPerElement} props.`,
        repair: `Keep at most ${BOUNDS.propsPerElement} props per element; split the content across nested components.`,
      }),
    );
  }
  if (!isFacetIdentifier(name)) {
    faults.push(
      authorError({
        code: "invalid-prop-name",
        location,
        cause: `\`${excerpt(name)}\` is not a prop name. A name starts with a letter, continues with letters, digits, \`_\` or \`-\`, and is at most ${BOUNDS.identifierChars} characters.`,
        repair: "Use a prop the component declares.",
      }),
    );
    return faults;
  }
  if (HANDLER_PATTERN.test(name)) {
    faults.push(
      authorError({
        code: "event-handler",
        location,
        cause: `\`${name}\` is an event handler. Markup carries no code, so it cannot carry a handler.`,
        repair:
          "Send the interaction to the agent with an `agent:` reference, or move to a screen with a `nav:` reference.",
      }),
    );
  }
  if (name === STYLE_PROP) {
    faults.push(
      authorError({
        code: "raw-css",
        location,
        cause: "`style` is raw CSS. Appearance comes from the theme, not from the markup.",
        repair: "Use the component's own presentation props.",
      }),
    );
  }
  if (DANGEROUS_PROPS.has(name)) {
    faults.push(
      authorError({
        code: "dangerous-prop",
        location,
        cause: `\`${name}\` injects raw HTML. There is no raw-HTML escape hatch.`,
        repair: "Pass the content as a scalar prop of a registered component.",
      }),
    );
  }
  if (seen.has(name)) {
    faults.push(
      authorError({
        code: "duplicate-prop",
        location,
        cause: `\`${name}\` is declared twice on this element.`,
        repair: "Declare each prop once.",
      }),
    );
  }
  return faults;
}

interface OpenElement {
  readonly tag: string;
  readonly location: SourceLocation;
  readonly slot?: string;
  readonly props: readonly MarkupProp[];
  readonly children: MarkupNode[];
}

type PropsOutcome =
  | {
      readonly ok: true;
      readonly slot?: string;
      readonly props: readonly MarkupProp[];
      readonly selfClosing: boolean;
    }
  | { readonly ok: false; readonly error: AuthorError };

type TagNameOutcome =
  | { readonly ok: true; readonly token: Token }
  | { readonly ok: false; readonly error: AuthorError };

/**
 * The parse itself: an explicit stack rather than recursion, so depth is a
 * bound rather than a stack frame budget.
 */
function parseTokens(tokens: readonly Token[]): ParseMarkupResult {
  const stack: OpenElement[] = [];
  const roots: MarkupNode[] = [];
  let index = 0;
  let nodeCount = 0;

  const attach = (node: MarkupNode): void => {
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  };

  const unterminated = (open: Token): AuthorError =>
    authorError({
      code: "unterminated-tag",
      location: locate(open),
      cause: "This tag is never closed with `>` or `/>`.",
      repair: "Close the tag.",
    });

  /** Reads props up to the tag's own `>` or `/>`. */
  const readProps = (open: Token): PropsOutcome => {
    const props: MarkupProp[] = [];
    const seen = new Set<string>();
    let slot: string | undefined;
    let attributeCount = 0;
    /** How many reserved `id` attributes were excluded from the `B-04` count: 0 or 1. */
    let excludedIds = 0;
    for (;;) {
      const token = tokens[index];
      if (!token) {
        return { ok: false, error: unterminated(open) };
      }
      if (token.kind === "tag-end" || token.kind === "self-close") {
        index += 1;
        return {
          ok: true,
          ...(slot === undefined ? {} : { slot }),
          props: Object.freeze(props),
          selfClosing: token.kind === "self-close",
        };
      }
      if (token.kind === "expression") {
        return { ok: false, error: describeExpression(token) };
      }
      if (token.kind !== "word") {
        return {
          ok: false,
          error: authorError({
            code: "unexpected-token",
            location: locate(token),
            cause: `\`${excerpt(token.text)}\` is not a prop name.`,
            repair: 'Write props as `name="value"` pairs.',
          }),
        };
      }
      // Only the first `id` is Facet's own; a repeat is an ordinary duplicate
      // and is counted, so `id` can never buy an element extra prop budget.
      const reservedId = token.text === ID_PROP && excludedIds === 0;
      const authorPropCount = attributeCount - excludedIds + (reservedId ? 0 : 1);
      const faults = propNameFaults(token, seen, authorPropCount);
      const [head, ...tail] = faults;
      if (head) {
        return { ok: false, error: firstError(head, ...tail) };
      }
      index += 1;
      if (tokens[index]?.kind !== "equals") {
        return {
          ok: false,
          error: authorError({
            code: "missing-prop-value",
            location: locate(token),
            cause: `\`${token.text}\` has no value. A prop is always \`name="value"\`.`,
            repair: `Write \`${token.text}="..."\` with a quoted value.`,
          }),
        };
      }
      index += 1;
      const valueToken = tokens[index];
      if (!valueToken) {
        return { ok: false, error: unterminated(open) };
      }
      const value = readPropValue(token, valueToken);
      if (!value.ok) {
        return { ok: false, error: value.error };
      }
      index += 1;
      attributeCount += 1;
      if (token.text === SLOT_PROP) {
        if (value.value.kind !== "scalar" || !isFacetIdentifier(value.value.value)) {
          return {
            ok: false,
            error: authorError({
              code: "invalid-value",
              location: locate(valueToken),
              cause: `\`${excerpt(valueToken.text)}\` is not a slot name. A slot must be a literal Facet identifier.`,
              repair: 'Use a quoted slot name such as `slot="header"`.',
            }),
          };
        }
        slot = value.value.value;
      } else {
        props.push(
          Object.freeze({
            name: token.text,
            value: value.value,
            location: locate(token),
            valueLocation: locate(valueToken),
          }),
        );
      }
      seen.add(token.text);
      if (reservedId) {
        excludedIds += 1;
      }
    }
  };

  /** Reads the tag name of an opening or closing tag, enforcing adjacency to `<`. */
  const readTagName = (open: Token): TagNameOutcome => {
    const nameToken = tokens[index];
    if (
      !nameToken ||
      nameToken.kind !== "word" ||
      nameToken.offset !== open.offset + open.text.length ||
      !isFacetIdentifier(nameToken.text)
    ) {
      return {
        ok: false,
        error: authorError({
          code: "invalid-tag-name",
          location: locate(open),
          cause: `\`${open.text}\` is not followed by a tag name. A name starts with a letter directly after \`${open.text}\`, continues with letters, digits, \`_\` or \`-\`, and is at most ${BOUNDS.identifierChars} characters.`,
          repair: "Name a registered component, such as `<Text />`.",
        }),
      };
    }
    index += 1;
    return { ok: true, token: nameToken };
  };

  const openElement = (open: Token): AuthorError | null => {
    const named = readTagName(open);
    if (!named.ok) {
      return named.error;
    }
    const nameToken = named.token;
    const tag = nameToken.text;
    if (!isComponentTag(tag)) {
      return authorError({
        code: "raw-html",
        location: locate(nameToken),
        cause: `\`${tag}\` is a raw HTML element. Markup admits registered component tags only.`,
        repair: "Use a registered component tag, which starts with a capital letter.",
      });
    }
    nodeCount += 1;
    if (nodeCount > BOUNDS.nodesPerMutation) {
      return authorError({
        code: "too-many-nodes",
        location: locate(open),
        cause: `This call creates more than ${BOUNDS.nodesPerMutation} nodes.`,
        repair: `Build the page across several calls of at most ${BOUNDS.nodesPerMutation} nodes each.`,
      });
    }
    if (stack.length + 1 > BOUNDS.elementDepth) {
      return authorError({
        code: "too-deep",
        location: locate(open),
        cause: `This element nests deeper than ${BOUNDS.elementDepth} levels.`,
        repair: `Flatten the markup to at most ${BOUNDS.elementDepth} levels.`,
      });
    }
    const outcome = readProps(open);
    if (!outcome.ok) {
      return outcome.error;
    }
    const element: OpenElement = {
      tag,
      location: locate(open),
      ...(outcome.slot === undefined ? {} : { slot: outcome.slot }),
      props: outcome.props,
      children: [],
    };
    if (outcome.selfClosing) {
      attach(
        Object.freeze({
          tag,
          ...(element.slot === undefined ? {} : { slot: element.slot }),
          props: element.props,
          children: Object.freeze([] as readonly MarkupNode[]),
          location: element.location,
        }),
      );
      return null;
    }
    stack.push(element);
    return null;
  };

  const closeElement = (close: Token): AuthorError | null => {
    const named = readTagName(close);
    if (!named.ok) {
      return named.error;
    }
    const nameToken = named.token;
    if (tokens[index]?.kind !== "tag-end") {
      return unterminated(close);
    }
    index += 1;
    const open = stack[stack.length - 1];
    if (!open) {
      return authorError({
        code: "stray-closing-tag",
        location: locate(close),
        cause: `\`</${nameToken.text}>\` closes an element that is not open.`,
        repair: "Delete the closing tag, or open the element before it.",
      });
    }
    if (open.tag !== nameToken.text) {
      return authorError({
        code: "mismatched-closing-tag",
        location: locate(close),
        cause: `\`</${nameToken.text}>\` closes an element while \`<${open.tag}>\` is open.`,
        repair: `Close \`<${open.tag}>\` first.`,
      });
    }
    stack.pop();
    attach(
      Object.freeze({
        tag: open.tag,
        ...(open.slot === undefined ? {} : { slot: open.slot }),
        props: open.props,
        children: Object.freeze([...open.children]),
        location: open.location,
      }),
    );
    return null;
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      break;
    }
    if (token.kind === "text") {
      return reject(describeText(token));
    }
    if (token.kind === "expression") {
      return reject(describeExpression(token));
    }
    if (token.kind === "tag-open" || token.kind === "close-tag-open") {
      index += 1;
      const error = token.kind === "tag-open" ? openElement(token) : closeElement(token);
      if (error) {
        return reject(error);
      }
      continue;
    }
    return reject(
      authorError({
        code: "unexpected-token",
        location: locate(token),
        cause: `\`${excerpt(token.text)}\` is outside any tag.`,
        repair: "Every value belongs to a prop inside a component tag.",
      }),
    );
  }

  const [firstOpen, ...restOpen] = stack.map((open) =>
    authorError({
      code: "unclosed-element",
      location: open.location,
      cause: `\`<${open.tag}>\` is never closed.`,
      repair: `Add \`</${open.tag}>\`, or self-close it as \`<${open.tag} />\`.`,
    }),
  );
  if (firstOpen) {
    return reject(firstError(firstOpen, ...restOpen));
  }
  if (roots.length === 0) {
    return reject(
      authorError({
        code: "empty-markup",
        location: ORIGIN,
        cause: "This call carries no markup.",
        repair: "Send the complete markup for the unit you are requesting.",
      }),
    );
  }
  return { ok: true, ast: Object.freeze({ roots: Object.freeze(roots), nodeCount }) };
}

/**
 * Parses author markup into an AST, or returns the one first failure.
 *
 * Total: any input of any type yields a result, never an exception.
 */
export function parseMarkup(source: unknown): ParseMarkupResult {
  if (typeof source !== "string") {
    return reject(
      authorError({
        code: "invalid-source",
        location: ORIGIN,
        cause: "Markup must be a string.",
        repair: "Send the markup as text.",
      }),
    );
  }
  if (source.length > BOUNDS.markupSourceChars) {
    return reject(
      authorError({
        code: "markup-too-large",
        location: ORIGIN,
        cause: `This markup is ${source.length} characters; the limit is ${BOUNDS.markupSourceChars}.`,
        repair: `Build the page across several calls of at most ${BOUNDS.markupSourceChars} characters each.`,
      }),
    );
  }
  const lexed = tokenize(source);
  if (!lexed.ok) {
    return reject(lexed.error);
  }
  return parseTokens(lexed.tokens);
}
