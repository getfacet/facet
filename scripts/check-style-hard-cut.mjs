#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const PRODUCTION_ROOTS = ["packages", "apps", "scripts"];
const ALL_ROOTS = [...PRODUCTION_ROOTS, "docs", ".changeset", "README.md", "AGENTS.md"];

const EXCLUDED_GLOBS = [
  "!**/node_modules/**",
  "!**/dist/**",
  "!**/coverage/**",
  "!**/.turbo/**",
  "!apps/playground/.facet-sessions/**",
  "!apps/playground/generated/**",
];

const ALLOWED_ANNOTATION = ["style-hard-cut", "allowed-negative"].join(": ");
const LEGACY_ALLOWED_ANNOTATION = ["composition-hard-cut", "allowed-negative"].join(": ");
const ELIGIBLE_FIXTURE_SEGMENTS = new Set(["fixtures", "__fixtures__", "test-data"]);
const SCANNER_PATH = "scripts/check-style-hard-cut.mjs";
const MAX_LEXICAL_FILE_LENGTH = 8 * 1024 * 1024;
const LEXICAL_READ_CHUNK_LENGTH = 64 * 1024;
const MAX_LEXICAL_TOKENS = 100_000;
const MAX_AST_NODES = 100_000;
const MAX_AST_DEPTH = 128;
const MAX_STYLE_OBJECT_DEPTH = 128;
const MAX_STYLE_OBJECTS_PER_FILE = 10_000;
const MAX_TRANSPARENT_WRAPPER_DEPTH = 16;
const MAX_QUOTED_TOKEN_LENGTH = 32;
const JAVASCRIPT_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const JSON_QUOTED_ESCAPES = Object.freeze({
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
});
const JAVASCRIPT_QUOTED_ESCAPES = Object.freeze({
  ...JSON_QUOTED_ESCAPES,
  "'": "'",
  v: "\v",
  0: "\0",
});
const YAML_QUOTED_ESCAPES = Object.freeze({
  ...JSON_QUOTED_ESCAPES,
  0: "\0",
  a: "\u0007",
  v: "\v",
  e: "\u001b",
  " ": " ",
  N: "\u0085",
  _: "\u00a0",
  L: "\u2028",
  P: "\u2029",
});
const RETIRED_STYLE_PROPERTY_KEYS = new Set([
  "bg",
  "fg",
  "pad",
  "size",
  "weight",
  "radius",
  "align",
  "appear",
  "family",
  "leading",
  "gradient",
  "justify",
  "border",
  "tracking",
  "ratio",
]);

function buildRetiredStyleSymbolsPattern() {
  const joined = (...parts) => parts.join("");
  return [
    joined("Facet", "Catalog"),
    joined("DEFAULT", "_CATALOG"),
    joined("DEFAULT", "_COMPOSITIONS"),
    joined("Facet", "Composition"),
    joined("validate", "Composition"),
    joined("select", "Composition", "References"),
    joined("Composition", "ReferenceDataset"),
    joined("get", "_composition"),
    joined("set", "_theme"),
    joined("Brick", "Recipe"),
    joined("Recipe", "PartName"),
    joined("resolve", "RecipePart"),
    joined("resolve", "Recipe"),
    joined("active", "Style"),
    joined("active", "Variant"),
    joined("composition", "-references"),
    joined("composition", "-observation"),
    joined("recipe", "-parts"),
    joined("theme", "-recipes"),
  ].join("|");
}

function buildRetiredAuthoredStylePattern() {
  const selectorKeys = [
    "variant",
    "tone",
    ["active", "Style"].join(""),
    ["active", "Variant"].join(""),
    "scheme",
  ].join("|");
  const oldToken = [
    ["fg", "muted"].join("-"),
    ["surface", "2"].join("-"),
    ["accent", "fg"].join("-"),
  ].join("|");
  return [
    String.raw`(?<![A-Za-z0-9_-])["']?(?:${selectorKeys})["']?\s*:`,
    String.raw`["']direction["']?\s*:\s*["']col["']`,
    String.raw`["'](?:${oldToken})["']`,
  ].join("|");
}

