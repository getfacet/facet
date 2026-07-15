#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOTS = ["packages", "apps", "docs", "scripts", ".changeset", "README.md", "AGENTS.md"];

const EXCLUDED_GLOBS = ["!**/node_modules/**", "!**/dist/**", "!**/coverage/**", "!**/.turbo/**"];

const ALLOWED_ANNOTATION = ["composition-hard-cut", "allowed-negative"].join(": ");
const ELIGIBLE_FIXTURE_SEGMENTS = new Set(["fixtures", "__fixtures__", "test-data"]);
const SCANNER_PATH = "scripts/check-composition-hard-cut.mjs";

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
  if (!lineText.includes(ALLOWED_ANNOTATION)) return false;
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
  if (basename.includes(".test.") || basename.includes(".spec.")) return true;
  return relativePath.split("/").some((segment) => ELIGIBLE_FIXTURE_SEGMENTS.has(segment));
}

function searchArguments(group) {
  const args = ["--no-config", "--json", "--pcre2", "--no-ignore", "--hidden", "--text"];
  for (const glob of EXCLUDED_GLOBS) args.push("--glob", glob);
  if (group.caseInsensitive) args.push("--ignore-case");
  if (group.multiline) args.push("--multiline");
  args.push("--regexp", group.pattern, ...ROOTS);
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
      text: lineText.replace(/\r?\n$/, ""),
    });
  }
  return matches;
}

function searchGroup({ cwd, group, rgPath }) {
  const result = spawnSync(rgPath, searchArguments(group), {
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

export function scanHardCut({ cwd = process.cwd(), rgPath = "rg" } = {}) {
  const matches = PATTERN_GROUPS.flatMap((group) => searchGroup({ cwd, group, rgPath }));
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
    const result = scanHardCut();
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
