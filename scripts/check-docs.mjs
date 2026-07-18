import { access, lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

import GithubSlugger from "github-slugger";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import ts from "typescript";

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
]);
const SKIPPED_REPOSITORY_PATHS = new Set([".agents/work"]);
const LINK_NODE_TYPES = new Set(["definition", "image", "link"]);
const IMAGE_NODE_TYPES = new Set(["image", "imageReference"]);
const CHECKED_LANGUAGES = new Set(["ts", "tsx", "typescript"]);
const CANONICAL_GITHUB_PREFIX = "/getfacet/facet/blob/main/";
const CHECKED_FENCE =
  /^ {0,3}(?<fence>`{3,}|~{3,})\s*(?<language>ts|tsx|typescript)\s+check-docs\s*$/;

function toRepoPath(cwd, absolutePath) {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

async function exists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function collectMarkdownUnder(cwd, absolutePath, files) {
  const relativePath = toRepoPath(cwd, absolutePath);
  if (relativePath === ".." || relativePath.startsWith("../")) {
    return;
  }

  let stat;
  try {
    stat = await lstat(absolutePath);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) {
    return;
  }
  if (stat.isFile()) {
    if (absolutePath.endsWith(".md")) {
      files.add(absolutePath);
    }
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }

  const directoryName = path.basename(absolutePath);
  if (relativePath && SKIPPED_DIRECTORIES.has(directoryName)) {
    return;
  }
  if (SKIPPED_REPOSITORY_PATHS.has(relativePath)) {
    return;
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    await collectMarkdownUnder(cwd, path.join(absolutePath, entry.name), files);
  }
}

async function collectMarkdownFiles(cwd, requestedFiles) {
  const files = new Set();
  const inputs = requestedFiles.length > 0 ? requestedFiles : ["."];
  const inputErrors = [];

  for (const input of inputs) {
    const absolutePath = path.resolve(cwd, input);
    const relativePath = toRepoPath(cwd, absolutePath);
    if (relativePath === ".." || relativePath.startsWith("../")) {
      inputErrors.push({
        column: 1,
        kind: "input",
        line: 1,
        message: `path is outside the repository: ${input}`,
        source: input,
      });
      continue;
    }
    if (!(await exists(absolutePath))) {
      inputErrors.push({
        column: 1,
        kind: "input",
        line: 1,
        message: `path does not exist: ${input}`,
        source: input,
      });
      continue;
    }
    await collectMarkdownUnder(cwd, absolutePath, files);
  }

  return {
    errors: inputErrors,
    files: [...files].sort((left, right) =>
      toRepoPath(cwd, left).localeCompare(toRepoPath(cwd, right)),
    ),
  };
}

function parseMarkdown(contents) {
  return fromMarkdown(contents, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

function walkMarkdown(node, visitor) {
  visitor(node);
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) walkMarkdown(child, visitor);
}

function markdownLinks(tree) {
  const links = [];
  walkMarkdown(tree, (node) => {
    if (!LINK_NODE_TYPES.has(node.type) || !node.url) return;
    links.push({
      column: node.position?.start.column ?? 1,
      line: node.position?.start.line ?? 1,
      target: node.url,
    });
  });
  return links.sort((left, right) => left.line - right.line || left.column - right.column);
}

function markdownPlainText(node) {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (IMAGE_NODE_TYPES.has(node.type)) return node.alt ?? "";
  if (!Array.isArray(node.children)) return "";
  return node.children.map((child) => markdownPlainText(child)).join("");
}

function markdownAnchors(tree) {
  const anchors = new Set();
  const slugger = new GithubSlugger();
  walkMarkdown(tree, (node) => {
    if (node.type === "heading") {
      anchors.add(slugger.slug(markdownPlainText(node)));
    } else if (node.type === "html") {
      for (const explicit of (node.value ?? "").matchAll(
        /<(?:a\s+(?:name|id)|[^>]+\sid)=["']([^"']+)["'][^>]*>/gi,
      )) {
        if (explicit[1]) anchors.add(explicit[1]);
      }
    }
  });
  return anchors;
}

function decodeUrlPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function classifyTarget(cwd, sourcePath, target) {
  if (/^\/\//.test(target)) {
    return { external: true };
  }

  let pathname = target;
  let fragment = "";
  let repositoryRooted = false;
  if (/^https?:\/\//i.test(target)) {
    let url;
    try {
      url = new URL(target);
    } catch {
      return { external: true };
    }
    if (url.hostname !== "github.com" || !url.pathname.startsWith(CANONICAL_GITHUB_PREFIX)) {
      return { external: true };
    }
    pathname = url.pathname.slice(CANONICAL_GITHUB_PREFIX.length);
    fragment = url.hash.slice(1);
    repositoryRooted = true;
  } else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) {
    return { external: true };
  } else {
    const hashIndex = pathname.indexOf("#");
    if (hashIndex >= 0) {
      fragment = pathname.slice(hashIndex + 1);
      pathname = pathname.slice(0, hashIndex);
    }
    const queryIndex = pathname.indexOf("?");
    if (queryIndex >= 0) {
      pathname = pathname.slice(0, queryIndex);
    }
  }

  pathname = decodeUrlPart(pathname);
  fragment = decodeUrlPart(fragment);
  const absolutePath = pathname
    ? path.resolve(
        repositoryRooted || pathname.startsWith("/") ? cwd : path.dirname(sourcePath),
        pathname.replace(/^\//, ""),
      )
    : sourcePath;
  return { absolutePath, external: false, fragment, pathname };
}

async function checkLinks({ contents, cwd, sourcePath, tree }) {
  const errors = [];
  let checked = 0;
  const realRoot = await realpath(cwd);
  for (const link of markdownLinks(tree)) {
    const target = classifyTarget(cwd, sourcePath, link.target);
    if (target.external) {
      continue;
    }
    checked += 1;
    const targetPath = target.absolutePath;
    const relativeTarget = toRepoPath(cwd, targetPath);
    if (relativeTarget === ".." || relativeTarget.startsWith("../")) {
      errors.push({
        column: link.column,
        kind: "link",
        line: link.line,
        message: `target is outside the repository: ${relativeTarget}`,
      });
      continue;
    }
    if (!(await exists(targetPath))) {
      errors.push({
        column: link.column,
        kind: "link",
        line: link.line,
        message: `target does not exist: ${relativeTarget}`,
      });
      continue;
    }
    const realTarget = await realpath(targetPath);
    const relativeRealTarget = path.relative(realRoot, realTarget);
    if (
      relativeRealTarget === ".." ||
      relativeRealTarget.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeRealTarget)
    ) {
      errors.push({
        column: link.column,
        kind: "link",
        line: link.line,
        message: `target resolves outside the repository: ${relativeTarget}`,
      });
      continue;
    }
    if (target.fragment && path.extname(targetPath).toLowerCase() === ".md") {
      const targetContents =
        targetPath === sourcePath ? contents : await readFile(targetPath, "utf8");
      if (!markdownAnchors(parseMarkdown(targetContents)).has(target.fragment)) {
        errors.push({
          column: link.column,
          kind: "anchor",
          line: link.line,
          message: `anchor does not exist: #${target.fragment} in ${relativeTarget}`,
        });
      }
    }
  }
  return { checked, errors };
}

