import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";

import { scanHardCut } from "./check-style-hard-cut.mjs";

const ROOT_DIRECTORIES = ["packages", "apps", "labs", "docs", "scripts", ".changeset"];

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
  return ["style-hard-cut", "allowed-negative"].join(": ");
}

function retiredStyleSamples() {
  const joined = (...parts) => parts.join("");
  return [
    joined("Facet", "Catalog"),
    joined("DEFAULT", "_CATALOG"),
    joined("DEFAULT", "_COMPOSITIONS"),
    joined("Facet", "Composition"),
    joined("validate", "Composition"),
    joined("select", "Composition", "References"),
    joined("get", "_composition"),
    joined("set", "_theme"),
    joined("Brick", "Recipe"),
    joined("Recipe", "PartName"),
    joined("resolve", "Recipe"),
    joined("resolve", "RecipePart"),
    joined("active", "Style"),
    joined("active", "Variant"),
  ];
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
    ["composition", "before", "patch"].join(" now comes "), // style-hard-cut: allowed-negative
    ["prefer", "composition"].join(" the reference "), // style-hard-cut: allowed-negative
    ["graft", "composition"].join(" this "), // style-hard-cut: allowed-negative
    ["composition", "metadata", "prompt"].join(" data puts the "), // style-hard-cut: allowed-negative
    ["primitive", "fallback"].join(" "), // style-hard-cut: allowed-negative
    ["primitive", "base"].join(" "), // style-hard-cut: allowed-negative
    ["intrinsic", "components"].join(" "), // style-hard-cut: allowed-negative
    ["component", "primitive"].join(" -> "), // style-hard-cut: allowed-negative
    ["component", "primitive"].join(" → "), // style-hard-cut: allowed-negative
    ["component", "first"].join("-"), // style-hard-cut: allowed-negative
    ["primitive", "component"].join("/"), // style-hard-cut: allowed-negative
    ["component", "rich four-tab seed stage"].join("-"), // style-hard-cut: allowed-negative
    ["component", "based seeded first paint"].join("-"), // style-hard-cut: allowed-negative
    ["component", "based four-tab tour seed"].join("-"), // style-hard-cut: allowed-negative
    ["`richtext`", "primitive", "brick"].join(" "), // style-hard-cut: allowed-negative
  ];
}

test("detects the retired style asset public contract and authored keys", async (t) => {
  const cwd = await makeFixture(t);
  const symbols = retiredStyleSamples();
  await Promise.all(
    symbols.map((sample, index) =>
      writeFixture(cwd, `packages/example/src/style-symbol-${index}.ts`, `${sample}\n`),
    ),
  );
  await writeFixture(
    cwd,
    "apps/example/src/legacy-style.ts",
    [
      'const a = { variant: "primary", activeStyle: {}, activeVariant: "selected" };', // style-hard-cut: allowed-negative
      'const b = { style: { bg: "surface", pad: "md", size: "lg", weight: "bold" } };', // style-hard-cut: allowed-negative
      'const c = { direction: "col", scheme: "dark" };', // style-hard-cut: allowed-negative
      'const d = { style: { justify: "between" } };', // style-hard-cut: allowed-negative
      "const e = { style: { border: true } };", // style-hard-cut: allowed-negative
      'const f = { style: { tracking: "wide" } };', // style-hard-cut: allowed-negative
      'const g = { style: { ratio: "square" } };', // style-hard-cut: allowed-negative
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.ok(result.violations.length >= symbols.length + 2);
  assert.ok(result.violations.some((entry) => entry.group === "retired_style_symbols"));
  assert.ok(result.violations.some((entry) => entry.group === "retired_authored_style"));
  for (const key of ["justify", "border", "tracking", "ratio"]) {
    assert.ok(
      result.violations.some((entry) => entry.text.includes(`${key}:`)),
      key,
    );
  }
});

test("does not scan past a closed same-line style object", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/current-style.ts",
    'const current = { style: { padding: "md" } }; const avatar = { size: 32 };\n',
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(result.violations, []);
});

test("finds retired style keys after deep targets and ignores lexical lookalikes", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/deep-style.ts",
    [
      "const rootRetired = {",
      "  style: {",
      "    target: {",
      '      state: { background: "accent" },',
      "    },",
      '    bg: "surface",',
      "  },",
      "};",
      "const nestedRetired = {",
      '  "style": {',
      '    "target": {',
      '      "state": {',
      '        "bg": "surface",',
      "      },",
      "    },",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await writeFixture(
    cwd,
    "packages/example/src/current-style.ts",
    [
      "const current = {",
      "  style: {",
      "    target: {",
      "      state: {",
      '        background: "accent", // bg: "surface"',
      '        content: "bg: surface",',
      "      },",
      "    },",
      "  },",
      "};",
      "const prose = 'style: { target: { state: { bg: \"surface\" } } }';",
      'const template = `style: { target: { state: { bg: "surface" } } }`;',
      '// style: { target: { state: { bg: "surface" } } }',
      '/* style: { target: { state: { bg: "surface" } } } */',
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [
      ["retired_authored_style", "packages/example/src/deep-style.ts", 6],
      ["retired_authored_style", "packages/example/src/deep-style.ts", 13],
    ],
  );
});

test("allows nested target size but rejects direct style size", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/size-style.ts",
    [
      "const loading = {",
      "  style: {",
      '    indicator: { size: "sm" },',
      "  },",
      "};",
      "const legacy = {",
      "  style: {",
      '    size: "lg",',
      "  },",
      "};",
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/src/size-style.ts", 8]],
  );
});

test("scans JavaScript template expressions while ignoring raw template text", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/template-style.ts",
    [
      'const raw = `style: { bg: \\"surface\\" }`;',
      "const rendered = `${JSON.stringify({",
      "  style: {",
      '    bg: "surface",',
      "  },",
      "})}`;",
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/src/template-style.ts", 4]],
  );
});