function buildRetiredSymbolsPattern() {
  const joined = (left, right, separator = "") => [left, right].join(separator);
  return [
    joined("use", "composition", "_"),
    joined("use", "Composition"),
    `${joined("Use", "Composition")}ToolInput`,
    `${joined("Use", "Composition")}Result`,
    joined("expand", "Composition"),
    `${joined("Expand", "Composition")}(Result|Options)?`,
    joined("Composition", "Params"),
    `${joined("Composition", "Ref")}(?!erence)`,
    joined("Expand", "At"),
    ["validate", "Composition", "Graph"].join(""),
    joined("composition", "graph", "-"),
    joined("expand", "composition", "-"),
    joined("allow", "Reference"),
    joined("allow", "SlotMarkers"),
    ["SLOT", "MARKER", "RE"].join("_"),
    joined("Node", "Filler"),
    joined("Node", "StringLeaves"),
    ["composition", "Catalog", "Violation"].join(""),
    ["PRIMITIVE", "BRICK", "TYPES"].join("_"),
    joined("Primitive", "BrickType"),
    joined("Primitive", "BrickNode"),
    ["INTRINSIC", "COMPONENT", "TYPES"].join("_"),
    joined("Intrinsic", "ComponentType"),
    ["LEGACY", "COMPONENT", "TYPES"].join("_"),
    joined("Legacy", "ComponentType"),
    ["COMPONENT", "NODE", "TYPES"].join("_"),
    ["Component", "Node", "Type"].join(""),
    ["Intrinsic", "Component", "Node"].join(""),
    ["Legacy", "Component", "Node"].join(""),
    joined("Component", "Node"),
    ["is", "Component", "Node", "Type"].join(""),
    joined("Catalog", "Component"),
    joined("Catalog", "UsageOrder"),
    joined("Button", "Node"),
    joined("Tabs", "Node"),
    joined("Nav", "Node"),
    joined("Metric", "Node"),
    joined("Stat", "Node"),
    joined("Form", "Node"),
    joined("FilterBar", "Node"),
    joined("Component", "RecipePart"),
    joined("Component", "Recipe"),
    joined("Component", "Recipes"),
    ["RECIPE", "COMPONENTS"].join("_"),
    joined("Recipe", "ComponentName"),
    ["MAX", "TABS", "ITEMS"].join("_"),
  ].join("|");
}

function buildLegacyDataPattern() {
  const key = ["u", "se"].join("");
  const pluralSlot = ["slo", "ts"].join("");
  const componentsKey = ["compo", "nents"].join("");
  const fallbackKey = ["primitive", "Fallback"].join("");
  const retiredTypes = ["button", "form", "filterBar", "metric", "tabs", "nav", "stat"].join("|");
  return [
    String.raw`\{\{[A-Za-z_][A-Za-z0-9_-]*\}\}`,
    String.raw`"${pluralSlot}"\s*:`,
    `${pluralSlot}:`,
    String.raw`\{\s*(?:"${key}"|${key})\s*:`,
    String.raw`^\s*(?:"${key}"|${key})\s*:\s*["'\x60]`,
    String.raw`(?:"${componentsKey}"|${componentsKey})\s*:`,
    String.raw`(?:"${fallbackKey}"|${fallbackKey})\s*:`,
    String.raw`(?:"type"|type)\s*:\s*["'](?:${retiredTypes})["']`,
  ].join("|");
}

function buildLegacyMultilineDataPattern() {
  const componentTier = ["compo", "nent"].join("");
  const primitiveTier = ["primi", "tive"].join("");
  return String.raw`(?:"order"|order)\s*:\s*\[\s*["']${componentTier}["']\s*,\s*["']${primitiveTier}["']`;
}

