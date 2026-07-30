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
  "@facet/quickstart": "packages/tools/quickstart",
});
const PACKAGE_DEPENDENCIES = Object.freeze({
  "@facet/core": [],
  "@facet/runtime": ["@facet/core"],
  "@facet/assets": ["@facet/core"],
  "@facet/react": ["@facet/core"],
  "@facet/agent-tools": ["@facet/core"],
  "@facet/agent": ["@facet/core"],
  "@facet/reference-agent": ["@facet/agent", "@facet/agent-tools", "@facet/core", "@facet/runtime"],
  "@facet/server": ["@facet/core", "@facet/runtime"],
  "@facet/client": ["@facet/core"],
  "@facet/agent-client": ["@facet/core"],
  "@facet/quickstart": [
    "@facet/agent",
    "@facet/assets",
    "@facet/core",
    "@facet/reference-agent",
    "@facet/runtime",
    "@facet/server",
  ],
});
const PACKAGE_EXPORTS = Object.freeze({
  "@facet/assets": [".", "./react"],
});

// Built by join so this file never spells a retired path literally: the checker
// scans its own repository, including this test.
const CUT_RETIRED_PATHS = Object.freeze([
  ["packages", "adapters", "ag-ui"].join("/"),
  ["packages", "adapters", "store-postgres"].join("/"),
  ["packages", "tools", "cli"].join("/"),
  ["packages", "tools", "bridge"].join("/"),
  ["apps", "playground"].join("/"),
  ["apps", "facet-lab"].join("/"),
]);

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function updateJson(path, update) {
  const value = readJson(path);
  update(value);
  writeJson(path, value);
}

function specifierForExport(packageName, exportKey) {
  return exportKey === "." ? packageName : `${packageName}${exportKey.slice(1)}`;
}

function writePackageSources(cwd, packageName) {
  const packagePath = PACKAGE_PATHS[packageName];
  const exports = PACKAGE_EXPORTS[packageName] ?? ["."];
  for (const exportKey of exports) {
    const relativeEntry = exportKey === "." ? "src/index.ts" : `src/${exportKey.slice(2)}.tsx`;
    mkdirSync(dirname(join(cwd, packagePath, relativeEntry)), { recursive: true });
    writeFileSync(join(cwd, packagePath, relativeEntry), "export {};\n");
  }
  if (packageName === "@facet/assets") {
    writeFileSync(join(cwd, packagePath, "src/react.tsx"), 'import "react";\nexport {};\n');
  } else if (packageName === "@facet/agent-tools") {
    writeFileSync(
      join(cwd, packagePath, "src/index.ts"),
      'import type { FacetToolSession } from "@facet/core";\nexport type { FacetToolSession } from "@facet/core";\n',
    );
  }
}

function writeBaseTsconfig(cwd) {
  const paths = {};
  for (const [packageName, packagePath] of Object.entries(PACKAGE_PATHS)) {
    for (const exportKey of PACKAGE_EXPORTS[packageName] ?? ["."]) {
      const specifier = specifierForExport(packageName, exportKey);
      const relativeEntry = exportKey === "." ? "src/index.ts" : `src/${exportKey.slice(2)}.tsx`;
      paths[specifier] = [join(packagePath, relativeEntry)];
    }
  }
  writeJson(join(cwd, "tsconfig.base.json"), { compilerOptions: { paths } });
}

function makeFixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "facet-package-layout-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  mkdirSync(join(cwd, "labs"), { recursive: true });
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  writeFileSync(join(cwd, ".gitignore"), ".agents/work/\n");
  writeFileSync(join(cwd, "scripts/check-package-layout.mjs"), SCRIPT_SOURCE);
  writeFileSync(join(cwd, "AGENTS.md"), "# Facet\n");
  symlinkSync("AGENTS.md", join(cwd, "CLAUDE.md"));

  for (const [name, path] of Object.entries(PACKAGE_PATHS)) {
    const exportKeys = PACKAGE_EXPORTS[name] ?? ["."];
    const exports = Object.fromEntries(
      exportKeys.map((key) => [key, key === "." ? "./src/index.ts" : `./src/${key.slice(2)}.tsx`]),
    );
    writeJson(join(cwd, path, "package.json"), {
      name,
      repository: { directory: path },
      dependencies: Object.fromEntries(
        PACKAGE_DEPENDENCIES[name].map((dependency) => [dependency, "workspace:*"]),
      ),
      exports,
      publishConfig: { exports },
    });
    writePackageSources(cwd, name);
  }
  writeBaseTsconfig(cwd);

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
    ...Object.entries(PACKAGE_PATHS).map(([name, path]) => ({ name, path: join(cwd, path) })),
  ];
}