test("does not mistake postfix division for a regex literal", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/postfix-division.ts",
    "export let value = 2; export const ratio = value++ / 2;\n",
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(result.violations, []);
});

test("ignores regex bodies after control-flow parentheses", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/regex-style.ts",
    'if (enabled) /style: { bg: "surface" }/.test(input);\n',
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(result.violations, []);
});

test("finds a real style object after a brace-heavy regex in a template expression", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/template-regex-style.ts",
    [
      "const rendered = `${(() => {",
      '  if (true) /}}/.test("}}");',
      '  return { style: { bg: "surface" } };',
      "})()}`;",
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/src/template-regex-style.ts", 3]],
  );
});

test("scans fenced object syntax in non-JavaScript files", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "docs/legacy-style.md",
    ["```json", '{"style":{"target":{"state":{"bg":"surface"}}}}', "```", ""].join("\n"),
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "docs/legacy-style.md", 2]],
  );
});

test("distinguishes quoted property names from neighboring string values", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/string-style.ts",
    [
      'const current = { style: { labels: ["bg", ":"] } };',
      'const retired = { style: { "bg": "surface" } };',
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/src/string-style.ts", 2]],
  );
});

test("decodes escaped static property names without treating string values as properties", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/escaped-string-style.ts",
    [
      'const current = { style: { labels: ["\\u0062g", ":"] } };',
      'const retired = { style: { "\\u0062g": "surface" } };',
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/src/escaped-string-style.ts", 2]],
  );
});

test("keeps scanning retired properties in TypeScript style type literals", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/style-contract.ts",
    [
      "interface LegacyNode {",
      "  style: {",
      "    size?: string;",
      "    target?: { bg?: string; size?: string };",
      "  };",
      "}",
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [
      ["retired_authored_style", "packages/example/src/style-contract.ts", 3],
      ["retired_authored_style", "packages/example/src/style-contract.ts", 4],
    ],
  );
});

test("unwraps bounded expression and type wrappers around style roots", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/wrapped-style.ts",
    [
      'const parenthesized = { style: ({ bg: "surface" }) };',
      'const asserted = { style: ({ pad: "md" } as const) };',
      'const satisfied = { style: ({ radius: "md" } satisfies Record<string, unknown>) };',
      'const nonNull = { style: ({ weight: "bold" }!) };',
      'const typed = { style: (<Record<string, unknown>>{ fg: "default" }) };',
      "interface WrappedNode {",
      "  style: Readonly<({ size?: string; target?: { size?: string; bg?: string } }) | ({ ratio?: string } & { pad?: string })>;",
      "}",
      "interface CurrentNode {",
      "  style: Readonly<{ target?: { size?: string } }>;",
      "}",
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [1, 2, 3, 4, 5, 7].map((line) => [
      "retired_authored_style",
      "packages/example/src/wrapped-style.ts",
      line,
    ]),
  );
});

test("keeps inline spread objects at the owning style depth", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/spread-style.ts",
    [
      'const direct = { style: { ...(({ size: "lg" }) as const) } };',
      'const nested = { style: { target: { ...(({ size: "sm" }) satisfies object) } } };',
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/src/spread-style.ts", 1]],
  );
});