function buildSemanticPattern() {
  const compositionWord = ["compo", "sition"].join("");
  const beforeWord = ["be", "fore"].join("");
  const preferWord = ["pre", "fer"].join("");
  const graftWord = ["gr", "aft"].join("");
  const metadataWord = ["meta", "data"].join("");
  const promptWord = ["pro", "mpt"].join("");
  const wildcard = ".*";
  const finalBrickName =
    "(?:box|text|media|input|richtext|table|chart|list|keyValue|progress|loading)";
  const ruleSixParts = [];
  ruleSixParts.push(compositionWord);
  ruleSixParts.push(wildcard);
  ruleSixParts.push(beforeWord);
  ruleSixParts.push(wildcard);
  ruleSixParts.push("(patch|component|primitive)");
  const ruleSevenParts = [];
  ruleSevenParts.push(preferWord);
  ruleSevenParts.push(wildcard);
  ruleSevenParts.push(compositionWord);
  const ruleEightParts = [];
  ruleEightParts.push(graftWord);
  ruleEightParts.push(wildcard);
  ruleEightParts.push(compositionWord);
  const ruleNineParts = [];
  ruleNineParts.push(compositionWord);
  ruleNineParts.push(wildcard);
  ruleNineParts.push(metadataWord);
  ruleNineParts.push(wildcard);
  ruleNineParts.push(promptWord);
  return [
    ["composition", "component", "primitive"].join(" -> "),
    ["expanded", "server-side"].join(" "),
    ["server-side", "expansion"].join(" "),
    ["composition", "first"].join("-"),
    ["composition", "first"].join(" "),
    ruleSixParts.join(""),
    ruleSevenParts.join(""),
    ruleEightParts.join(""),
    ruleNineParts.join(""),
    ["primitive", "(fallback|base)"].join("\\s+"),
    ["intrinsic", "components?"].join("\\s+"),
    ["component", "primitive"].join("\\s*(?:->|→)\\s*"),
    ["component", "first"].join("[-\\s]+"),
    ["primitive", "component"].join("\\s*/\\s*"),
    ["component", "rich\\s+four[-\\s]+tab\\s+seed\\s+stage"].join("[-\\s]+"),
    ["component", "based\\s+(?:seeded\\s+first\\s+paint|four[-\\s]+tab\\s+tour\\s+seed)"].join(
      "[-\\s]+",
    ),
    [String.raw`(?<![A-Za-z0-9_])[\x60"']?${finalBrickName}[\x60"']?`, "primitive", "bricks?"].join(
      "\\s+",
    ),
  ].join("|");
}

const PATTERN_GROUPS = [
  { name: "retired_style_symbols", pattern: buildRetiredStyleSymbolsPattern() },
  {
    name: "retired_authored_style",
    pattern: buildRetiredAuthoredStylePattern(),
    multiline: true,
  },
  { name: "retired_symbols", pattern: buildRetiredSymbolsPattern() },
  { name: "legacy_data", pattern: buildLegacyDataPattern() },
  {
    name: "legacy_multiline_data",
    pattern: buildLegacyMultilineDataPattern(),
    multiline: true,
  },
  {
    name: "semantic_case_insensitive",
    pattern: buildSemanticPattern(),
    caseInsensitive: true,
  },
];

function normalizedRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function annotationIsEligible(relativePath, lineText) {
  if (!lineText.includes(ALLOWED_ANNOTATION) && !lineText.includes(LEGACY_ALLOWED_ANNOTATION)) {
    return false;
  }
  if (
    relativePath === SCANNER_PATH ||
    relativePath === "README.md" ||
    relativePath === "AGENTS.md" ||
    relativePath.startsWith("docs/") ||
    relativePath.startsWith(".changeset/")
  ) {
    return false;
  }

  const basename = path.posix.basename(relativePath);
  if (relativePath === "scripts/package-smoke.mjs") return true;
  if (basename.includes(".test.") || basename.includes(".spec.")) return true;
  return relativePath.split("/").some((segment) => ELIGIBLE_FIXTURE_SEGMENTS.has(segment));
}

function searchArguments(group, mode) {
  const args = ["--no-config", "--json", "--pcre2", "--no-ignore", "--hidden", "--text"];
  for (const glob of EXCLUDED_GLOBS) args.push("--glob", glob);
  if (mode === "production") args.push("--glob", "!**/*.md");
  if (group.caseInsensitive) args.push("--ignore-case");
  if (group.multiline) args.push("--multiline");
  args.push("--regexp", group.pattern, ...(mode === "production" ? PRODUCTION_ROOTS : ALL_ROOTS));
  return args;
}

