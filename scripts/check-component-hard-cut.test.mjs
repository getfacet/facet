import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";

import { scanHardCut } from "./check-component-hard-cut.mjs";

const ROOT_DIRECTORIES = ["packages", "apps", "labs", "docs", "scripts", ".changeset"];

async function makeFixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "facet-hard-cut-"));
  t.after(async () => rm(cwd, { force: true, recursive: true }));

  await Promise.all(
    ROOT_DIRECTORIES.map((root) => mkdir(path.join(cwd, root), { recursive: true })),
  );
  await writeFixture(cwd, "README.md", "# Fixture\n");
  await writeFixture(cwd, "AGENTS.md", "Fixture instructions.\n");
  await writeFixture(
    cwd,
    "labs/markup-model/DIRECTION.md",
    "> **Superseded** by markup-component-greenfield-hard-cut.\n",
  );
  return cwd;
}

async function writeFixture(cwd, relativePath, contents) {
  const absolutePath = path.join(cwd, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

function allowedAnnotation() {
  return ["component-hard-cut", "allowed-negative"].join(": ");
}

function hardCutResidueSamples() {
  const joined = (...parts) => parts.join("");
  return [
    joined("Br", "ick"),
    joined("Br", "icks"),
    joined("Pat", "tern"),
    joined("Pat", "terns"),
    joined("Pre", "set"),
    joined("Pre", "sets"),
    ["STAGE", "SPEC"].join("_"),
    joined("Facet", "Tree"),
    joined("Assets", "Store"),
    joined("File", "Assets"),
    joined("Memory", "Assets"),
    joined("load", "Assets"),
    `kind: "${["sa", "y"].join("")}"`,
    `"kind": "${["re", "set"].join("")}"`,
    joined("View", "Snapshot"),
    `${["lo", "cal"].join("")}:`,
    joined("Over", "lay"),
  ];
}

function retiredToolNameSamples() {
  const joined = (left, right, separator = "") => [left, right].join(separator);
  return [
    `${["sa", "y"].join("")}()`,
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
}

function deletedPackageSamples() {
  const joined = (...parts) => parts.join("");
  return [
    ["@facet", joined("ag", "-", "ui")].join("/"),
    ["@facet", joined("store", "-", "postgres")].join("/"),
    ["@facet", joined("cli")].join("/"),
    ["@facet", joined("bridge")].join("/"),
    ["packages", "adapters", joined("ag", "-", "ui")].join("/"),
    ["packages", "adapters", joined("store", "-", "postgres")].join("/"),
    ["packages", "tools", joined("cli")].join("/"),
    ["packages", "tools", joined("bridge")].join("/"),
  ];
}

function deletedAppPathSamples() {
  const joined = (...parts) => parts.join("");
  return [
    ["apps", joined("play", "ground")].join("/"),
    ["apps", joined("facet", "-", "lab")].join("/"),
  ];
}

test("reports a clean shipping fixture", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "packages/example/src/index.ts", "export const value = 1;\n");

  const result = scanHardCut({ cwd });

  assert.deepEqual(result.violations, []);
});

test("allows the component catalog vocabulary that is current in the new model", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/catalog.ts",
    [
      'export const button = { variant: "primary", tone: "accent", scheme: "light" };',
      "export const DEFAULT_CATALOG = {};",
      "export const DEFAULT_REGISTRY = {};",
      "export type FacetCatalog = unknown;",
      "export type CatalogComponent = unknown;",
      "export type CatalogUsageOrder = unknown;",
      "export type ComponentNode = unknown;",
      "export type ComponentDocument = unknown;",
      "export const data = { components: [] };",
      "export const catalogRegistryTerminology = 'catalog and registry tag sets match';",
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(result.violations, []);
});

test("allows generic external component prose that makes no Facet tier claim", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "docs/comparison.md",
    [
      "This comparison targets component-based React libraries and component-rich design systems.",
      "Facet can run inside component-based React applications.",
      "Unlike component-rich design systems, Facet authors closed registered elements.",
      "The Facet stage can run inside a component-based React application.",
      "This tour compares component-rich design systems with Facet native elements.",
      "A component-based seedling catalog is an external example.",
      "An external context primitive element is not a Facet node claim.",
      "A mailbox primitive element belongs to another system.",
      "A checklist primitive element is generic external prose.",
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(result.violations, []);
});

test("waives same-line annotated negatives only in eligible test and fixture paths", async (t) => {
  const cwd = await makeFixture(t);
  const annotated = `const legacy = "${hardCutResidueSamples()[0]}"; // ${allowedAnnotation()}\n`;
  await writeFixture(cwd, "packages/example/src/legacy.test.ts", annotated);
  await writeFixture(cwd, "packages/example/src/legacy.spec.ts", annotated);
  await writeFixture(cwd, "packages/example/fixtures/legacy.ts", annotated);
  await writeFixture(cwd, "packages/example/__fixtures__/legacy.ts", annotated);
  await writeFixture(cwd, "packages/example/test-data/legacy.ts", annotated);

  const result = scanHardCut({ cwd });

  assert.deepEqual(result.violations, []);
  assert.equal(result.waived.length, 5);
});

test("does not waive annotations in production or on a different line", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/index.ts",
    `const legacy = "${hardCutResidueSamples()[0]}"; // ${allowedAnnotation()}\n`,
  );
  await writeFixture(
    cwd,
    "packages/example/src/legacy.test.ts",
    `const legacy = "${hardCutResidueSamples()[0]}";\n// ${allowedAnnotation()}\n`,
  );
  await writeFixture(
    cwd,
    "packages/example/src/legacy-alias.test.ts",
    `const legacy = "${hardCutResidueSamples()[0]}"; // ${["composition-hard-cut", "allowed-negative"].join(": ")}\n`,
  );
  await writeFixture(
    cwd,
    "docs/legacy.test.md",
    `${hardCutResidueSamples()[0]} // ${allowedAnnotation()}\n`,
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations
      .filter((entry) => entry.group !== "docs_scope_residue")
      .map(({ path: violationPath, line }) => [violationPath, line]),
    [
      ["docs/legacy.test.md", 1],
      ["packages/example/src/index.ts", 1],
      ["packages/example/src/legacy-alias.test.ts", 1],
      ["packages/example/src/legacy.test.ts", 1],
    ],
  );
});