function checkedSnippets(contents, tree) {
  const snippets = [];
  const errors = [];
  const lines = contents.split(/\r?\n/);
  walkMarkdown(tree, (node) => {
    if (
      node.type !== "code" ||
      !CHECKED_LANGUAGES.has(node.lang) ||
      node.meta?.trim() !== "check-docs" ||
      !node.position
    ) {
      return;
    }
    const openingLine = node.position.start.line;
    const openingOffset = node.position.start.offset ?? 0;
    const openingEnd = contents.indexOf("\n", openingOffset);
    const openingText = contents
      .slice(openingOffset, openingEnd < 0 ? contents.length : openingEnd)
      .replace(/^\uFEFF/, "")
      .replace(/\r$/, "");
    const opening = openingText.match(CHECKED_FENCE);
    const fence = opening?.groups?.fence;
    if (!fence) {
      errors.push({
        column: node.position.start.column,
        kind: "fence",
        line: openingLine,
        message: "could not locate the opt-in code fence",
      });
      return;
    }
    const closingText = (lines[node.position.end.line - 1] ?? "").replace(/\r$/, "");
    const closingPattern = new RegExp(`\\${fence[0]}{${String(fence.length)},}[ \\t]*$`);
    if (!closingPattern.test(closingText)) {
      errors.push({
        column: node.position.start.column,
        kind: "fence",
        line: openingLine,
        message: "opt-in code fence is not closed",
      });
    }
    snippets.push({
      code: node.value,
      language: node.lang === "typescript" ? "ts" : node.lang,
      startLine: openingLine + 1,
    });
  });
  return { errors, snippets };
}

