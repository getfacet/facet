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
const APP_PATHS = Object.freeze({
  "@facet/playground": "apps/playground",
  "@facet/lab": "apps/facet-lab",
});

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "facet-package-layout-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  mkdirSync(join(cwd, "labs"), { recursive: true });
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  writeFileSync(join(cwd, ".gitignore"), ".agents/work/\n");
  writeFileSync(join(cwd, "scripts/check-package-layout.mjs"), SCRIPT_SOURCE);

  for (const [name, path] of Object.entries(PACKAGE_PATHS)) {
    writeJson(join(cwd, path, "package.json"), {
      name,
      repository: { directory: path },
    });
  }
  for (const [name, path] of Object.entries(APP_PATHS)) {
    writeJson(join(cwd, path, "package.json"), { name, private: true });
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
    ...Object.entries(APP_PATHS).map(([name, path]) => ({ name, path: join(cwd, path) })),
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

test("accepts Facet Lab only as a private dependency leaf", (t) => {
  const fixture = makeFixture(t);
  let result = runCheck(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /15 public packages, 18 workspaces/);

  writeJson(join(fixture.cwd, "apps/facet-lab/package.json"), {
    name: "@facet/lab",
    private: false,
  });
  result = runCheck(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /@facet\/lab must be private/);

  writeJson(join(fixture.cwd, "apps/facet-lab/package.json"), {
    name: "@facet/lab",
    private: true,
  });
  writeJson(join(fixture.cwd, "packages/renderers/react/package.json"), {
    name: "@facet/react",
    repository: { directory: "packages/renderers/react" },
    dependencies: { "@facet/lab": "workspace:*" },
  });
  result = runCheck(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /@facet\/react dependencies depend on private app @facet\/lab/);

  writeJson(join(fixture.cwd, "packages/renderers/react/package.json"), {
    name: "@facet/react",
    repository: { directory: "packages/renderers/react" },
  });
  writeFileSync(join(fixture.cwd, "packages/renderers/react/leak.ts"), 'import "@facet/lab";\n');
  result = runCheck(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /public package source imports private app/);
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

test("rejects retired child paths but excludes generated and ephemeral output", (t) => {
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
    ".agents/work/example/dev-spec.md",
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

test("rejects retired documentation and committed planning roots", (t) => {
  const fixture = makeFixture(t);
  mkdirSync(join(fixture.cwd, "docs/comparisons"), { recursive: true });
  mkdirSync(join(fixture.cwd, "docs/specs"), { recursive: true });
  mkdirSync(join(fixture.cwd, "specs"), { recursive: true });

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /retired repository path exists: docs\/comparisons/);
  assert.match(result.stderr, /retired repository path exists: docs\/specs/);
  assert.match(result.stderr, /retired repository path exists: specs/);
});

test("requires the ephemeral agent work directory to stay ignored", (t) => {
  const fixture = makeFixture(t);
  writeFileSync(join(fixture.cwd, ".gitignore"), "node_modules/\n");

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.gitignore must contain \.agents\/work\//);
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