test("detects every locked pattern alternative with the specified casing", async (t) => {
  const cwd = await makeFixture(t);
  const hardCut = hardCutResidueSamples();
  const retiredToolNames = retiredToolNameSamples();
  const deletedPackages = deletedPackageSamples();
  const deletedApps = deletedAppPathSamples();
  await Promise.all(
    hardCut.map((sample, index) =>
      writeFixture(cwd, `packages/example/src/hard-cut-${index}.txt`, `${sample}\n`),
    ),
  );
  await Promise.all(
    retiredToolNames.map((sample, index) =>
      writeFixture(cwd, `packages/example/src/tool-${index}.txt`, `${sample}\n`),
    ),
  );
  await Promise.all(
    deletedPackages.map((sample, index) =>
      writeFixture(cwd, `packages/example/src/deleted-package-${index}.txt`, `${sample}\n`),
    ),
  );
  await Promise.all(
    deletedApps.map((sample, index) =>
      writeFixture(cwd, `packages/example/src/deleted-app-${index}.txt`, `${sample}\n`),
    ),
  );

  const result = scanHardCut({ cwd });

  const count = (group) =>
    result.violations.filter((violation) => violation.group === group).length;
  assert.equal(count("retired_hard_cut_symbols"), hardCut.length);
  assert.equal(count("retired_tool_names"), retiredToolNames.length);
  assert.equal(count("deleted_package_names"), deletedPackages.length);
  assert.equal(count("deleted_app_paths"), deletedApps.length);
});

test("allows only the qualified UI Pattern term while retaining the generic ban", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/ui-pattern-language.ts",
    'export const description = "UI Pattern and UI Patterns";\n',
  );
  await writeFixture(
    cwd,
    "packages/example/example/README.md",
    "UI Pattern guidance may contain several UI Patterns.\n",
  );

  assert.deepEqual(scanHardCut({ cwd }).violations, []);
});

test("flags retired residue in documentation scope and token-count-limit language", async (t) => {
  const cwd = await makeFixture(t);
  const deletedApp = ["apps", "playground"].join("/");
  await writeFixture(
    cwd,
    "docs/old-quickstart.md",
    [
      "The deleted package @facet/bridge is still named here.", // component-hard-cut: allowed-negative
      `The retired evidence path ${deletedApp} is still named here.`,
      "The old Lab evidence check used check-lab-gates.",
      "This text still describes a token-count limit.",
      "",
    ].join("\n"),
  );
  await writeFixture(
    cwd,
    "packages/example/example/README.md",
    "This README still mentions Overlay and pnpm --filter @facet/lab.\n", // component-hard-cut: allowed-negative
  );
  await writeFixture(
    cwd,
    "packages/example/src/source.ts",
    "const docsOnly = 'pnpm demo and token-count limit stay ignored outside docs scope';\n",
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations
      .filter((entry) => entry.group === "docs_scope_residue")
      .map(({ path: violationPath, line }) => [violationPath, line]),
    [
      ["docs/old-quickstart.md", 1],
      ["docs/old-quickstart.md", 2],
      ["docs/old-quickstart.md", 3],
      ["packages/example/example/README.md", 1],
    ],
  );
  assert.deepEqual(
    result.violations
      .filter((entry) => entry.group === "token_count_language")
      .map(({ path: violationPath, line }) => [violationPath, line]),
    [["docs/old-quickstart.md", 4]],
  );
  assert.equal(
    result.violations.some((entry) => entry.path === "packages/example/src/source.ts"),
    false,
  );
});

