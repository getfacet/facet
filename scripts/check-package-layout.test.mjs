import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

import { normalizeRepoPath } from "./check-package-layout.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("./check-package-layout.mjs", import.meta.url));
const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, "utf8");
const PACKAGE_PATHS = Object.freeze({
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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "facet-package-layout-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  mkdirSync(join(cwd, "apps/playground"), { recursive: true });
  mkdirSync(join(cwd, "labs"), { recursive: true });
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  writeFileSync(join(cwd, "scripts/check-package-layout.mjs"), SCRIPT_SOURCE);

  for (const [name, path] of Object.entries(PACKAGE_PATHS)) {
    writeJson(join(cwd, path, "package.json"), {
      name,
      repository: { directory: path },
    });
  }

  const fakeBin = join(cwd, "test-bin");
  mkdirSync(fakeBin);
  const fakePnpm = join(fakeBin, "pnpm");
  writeFileSync(
    fakePnpm,
    `#!/usr/bin/env node\nprocess.stdout.write(process.env.FACET_TEST_WORKSPACES ?? "[]");\n`,
  );
  chmodSync(fakePnpm, 0o755);

  return { cwd, fakeBin };
}

function workspaceRows(cwd) {
  return [
    { name: "facet", path: cwd },
    { name: "@facet/playground", path: join(cwd, "apps/playground") },
    ...Object.entries(PACKAGE_PATHS).map(([name, path]) => ({ name, path: join(cwd, path) })),
  ];
}

function runCheck({ cwd, fakeBin }) {
  return spawnSync(process.execPath, ["scripts/check-package-layout.mjs"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      FACET_TEST_WORKSPACES: JSON.stringify(workspaceRows(cwd)),
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    },
  });
}

test("normalizes platform-specific repository separators", () => {
  assert.equal(normalizeRepoPath("packages\\core\\core"), "packages/core/core");
});

test("accepts the exact five-group package layout", (t) => {
  const fixture = makeFixture(t);
  const result = runCheck(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[package-layout\] PASS/);
});

test("rejects an extra manifestless compatibility directory", (t) => {
  const fixture = makeFixture(t);
  mkdirSync(join(fixture.cwd, "packages/tools/compat"));

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /package entries differ in packages\/tools/);
});

test("rejects a role group implemented as a symlink", (t) => {
  const fixture = makeFixture(t);
  renameSync(join(fixture.cwd, "packages/agents"), join(fixture.cwd, "agents-target"));
  symlinkSync("../agents-target", join(fixture.cwd, "packages/agents"));

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /package group is a symlink: packages\/agents/);
});

test("scans untracked CI files and rejects bare retired group roots", (t) => {
  const fixture = makeFixture(t);
  const retiredRoot = ["packages", "agent-stack"].join("/");
  mkdirSync(join(fixture.cwd, ".github/workflows"), { recursive: true });
  writeFileSync(join(fixture.cwd, ".github/workflows/ci.yml"), retiredRoot);

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    new RegExp(`current files reference retired package paths:[\\s\\S]*${retiredRoot}`),
  );
});

test("rejects retired child paths but excludes generated runtime output", (t) => {
  const fixture = makeFixture(t);
  const retiredGroup = ["packages", "extensions"].join("/");
  const retiredChild = [retiredGroup, "agent"].join("/");
  mkdirSync(join(fixture.cwd, "docs"));
  writeFileSync(join(fixture.cwd, "docs/current.md"), retiredChild);

  let result = runCheck(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(retiredGroup));

  rmSync(join(fixture.cwd, "docs/current.md"));
  const runtimePaths = [
    "apps/playground/.facet-sessions/session.txt",
    "apps/playground/generated/page.txt",
  ];
  for (const path of runtimePaths) {
    const absolutePath = join(fixture.cwd, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, retiredChild);
  }

  result = runCheck(fixture);
  assert.equal(result.status, 0, result.stderr);
});

test("allows path-segment lookalikes that only share a retired prefix", (t) => {
  const fixture = makeFixture(t);
  const lookalikes = [
    [["packages", "agent-stack-v2"].join("/"), "agent"].join("/"),
    [["packages", "extensions2"].join("/"), "agent"].join("/"),
    [["packages", "core", "client-backup"].join("/"), "src"].join("/"),
  ];
  mkdirSync(join(fixture.cwd, "docs"));
  writeFileSync(join(fixture.cwd, "docs/current.md"), lookalikes.join("\n"));

  const result = runCheck(fixture);

  assert.equal(result.status, 0, result.stderr);
});
