import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";

import { scanHardCut } from "./check-composition-hard-cut.mjs";

const ROOT_DIRECTORIES = ["packages", "apps", "docs", "scripts", ".changeset"];

async function makeFixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "facet-hard-cut-"));
  t.after(async () => rm(cwd, { force: true, recursive: true }));

  await Promise.all(
    ROOT_DIRECTORIES.map((root) => mkdir(path.join(cwd, root), { recursive: true })),
  );
  await writeFixture(cwd, "README.md", "# Fixture\n");
  await writeFixture(cwd, "AGENTS.md", "Fixture instructions.\n");
  return cwd;
}

async function writeFixture(cwd, relativePath, contents) {
  const absolutePath = path.join(cwd, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

function retiredSymbol() {
  return ["use", "Composition"].join("");
}

function retiredSamples() {
  const joined = (left, right, separator = "") => [left, right].join(separator);
  return [
    joined("use", "composition", "_"),
    joined("use", "Composition"),
    `${joined("Use", "Composition")}ToolInput`,
    `${joined("Use", "Composition")}Result`,
    joined("expand", "Composition"),
    joined("Expand", "Composition"),
    `${joined("Expand", "Composition")}Result`,
    `${joined("Expand", "Composition")}Options`,
    joined("Composition", "Params"),
    joined("Composition", "Ref"),
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
  ];
}

function allowedAnnotation() {
  return ["composition-hard-cut", "allowed-negative"].join(": ");
}

function slotMarker(name = "title") {
  return [`{{`, name, `}}`].join("");
}

function inlineRawUse(name = "card") {
  return [`{ `, ["u", "se"].join(""), `: "`, name, `" }`].join("");
}

function multilineRawUse(name = "card") {
  return ["{", `  ${["u", "se"].join("")}: "${name}"`, "}"].join("\n");
}

function legacyDataSamples() {
  const key = ["u", "se"].join("");
  const pluralSlot = ["slo", "ts"].join("");
  const componentsKey = ["compo", "nents"].join("");
  const fallbackKey = ["primitive", "Fallback"].join("");
  const retiredTypes = ["button", "form", "filterBar", "metric", "tabs", "nav", "stat"];
  return [
    slotMarker(),
    `"${pluralSlot}": {}`,
    `${pluralSlot}: {}`,
    `{ "${key}": "card" }`,
    inlineRawUse(),
    ["{", `  "${key}": "card"`, "}"].join("\n"),
    multilineRawUse(),
    `"${componentsKey}": []`,
    `${componentsKey}: []`,
    `"${fallbackKey}": "allowed"`,
    `${fallbackKey}: "allowed"`,
    ...retiredTypes.map((type) => `{ type: "${type}" }`),
  ];
}

function legacyMultilineDataSamples() {
  const componentTier = ["compo", "nent"].join("");
  const primitiveTier = ["primi", "tive"].join("");
  return [
    `"order": ["${componentTier}", "${primitiveTier}"]`,
    `order: ["${componentTier}", "${primitiveTier}"]`,
    [
      '"policy": {',
      '  "order": [',
      `    "${componentTier}",`,
      `    "${primitiveTier}"`,
      "  ]",
      "}",
    ].join("\n"),
  ];
}

function semanticSamples() {
  return [
    ["COMPOSITION", "COMPONENT", "PRIMITIVE"].join(" -> "),
    ["expanded", "server-side"].join(" "),
    ["server-side", "expansion"].join(" "),
    ["composition", "first"].join("-"),
    ["composition", "first"].join(" "),
    ["composition", "before", "patch"].join(" now comes "), // composition-hard-cut: allowed-negative
    ["prefer", "composition"].join(" the reference "), // composition-hard-cut: allowed-negative
    ["graft", "composition"].join(" this "), // composition-hard-cut: allowed-negative
    ["composition", "metadata", "prompt"].join(" data puts the "), // composition-hard-cut: allowed-negative
    ["primitive", "fallback"].join(" "), // composition-hard-cut: allowed-negative
    ["primitive", "base"].join(" "), // composition-hard-cut: allowed-negative
    ["intrinsic", "components"].join(" "), // composition-hard-cut: allowed-negative
    ["component", "primitive"].join(" -> "), // composition-hard-cut: allowed-negative
    ["component", "primitive"].join(" → "), // composition-hard-cut: allowed-negative
    ["component", "first"].join("-"), // composition-hard-cut: allowed-negative
    ["primitive", "component"].join("/"), // composition-hard-cut: allowed-negative
    ["component", "rich four-tab seed stage"].join("-"), // composition-hard-cut: allowed-negative
    ["component", "based seeded first paint"].join("-"), // composition-hard-cut: allowed-negative
    ["component", "based four-tab tour seed"].join("-"), // composition-hard-cut: allowed-negative
    ["`richtext`", "primitive", "brick"].join(" "), // composition-hard-cut: allowed-negative
  ];
}

test("reports a clean shipping fixture", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "packages/example/src/index.ts", "export const value = 1;\n");

  const result = scanHardCut({ cwd });

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
      "Unlike component-rich design systems, Facet authors closed native bricks.",
      "The Facet stage can run inside a component-based React application.",
      "This tour compares component-rich design systems with Facet native bricks.",
      "A component-based seedling catalog is an external example.",
      "External catalogs expose allowed components and component recipes.",
      "An external context primitive brick is not a Facet node claim.",
      "A mailbox primitive brick belongs to another system.",
      "A checklist primitive brick is generic external prose.",
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(result.violations, []);
});