test("flags retired operational residue in root docs and agent process surfaces", async (t) => {
  const cwd = await makeFixture(t);
  const validateTree = ["validate", "Tree"].join("");
  const nativeBrick = ["native", ["Br", "ick"].join("")].join(" ");
  const styleVocabulary = ["style", "vocabulary"].join(" ");

  await writeFixture(
    cwd,
    "CHANGELOG.md",
    [
      `The first release still advertises ${validateTree}, ${nativeBrick}, ${styleVocabulary}, the facet CLI, a Postgres adapter, and a local bridge.`,
      "",
    ].join("\n"),
  );
  await writeFixture(
    cwd,
    "SECURITY.md",
    ["The trust model still tells the local bridge to authenticate the agent channel.", ""].join(
      "\n",
    ),
  );
  await writeFixture(
    cwd,
    ".agents/skills/update-tests/SKILL.md",
    [
      "React tests still mention browser-local navigate/toggle resolution plus tap recording.",
      "",
    ].join("\n"),
  );
  await writeFixture(
    cwd,
    ".claude/agents/review-bugs.md",
    [`Review still asks for ${validateTree} gaps.`, ""].join("\n"),
  );
  await writeFixture(
    cwd,
    ".codex/agents/review-test-gaps.toml",
    ["Review still treats media.src safety as a current test surface.", ""].join("\n"),
  );
  await writeFixture(
    cwd,
    ".agents/work/ignored/dev-spec.md",
    [
      `Ignored planning state can retain ${validateTree} history without failing the shipping scan.`,
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations
      .filter((entry) => entry.group === "retired_operational_contracts")
      .map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [
      ["retired_operational_contracts", ".agents/skills/update-tests/SKILL.md", 1],
      ["retired_operational_contracts", ".claude/agents/review-bugs.md", 1],
      ["retired_operational_contracts", ".codex/agents/review-test-gaps.toml", 1],
      ["retired_operational_contracts", "CHANGELOG.md", 1],
      ["retired_operational_contracts", "SECURITY.md", 1],
    ],
  );
  assert.equal(
    result.violations.some((entry) => entry.path.startsWith(".agents/work/")),
    false,
  );
});

test("reports each hard-cut group at most once per source line", async (t) => {
  const cwd = await makeFixture(t);
  const validateTree = ["validate", "Tree"].join("");
  const nativeBrick = ["native", ["Br", "ick"].join("")].join(" ");
  const styleVocabulary = ["style", "vocabulary"].join(" ");
  await writeFixture(
    cwd,
    "CHANGELOG.md",
    `One line contains ${validateTree}, ${nativeBrick}, ${styleVocabulary}, the facet CLI, a Postgres adapter, and a local bridge.\n`,
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations
      .filter((entry) => entry.group === "retired_operational_contracts")
      .map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_operational_contracts", "CHANGELOG.md", 1]],
  );
});

test("allows current lookalikes in scanned root and process surfaces", async (t) => {
  const cwd = await makeFixture(t);
  const agentToken = ["FACET", "AGENT", "TOKEN"].join("_");

  await writeFixture(
    cwd,
    "SECURITY.md",
    [
      `External agents may load ${agentToken} and send it as x-facet-token to the reference server.`,
      "",
    ].join("\n"),
  );
  await writeFixture(
    cwd,
    ".agents/skills/spec-bridge/SKILL.md",
    [
      "The spec-bridge workflow may describe generic pattern choices without naming retired contracts.",
      "Use budgetPreset for the planning budget when the approved template asks for it.",
      "",
    ].join("\n"),
  );
  await writeFixture(
    cwd,
    ".claude/agents/review-edge.md",
    [
      "Renderer-internal OverlayRoot behavior remains a legitimate current implementation detail.",
      "",
    ].join("\n"),
  );

  assert.deepEqual(scanHardCut({ cwd }).violations, []);
});

test("requires the superseded header on the old direction record", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "labs/markup-model/DIRECTION.md", "# Current direction\n");

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["direction_superseded_header", "labs/markup-model/DIRECTION.md", 1]],
  );
});

