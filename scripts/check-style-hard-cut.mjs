#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const HARD_CUT_SLUG = ["markup", "component", "greenfield", "hard", "cut"].join("-");
const PRODUCTION_ROOTS = ["packages", "labs", "scripts"];
const ROOT_DOCS = ["README.md", "AGENTS.md", "CHANGELOG.md", "SECURITY.md"];
const AGENT_PROCESS_ROOTS = [".agents", ".claude", ".codex"];
const ALL_ROOTS = [...PRODUCTION_ROOTS, "docs", ".changeset", ...ROOT_DOCS, ...AGENT_PROCESS_ROOTS];
const DOCS_SCOPE_ROOTS = [...ROOT_DOCS, "docs", "packages", ...AGENT_PROCESS_ROOTS];

const EXCLUDED_GLOBS = [
  "!**/node_modules/**",
  "!**/dist/**",
  "!**/coverage/**",
  "!**/.turbo/**",
  "!**/.agents/work/**",
];

const ALLOWED_ANNOTATION = ["style-hard-cut", "allowed-negative"].join(": ");
const ELIGIBLE_FIXTURE_SEGMENTS = new Set(["fixtures", "__fixtures__", "test-data"]);
const SCANNER_PATH = "scripts/check-style-hard-cut.mjs";
const MAX_LEXICAL_FILE_LENGTH = 8 * 1024 * 1024;
const LEXICAL_READ_CHUNK_LENGTH = 64 * 1024;
function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function exactIdentifierPattern(value) {
  return String.raw`(?<![A-Za-z0-9_])${escapeRegExp(value)}(?![A-Za-z0-9_])`;
}

function exactPathPattern(value) {
  return String.raw`(?<![A-Za-z0-9_@/-])${escapeRegExp(value)}(?![A-Za-z0-9_@/-])`;
}

function buildRetiredHardCutSymbolsPattern() {
  const joined = (...parts) => parts.join("");
  const symbols = [
    joined("Br", "ick"),
    joined("Pat", "tern"),
    joined("Pre", "set"),
    ["STAGE", "SPEC"].join("_"),
    joined("Facet", "Tree"),
    joined("Assets", "Store"),
    joined("File", "Assets"),
    joined("Memory", "Assets"),
    joined("load", "Assets"),
    joined("View", "Snapshot"),
    joined("Over", "lay"),
  ];
  return [
    ...symbols.map(exactIdentifierPattern),
    String.raw`(?<![A-Za-z0-9_-])${["lo", "cal"].join("")}:`,
    String.raw`(?:(?<![A-Za-z0-9_$])kind|["']kind["'])\s*:\s*["'](?:say|reset)["']`,
  ].join("|");
}

function buildRetiredToolNamesPattern() {
  const joined = (left, right, separator = "") => [left, right].join(separator);
  const toolNames = [
    joined("get", "brick", "_") + "_spec",
    joined("get", "style", "_") + "_choices",
    joined("get", "preset", "_"),
    joined("get", "pattern", "_"),
    joined("inspect", "stage", "_"),
    joined("inspect", "node", "_"),
    joined("append", "node", "_"),
    joined("set", "node", "_"),
    joined("remove", "node", "_"),
  ];
  return [String.raw`(?<![A-Za-z0-9_])say\s*\(`, ...toolNames.map(exactIdentifierPattern)].join(
    "|",
  );
}

function buildDeletedPackagePattern() {
  const joined = (...parts) => parts.join("");
  const npmNames = [
    ["@facet", joined("ag", "-", "ui")].join("/"),
    ["@facet", joined("store", "-", "postgres")].join("/"),
    ["@facet", joined("cli")].join("/"),
    ["@facet", joined("bridge")].join("/"),
  ];
  const paths = [
    ["packages", "adapters", joined("ag", "-", "ui")].join("/"),
    ["packages", "adapters", joined("store", "-", "postgres")].join("/"),
    ["packages", "tools", joined("cli")].join("/"),
    ["packages", "tools", joined("bridge")].join("/"),
  ];
  return [...npmNames, ...paths].map(exactPathPattern).join("|");
}

function buildDeletedAppPathPattern() {
  const joined = (...parts) => parts.join("");
  return [
    ["apps", joined("play", "ground")].join("/"),
    ["apps", joined("facet", "-", "lab")].join("/"),
  ]
    .map(exactPathPattern)
    .join("|");
}