function parseMatches(stdout, groupName) {
  const matches = [];
  for (const rawLine of stdout.split("\n")) {
    if (rawLine.length === 0) continue;
    let event;
    try {
      event = JSON.parse(rawLine);
    } catch (error) {
      throw new Error(`Hard-cut search failed while parsing ${groupName} output: ${error.message}`);
    }
    if (event.type !== "match") continue;
    const relativePath = event.data?.path?.text;
    const lineText = event.data?.lines?.text;
    const line = event.data?.line_number;
    if (
      typeof relativePath !== "string" ||
      typeof lineText !== "string" ||
      !Number.isInteger(line)
    ) {
      throw new Error(`Hard-cut search failed: malformed ${groupName} match output.`);
    }
    matches.push({
      group: groupName,
      path: normalizedRelativePath(relativePath),
      line,
      text: lineText.split(/\r\n|\n|\r/, 1)[0] ?? "",
    });
  }
  return matches;
}

function searchGroup({ cwd, group, mode, rgPath }) {
  const result = spawnSync(rgPath, searchArguments(group, mode), {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Hard-cut search failed for ${group.name}: ${result.error.message}`);
  }
  if (result.status === 1) return [];
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(
      `Hard-cut search failed for ${group.name} with exit ${String(result.status)}${
        detail.length > 0 ? `: ${detail}` : ""
      }`,
    );
  }
  const matches = parseMatches(result.stdout, group.name);
  if (matches.length === 0) {
    throw new Error(`Hard-cut search failed: ${group.name} exited 0 without a match.`);
  }
  return matches.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.text.localeCompare(right.text),
  );
}

function scannedFileArguments(mode) {
  const args = ["--no-config", "--files", "--null", "--no-ignore", "--hidden"];
  for (const glob of EXCLUDED_GLOBS) args.push("--glob", glob);
  if (mode === "production") args.push("--glob", "!**/*.md");
  args.push(...(mode === "production" ? PRODUCTION_ROOTS : ALL_ROOTS));
  return args;
}

function listScannedFiles({ cwd, mode, rgPath }) {
  const result = spawnSync(rgPath, scannedFileArguments(mode), {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Hard-cut search failed for lexical file list: ${result.error.message}`);
  }
  if (result.status === 1) return [];
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(
      `Hard-cut search failed for lexical file list with exit ${String(result.status)}${
        detail.length > 0 ? `: ${detail}` : ""
      }`,
    );
  }
  return result.stdout
    .split("\0")
    .filter((value) => value.length > 0)
    .map(normalizedRelativePath)
    .sort((left, right) => left.localeCompare(right));
}

function quotedEscapeMode(relativePath, quote) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (extension === ".json") return quote === '"' ? "json" : "invalid";
  if (extension === ".yaml" || extension === ".yml") {
    return quote === "'" ? "yaml-single" : "yaml-double";
  }
  return "javascript";
}

function simpleQuotedEscapes(mode) {
  if (mode === "json") return JSON_QUOTED_ESCAPES;
  if (mode === "yaml-double") return YAML_QUOTED_ESCAPES;
  return JAVASCRIPT_QUOTED_ESCAPES;
}

function isHexDigit(character) {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function fixedHexValue(source, start, length) {
  let value = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const character = source[start + offset];
    if (!isHexDigit(character)) return undefined;
    value = value * 16 + Number.parseInt(character, 16);
  }
  return value;
}

function bracedUnicodeValue(source, start) {
  let cursor = start;
  let digits = "";
  while (digits.length < 6 && isHexDigit(source[cursor])) {
    digits += source[cursor];
    cursor += 1;
  }
  const codePoint = digits.length > 0 ? Number.parseInt(digits, 16) : undefined;
  if (source[cursor] === "}" && codePoint !== undefined && codePoint <= 0x10_ff_ff) {
    return { codePoint, end: cursor + 1 };
  }
  return { codePoint: undefined, end: cursor };
}