function runCheck({ cwd, fakeBin }, extraWorkspaces = []) {
  return spawnSync(process.execPath, ["scripts/check-package-layout.mjs"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      FACET_TEST_WORKSPACES: JSON.stringify([...workspaceRows(cwd), ...extraWorkspaces]),
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

test("reports the eleven-package, twelve-workspace, five-group topology", (t) => {
  const fixture = makeFixture(t);
  const result = runCheck(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /11 public packages, 12 workspaces, 5 role groups/);
});

test("rejects tsconfig alias drift, both extra and missing aliases", (t) => {
  const fixture = makeFixture(t);
  const tsconfigPath = join(fixture.cwd, "tsconfig.base.json");
  updateJson(tsconfigPath, (tsconfig) => {
    delete tsconfig.compilerOptions.paths["@facet/assets/react"];
    tsconfig.compilerOptions.paths["@facet/extra"] = ["packages/core/core/src/index.ts"];
  });

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /tsconfig path aliases differ/);
  assert.match(result.stderr, /@facet\/assets\/react/);
  assert.match(result.stderr, /@facet\/extra/);
});

test("rejects export-map drift between source exports and publishConfig", (t) => {
  const fixture = makeFixture(t);
  updateJson(join(fixture.cwd, "packages/core/assets/package.json"), (manifest) => {
    delete manifest.publishConfig.exports["./react"];
  });

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /publishConfig exports differ for @facet\/assets/);
  assert.match(result.stderr, /@facet\/assets\/react/);
});

test("rejects a re-added assets dependency edge on runtime", (t) => {
  const fixture = makeFixture(t);
  updateJson(join(fixture.cwd, "packages/core/runtime/package.json"), (manifest) => {
    manifest.dependencies["@facet/assets"] = "workspace:*";
  });

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /dependency graph differs for @facet\/runtime/);
  assert.match(result.stderr, /@facet\/assets/);
});

test("rejects agent-tools depending on agent", (t) => {
  const fixture = makeFixture(t);
  updateJson(join(fixture.cwd, "packages/agents/agent-tools/package.json"), (manifest) => {
    manifest.dependencies["@facet/agent"] = "workspace:*";
  });

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /dependency graph differs for @facet\/agent-tools/);
  assert.match(result.stderr, /@facet\/agent/);
});

test("rejects react reachable from the assets root entry", (t) => {
  const fixture = makeFixture(t);
  writeFileSync(
    join(fixture.cwd, "packages/core/assets/src/index.ts"),
    'export { DEFAULT_REGISTRY } from "./react.js";\n',
  );

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /@facet\/assets root entry reaches react/);
});

test("normalizes external import subpaths before graph policy checks", (t) => {
  const fixture = makeFixture(t);
  writeFileSync(
    join(fixture.cwd, "packages/core/assets/src/index.ts"),
    'import "react/jsx-runtime";\nimport "react-dom/client";\n',
  );

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /@facet\/assets root entry reaches react imports: react, react-dom/);
});

test("rejects unexpected packages reachable from the assets react entry", (t) => {
  const fixture = makeFixture(t);
  writeFileSync(
    join(fixture.cwd, "packages/core/assets/src/react.tsx"),
    'import "react";\nimport "react-dom/client";\nexport {};\n',
  );

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /@facet\/assets\/react imports unexpected packages: react-dom(?:\n|$)/,
  );
});

test("rejects agent-tools source importing agent without a manifest edge", (t) => {
  const fixture = makeFixture(t);
  writeFileSync(
    join(fixture.cwd, "packages/agents/agent-tools/src/index.ts"),
    'import type { Stage } from "@facet/agent";\nexport type { FacetToolSession } from "@facet/core";\nexport type { Stage };\n',
  );

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /@facet\/agent-tools imports unexpected workspace packages/);
  assert.match(result.stderr, /@facet\/agent/);
});

