#!/usr/bin/env node

/* global console, process */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_PACKAGES = Object.freeze({
  "@facet/core": "packages/core/core",
  "@facet/runtime": "packages/core/runtime",
  "@facet/assets": "packages/core/assets",
  "@facet/react": "packages/renderers/react",
  "@facet/agent-tools": "packages/agents/agent-tools",
  "@facet/agent": "packages/agents/agent",
  "@facet/reference-agent": "packages/agents/reference-agent",
  "@facet/server": "packages/adapters/server",
  "@facet/client": "packages/adapters/client",
  "@facet/agent-client": "packages/adapters/agent-client",
  "@facet/ag-ui": "packages/adapters/ag-ui",
  "@facet/store-postgres": "packages/adapters/store-postgres",
  "@facet/quickstart": "packages/tools/quickstart",
  "@facet/cli": "packages/tools/cli",
  "@facet/bridge": "packages/tools/bridge",
});

const EXPECTED_GROUPS = Object.freeze(["adapters", "agents", "core", "renderers", "tools"]);
const EXPECTED_GROUP_CHILDREN = Object.freeze({
  adapters: Object.freeze(["ag-ui", "agent-client", "client", "server", "store-postgres"]),
  agents: Object.freeze(["agent", "agent-tools", "reference-agent"]),
  core: Object.freeze(["assets", "core", "runtime"]),
  renderers: Object.freeze(["react"]),
  tools: Object.freeze(["bridge", "cli", "quickstart"]),
});
const EXPECTED_WORKSPACES = Object.freeze({
  facet: ".",
  "@facet/playground": "apps/playground",
  ...EXPECTED_PACKAGES,
});

const RETIRED_PATHS = Object.freeze([
  ["packages", "agent-stack"].join("/"),
  ["packages", "extensions"].join("/"),
  ["packages", "labs"].join("/"),
  ["packages", "core", "react"].join("/"),
  ["packages", "core", "server"].join("/"),
  ["packages", "core", "client"].join("/"),
]);
const CURRENT_REFERENCE_ROOTS = Object.freeze(["."]);
const EXCLUDED_REFERENCE_DIRECTORY_NAMES = Object.freeze([
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const EXCLUDED_REFERENCE_PATHS = Object.freeze([
  ".git",
  "apps/playground/.facet-sessions",
  "apps/playground/generated",
  "specs",
]);

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
  checkWorkspaceDiscovery();
  checkRetiredPathReferences();

  if (errors.length > 0) {
    for (const error of errors) console.error(`[package-layout] ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `[package-layout] PASS (${String(Object.keys(EXPECTED_PACKAGES).length)} public packages, ${String(Object.keys(EXPECTED_WORKSPACES).length)} workspaces, ${String(EXPECTED_GROUPS.length)} role groups)`,
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) main();