function compilerOptions(cwd) {
  const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.base.json");
  let options = {};
  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!read.error) {
      options = ts.parseJsonConfigFileContent(read.config, ts.sys, cwd).options;
    }
  }
  return {
    ...options,
    allowJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: options.module ?? ts.ModuleKind.ESNext,
    moduleDetection: ts.ModuleDetectionKind.Force,
    moduleResolution: options.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: options.target ?? ts.ScriptTarget.ES2022,
  };
}

function workspaceResolutionBases(cwd) {
  return ts.sys
    .readDirectory(
      cwd,
      [".json"],
      ["node_modules", ".git", "dist"],
      ["packages/*/*/package.json", "apps/*/package.json"],
      5,
    )
    .map((packageJson) => path.dirname(packageJson));
}

function typecheckSnippet({ cwd, index, snippet, sourcePath }) {
  const extension = snippet.language === "tsx" ? "tsx" : "ts";
  const virtualPath = `${sourcePath}.check-docs-${index}.${extension}`;
  const options = compilerOptions(cwd);
  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => fileName === virtualPath || ts.sys.fileExists(fileName);
  host.readFile = (fileName) => {
    if (fileName === virtualPath) return snippet.code;
    return ts.sys.readFile(fileName);
  };
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === virtualPath) {
      return ts.createSourceFile(fileName, snippet.code, languageVersion, true);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const resolutionBases = workspaceResolutionBases(cwd);
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) => {
      const direct = ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule;
      if (direct) return direct;
      for (const base of resolutionBases) {
        const resolved = ts.resolveModuleName(
          moduleName,
          path.join(base, "__facet-docs__.tsx"),
          options,
          host,
        ).resolvedModule;
        if (resolved) return resolved;
      }
      return undefined;
    });

  const program = ts.createProgram([virtualPath], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !diagnostic.file || diagnostic.file.fileName === virtualPath)
    .map((diagnostic) => {
      let line = snippet.startLine;
      let column = 1;
      if (diagnostic.file && diagnostic.start !== undefined) {
        const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        line += position.line;
        column = position.character + 1;
      }
      return {
        column,
        kind: `typescript TS${diagnostic.code}`,
        line,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      };
    });
}

export async function checkDocs({ cwd = process.cwd(), files = [] } = {}) {
  const root = path.resolve(cwd);
  const collected = await collectMarkdownFiles(root, files);
  const errors = [...collected.errors];
  let links = 0;
  let snippets = 0;

  for (const sourcePath of collected.files) {
    const contents = await readFile(sourcePath, "utf8");
    const source = toRepoPath(root, sourcePath);
    const tree = parseMarkdown(contents);
    const linkResult = await checkLinks({ contents, cwd: root, sourcePath, tree });
    links += linkResult.checked;
    errors.push(...linkResult.errors.map((error) => ({ ...error, source })));

    const checked = checkedSnippets(contents, tree);
    errors.push(...checked.errors.map((error) => ({ ...error, source })));
    for (const [index, snippet] of checked.snippets.entries()) {
      snippets += 1;
      errors.push(
        ...typecheckSnippet({ cwd: root, index, snippet, sourcePath }).map((error) => ({
          ...error,
          source,
        })),
      );
    }
  }

  errors.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.line - right.line ||
      left.column - right.column,
  );
  return { errors, files: collected.files.length, links, snippets };
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

async function main() {
  const args = process.argv.slice(2);
  const files = args[0] === "--files" ? args.slice(1) : args;
  const result = await checkDocs({ files });
  const summary = `${plural(result.files, "Markdown file")}, ${plural(result.links, "checked link")}, ${plural(result.snippets, "checked snippet")}`;

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      process.stderr.write(
        `${error.source}:${error.line}:${error.column} [${error.kind}] ${error.message}\n`,
      );
    }
    process.stderr.write(`[docs] FAIL (${plural(result.errors.length, "error")}; ${summary})\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`[docs] PASS (${summary})\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await main();
}