test("rejects a node builtin import in a browser-facing root graph", (t) => {
  const fixture = makeFixture(t);
  writeFileSync(join(fixture.cwd, "packages/renderers/react/src/index.ts"), 'import "node:fs";\n');

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /node builtin import reachable from @facet\/react/);
});

test("rejects an induced workspace dependency cycle", (t) => {
  const fixture = makeFixture(t);
  updateJson(join(fixture.cwd, "packages/core/core/package.json"), (manifest) => {
    manifest.dependencies["@facet/quickstart"] = "workspace:*";
  });

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /workspace dependency cycle/);
});

test("rejects an application workspace rejoining the twelve-workspace map", (t) => {
  const fixture = makeFixture(t);
  const appPath = ["apps", "demo"].join("/");
  writeJson(join(fixture.cwd, appPath, "package.json"), { name: "@facet/demo", private: true });

  const result = runCheck(fixture, [{ name: "@facet/demo", path: join(fixture.cwd, appPath) }]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /workspace map differs/);
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

test("rejects retired child paths but excludes ephemeral planning output", (t) => {
  const fixture = makeFixture(t);
  const retiredGroup = ["packages", "extensions"].join("/");
  const retiredChild = [retiredGroup, "agent"].join("/");
  mkdirSync(join(fixture.cwd, "docs"));
  writeFileSync(join(fixture.cwd, "docs/current.md"), retiredChild);

  let result = runCheck(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(retiredGroup));

  rmSync(join(fixture.cwd, "docs/current.md"));
  const ephemeralPath = join(fixture.cwd, ".agents/work/example/dev-spec.md");
  mkdirSync(dirname(ephemeralPath), { recursive: true });
  writeFileSync(ephemeralPath, retiredChild);

  result = runCheck(fixture);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects every directory retired by the markup hard cut", (t) => {
  const fixture = makeFixture(t);
  mkdirSync(join(fixture.cwd, "docs"));

  for (const retiredPath of CUT_RETIRED_PATHS) {
    writeFileSync(join(fixture.cwd, "docs/current.md"), `see ${retiredPath} for details\n`);

    const result = runCheck(fixture);

    assert.equal(result.status, 1, `${retiredPath} was not rejected`);
    assert.match(
      result.stderr,
      new RegExp(`current files reference retired package paths:[\\s\\S]*${retiredPath}`),
    );
  }

  rmSync(join(fixture.cwd, "docs/current.md"));
  const result = runCheck(fixture);
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

test("rejects a missing CLAUDE.md agent guidance alias", (t) => {
  const fixture = makeFixture(t);
  rmSync(join(fixture.cwd, "CLAUDE.md"));

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing agent guidance alias: CLAUDE\.md/);
});

test("rejects a de-symlinked CLAUDE.md copied as a regular file", (t) => {
  const fixture = makeFixture(t);
  rmSync(join(fixture.cwd, "CLAUDE.md"));
  writeFileSync(join(fixture.cwd, "CLAUDE.md"), "# Facet\n");

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CLAUDE\.md must be a symlink to AGENTS\.md/);
});

test("rejects a CLAUDE.md symlink that points somewhere other than AGENTS.md", (t) => {
  const fixture = makeFixture(t);
  rmSync(join(fixture.cwd, "CLAUDE.md"));
  writeFileSync(join(fixture.cwd, "GUIDE.md"), "# Facet\n");
  symlinkSync("GUIDE.md", join(fixture.cwd, "CLAUDE.md"));

  const result = runCheck(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CLAUDE\.md must point at AGENTS\.md; found GUIDE\.md/);
});

test("allows path-segment lookalikes that only share a retired prefix", (t) => {
  const fixture = makeFixture(t);
  const lookalikes = [
    [["packages", "agent-stack-v2"].join("/"), "agent"].join("/"),
    [["packages", "extensions2"].join("/"), "agent"].join("/"),
    [["packages", "core", "client-backup"].join("/"), "src"].join("/"),
    [["packages", "tools", "cli-notes"].join("/"), "src"].join("/"),
    [["packages", "adapters", "ag-uix"].join("/"), "src"].join("/"),
    [["apps", "playground2"].join("/"), "src"].join("/"),
  ];
  mkdirSync(join(fixture.cwd, "docs"));
  writeFileSync(join(fixture.cwd, "docs/current.md"), lookalikes.join("\n"));

  const result = runCheck(fixture);

  assert.equal(result.status, 0, result.stderr);
});