function skipQuoted(source, start, quote, mode) {
  let index = start + 1;
  let line = 0;
  let value = mode === "invalid" ? undefined : "";
  const append = (fragment) => {
    if (value === undefined) return;
    const next = value + fragment;
    value = next.length <= MAX_QUOTED_TOKEN_LENGTH ? next : undefined;
  };
  while (index < source.length) {
    const character = source[index];
    if (mode === "yaml-single") {
      if (character === "'" && source[index + 1] === "'") {
        append("'");
        index += 2;
        continue;
      }
      if (character === "'") {
        return { end: index + 1, lineDelta: line, value };
      }
      if (character === "\n") line += 1;
      append(character);
      index += 1;
      continue;
    }
    if (character === "\\") {
      index += 1;
      const escaped = source[index];
      if (escaped === "\n" || escaped === "\r") {
        line += 1;
        if (mode === "json") value = undefined;
        index += escaped === "\r" && source[index + 1] === "\n" ? 2 : 1;
        continue;
      }
      const escapes = simpleQuotedEscapes(mode);
      if (escaped !== undefined && Object.hasOwn(escapes, escaped)) {
        append(escapes[escaped]);
        index += 1;
        continue;
      }
      if (escaped === "x" && (mode === "javascript" || mode === "yaml-double")) {
        const codePoint = fixedHexValue(source, index + 1, 2);
        if (codePoint !== undefined) {
          append(String.fromCharCode(codePoint));
          index += 3;
          continue;
        }
      } else if (escaped === "u") {
        if (mode === "javascript" && source[index + 1] === "{") {
          const decoded = bracedUnicodeValue(source, index + 2);
          if (decoded.codePoint !== undefined) {
            append(String.fromCodePoint(decoded.codePoint));
            index = decoded.end;
            continue;
          }
          value = undefined;
          index = decoded.end;
          continue;
        } else {
          const codePoint = fixedHexValue(source, index + 1, 4);
          if (codePoint !== undefined) {
            append(String.fromCharCode(codePoint));
            index += 5;
            continue;
          }
        }
      } else if (escaped === "U" && mode === "yaml-double") {
        const codePoint = fixedHexValue(source, index + 1, 8);
        if (codePoint !== undefined && codePoint <= 0x10_ff_ff) {
          append(String.fromCodePoint(codePoint));
          index += 9;
          continue;
        }
      }
      value = undefined;
      if (escaped !== undefined) index += 1;
      continue;
    }
    if (character === quote) {
      return { end: index + 1, lineDelta: line, value };
    }
    if (character === "\n") line += 1;
    append(character);
    index += 1;
  }
  return { end: source.length, lineDelta: line, value: undefined };
}

function skipLineComment(source, start) {
  const newline = source.indexOf("\n", start + 2);
  return newline === -1 ? source.length : newline;
}

function skipBlockComment(source, start) {
  const close = source.indexOf("*/", start + 2);
  const end = close === -1 ? source.length : close + 2;
  let lineDelta = 0;
  for (let index = start; index < end; index += 1) {
    if (source[index] === "\n") lineDelta += 1;
  }
  return { end, lineDelta };
}

function pushLexicalToken(state, token) {
  state.tokenCount += 1;
  if (state.tokenCount > MAX_LEXICAL_TOKENS) {
    throw new Error(`Hard-cut lexical scan exceeded the token limit: ${state.relativePath}`);
  }
  state.tokens.push(token);
}

function pushQuotedToken(state, start, quote) {
  const skipped = skipQuoted(
    state.source,
    start,
    quote,
    quotedEscapeMode(state.relativePath, quote),
  );
  pushLexicalToken(state, {
    kind: "string",
    value: skipped.value,
    start,
    line: state.line,
  });
  state.line += skipped.lineDelta;
  return skipped.end;
}

function pushIdentifierToken(state, start) {
  let end = start + 1;
  while (end < state.source.length && /[A-Za-z0-9_$]/.test(state.source[end])) end += 1;
  pushLexicalToken(state, {
    kind: "identifier",
    value: state.source.slice(start, end),
    start,
    line: state.line,
  });
  return end;
}

function pushPunctuationToken(state, start) {
  pushLexicalToken(state, {
    kind: "punctuation",
    value: state.source[start],
    start,
    line: state.line,
  });
}

function lexicalTokens(source, relativePath) {
  const state = { source, relativePath, tokens: [], tokenCount: 0, line: 1 };
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "\n") {
      state.line += 1;
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      index = skipLineComment(source, index);
      continue;
    }
    if (character === "/" && next === "*") {
      const skipped = skipBlockComment(source, index);
      index = skipped.end;
      state.line += skipped.lineDelta;
      continue;
    }
    if (character === "'" || character === '"') {
      index = pushQuotedToken(state, index, character);
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      index = pushIdentifierToken(state, index);
      continue;
    }
    if (character === "{" || character === "}" || character === ":") {
      pushPunctuationToken(state, index);
    }
    index += 1;
  }
  return state.tokens;
}