test("does not treat the canonical composition reference selector as a retired symbol", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/index.ts",
    [
      "export function selectCompositionReferences() {}",
      "export type CompositionReferenceDataset = unknown;",
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(result.violations, []);
});

test(`detects retired ${["Composition", "Ref"].join("")}-prefixed aliases`, async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/index.ts",
    `export type ${["Composition", "Ref", "Legacy"].join("")} = unknown;\n`,
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations.map(({ path: violationPath, line }) => [violationPath, line]),
    [["packages/example/src/index.ts", 1]],
  );
});

test("waives same-line annotated negatives only in eligible test and fixture paths", async (t) => {
  const cwd = await makeFixture(t);
  const annotated = `const legacy = "${retiredSymbol()}"; // ${allowedAnnotation()}\n`;
  await writeFixture(cwd, "packages/example/src/legacy.test.ts", annotated);
  await writeFixture(cwd, "packages/example/src/legacy.spec.ts", annotated);
  await writeFixture(cwd, "packages/example/fixtures/legacy.ts", annotated);
  await writeFixture(cwd, "apps/example/__fixtures__/legacy.ts", annotated);
  await writeFixture(cwd, "apps/example/test-data/legacy.ts", annotated);

  const result = scanHardCut({ cwd });

  assert.deepEqual(result.violations, []);
  assert.equal(result.waived.length, 5);
});

test("does not waive annotations in production or on a different line", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/index.ts",
    `const legacy = "${retiredSymbol()}"; // ${allowedAnnotation()}\n`,
  );
  await writeFixture(
    cwd,
    "packages/example/src/legacy.test.ts",
    `const legacy = "${retiredSymbol()}";\n// ${allowedAnnotation()}\n`,
  );
  await writeFixture(cwd, "docs/legacy.test.md", `${retiredSymbol()} // ${allowedAnnotation()}\n`);

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations.map(({ path: violationPath, line }) => [violationPath, line]),
    [
      ["docs/legacy.test.md", 1],
      ["packages/example/src/index.ts", 1],
      ["packages/example/src/legacy.test.ts", 1],
    ],
  );
});

test("detects every locked pattern alternative with the specified casing", async (t) => {
  const cwd = await makeFixture(t);
  const retired = retiredSamples();
  const legacy = legacyDataSamples();
  const legacyMultiline = legacyMultilineDataSamples();
  const semantic = semanticSamples();
  await Promise.all(
    retired.map((sample, index) =>
      writeFixture(cwd, `packages/example/src/retired-${index}.ts`, `${sample}\n`),
    ),
  );
  await Promise.all(
    legacy.map((sample, index) =>
      writeFixture(cwd, `apps/example/src/legacy-${index}.ts`, `${sample}\n`),
    ),
  );
  await Promise.all(
    legacyMultiline.map((sample, index) =>
      writeFixture(cwd, `docs/legacy-multiline-${index}.md`, `${sample}\n`),
    ),
  );
  await Promise.all(
    semantic.map((sample, index) => writeFixture(cwd, `docs/semantic-${index}.md`, `${sample}\n`)),
  );

  const result = scanHardCut({ cwd });

  const count = (group) =>
    result.violations.filter((violation) => violation.group === group).length;
  assert.equal(count("retired_symbols"), retired.length);
  assert.equal(count("legacy_data"), legacy.length);
  assert.equal(count("legacy_multiline_data"), legacyMultiline.length);
  assert.equal(count("semantic_case_insensitive"), semantic.length);
});

test("detects inline and multiline slotless raw-use references", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "packages/example/src/inline.ts", `${inlineRawUse()}\n`);
  await writeFixture(cwd, "packages/example/src/multiline.ts", `${multilineRawUse()}\n`);

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations.map(({ path: violationPath, line }) => [violationPath, line]),
    [
      ["packages/example/src/inline.ts", 1],
      ["packages/example/src/multiline.ts", 2],
    ],
  );
});

test("scans only locked roots and excludes only locked generated directories", async (t) => {
  const cwd = await makeFixture(t);
  const legacy = `${retiredSymbol()}();\n`;
  await writeFixture(cwd, "specs/archive.md", legacy);
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
    scanned.violations.map(({ path: violationPath }) => violationPath),
    [".changeset/current.md", "AGENTS.md", "README.md", "scripts/legacy.mjs"],
  );
});

test("does not match the scanner's own pattern construction", async (t) => {
  const cwd = await makeFixture(t);
  const scannerSource = await readFile(
    new URL("./check-composition-hard-cut.mjs", import.meta.url),
    "utf8",
  );
  await writeFixture(cwd, "scripts/check-composition-hard-cut.mjs", scannerSource);

  const result = scanHardCut({ cwd });

  assert.deepEqual(result.violations, []);
});

test("escapes terminal control characters in CLI diagnostics", async (t) => {
  const cwd = await makeFixture(t);
  const escape = "\u001b";
  await writeFixture(
    cwd,
    "packages/example/src/legacy.ts",
    `const legacy = "${retiredSymbol()}"; // ${escape}]52;clipboard payload\u0007\n`,
  );

  const scanner = new URL("./check-composition-hard-cut.mjs", import.meta.url);
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

  const scanner = new URL("./check-composition-hard-cut.mjs", import.meta.url);
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