function buildTokenCountLanguagePattern() {
  const tokenWord = ["to", "ken"].join("");
  return [
    String.raw`\b${tokenWord}[-\s]?(?:count|counts|budget|budgets|limit|limits|ceiling|ceilings|cap|caps)\b`,
    String.raw`\b(?:count|counts|budget|budgets|limit|limits|ceiling|ceilings|cap|caps)[-\s]?${tokenWord}s?\b`,
  ].join("|");
}

function buildRetiredOperationalContractsPattern() {
  const joined = (...parts) => parts.join("");
  const legacyTrustFunction = joined("validate", "Tree");
  const localBrowser = joined("browser", "-", "local");
  return [
    exactIdentifierPattern(legacyTrustFunction),
    String.raw`\bnative\s+${joined("Br", "ick")}\b`,
    String.raw`\bstyle\s+vocabular(?:y|ies)\b`,
    String.raw`\bfacet\s+CLI\b`,
    String.raw`\bPostgres\s+(?:store\s+)?adapter\b`,
    String.raw`\blocal\s+bridge\b`,
    String.raw`\bmedia\.src\b`,
    String.raw`\b${localBrowser}\b[^\n]*(?:navigate\W*/\W*toggle|tap\s+recording)`,
    String.raw`\bnavigate\W*/\W*toggle\b`,
    String.raw`\btap\s+recording\b`,
  ].join("|");
}

function buildDocsScopePattern() {
  const joined = (...parts) => parts.join("");
  const labEvidencePaths = [joined("facet", "-", "lab"), joined("check", "-", "lab", "-", "gates")];
  const labEvidenceCommands = [
    String.raw`pnpm\s+--filter\s+${escapeRegExp(["@facet", "lab"].join("/"))}`,
    String.raw`pnpm\s+demo`,
  ];
  return [
    buildRetiredHardCutSymbolsPattern(),
    buildRetiredToolNamesPattern(),
    buildDeletedPackagePattern(),
    buildDeletedAppPathPattern(),
    ...labEvidencePaths.map(exactPathPattern),
    ...labEvidenceCommands,
  ].join("|");
}

const PATTERN_GROUPS = [
  { name: "retired_hard_cut_symbols", pattern: buildRetiredHardCutSymbolsPattern() },
  { name: "retired_tool_names", pattern: buildRetiredToolNamesPattern() },
  { name: "deleted_package_names", pattern: buildDeletedPackagePattern() },
  { name: "deleted_app_paths", pattern: buildDeletedAppPathPattern() },
  {
    name: "token_count_language",
    pattern: buildTokenCountLanguagePattern(),
    caseInsensitive: true,
    docsScope: true,
  },
  {
    name: "retired_operational_contracts",
    pattern: buildRetiredOperationalContractsPattern(),
    caseInsensitive: true,
    docsScope: true,
  },
  {
    name: "docs_scope_residue",
    pattern: buildDocsScopePattern(),
    caseInsensitive: true,
    docsScope: true,
  },
];

function normalizedRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function annotationIsEligible(relativePath, lineText) {
  if (!lineText.includes(ALLOWED_ANNOTATION)) {
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

function searchArguments(group, mode, cwd) {
  const args = ["--no-config", "--json", "--pcre2", "--no-ignore", "--hidden", "--text"];
  for (const glob of EXCLUDED_GLOBS) args.push("--glob", glob);
  if (mode === "production") args.push("--glob", "!**/*.md");
  if (group.caseInsensitive) args.push("--ignore-case");
  if (group.multiline) args.push("--multiline");
  const roots = group.docsScope
    ? DOCS_SCOPE_ROOTS
    : mode === "production"
      ? PRODUCTION_ROOTS
      : ALL_ROOTS;
  const existingRoots = roots.filter((root) => existsSync(path.resolve(cwd, root)));
  args.push("--regexp", group.pattern, ...existingRoots);
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

function isDefaultMissingSearch(error, rgPath) {
  return rgPath === "rg" && error?.code === "ENOENT";
}

function pathSegments(relativePath) {
  return normalizedRelativePath(relativePath)
    .split("/")
    .filter((segment) => segment.length > 0);
}

function isExcludedPath(relativePath, mode) {
  const normalized = normalizedRelativePath(relativePath);
  const segments = pathSegments(normalized);
  if (normalized === ".agents/work" || normalized.startsWith(".agents/work/")) {
    return true;
  }
  if (
    segments.some(
      (segment) =>
        segment === "node_modules" ||
        segment === "dist" ||
        segment === "coverage" ||
        segment === ".turbo",
    )
  ) {
    return true;
  }
  return mode === "production" && path.posix.extname(normalized).toLowerCase() === ".md";
}

function isDocsScopePath(relativePath, groupName) {
  const normalized = normalizedRelativePath(relativePath);
  const isCommittedDoc =
    ROOT_DOCS.includes(normalized) ||
    normalized.startsWith("docs/") ||
    /^packages\/[^/]+\/[^/]+\/README\.md$/u.test(normalized);
  if (isCommittedDoc) return true;
  return (
    groupName === "retired_operational_contracts" &&
    (normalized.startsWith(".agents/") ||
      normalized.startsWith(".claude/") ||
      normalized.startsWith(".codex/"))
  );
}

function listScannedFilesPortable({ cwd, mode }) {
  const roots = mode === "production" ? PRODUCTION_ROOTS : ALL_ROOTS;
  const files = [];
  const resolvedCwd = path.resolve(cwd);
  for (const root of roots) {
    const rootPath = path.resolve(resolvedCwd, root);
    if (!existsSync(rootPath)) continue;
    const rootStats = lstatSync(rootPath);
    if (rootStats.isSymbolicLink()) continue;
    if (rootStats.isFile()) {
      const relativePath = normalizedRelativePath(root);
      if (!isExcludedPath(relativePath, mode)) files.push(relativePath);
      continue;
    }
    if (!rootStats.isDirectory()) continue;
    const stack = [normalizedRelativePath(root)];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || isExcludedPath(`${current}/`, mode)) continue;
      const entries = readdirSync(path.resolve(resolvedCwd, current), { withFileTypes: true });
      for (const entry of entries) {
        const childPath = normalizedRelativePath(path.posix.join(current, entry.name));
        if (entry.isSymbolicLink() || isExcludedPath(childPath, mode)) continue;
        if (entry.isDirectory()) {
          stack.push(childPath);
        } else if (entry.isFile()) {
          files.push(childPath);
        }
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "\n") line += 1;
  }
  return line;
}

function sourceLineAt(source, index) {
  let lineStart = index;
  while (lineStart > 0 && source[lineStart - 1] !== "\n" && source[lineStart - 1] !== "\r") {
    lineStart -= 1;
  }
  let lineEnd = index;
  while (lineEnd < source.length && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") {
    lineEnd += 1;
  }
  return source.slice(lineStart, lineEnd);
}

function groupRegExp(group, { multiline }) {
  return new RegExp(group.pattern, `gu${multiline ? "m" : ""}${group.caseInsensitive ? "i" : ""}`);
}

function sourceLineEntries(source) {
  const entries = [];
  let start = 0;
  let line = 1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== "\n" && character !== "\r") continue;
    entries.push({ line, text: source.slice(start, index) });
    if (character === "\r" && source[index + 1] === "\n") index += 1;
    start = index + 1;
    line += 1;
  }
  if (start <= source.length) entries.push({ line, text: source.slice(start) });
  return entries;
}

function searchLineMode({ source, relativePath, group }) {
  const pattern = groupRegExp(group, { multiline: false });
  const matches = [];
  for (const entry of sourceLineEntries(source)) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(entry.text)) !== null) {
      matches.push({
        group: group.name,
        path: relativePath,
        line: entry.line,
        text: entry.text,
      });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return matches;
}

function searchMultilineMode({ source, relativePath, group }) {
  const pattern = groupRegExp(group, { multiline: true });
  const matches = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    matches.push({
      group: group.name,
      path: relativePath,
      line: lineNumberAt(source, match.index),
      text: sourceLineAt(source, match.index),
    });
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return matches;
}

function searchGroupPortable({ cwd, group, mode }) {
  const resolvedCwd = path.resolve(cwd);
  const matches = [];
  for (const relativePath of listScannedFilesPortable({ cwd, mode })) {
    const absolutePath = path.resolve(resolvedCwd, relativePath);
    if (absolutePath !== resolvedCwd && !absolutePath.startsWith(`${resolvedCwd}${path.sep}`)) {
      throw new Error(`Hard-cut search rejected an out-of-root path: ${relativePath}`);
    }
    const source = readBoundedSource(absolutePath, relativePath);
    matches.push(
      ...(group.multiline
        ? searchMultilineMode({ source, relativePath, group })
        : searchLineMode({ source, relativePath, group })),
    );
  }
  const filtered = group.docsScope
    ? matches.filter((match) => isDocsScopePath(match.path, group.name))
    : matches;
  return filtered.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.text.localeCompare(right.text),
  );
}