function sourceLine(source, start) {
  let lineStart = start;
  while (lineStart > 0 && source[lineStart - 1] !== "\n" && source[lineStart - 1] !== "\r") {
    lineStart -= 1;
  }
  let lineEnd = start;
  while (lineEnd < source.length && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") {
    lineEnd += 1;
  }
  return source.slice(lineStart, lineEnd);
}

function readBoundedSource(absolutePath, relativePath) {
  const descriptor = openSync(absolutePath, "r");
  try {
    const chunks = [];
    let bytesRead = 0;
    while (bytesRead <= MAX_LEXICAL_FILE_LENGTH) {
      const chunk = Buffer.allocUnsafe(
        Math.min(LEXICAL_READ_CHUNK_LENGTH, MAX_LEXICAL_FILE_LENGTH + 1 - bytesRead),
      );
      const count = readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) break;
      chunks.push(count === chunk.length ? chunk : chunk.subarray(0, count));
      bytesRead += count;
    }
    if (bytesRead > MAX_LEXICAL_FILE_LENGTH) {
      throw new Error(`Hard-cut lexical scan exceeded the file limit: ${relativePath}`);
    }
    return Buffer.concat(chunks, bytesRead).toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

function isJavaScriptFile(relativePath) {
  return JAVASCRIPT_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function scriptKind(relativePath) {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case ".js":
    case ".cjs":
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function enforceJavaScriptTokenLimit(source, relativePath, kind) {
  const languageVariant =
    kind === ts.ScriptKind.JSX || kind === ts.ScriptKind.TSX
      ? ts.LanguageVariant.JSX
      : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, languageVariant, source);
  let tokenCount = 0;
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    tokenCount += 1;
    if (tokenCount > MAX_LEXICAL_TOKENS) {
      throw new Error(`Hard-cut lexical scan exceeded the token limit: ${relativePath}`);
    }
  }
}

function transparentExpressionChild(node) {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return node.expression;
  }
  return undefined;
}

function expressionObjectRoot(expression, relativePath) {
  let current = expression;
  for (let depth = 0; depth <= MAX_TRANSPARENT_WRAPPER_DEPTH; depth += 1) {
    if (ts.isObjectLiteralExpression(current)) return current;
    const child = transparentExpressionChild(current);
    if (child === undefined) return undefined;
    current = child;
  }
  throw new Error(`Hard-cut JavaScript scan exceeded the wrapper limit: ${relativePath}`);
}

function typeLiteralRoots(type, relativePath) {
  const roots = [];
  const stack = [{ node: type, depth: 0 }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.depth > MAX_TRANSPARENT_WRAPPER_DEPTH) {
      throw new Error(`Hard-cut JavaScript scan exceeded the wrapper limit: ${relativePath}`);
    }
    if (ts.isTypeLiteralNode(frame.node)) {
      roots.push(frame.node);
      continue;
    }
    let children;
    if (ts.isParenthesizedTypeNode(frame.node)) {
      children = [frame.node.type];
    } else if (ts.isTypeReferenceNode(frame.node)) {
      children = frame.node.typeArguments ?? [];
    } else if (ts.isUnionTypeNode(frame.node) || ts.isIntersectionTypeNode(frame.node)) {
      children = frame.node.types;
    } else {
      continue;
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: frame.depth + 1 });
    }
  }
  return roots;
}

function staticPropertyName(name, relativePath) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    let expression = name.expression;
    for (let depth = 0; ; depth += 1) {
      const child = transparentExpressionChild(expression);
      if (child === undefined) break;
      if (depth >= MAX_TRANSPARENT_WRAPPER_DEPTH) {
        throw new Error(`Hard-cut JavaScript scan exceeded the wrapper limit: ${relativePath}`);
      }
      expression = child;
    }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
  }
  return undefined;
}

function isScannedProperty(node) {
  return ts.isPropertyAssignment(node) || ts.isPropertySignature(node);
}

function styleContainers(node, name, relativePath) {
  if (name !== "style") return [];
  if (ts.isPropertyAssignment(node)) {
    const root = expressionObjectRoot(node.initializer, relativePath);
    return root === undefined ? [] : [root];
  }
  if (ts.isPropertySignature(node) && node.type) {
    return typeLiteralRoots(node.type, relativePath);
  }
  return [];
}