test("normalizes a parenthesized computed literal property name", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/computed-style.ts",
    'const legacy = { style: { [("fg")]: "default" } };\n',
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/src/computed-style.ts", 1]],
  );
});

test("fails closed when a computed property exceeds the transparent wrapper bound", async (t) => {
  const cwd = await makeFixture(t);
  let propertyName = '"fg"';
  for (let depth = 0; depth < 17; depth += 1) propertyName = `(${propertyName})`;
  await writeFixture(
    cwd,
    "packages/example/src/deep-computed-style.ts",
    `const legacy = { style: { [${propertyName}]: "default" } };\n`,
  );

  assert.throws(() => scanHardCut({ cwd, mode: "production" }), /wrapper limit/i);
});

test("decodes bounded escapes only when quoted non-JavaScript strings are property names", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/fixtures/current.json",
    '{"style":{"labels":["\\u0062g", ":"]}}\n',
  );
  await writeFixture(
    cwd,
    "packages/example/fixtures/retired.json",
    '{"st\\u0079le":{"\\u0062g":"surface"}}\n',
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/fixtures/retired.json", 1]],
  );
});

test("uses only a bounded local scan for repeated malformed braced Unicode escapes", async (t) => {
  const cwd = await makeFixture(t);
  const scannerSource = await readFile(
    new URL("./check-style-hard-cut.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(scannerSource, /source\.indexOf\("}", index \+ 2\)/);

  await writeFixture(
    cwd,
    "packages/example/fixtures/malformed.txt",
    `{"style":{"labels":["${"\\u{1234567".repeat(512)}"]}}\n`,
  );
  await writeFixture(
    cwd,
    "packages/example/fixtures/after-malformed.json",
    '{"st\\u0079le":{"\\u0062g":"surface"}}\n',
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/fixtures/after-malformed.json", 1]],
  );
});

test("uses extension and quote aware escape rules for JSON and YAML keys", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/fixtures/yaml-single.yml",
    "{'style': {'\\u0062g': surface, 'b''g': surface}}\n",
  );
  await writeFixture(
    cwd,
    "packages/example/fixtures/yaml-double.yaml",
    '{"st\\u0079le":{"\\U00000062g":"surface"}}\n',
  );
  await writeFixture(
    cwd,
    "packages/example/fixtures/json-js-only.json",
    '{"st\\x79le":{"\\x62g":"surface"}}\n',
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/fixtures/yaml-double.yaml", 1]],
  );
});

test("fails closed before decoding a file that exceeds the byte cap", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/oversized.ts",
    "界".repeat(Math.floor((8 * 1024 * 1024) / 3) + 1),
  );

  assert.throws(() => scanHardCut({ cwd, mode: "production" }), /file limit/i);
});

test("fails closed when the shared lexical token budget is exceeded", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/token-heavy.ts",
    `export const values = [${'"x",'.repeat(100_001)}];\n`,
  );

  assert.throws(() => scanHardCut({ cwd, mode: "production" }), /token limit/i);
});

test("fails closed when a JavaScript or TypeScript file cannot be parsed", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "packages/example/src/invalid.ts", "const value = { style: {\n");

  assert.throws(() => scanHardCut({ cwd, mode: "production" }), /invalid syntax/i);
});

test("fails closed when JavaScript AST depth exceeds its bound", async (t) => {
  const cwd = await makeFixture(t);
  let nested = '"done"';
  for (let depth = 0; depth < 65; depth += 1) nested = `\`\${${nested}}\``;
  await writeFixture(cwd, "packages/example/src/deep-template.ts", `const value = ${nested};\n`);

  assert.throws(() => scanHardCut({ cwd, mode: "production" }), /AST depth limit/i);
});

test("does not waive a multiline match annotated after its first physical line", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/multiline-negative.test.ts",
    [
      "const legacy = {",
      "  variant",
      `  : // ${allowedAnnotation()}`,
      '  "primary",',
      "};",
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(result.waived, []);
  assert.deepEqual(
    result.violations.map(({ group, path: violationPath, line }) => [group, violationPath, line]),
    [["retired_authored_style", "packages/example/src/multiline-negative.test.ts", 2]],
  );
});

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

