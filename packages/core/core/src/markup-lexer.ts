/**
 * The markup tokenizer.
 *
 * PRIVATE to `@facet/core`: this module is not barrel-exported, is not a
 * package entry point, and must not be imported across a package boundary. One
 * deterministic first error is only auditable if lexing, parsing and error
 * shaping stay three named modules, and the lexer must never become a second
 * public grammar surface.
 *
 * The scanner is a single forward pass with two states — inside a tag and
 * outside one. Because it never backtracks and never looks past a region it has
 * not already checked, the first fault it reports is by construction the
 * earliest fault in the source.
 *
 * Quoted values carry **no escape sequences**: a value runs to the next
 * occurrence of its own delimiter. Two delimiters exist, so any value can be
 * written (and later serialized) by choosing the quote character it does not
 * contain, and a value can never contain its own delimiter.
 */

import { BOUNDS } from "./bounds.js";
import { authorError, type AuthorError, type SourceLocation } from "./markup-errors.js";

/**
 * `word` is any bare run inside a tag — a tag name, a prop name, or an
 * unquoted value. The lexer does not decide which; the parser classifies it
 * against the identifier grammar and its position.
 */
export type TokenKind =
  | "tag-open"
  | "close-tag-open"
  | "tag-end"
  | "self-close"
  | "equals"
  | "word"
  | "string"
  | "expression"
  | "text";

export interface Token {
  readonly kind: TokenKind;
  /** For `string` and `expression`, the inner content without its delimiters. */
  readonly text: string;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export type LexResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly error: AuthorError };

/** Characters that end a bare word inside a tag. */
const TAG_DELIMITERS = new Set(["<", ">", "=", "/", '"', "'", "{", "}"]);

const QUOTE_CHARACTERS = new Set(['"', "'"]);

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

export function tokenize(source: string): LexResult {
  const tokens: Token[] = [];
  const length = source.length;
  let offset = 0;
  let line = 1;
  let column = 1;
  let insideTag = false;

  const here = (): SourceLocation => ({ offset, line, column });

  const step = (count: number): void => {
    for (let taken = 0; taken < count && offset < length; taken += 1) {
      if (source[offset] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      offset += 1;
    }
  };

  const push = (kind: TokenKind, text: string, at: SourceLocation): void => {
    tokens.push({ kind, text, offset: at.offset, line: at.line, column: at.column });
  };

  /** Scans a braced run, tracking nesting and skipping quoted spans inside it. */
  const readExpression = (): AuthorError | null => {
    const start = here();
    step(1);
    let depth = 1;
    let text = "";
    while (offset < length) {
      const char = source[offset] ?? "";
      if (QUOTE_CHARACTERS.has(char)) {
        const quote = char;
        text += char;
        step(1);
        while (offset < length && source[offset] !== quote) {
          text += source[offset] ?? "";
          step(1);
        }
        if (offset >= length) {
          break;
        }
        text += quote;
        step(1);
        continue;
      }
      if (char === "{") {
        depth += 1;
        text += char;
        step(1);
        continue;
      }
      if (char === "}") {
        depth -= 1;
        step(1);
        if (depth === 0) {
          push("expression", text, start);
          return null;
        }
        text += char;
        continue;
      }
      text += char;
      step(1);
    }
    return authorError({
      code: "unterminated-expression",
      location: start,
      cause: "An expression opened with `{` is never closed.",
      repair:
        "Remove it. Markup carries no expressions — a prop takes a quoted scalar or a `data:` reference.",
    });
  };

  /** Scans a quoted attribute value and enforces `B-05`. */
  const readString = (): AuthorError | null => {
    const start = here();
    const quote = source[offset] ?? "";
    step(1);
    let text = "";
    while (offset < length && source[offset] !== quote) {
      text += source[offset] ?? "";
      step(1);
    }
    if (offset >= length) {
      return authorError({
        code: "unterminated-value",
        location: start,
        cause: `A value opened with ${quote} is never closed.`,
        repair: `Close the value with a matching ${quote}.`,
      });
    }
    step(1);
    if (text.length > BOUNDS.attributeValueChars) {
      return authorError({
        code: "value-too-long",
        location: start,
        cause: `This attribute value is ${text.length} characters; the limit is ${BOUNDS.attributeValueChars}.`,
        repair: `Shorten the value to ${BOUNDS.attributeValueChars} characters, or publish the text as data and bind it with a \`data:\` reference.`,
      });
    }
    push("string", text, start);
    return null;
  };

  /**
   * One step of the outside-a-tag state. Everything here is either the start of
   * a tag, a braced run, or a run of stray text that the parser will reject.
   */
  const scanOutsideTag = (char: string): AuthorError | null => {
    if (char === "<") {
      const start = here();
      if (source[offset + 1] === "/") {
        step(2);
        push("close-tag-open", "</", start);
      } else {
        step(1);
        push("tag-open", "<", start);
      }
      insideTag = true;
      return null;
    }
    if (char === "{") {
      return readExpression();
    }
    if (isWhitespace(char)) {
      step(1);
      return null;
    }
    const start = here();
    let text = "";
    while (offset < length && source[offset] !== "<" && source[offset] !== "{") {
      text += source[offset] ?? "";
      step(1);
    }
    push("text", text, start);
    return null;
  };

  /**
   * One step of the inside-a-tag state: the tag's own punctuation, a quoted
   * value, a braced run, or a bare word the parser classifies by position.
   */
  const scanInsideTag = (char: string): AuthorError | null => {
    if (isWhitespace(char)) {
      step(1);
      return null;
    }
    if (char === ">") {
      const start = here();
      step(1);
      push("tag-end", ">", start);
      insideTag = false;
      return null;
    }
    if (char === "/" && source[offset + 1] === ">") {
      const start = here();
      step(2);
      push("self-close", "/>", start);
      insideTag = false;
      return null;
    }
    if (char === "=") {
      const start = here();
      step(1);
      push("equals", "=", start);
      return null;
    }
    if (QUOTE_CHARACTERS.has(char)) {
      return readString();
    }
    if (char === "{") {
      return readExpression();
    }

    const start = here();
    let word = "";
    while (offset < length) {
      const next = source[offset] ?? "";
      if (isWhitespace(next) || TAG_DELIMITERS.has(next)) {
        break;
      }
      word += next;
      step(1);
    }
    if (word.length === 0) {
      // A lone delimiter that starts nothing (a stray `/`, `<` or `}`). Emit it
      // as a one-character word so the parser rejects it in place; consuming it
      // is what guarantees the scan always advances.
      word = char;
      step(1);
    }
    push("word", word, start);
    return null;
  };

  while (offset < length) {
    const char = source[offset] ?? "";
    const error = insideTag ? scanInsideTag(char) : scanOutsideTag(char);
    if (error) {
      return { ok: false, error };
    }
  }

  return { ok: true, tokens };
}