function sourceMatch(sourceFile, source, relativePath, node) {
  const start = node.getStart(sourceFile);
  return {
    group: "retired_authored_style",
    path: relativePath,
    line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
    text: sourceLine(source, start),
  };
}

function scanJavaScriptAuthoredStyles(source, relativePath) {
  const kind = scriptKind(relativePath);
  enforceJavaScriptTokenLimit(source, relativePath, kind);
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, kind);
  const parseDiagnostic = sourceFile.parseDiagnostics[0];
  if (parseDiagnostic !== undefined) {
    const detail = ts.flattenDiagnosticMessageText(parseDiagnostic.messageText, " ");
    throw new Error(`Hard-cut JavaScript scan found invalid syntax: ${relativePath}: ${detail}`);
  }

  const matches = [];
  const stack = [{ node: sourceFile, astDepth: 1, styleDepth: undefined }];
  const styleRoots = new WeakSet();
  const spreadRoots = new WeakSet();
  let nodeCount = 0;
  let styleObjects = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    const node = frame.node;
    nodeCount += 1;
    if (nodeCount > MAX_AST_NODES) {
      throw new Error(`Hard-cut JavaScript scan exceeded the AST node limit: ${relativePath}`);
    }
    if (frame.astDepth > MAX_AST_DEPTH) {
      throw new Error(`Hard-cut JavaScript scan exceeded the AST depth limit: ${relativePath}`);
    }

    if (isScannedProperty(node)) {
      const name = staticPropertyName(node.name, relativePath);
      const roots = styleContainers(node, name, relativePath);
      for (const root of roots) styleRoots.add(root);
      if (roots.length > 0) {
        styleObjects += roots.length;
        if (styleObjects > MAX_STYLE_OBJECTS_PER_FILE) {
          throw new Error(`Hard-cut lexical scan exceeded the style-object limit: ${relativePath}`);
        }
      }
      if (
        name !== undefined &&
        frame.styleDepth !== undefined &&
        RETIRED_STYLE_PROPERTY_KEYS.has(name) &&
        (name !== "size" || frame.styleDepth === 1)
      ) {
        matches.push(sourceMatch(sourceFile, source, relativePath, node.name));
      }
    }
    if (ts.isSpreadAssignment(node)) {
      const root = expressionObjectRoot(node.expression, relativePath);
      if (root !== undefined) spreadRoots.add(root);
    }

    const children = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      let childStyleDepth = frame.styleDepth;
      if (styleRoots.has(child)) {
        childStyleDepth = 1;
      } else if (spreadRoots.has(child)) {
        childStyleDepth = frame.styleDepth;
      } else if (
        childStyleDepth !== undefined &&
        (ts.isObjectLiteralExpression(child) || ts.isTypeLiteralNode(child))
      ) {
        childStyleDepth += 1;
      }
      if (childStyleDepth !== undefined && childStyleDepth > MAX_STYLE_OBJECT_DEPTH) {
        throw new Error(`Hard-cut lexical scan exceeded the object-depth limit: ${relativePath}`);
      }
      stack.push({ node: child, astDepth: frame.astDepth + 1, styleDepth: childStyleDepth });
    }
  }
  return matches;
}

function isPropertyNameToken(token) {
  return token?.kind === "identifier" || token?.kind === "string";
}

function isPunctuationToken(token, value) {
  return token?.kind === "punctuation" && token.value === value;
}