test("allows only the locked superseded concept names under the Direction header", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "labs/markup-model/DIRECTION.md",
    [
      "> **Superseded** by markup-component-greenfield-hard-cut.",
      "",
      "## Superseded decisions",
      "",
      "- `Overlay` as a general authored overlap primitive", // component-hard-cut: allowed-negative
      "- `local:` browser action routing", // component-hard-cut: allowed-negative
      "- markup-template components as an authoring surface",
      "- catalog-in-AssetsStore as the catalog source of truth", // component-hard-cut: allowed-negative
      "- Lab-first evidence as the public hard gate",
      "",
      "## Still invalid",
      "",
      "- Deleted package @facet/bridge remains invalid here.", // component-hard-cut: allowed-negative
      "- Old get_pattern tool text remains invalid here.", // component-hard-cut: allowed-negative
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations
      .map(({ group, path: violationPath, line }) => [group, violationPath, line])
      .sort(),
    [
      ["deleted_package_names", "labs/markup-model/DIRECTION.md", 13],
      ["retired_tool_names", "labs/markup-model/DIRECTION.md", 14],
    ].sort(),
  );
});

test("scans only locked roots and excludes only locked generated directories", async (t) => {
  const cwd = await makeFixture(t);
  const legacy = `const legacy = "${hardCutResidueSamples()[0]}";\n`;
  await writeFixture(cwd, ".agents/work/example/dev-spec.md", legacy);
  await writeFixture(cwd, "notes/outside.md", legacy);
  await writeFixture(cwd, "packages/example/node_modules/pkg/index.js", legacy);
  await writeFixture(cwd, "packages/example/dist/index.js", legacy);
  await writeFixture(cwd, "packages/example/coverage/index.js", legacy);
  await writeFixture(cwd, "packages/example/.turbo/index.js", legacy);

  const clean = scanHardCut({ cwd });
  assert.deepEqual(clean.violations, []);

  await writeFixture(cwd, ".changeset/current.md", legacy);
  await writeFixture(cwd, "scripts/legacy.mjs", legacy);
  await writeFixture(cwd, "README.md", legacy);
  await writeFixture(cwd, "AGENTS.md", legacy);
  const scanned = scanHardCut({ cwd });
  assert.deepEqual(
    [...new Set(scanned.violations.map(({ path: violationPath }) => violationPath))],
    [".changeset/current.md", "AGENTS.md", "README.md", "scripts/legacy.mjs"],
  );
});

test("keeps root labs inside the production hard-cut scan", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "labs/experiment.ts",
    `const legacy = "${hardCutResidueSamples()[0]}";\n`,
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ path: violationPath }) => violationPath),
    ["labs/experiment.ts"],
  );
});

test("does not scan deleted apps and keeps ripgrep/portable roots aligned", async (t) => {
  const cwd = await makeFixture(t);
  const legacy = `const legacy = "${hardCutResidueSamples()[0]}";\n`;
  const deletedApp = ["apps", "playground"].join("/");
  await writeFixture(cwd, `${deletedApp}/.facet-sessions/visitor/session.ts`, legacy);
  await writeFixture(cwd, `${deletedApp}/generated/visitor/page.ts`, legacy);
  await writeFixture(cwd, `${deletedApp}/.facet-sessions-backup/legacy.ts`, legacy);
  await writeFixture(cwd, `${deletedApp}/generated-source/legacy.ts`, legacy);
  await writeFixture(cwd, `${deletedApp}/src/legacy.ts`, legacy);

  const ripgrepResult = scanHardCut({ cwd, mode: "production" });
  const scanner = new URL("./check-component-hard-cut.mjs", import.meta.url);
  const portableResult = spawnSync(process.execPath, [scanner.pathname, "--production"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: cwd,
    },
  });

  assert.deepEqual(ripgrepResult.violations, []);
  assert.equal(portableResult.status, 0);
  assert.equal(portableResult.stderr, "");
});

test("continues scanning untracked source ignored by git", async (t) => {
  const cwd = await makeFixture(t);
  const initialized = spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  await writeFixture(cwd, ".gitignore", "packages/example/local-source/\n");
  await writeFixture(
    cwd,
    "packages/example/local-source/legacy.ts",
    `const legacy = "${hardCutResidueSamples()[0]}";\n`,
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ path: violationPath }) => violationPath),
    ["packages/example/local-source/legacy.ts"],
  );
});

