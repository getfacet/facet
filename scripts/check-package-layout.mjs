#!/usr/bin/env node

/* global console, process */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_DEPENDENCIES,
  EXPECTED_GROUP_CHILDREN,
  EXPECTED_GROUPS,
  EXPECTED_PACKAGES,
  EXPECTED_WORKSPACES,
  NODE_FREE_ROOT_ENTRY_PACKAGES,
  PUBLIC_PACKAGE_COUNT,
  WORKSPACE_COUNT,
} from "./package-topology.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS_ROOT_ENTRY = "packages/core/assets/src/index.ts";
const ASSETS_REACT_ENTRY = "packages/core/assets/src/react.tsx";
const ASSETS_REACT_ALLOWED_IMPORTS = Object.freeze(["@facet/core", "react"]);
const AGENT_TOOLS_ALLOWED_IMPORTS = Object.freeze(["@facet/core"]);

const AGENT_GUIDANCE_FILE = "AGENTS.md";
const AGENT_GUIDANCE_ALIAS = "CLAUDE.md";

// Every entry is assembled by join so this file never spells a retired path
// literally: the checker scans its own repository, including this script.
const RETIRED_PATHS = Object.freeze([
  ["packages", "agent-stack"].join("/"),
  ["packages", "extensions"].join("/"),
  ["packages", "labs"].join("/"),
  ["packages", "core", "react"].join("/"),
  ["packages", "core", "server"].join("/"),
  ["packages", "core", "client"].join("/"),
  ["packages", "adapters", "ag-ui"].join("/"),
  ["packages", "adapters", "store-postgres"].join("/"),
  ["packages", "tools", "cli"].join("/"),
  ["packages", "tools", "bridge"].join("/"),
  ["apps", "playground"].join("/"),
  ["apps", "facet-lab"].join("/"),
]);
const RETIRED_REPOSITORY_PATHS = Object.freeze(["docs/comparisons", "docs/specs", "specs"]);
const AGENT_WORK_IGNORE = ".agents/work/";
const CURRENT_REFERENCE_ROOTS = Object.freeze(["."]);
const EXCLUDED_REFERENCE_DIRECTORY_NAMES = Object.freeze([
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const EXCLUDED_REFERENCE_PATHS = Object.freeze([".git", ".agents/work"]);

const errors = [];

function record(condition, message) {
  if (!condition) errors.push(message);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function normalizeRepoPath(value) {
  return value.replaceAll("\\", "/");
}

function repoPath(absolutePath) {
  const value = normalizeRepoPath(relative(repoRoot, absolutePath));
  return value === "" ? "." : value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function checkPhysicalLayout() {
  const packageRoot = join(repoRoot, "packages");
  const groups = sorted(
    readdirSync(packageRoot, { withFileTypes: true }).map((entry) => entry.name),
  );
  record(
    JSON.stringify(groups) === JSON.stringify(EXPECTED_GROUPS),
    `package groups differ: expected ${EXPECTED_GROUPS.join(", ")}; found ${groups.join(", ")}`,
  );

  const discovered = new Map();
  for (const group of EXPECTED_GROUPS) {
    const groupRoot = join(packageRoot, group);
    record(existsSync(groupRoot), `missing package group: packages/${group}`);
    if (!existsSync(groupRoot)) continue;
    const groupStat = lstatSync(groupRoot);
    record(groupStat.isDirectory(), `package group is not a directory: packages/${group}`);
    record(!groupStat.isSymbolicLink(), `package group is a symlink: packages/${group}`);
    if (!groupStat.isDirectory() && !groupStat.isSymbolicLink()) continue;

    const entries = readdirSync(groupRoot, { withFileTypes: true });
    const childNames = sorted(entries.map((entry) => entry.name));
    const expectedChildNames = sorted(EXPECTED_GROUP_CHILDREN[group]);
    record(
      JSON.stringify(childNames) === JSON.stringify(expectedChildNames),
      `package entries differ in packages/${group}: expected ${expectedChildNames.join(", ")}; found ${childNames.join(", ")}`,
    );

    for (const entry of entries) {
      const directory = join(groupRoot, entry.name);
      const manifestPath = join(directory, "package.json");
      record(
        !lstatSync(directory).isSymbolicLink(),
        `package path is a symlink: ${repoPath(directory)}`,
      );
      if (!existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath);
      record(typeof manifest.name === "string", `package has no name: ${repoPath(manifestPath)}`);
      if (typeof manifest.name !== "string") continue;
      record(!discovered.has(manifest.name), `duplicate package name: ${manifest.name}`);
      discovered.set(manifest.name, repoPath(directory));
      record(
        manifest.repository?.directory === repoPath(directory),
        `${manifest.name} repository.directory is ${String(manifest.repository?.directory)}; expected ${repoPath(directory)}`,
      );
    }
  }

  const actual = Object.fromEntries(
    sorted(discovered.keys()).map((name) => [name, discovered.get(name)]),
  );
  const expected = Object.fromEntries(
    sorted(Object.keys(EXPECTED_PACKAGES)).map((name) => [name, EXPECTED_PACKAGES[name]]),
  );
  record(
    JSON.stringify(actual) === JSON.stringify(expected),
    `public package map differs: expected ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`,
  );

  const labsPath = join(repoRoot, "labs");
  record(existsSync(labsPath), "missing root labs/");
  if (existsSync(labsPath)) {
    const labsStat = lstatSync(labsPath);
    record(labsStat.isDirectory(), "labs/ must be a directory");
    record(!labsStat.isSymbolicLink(), "labs/ must not be a symlink");
    record(!existsSync(join(labsPath, "package.json")), "labs/ must remain unpublished");
  }
}

function checkGuidanceAlias() {
  const aliasPath = join(repoRoot, AGENT_GUIDANCE_ALIAS);
  let aliasStat;
  try {
    aliasStat = lstatSync(aliasPath);
  } catch {
    record(false, `missing agent guidance alias: ${AGENT_GUIDANCE_ALIAS}`);
    return;
  }
  record(
    aliasStat.isSymbolicLink(),
    `${AGENT_GUIDANCE_ALIAS} must be a symlink to ${AGENT_GUIDANCE_FILE}`,
  );
  if (!aliasStat.isSymbolicLink()) return;
  const target = normalizeRepoPath(readlinkSync(aliasPath));
  record(
    target === AGENT_GUIDANCE_FILE,
    `${AGENT_GUIDANCE_ALIAS} must point at ${AGENT_GUIDANCE_FILE}; found ${target}`,
  );
}

function checkRepositoryPolicy() {
  for (const path of RETIRED_REPOSITORY_PATHS) {
    record(!existsSync(join(repoRoot, path)), `retired repository path exists: ${path}`);
  }

  const gitignorePath = join(repoRoot, ".gitignore");
  const ignored = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf8")
        .split(/\r?\n/u)
        .map((line) => line.trim())
    : [];
  record(ignored.includes(AGENT_WORK_IGNORE), `.gitignore must contain ${AGENT_WORK_IGNORE}`);
}

function checkWorkspaceDiscovery() {
  const result = spawnSync("pnpm", ["list", "-r", "--depth", "-1", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  record(
    result.status === 0,
    `pnpm workspace discovery failed: ${String(result.stderr ?? "").trim()}`,
  );
  if (result.status !== 0) return;

  const rows = JSON.parse(result.stdout);
  const discovered = new Map();
  for (const row of rows) {
    if (typeof row.name !== "string" || typeof row.path !== "string") continue;
    const path = repoPath(realpathSync(row.path));
    const existing = discovered.get(row.name);
    record(existing === undefined, `workspace discovered more than once: ${row.name}`);
    if (existing === undefined) discovered.set(row.name, path);
  }

  const actual = Object.fromEntries(
    sorted(discovered.keys()).map((name) => [name, discovered.get(name)]),
  );
  const expected = Object.fromEntries(
    sorted(Object.keys(EXPECTED_WORKSPACES)).map((name) => [name, EXPECTED_WORKSPACES[name]]),
  );
  record(
    JSON.stringify(actual) === JSON.stringify(expected),
    `workspace map differs: expected ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`,
  );
}

function packageDirectory(packageName) {
  return join(repoRoot, EXPECTED_PACKAGES[packageName]);
}

function packageManifest(packageName) {
  return readJson(join(packageDirectory(packageName), "package.json"));
}

function workspaceDependencies(manifest) {
  const dependencies = manifest.dependencies;
  if (dependencies === undefined || dependencies === null || typeof dependencies !== "object") {
    return [];
  }
  return sorted(Object.keys(dependencies).filter((name) => EXPECTED_PACKAGES[name] !== undefined));
}

function exportEntries(exportsField) {
  if (exportsField === undefined) return [];
  if (
    typeof exportsField === "string" ||
    Array.isArray(exportsField) ||
    "import" in exportsField ||
    "types" in exportsField ||
    "require" in exportsField
  ) {
    return [[".", exportsField]];
  }
  if (exportsField === null || typeof exportsField !== "object") return [];
  return Object.entries(exportsField);
}

function exportSpecifiers(packageName, exportsField) {
  return sorted(
    exportEntries(exportsField).map(([subpath]) =>
      subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`,
    ),
  );
}

function checkDependencyGraph() {
  const graph = {};
  for (const packageName of sorted(Object.keys(EXPECTED_PACKAGES))) {
    const manifest = packageManifest(packageName);
    const actual = workspaceDependencies(manifest);
    graph[packageName] = actual;
    const expected = EXPECTED_DEPENDENCIES[packageName] ?? [];
    record(
      JSON.stringify(actual) === JSON.stringify(expected),
      `dependency graph differs for ${packageName}: expected ${expected.join(", ") || "(none)"}; found ${actual.join(", ") || "(none)"}`,
    );
  }
  checkWorkspaceDependencyCycles(graph);
}

function checkTsconfigAliases() {
  const tsconfig = readJson(join(repoRoot, "tsconfig.base.json"));
  const actual = sorted(Object.keys(tsconfig.compilerOptions?.paths ?? {}));
  const expected = sorted(
    Object.keys(EXPECTED_PACKAGES).flatMap((packageName) =>
      exportSpecifiers(packageName, packageManifest(packageName).exports),
    ),
  );
  record(
    JSON.stringify(actual) === JSON.stringify(expected),
    `tsconfig path aliases differ: expected ${expected.join(", ")}; found ${actual.join(", ")}`,
  );
}

function checkPublishConfigExports() {
  for (const packageName of sorted(Object.keys(EXPECTED_PACKAGES))) {
    const manifest = packageManifest(packageName);
    const expected = exportSpecifiers(packageName, manifest.exports);
    const actual = exportSpecifiers(packageName, manifest.publishConfig?.exports);
    record(
      JSON.stringify(actual) === JSON.stringify(expected),
      `publishConfig exports differ for ${packageName}: expected ${expected.join(", ")}; found ${actual.join(", ")}`,
    );
  }
}

function parseImportSpecifiers(source) {
  const specifiers = [];
  const importPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/gu;
  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const specifier = match[1] ?? match[2];
    if (typeof specifier === "string") specifiers.push(specifier);
  }
  return specifiers;
}

function localCandidates(basePath) {
  const extension = extname(basePath);
  if (extension === ".js") return [`${basePath.slice(0, -3)}.ts`, `${basePath.slice(0, -3)}.tsx`];
  if (extension === ".jsx") return [`${basePath.slice(0, -4)}.tsx`, `${basePath.slice(0, -4)}.ts`];
  if (extension === ".mjs") return [`${basePath.slice(0, -4)}.mts`, `${basePath.slice(0, -4)}.ts`];
  if (extension === ".cjs") return [`${basePath.slice(0, -4)}.cts`, `${basePath.slice(0, -4)}.ts`];
  if (extension !== "") return [basePath];
  return [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    join(basePath, "index.ts"),
    join(basePath, "index.tsx"),
  ];
}

function resolveLocalImport(fromFile, specifier) {
  const basePath = resolve(dirname(fromFile), specifier);
  return localCandidates(basePath).find((candidate) => existsSync(candidate));
}

function externalImportName(specifier) {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0] ?? specifier;
}

function collectEntryGraph(entryPath) {
  const entry = join(repoRoot, entryPath);
  const pending = [entry];
  const visited = new Set();
  const externalImports = new Set();
  const nodeImports = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    if (!existsSync(current)) {
      record(false, `entry graph file missing: ${repoPath(current)}`);
      continue;
    }
    const source = readFileSync(current, "utf8");
    for (const specifier of parseImportSpecifiers(source)) {
      if (specifier.startsWith("node:")) {
        nodeImports.push(`${repoPath(current)} imports ${specifier}`);
        continue;
      }
      if (specifier.startsWith(".")) {
        const resolved = resolveLocalImport(current, specifier);
        if (resolved === undefined) {
          record(false, `unresolved local import from ${repoPath(current)}: ${specifier}`);
        } else {
          pending.push(resolved);
        }
        continue;
      }
      externalImports.add(externalImportName(specifier));
    }
  }

  return {
    externalImports: sorted(externalImports),
    files: sorted([...visited].map((file) => repoPath(file))),
    nodeImports: sorted(nodeImports),
  };
}

function checkEntryImportGraphs() {
  const assetsRoot = collectEntryGraph(ASSETS_ROOT_ENTRY);
  const assetsRootReactImports = assetsRoot.externalImports.filter(
    (specifier) => specifier === "react" || specifier === "react-dom",
  );
  record(
    assetsRootReactImports.length === 0,
    `@facet/assets root entry reaches react imports: ${assetsRootReactImports.join(", ")}`,
  );

  const assetsReact = collectEntryGraph(ASSETS_REACT_ENTRY);
  const unexpectedAssetsReactImports = assetsReact.externalImports.filter(
    (specifier) => !ASSETS_REACT_ALLOWED_IMPORTS.includes(specifier),
  );
  record(
    assetsReact.nodeImports.length === 0,
    `node builtin import reachable from @facet/assets/react: ${assetsReact.nodeImports.join("; ")}`,
  );
  record(
    unexpectedAssetsReactImports.length === 0,
    `@facet/assets/react imports unexpected packages: ${unexpectedAssetsReactImports.join(", ")}`,
  );

  for (const packageName of NODE_FREE_ROOT_ENTRY_PACKAGES) {
    const entryPath = join(EXPECTED_PACKAGES[packageName], "src/index.ts");
    const graph = collectEntryGraph(entryPath);
    record(
      graph.nodeImports.length === 0,
      `node builtin import reachable from ${packageName}: ${graph.nodeImports.join("; ")}`,
    );
  }

  const agentTools = collectEntryGraph("packages/agents/agent-tools/src/index.ts");
  const agentToolWorkspaceImports = agentTools.externalImports.filter(
    (specifier) => EXPECTED_PACKAGES[specifier] !== undefined,
  );
  record(
    JSON.stringify(agentToolWorkspaceImports) === JSON.stringify(AGENT_TOOLS_ALLOWED_IMPORTS),
    `@facet/agent-tools imports unexpected workspace packages: ${agentToolWorkspaceImports.join(", ") || "(none)"}`,
  );
}

function checkWorkspaceDependencyCycles(graph) {
  const visiting = [];
  const visited = new Set();

  function visit(packageName) {
    const activeIndex = visiting.indexOf(packageName);
    if (activeIndex !== -1) return [...visiting.slice(activeIndex), packageName];
    if (visited.has(packageName)) return undefined;

    visiting.push(packageName);
    for (const dependency of graph[packageName] ?? []) {
      const cycle = visit(dependency);
      if (cycle !== undefined) return cycle;
    }
    visiting.pop();
    visited.add(packageName);
    return undefined;
  }

  for (const packageName of sorted(Object.keys(graph))) {
    const cycle = visit(packageName);
    if (cycle !== undefined) {
      record(false, `workspace dependency cycle: ${cycle.join(" -> ")}`);
      return;
    }
  }
}

function isExcludedReferencePath(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    EXCLUDED_REFERENCE_DIRECTORY_NAMES.includes(name) ||
    EXCLUDED_REFERENCE_PATHS.some(
      (excludedPath) => path === excludedPath || path.startsWith(`${excludedPath}/`),
    )
  );
}

function currentReferenceFiles() {
  const files = [];

  function visit(absolutePath) {
    const path = repoPath(absolutePath);
    if (isExcludedReferencePath(path)) return;
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return;
    if (!stat.isDirectory()) {
      files.push(path);
      return;
    }
    for (const entry of readdirSync(absolutePath)) visit(join(absolutePath, entry));
  }

  for (const root of CURRENT_REFERENCE_ROOTS) {
    const absoluteRoot = join(repoRoot, root);
    if (existsSync(absoluteRoot)) visit(absoluteRoot);
  }
  return sorted(files);
}

function referencesRetiredPath(text, retiredPath) {
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(retiredPath, offset);
    if (index === -1) return false;
    const next = text[index + retiredPath.length];
    if (next === undefined || !/[A-Za-z0-9._-]/u.test(next)) return true;
    offset = index + retiredPath.length;
  }
  return false;
}

function checkRetiredPathReferences() {
  const matches = [];
  for (const path of currentReferenceFiles()) {
    const absolutePath = join(repoRoot, path);
    const contents = readFileSync(absolutePath);
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    for (const retiredPath of RETIRED_PATHS) {
      if (referencesRetiredPath(text, retiredPath)) matches.push(`${path}: ${retiredPath}`);
    }
  }
  record(
    matches.length === 0,
    `current files reference retired package paths:\n${matches.join("\n")}`,
  );
}

function main() {
  checkPhysicalLayout();
  checkGuidanceAlias();
  checkRepositoryPolicy();
  checkWorkspaceDiscovery();
  checkDependencyGraph();
  checkTsconfigAliases();
  checkPublishConfigExports();
  checkEntryImportGraphs();
  checkRetiredPathReferences();

  if (errors.length > 0) {
    for (const error of errors) console.error(`[package-layout] ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `[package-layout] PASS (${String(PUBLIC_PACKAGE_COUNT)} public packages, ${String(WORKSPACE_COUNT)} workspaces, ${String(EXPECTED_GROUPS.length)} role groups)`,
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) main();