function searchGroup({ cwd, group, mode, rgPath }) {
  const result = spawnSync(rgPath, searchArguments(group, mode, cwd), {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    if (isDefaultMissingSearch(result.error, rgPath)) {
      return searchGroupPortable({ cwd, group, mode });
    }
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
  const filtered = group.docsScope
    ? matches.filter((match) => isDocsScopePath(match.path, group.name))
    : matches;
  return filtered.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.text.localeCompare(right.text),
  );
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

export function scanHardCut({ cwd = process.cwd(), mode = "all", rgPath = "rg" } = {}) {
  if (mode !== "all" && mode !== "production") {
    throw new Error(`Hard-cut scan failed: unknown mode ${String(mode)}.`);
  }
  const activeGroups = PATTERN_GROUPS.filter((group) => mode === "all" || !group.docsScope);
  const groupedMatches = activeGroups.map((group) => ({
    group,
    matches: searchGroup({ cwd, group, mode, rgPath }),
  }));
  const matches = filterAllowedDirectionSupersededMatches(
    [
      ...groupedMatches.flatMap(({ matches: groupMatches }) => groupMatches),
      ...directionSupersededHeaderViolations(cwd, mode),
    ],
    cwd,
  );
  const waived = [];
  const violations = [];
  for (const match of matches) {
    if (annotationIsEligible(match.path, match.text)) waived.push(match);
    else violations.push(match);
  }
  return { violations, waived };
}

const DIRECTION_PATH = "labs/markup-model/DIRECTION.md";
const DIRECTION_SUPERSEDED_SECTION = "## Superseded decisions";
const DIRECTION_ALLOWED_SUPERSEDED_TEXT = [
  ["Over", "lay"].join(""),
  `${["lo", "cal"].join("")}:`,
  "markup-template",
  ["Assets", "Store"].join(""),
  "Lab-first",
];

function hasValidDirectionHeader(source) {
  const firstLine = sourceLineEntries(source)[0]?.text ?? "";
  return firstLine.startsWith("> **Superseded**") && firstLine.includes(HARD_CUT_SLUG);
}

function directionSupersededSectionLines(source) {
  const entries = sourceLineEntries(source);
  const sectionStart = entries.find((entry) => entry.text === DIRECTION_SUPERSEDED_SECTION)?.line;
  if (sectionStart === undefined) return undefined;
  const nextSection = entries.find(
    (entry) => entry.line > sectionStart && /^##\s/u.test(entry.text),
  )?.line;
  return { start: sectionStart + 1, end: nextSection ?? Number.POSITIVE_INFINITY };
}

function isAllowedDirectionSupersededMatch(match, source) {
  if (match.group !== "retired_hard_cut_symbols" || match.path !== DIRECTION_PATH) {
    return false;
  }
  if (!hasValidDirectionHeader(source)) return false;
  const section = directionSupersededSectionLines(source);
  if (section === undefined || match.line < section.start || match.line >= section.end) {
    return false;
  }
  return DIRECTION_ALLOWED_SUPERSEDED_TEXT.some((allowed) => match.text.includes(allowed));
}

function filterAllowedDirectionSupersededMatches(matches, cwd) {
  const directionMatches = matches.filter((match) => match.path === DIRECTION_PATH);
  if (directionMatches.length === 0) return matches;
  const absolutePath = path.resolve(cwd, DIRECTION_PATH);
  if (!existsSync(absolutePath)) return matches;
  const source = readBoundedSource(absolutePath, DIRECTION_PATH);
  return matches.filter((match) => !isAllowedDirectionSupersededMatch(match, source));
}

function directionSupersededHeaderViolations(cwd, mode) {
  if (mode !== "all") return [];
  const relativePath = DIRECTION_PATH;
  const absolutePath = path.resolve(cwd, relativePath);
  if (!existsSync(absolutePath)) {
    return [
      {
        group: "direction_superseded_header",
        path: relativePath,
        line: 1,
        text: "Missing labs/markup-model/DIRECTION.md superseded header",
      },
    ];
  }
  const source = readBoundedSource(absolutePath, relativePath);
  const firstLine = sourceLineEntries(source)[0]?.text ?? "";
  if (firstLine.startsWith("> **Superseded**") && firstLine.includes(HARD_CUT_SLUG)) return [];
  return [
    {
      group: "direction_superseded_header",
      path: relativePath,
      line: 1,
      text: firstLine.length > 0 ? firstLine : "Missing superseded header",
    },
  ];
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