function scanNonJavaScriptStyleObjects(source, relativePath) {
  const matches = [];
  const tokens = lexicalTokens(source, relativePath);
  let styleObjects = 0;
  let braceDepth = 0;
  const styleObjectDepths = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isPunctuationToken(token, "{")) {
      braceDepth += 1;
      const styleName = tokens[index - 2];
      const separator = tokens[index - 1];
      if (
        isPropertyNameToken(styleName) &&
        styleName.value === "style" &&
        isPunctuationToken(separator, ":")
      ) {
        styleObjects += 1;
        if (styleObjects > MAX_STYLE_OBJECTS_PER_FILE) {
          throw new Error(`Hard-cut lexical scan exceeded the style-object limit: ${relativePath}`);
        }
        styleObjectDepths.push(braceDepth);
      }
      const outerStyleDepth = styleObjectDepths[0];
      if (
        outerStyleDepth !== undefined &&
        braceDepth - outerStyleDepth + 1 > MAX_STYLE_OBJECT_DEPTH
      ) {
        throw new Error(`Hard-cut lexical scan exceeded the object-depth limit: ${relativePath}`);
      }
      continue;
    }
    if (isPunctuationToken(token, "}")) {
      if (styleObjectDepths.at(-1) === braceDepth) styleObjectDepths.pop();
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    const currentStyleObjectDepth = styleObjectDepths.at(-1);
    if (
      currentStyleObjectDepth !== undefined &&
      isPropertyNameToken(token) &&
      RETIRED_STYLE_PROPERTY_KEYS.has(token.value) &&
      (token.value !== "size" || braceDepth === currentStyleObjectDepth) &&
      isPunctuationToken(tokens[index + 1], ":")
    ) {
      matches.push({
        group: "retired_authored_style",
        path: relativePath,
        line: token.line,
        text: sourceLine(source, token.start),
      });
    }
  }
  return matches;
}

function scanBalancedStyleObjects({ cwd, files }) {
  const matches = [];
  const resolvedCwd = path.resolve(cwd);
  for (const relativePath of files) {
    const absolutePath = path.resolve(resolvedCwd, relativePath);
    if (absolutePath !== resolvedCwd && !absolutePath.startsWith(`${resolvedCwd}${path.sep}`)) {
      throw new Error(`Hard-cut lexical scan rejected an out-of-root path: ${relativePath}`);
    }
    const source = readBoundedSource(absolutePath, relativePath);
    matches.push(
      ...(isJavaScriptFile(relativePath)
        ? scanJavaScriptAuthoredStyles(source, relativePath)
        : scanNonJavaScriptStyleObjects(source, relativePath)),
    );
  }
  return matches;
}

function deduplicateMatches(matches) {
  const seen = new Set();
  return matches.filter((match) => {
    const key = `${match.group}\0${match.path}\0${String(match.line)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareMatches(left, right) {
  return (
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.text.localeCompare(right.text)
  );
}

export function scanHardCut({ cwd = process.cwd(), mode = "all", rgPath = "rg" } = {}) {
  if (mode !== "all" && mode !== "production") {
    throw new Error(`Hard-cut scan failed: unknown mode ${String(mode)}.`);
  }
  const groupedMatches = PATTERN_GROUPS.map((group) => ({
    group,
    matches: searchGroup({ cwd, group, mode, rgPath }),
  }));
  const balancedMatches = scanBalancedStyleObjects({
    cwd,
    files: listScannedFiles({ cwd, mode, rgPath }),
  });
  const matches = groupedMatches.flatMap(({ group, matches: groupMatches }) =>
    group.name === "retired_authored_style"
      ? deduplicateMatches([...groupMatches, ...balancedMatches]).sort(compareMatches)
      : groupMatches,
  );
  const waived = [];
  const violations = [];
  for (const match of matches) {
    if (annotationIsEligible(match.path, match.text)) waived.push(match);
    else violations.push(match);
  }
  return { violations, waived };
}

function reportViolations(violations) {
  for (const violation of violations) {
    process.stderr.write(
      `${escapeDiagnostic(violation.path)}:${violation.line}: [${violation.group}] ${escapeDiagnostic(violation.text)}\n`,
    );
  }
}

function escapeDiagnostic(value) {
  let escaped = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    escaped +=
      code < 0x20 || (code >= 0x7f && code <= 0x9f)
        ? `\\u${code.toString(16).padStart(4, "0")}`
        : character;
  }
  return escaped;
}

function runCli() {
  try {
    const args = process.argv.slice(2);
    if (args.some((value) => value !== "--production")) {
      throw new Error(`Hard-cut scan failed: unknown argument ${args.join(" ")}.`);
    }
    const mode = args.includes("--production") ? "production" : "all";
    const result = scanHardCut({ mode });
    if (result.violations.length > 0) {
      reportViolations(result.violations);
      process.stderr.write(`Hard-cut scan failed with ${result.violations.length} violation(s).\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `Hard-cut scan passed (${result.waived.length} annotated negative(s) waived).\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${escapeDiagnostic(error instanceof Error ? error.message : String(error))}\n`,
    );
    process.exitCode = 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) runCli();