test("does not expose excluded playground session contents in CLI diagnostics", async (t) => {
  const cwd = await makeFixture(t);
  const sessionSecret = "session-secret-that-must-not-reach-diagnostics";
  const deletedApp = ["apps", "playground"].join("/");
  await writeFixture(
    cwd,
    `${deletedApp}/.facet-sessions/visitor/session.ts`,
    `const legacy = "${hardCutResidueSamples()[0]} ${sessionSecret}";\n`,
  );

  const scanner = new URL("./check-component-hard-cut.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [scanner.pathname], {
    cwd,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes(sessionSecret), false);
});

test("falls back to portable search when default rg is unavailable", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "packages/example/src/legacy.ts", `${hardCutResidueSamples()[0]}\n`);
  await writeFixture(
    cwd,
    "packages/example/node_modules/pkg/ignored.ts",
    `${hardCutResidueSamples()[0]}\n`,
  );

  const scanner = new URL("./check-component-hard-cut.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [scanner.pathname, "--production"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: cwd,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /packages\/example\/src\/legacy\.ts:1:/);
  assert.equal(result.stderr.includes("node_modules"), false);
});

test("production mode excludes current docs while all mode includes them", async (t) => {
  const cwd = await makeFixture(t);
  const legacy = `${hardCutResidueSamples()[0]}\n`;
  await writeFixture(cwd, "packages/example/src/index.ts", "export const clean = true;\n");
  await writeFixture(cwd, "packages/example/README.md", legacy);
  await writeFixture(cwd, "docs/current.md", legacy);
  await writeFixture(cwd, ".changeset/current.md", legacy);
  await writeFixture(cwd, "README.md", legacy);
  await writeFixture(cwd, "AGENTS.md", legacy);

  assert.deepEqual(scanHardCut({ cwd, mode: "production" }).violations, []);
  assert.deepEqual(
    [
      ...new Set(
        scanHardCut({ cwd, mode: "all" }).violations.map(
          ({ path: violationPath }) => violationPath,
        ),
      ),
    ],
    [
      ".changeset/current.md",
      "AGENTS.md",
      "docs/current.md",
      "packages/example/README.md",
      "README.md",
    ],
  );
});

test("does not match the scanner's own pattern construction", async (t) => {
  const cwd = await makeFixture(t);
  const scannerSource = await readFile(
    new URL("./check-component-hard-cut.mjs", import.meta.url),
    "utf8",
  );
  await writeFixture(cwd, "scripts/check-component-hard-cut.mjs", scannerSource);

  const result = scanHardCut({ cwd });

  assert.deepEqual(result.violations, []);
});

test("escapes terminal control characters in CLI diagnostics", async (t) => {
  const cwd = await makeFixture(t);
  const escape = "\u001b";
  await writeFixture(
    cwd,
    "packages/example/src/legacy.ts",
    `const legacy = "${hardCutResidueSamples()[0]}"; // ${escape}]52;clipboard payload\u0007\n`,
  );

  const scanner = new URL("./check-component-hard-cut.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [scanner.pathname], {
    cwd,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes(escape), false);
  assert.equal(result.stderr.includes("\u0007"), false);
  assert.match(result.stderr, /\\u001b\]52;clipboard payload\\u0007/);
});

test("escapes terminal control characters in CLI search errors", async (t) => {
  const cwd = await makeFixture(t);
  const fakeSearch = path.join(cwd, "rg");
  await writeFile(
    fakeSearch,
    "#!/bin/sh\nprintf '\\033]52;search error\\007' >&2\nexit 2\n",
    "utf8",
  );
  await chmod(fakeSearch, 0o755);

  const scanner = new URL("./check-component-hard-cut.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [scanner.pathname], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${cwd}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr.includes("\u001b"), false);
  assert.equal(result.stderr.includes("\u0007"), false);
  assert.match(result.stderr, /\\u001b\]52;search error\\u0007/);
});

test("fails closed for search exit errors and an unexecutable search", async (t) => {
  const cwd = await makeFixture(t);
  const failingSearch = path.join(cwd, "fake-rg");
  await writeFile(failingSearch, "#!/bin/sh\nexit 2\n", "utf8");
  await chmod(failingSearch, 0o755);

  assert.throws(() => scanHardCut({ cwd, rgPath: failingSearch }), /exit 2/i);

  assert.throws(
    () => scanHardCut({ cwd, rgPath: "facet-rg-command-that-does-not-exist" }),
    /hard-cut search failed/i,
  );
});