test("treats the removed composition reference selector as retired", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "packages/example/src/index.ts",
    [
      "export function selectCompositionReferences() {}", // style-hard-cut: allowed-negative
      "export type CompositionReferenceDataset = unknown;", // style-hard-cut: allowed-negative
      "",
    ].join("\n"),
  );

  const result = scanHardCut({ cwd });

  assert.deepEqual(
    result.violations.map(({ path: violationPath, line }) => [violationPath, line]),
    [
      ["packages/example/src/index.ts", 1],
      ["packages/example/src/index.ts", 2],
    ],
  );
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
      writeFixture(cwd, `packages/example/src/retired-${index}.txt`, `${sample}\n`),
    ),
  );
  await Promise.all(
    legacy.map((sample, index) =>
      writeFixture(cwd, `apps/example/src/legacy-${index}.txt`, `${sample}\n`),
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
    scanned.violations.map(({ path: violationPath }) => violationPath),
    [".changeset/current.md", "AGENTS.md", "README.md", "scripts/legacy.mjs"],
  );
});

test("keeps root labs inside the production hard-cut scan", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "labs/experiment.ts", `${retiredSymbol()}();\n`);

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ path: violationPath }) => violationPath),
    ["labs/experiment.ts"],
  );
});

test("excludes only the two playground runtime output directories", async (t) => {
  const cwd = await makeFixture(t);
  const legacy = 'const legacy = { style: { bg: "surface" } };\n';
  await writeFixture(cwd, "apps/playground/.facet-sessions/visitor/session.ts", legacy);
  await writeFixture(cwd, "apps/playground/generated/visitor/page.ts", legacy);
  await writeFixture(cwd, "apps/playground/.facet-sessions-backup/legacy.ts", legacy);
  await writeFixture(cwd, "apps/playground/generated-source/legacy.ts", legacy);
  await writeFixture(cwd, "apps/playground/src/legacy.ts", legacy);

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ path: violationPath }) => violationPath),
    [
      "apps/playground/.facet-sessions-backup/legacy.ts",
      "apps/playground/generated-source/legacy.ts",
      "apps/playground/src/legacy.ts",
    ],
  );
});

test("continues scanning untracked source ignored by git", async (t) => {
  const cwd = await makeFixture(t);
  const initialized = spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  await writeFixture(cwd, ".gitignore", "apps/playground/local-source/\n");
  await writeFixture(
    cwd,
    "apps/playground/local-source/legacy.ts",
    'const legacy = { style: { bg: "surface" } };\n',
  );

  const result = scanHardCut({ cwd, mode: "production" });

  assert.deepEqual(
    result.violations.map(({ path: violationPath }) => violationPath),
    ["apps/playground/local-source/legacy.ts"],
  );
});

test("does not expose excluded playground session contents in CLI diagnostics", async (t) => {
  const cwd = await makeFixture(t);
  const sessionSecret = "session-secret-that-must-not-reach-diagnostics";
  await writeFixture(
    cwd,
    "apps/playground/.facet-sessions/visitor/session.ts",
    `const legacy = { style: { bg: "${sessionSecret}" } };\n`,
  );

  const scanner = new URL("./check-style-hard-cut.mjs", import.meta.url);
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
  await writeFixture(cwd, "packages/example/src/legacy.ts", `${retiredSymbol()}();\n`);
  await writeFixture(
    cwd,
    "packages/example/node_modules/pkg/ignored.ts",
    `${retiredSymbol()}();\n`,
  );

  const scanner = new URL("./check-style-hard-cut.mjs", import.meta.url);
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
  const legacy = `${retiredSymbol()}();\n`;
  await writeFixture(cwd, "packages/example/src/index.ts", "export const clean = true;\n");
  await writeFixture(cwd, "packages/example/README.md", legacy);
  await writeFixture(cwd, "docs/current.md", legacy);
  await writeFixture(cwd, ".changeset/current.md", legacy);
  await writeFixture(cwd, "README.md", legacy);
  await writeFixture(cwd, "AGENTS.md", legacy);

  assert.deepEqual(scanHardCut({ cwd, mode: "production" }).violations, []);
  assert.deepEqual(
    scanHardCut({ cwd, mode: "all" }).violations.map(({ path: violationPath }) => violationPath),
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
    new URL("./check-style-hard-cut.mjs", import.meta.url),
    "utf8",
  );
  await writeFixture(cwd, "scripts/check-style-hard-cut.mjs", scannerSource);

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

  const scanner = new URL("./check-style-hard-cut.mjs", import.meta.url);
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

  const scanner = new URL("./check-style-hard-cut.mjs", import.meta.url);
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
