/* global console, process */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PACKAGE_ROLE_ROOTS, PUBLIC_PACKAGE_COUNT } from "./package-topology.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let temporaryRoot;

export const packageRoots = PACKAGE_ROLE_ROOTS;
export const expectedPackageCount = PUBLIC_PACKAGE_COUNT;
export const expectedBins = {
  "facet-quickstart": {
    args: ["--invalid-for-package-smoke"],
    exitCode: 1,
    output: "Unknown flag",
  },
};
export const retiredBinNames = ["facet", "facet-bridge"];
export const expectedRuntimeExports = {
  "@facet/core": [
    "BOUNDS",
    "MAX_PATCH_OPS",
    "NEUTRAL_COPY_DEFAULTS",
    "applyPatch",
    "buildCatalogIndex",
    "buildDocument",
    "collectTurnOutcome",
    "createBoundedMap",
    "dataValueEntryCount",
    "dataValueFields",
    "dataValuePresenceCount",
    "dataValueShape",
    "describeDataValue",
    "deriveMessageId",
    "evaluateCandidateModel",
    "isAuthoredNumberLiteral",
    "isFacetIdentifier",
    "iterateTurnOutcome",
    "measurePublishPayload",
    "nextRevision",
    "parseAction",
    "parseAuthoredNumber",
    "parseDataPath",
    "parseMarkup",
    "resolveBinding",
    "resolveNeutralCopy",
    "serializeDocument",
    "serializeScreen",
    "themeToCssVars",
    "truncateConversationText",
    "validateVisitorEvent",
    "validateAuthorMarkup",
    "validateCatalog",
    "validateComponentSpec",
    "validateModalConformance",
    "validateTheme",
    "validateTurnOutcome",
    "validateVisitorText",
    "writePath",
  ],
  "@facet/runtime": [
    "FacetRuntime",
    "MemorySink",
    "MemoryStageStore",
    "MemorySummaryStore",
    "bootstrapSession",
    "loadSession",
    "validatePersistedSession",
  ],
  "@facet/assets": ["DEFAULT_CATALOG", "DEFAULT_COMPONENT_SPECS", "DEFAULT_THEME"],
  "@facet/assets/react": ["DEFAULT_REGISTRY"],
  "@facet/react": [
    "ConversationSurface",
    "CorruptSubtreeState",
    "CrashState",
    "ModalFrame",
    "PreparingState",
    "StageRenderer",
    "SubtreeBoundary",
    "bootstrapRenderer",
    "createRegistry",
    "resolveTheme",
    "useFacet",
  ],
  "@facet/agent-tools": [
    "FACET_PROMPT_KIT",
    "FACET_TOOL_NAMES",
    "FACET_TOOL_SPECS",
    "buildTurnObservation",
    "createMarkupBuffer",
    "executeFacetTool",
  ],
  "@facet/agent": ["Stage", "defineAgent", "defineStreamingAgent"],
  "@facet/reference-agent": [
    "DEFAULT_ANTHROPIC_MODEL",
    "DEFAULT_GUIDE",
    "DEFAULT_OPENAI_MODEL",
    "DEFAULT_REFERENCE_AGENT_BUDGET_PRESET",
    "DEFAULT_STAGE_MARKUP_CHAR_LIMIT",
    "DEFAULT_STAGE_SUMMARY_NODE_LIMIT",
    "HISTORY_TURNS",
    "MIN_REFERENCE_AGENT_OBSERVATION_CHARS",
    "REFERENCE_AGENT_BUDGET_PRESETS",
    "REFERENCE_AGENT_FALLBACK_TEXT",
    "REFERENCE_AGENT_NON_RETRYABLE_HTTP_STATUSES",
    "REFERENCE_AGENT_RETRYABLE_HTTP_STATUSES",
    "REFERENCE_AGENT_STOP_REASONS",
    "REFERENCE_AGENT_TRACE_EVENT_TYPES",
    "STUB_MARKUP",
    "TOOLS",
    "TURN_TIMEOUT_MS",
    "buildInitialMessages",
    "buildSystem",
    "classifyProviderFailure",
    "createAnthropicProvider",
    "createOpenAiProvider",
    "createProviderSummarizer",
    "createReferenceAgent",
    "createStubAgent",
    "describeEvent",
    "effectiveCharBudget",
    "emitReferenceAgentTrace",
    "formatCurrentStageForPrompt",
    "isRetryableProviderFailure",
    "measureChars",
    "normalizeBudget",
    "resolveProvider",
    "sanitizeReferenceAgentTraceEvent",
    "summarizeStageForPrompt",
    "summaryBlockMessage",
    "validateSummary",
  ],
  "@facet/server": ["createFacetServer"],
  "@facet/client": [
    "LocalTransport",
    "SseTransport",
    "browserVisitorId",
    "loadPersistedScreen",
    "persistScreen",
  ],
  "@facet/agent-client": ["connectAgent", "parseSseFrames"],
  "@facet/quickstart": ["QUICKSTART_INITIAL_STAGE", "createQuickstartAgent", "startQuickstart"],
};
const expectedDefaultCatalogTags = [
  "Screen",
  "Stack",
  "Row",
  "Grid",
  "Modal",
  "Card",
  "Empty",
  "Text",
  "Metric",
  "Badge",
  "Button",
  "Field",
  "Table",
];
const expectedFacetToolNames = [
  "render_page",
  "insert_subtree",
  "replace_subtree",
  "update_node",
  "remove_subtree",
  "read_component_spec",
  "read_screen",
  "read_data",
  "publish_data",
];

function fail(message) {
  throw new Error(`[package-smoke] ${message}`);
}

function isolatedEnvironment(extra = {}) {
  if (temporaryRoot === undefined) {
    throw new Error("[package-smoke] temporary root is not initialized");
  }
  const inherited = {};
  for (const key of [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SHELL",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "WINDIR",
    "CI",
    "LANG",
    "LC_ALL",
  ]) {
    const value = process.env[key];
    if (value !== undefined) inherited[key] = value;
  }
  return {
    ...inherited,
    HOME: temporaryRoot,
    npm_config_cache: join(temporaryRoot, "npm-cache"),
    npm_config_userconfig: join(temporaryRoot, ".npmrc"),
    ...extra,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: isolatedEnvironment(options.env),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== (options.exitCode ?? 0)) {
    fail(
      `${command} ${args.join(" ")} exited ${String(result.status)}\n${result.stdout}${result.stderr}`,
    );
  }
  return `${result.stdout}${result.stderr}`;
}

export function packageDirectories() {
  const directories = packageRoots.flatMap((root) => {
    const absoluteRoot = join(repoRoot, root);
    return readdirSync(absoluteRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(absoluteRoot, entry.name))
      .filter((directory) => existsSync(join(directory, "package.json")));
  });
  directories.sort();
  if (directories.length !== expectedPackageCount) {
    fail(
      `expected ${String(expectedPackageCount)} public packages, found ${String(directories.length)}; update the smoke inventory intentionally`,
    );
  }
  return directories;
}

function packagePath(fixture, packageName) {
  return join(fixture, "node_modules", ...packageName.split("/"));
}

export function exportSurfaces(packageName, exports) {
  if (exports === undefined) return [];
  if (typeof exports === "string" || Array.isArray(exports) || "import" in exports) {
    return [{ specifier: packageName, conditions: exports }];
  }
  return Object.entries(exports).map(([subpath, conditions]) => ({
    specifier: subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`,
    conditions,
  }));
}

export function conditionTarget(conditions, condition) {
  if (typeof conditions === "string") return condition === "import" ? conditions : undefined;
  if (conditions === null || Array.isArray(conditions) || typeof conditions !== "object") {
    return undefined;
  }
  const target = conditions[condition];
  return typeof target === "string" ? target : undefined;
}

export function assertInstalledSurface(packageDirectory, specifier, condition, target) {
  if (!target.startsWith("./dist/")) {
    fail(`${specifier} ${condition} target is not published from dist: ${target}`);
  }
  if (!existsSync(resolve(packageDirectory, target))) {
    fail(`${specifier} ${condition} target is missing from the installed tarball: ${target}`);
  }
}

export function main() {
  temporaryRoot = mkdtempSync(join(tmpdir(), "facet-package-smoke-"));
  const tarballDirectory = join(temporaryRoot, "tarballs");
  const fixture = join(temporaryRoot, "consumer");

  try {
    const packages = packageDirectories().map((directory) => ({
      directory,
      manifest: JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
    }));

    console.log(`[package-smoke] packing ${String(packages.length)} public packages`);
    mkdirSync(tarballDirectory);
    const tarballs = new Map();
    for (const pkg of packages) {
      const before = new Set(existsSync(tarballDirectory) ? readdirSync(tarballDirectory) : []);
      run("pnpm", ["--dir", pkg.directory, "pack", "--pack-destination", tarballDirectory]);
      const created = readdirSync(tarballDirectory).filter(
        (file) => file.endsWith(".tgz") && !before.has(file),
      );
      if (created.length !== 1) {
        fail(`${pkg.manifest.name} produced ${String(created.length)} tarballs instead of one`);
      }
      tarballs.set(pkg.manifest.name, join(tarballDirectory, created[0]));
    }

    const dependencies = Object.fromEntries(
      [...tarballs.entries()].map(([name, tarball]) => [name, `file:${tarball}`]),
    );
    Object.assign(dependencies, {
      "@types/node": "^22.0.0",
      "@types/react": "^19.0.0",
      react: "^19.0.0",
      typescript: "^5.9.0",
    });
    mkdirSync(fixture);
    writeFileSync(
      join(fixture, "package.json"),
      `${JSON.stringify({ name: "facet-package-smoke", private: true, type: "module", dependencies }, null, 2)}\n`,
    );

    console.log("[package-smoke] installing tarballs in a clean consumer project");
    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--registry=https://registry.npmjs.org/",
      ],
      {
        cwd: fixture,
        timeout: 240_000,
      },
    );

    const esmSurfaces = [];
    const cjsSurfaces = [];
    const typeSurfaces = [];
    for (const source of packages) {
      const packageDirectory = packagePath(fixture, source.manifest.name);
      const installedManifestPath = join(packageDirectory, "package.json");
      if (!existsSync(installedManifestPath)) fail(`${source.manifest.name} was not installed`);
      const installedManifestText = readFileSync(installedManifestPath, "utf8");
      const installedManifest = JSON.parse(installedManifestText);
      if (installedManifestText.includes("workspace:")) {
        fail(`${source.manifest.name} still contains a workspace: dependency after packing`);
      }
      if (!existsSync(join(packageDirectory, "LICENSE"))) {
        fail(`${source.manifest.name} tarball does not contain LICENSE`);
      }

      for (const surface of exportSurfaces(source.manifest.name, installedManifest.exports)) {
        const importTarget = conditionTarget(surface.conditions, "import");
        const requireTarget = conditionTarget(surface.conditions, "require");
        const typesTarget = conditionTarget(surface.conditions, "types");
        if (importTarget !== undefined) {
          assertInstalledSurface(packageDirectory, surface.specifier, "import", importTarget);
          esmSurfaces.push(surface.specifier);
        }
        if (requireTarget !== undefined) {
          assertInstalledSurface(packageDirectory, surface.specifier, "require", requireTarget);
          cjsSurfaces.push(surface.specifier);
        }
        if (typesTarget !== undefined) {
          assertInstalledSurface(packageDirectory, surface.specifier, "types", typesTarget);
          typeSurfaces.push(surface.specifier);
        }
      }
    }

    const environmentGuard = `for (const key of ["GITHUB_TOKEN", "GH_TOKEN", "NPM_TOKEN", "NODE_AUTH_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"]) {
  if (process.env[key] !== undefined) throw new Error(\`credential leaked to package smoke child: \${key}\`);
}`;
    writeFileSync(
      join(fixture, "esm-smoke.mjs"),
      `${environmentGuard}\n${esmSurfaces.map((specifier) => `await import(${JSON.stringify(specifier)});`).join("\n")}\n`,
    );
    run(process.execPath, ["esm-smoke.mjs"], { cwd: fixture });

    writeFileSync(
      join(fixture, "cjs-smoke.cjs"),
      `${environmentGuard}\n${cjsSurfaces.map((specifier) => `require(${JSON.stringify(specifier)});`).join("\n")}\n`,
    );
    run(process.execPath, ["cjs-smoke.cjs"], { cwd: fixture });

    writeFileSync(
      join(fixture, "contract-smoke.mjs"),
      `${environmentGuard}
import assert from "node:assert/strict";
const expectedRuntimeExports = ${JSON.stringify(expectedRuntimeExports, null, 2)};
const expectedDefaultCatalogTags = ${JSON.stringify(expectedDefaultCatalogTags, null, 2)};
const expectedFacetToolNames = ${JSON.stringify(expectedFacetToolNames, null, 2)};

const surfaces = {};
for (const specifier of Object.keys(expectedRuntimeExports)) {
  surfaces[specifier] = await import(specifier);
  assert.deepEqual(
    Object.keys(surfaces[specifier]).sort(),
    [...expectedRuntimeExports[specifier]].sort(),
    \`unexpected runtime exports for \${specifier}\`,
  );
}

const core = surfaces["@facet/core"];
const assets = surfaces["@facet/assets"];
const assetsReact = surfaces["@facet/assets/react"];
const tools = surfaces["@facet/agent-tools"];

assert.equal(core.deriveMessageId("turn-1", "assistant"), "turn-1:assistant");
assert.deepEqual(
  assets.DEFAULT_CATALOG.components.map((component) => component.tag),
  expectedDefaultCatalogTags,
);
assert.equal(assets.DEFAULT_CATALOG.components.length, 13);
assert.equal(core.validateCatalog(assets.DEFAULT_CATALOG).ok, true);
assert.equal(core.validateTheme(assets.DEFAULT_THEME).ok, true);
assert.deepEqual(Object.keys(assetsReact.DEFAULT_REGISTRY).sort(), [
  ...expectedDefaultCatalogTags,
].sort());
assert.equal(Object.keys(assetsReact.DEFAULT_REGISTRY).length, 13);
assert.equal("DEFAULT_REGISTRY" in assets, false);

assert.deepEqual([...tools.FACET_TOOL_NAMES], expectedFacetToolNames);
assert.deepEqual(
  tools.FACET_TOOL_SPECS.map((spec) => spec.name),
  expectedFacetToolNames,
);
for (const spec of tools.FACET_TOOL_SPECS) {
  assert.equal(spec.producesConversation, false);
  assert.equal(typeof spec.inputSchema, "object");
  assert.equal(spec.inputSchema.type, "object");
  assert.equal(spec.inputSchema.additionalProperties, false);
  assert.equal("parameters" in spec, false);
}

for (const name of ["FacetTree", "AssetsStore", "MemoryAssets", "loadAssets", "ViewSnapshot"]) { // component-hard-cut: allowed-negative
  assert.equal(name in core, false, \`retired @facet/core export survived: \${name}\`);
}
for (const name of ["get_brick_spec", "get_style_choices", "get_preset", "get_pattern", "inspect_stage", "inspect_node", "append_node", "set_node", "remove_node", "say"]) { // component-hard-cut: allowed-negative
  assert.equal(tools.FACET_TOOL_NAMES.includes(name), false, \`retired tool survived: \${name}\`);
}
for (const name of ["createStageToolAssetSnapshot", "selectPatternReference", "executeGetPattern", "executeGetBrickSpec"]) { // component-hard-cut: allowed-negative
  assert.equal(name in tools, false, \`retired @facet/agent-tools export survived: \${name}\`);
}
`,
    );
    run(process.execPath, ["contract-smoke.mjs"], { cwd: fixture });

    const typeImports = typeSurfaces
      .map(
        (specifier, index) =>
          `import type * as Surface${String(index)} from ${JSON.stringify(specifier)};`,
      )
      .join("\n");
    const typeUses = typeSurfaces
      .map((_, index) => `keyof typeof Surface${String(index)}`)
      .join(", ");
    writeFileSync(
      join(fixture, "types-smoke.ts"),
      `${typeImports}
import type {
  VisitorEvent,
  ComponentDocument,
  ComponentSpec,
  ConversationMessage,
  DataValueCountPolicy,
  DataValueDescriptor,
  DescribeDataValueOptions,
  DataValueShape,
  FacetAgent,
  FacetCatalog,
  FacetTargetedMutationInput,
  FacetTargetedMutationResult,
  FacetTheme,
  FacetToolSession,
  TurnOutcome,
} from "@facet/core";
import type { Session, Sink, StageStore, SummaryStore } from "@facet/runtime";
import type {
  FacetToolName,
  FacetToolResult,
  FacetToolSpec,
  InsertSubtreeInput,
  PublishDataInput,
  ReadComponentSpecInput,
  ReadDataInput,
  ReadScreenInput,
  RemoveSubtreeInput,
  RenderPageInput,
  ReplaceSubtreeInput,
  TurnObservation,
  UpdateNodeInput,
} from "@facet/agent-tools";
import type { AgentConnection, ConnectOptions } from "@facet/agent-client";
import type { SseVisitorMessageInput } from "@facet/client";
import type { ReferenceAgentOptions } from "@facet/reference-agent";
import type { QuickstartServerOptions, RunningQuickstart } from "@facet/quickstart";
// @ts-expect-error retired hard-cut type
import type { FacetTree } from "@facet/core"; // component-hard-cut: allowed-negative
// @ts-expect-error retired hard-cut type
import type { LoadedAssets } from "@facet/runtime"; // component-hard-cut: allowed-negative
// @ts-expect-error retired hard-cut type
import type { GetBrickSpecToolInput } from "@facet/agent-tools"; // component-hard-cut: allowed-negative
export type PublishedSurfaces = [${typeUses}];
export type ComponentMarkupContract = [
  ComponentSpec,
  FacetCatalog,
  ComponentDocument,
  VisitorEvent,
  TurnOutcome,
  ConversationMessage,
  DescribeDataValueOptions,
  StageStore,
  Sink,
  SummaryStore,
  Session,
  RenderPageInput,
  FacetTheme,
  FacetToolSession,
  FacetTargetedMutationInput,
  FacetTargetedMutationResult,
  FacetToolName,
  FacetToolSpec,
  FacetToolResult,
  TurnObservation,
  AgentConnection,
  ConnectOptions,
  SseVisitorMessageInput,
  ReferenceAgentOptions,
  QuickstartServerOptions,
  RunningQuickstart,
];
export type ToolInputContract = [
  RenderPageInput,
  InsertSubtreeInput,
  ReplaceSubtreeInput,
  UpdateNodeInput,
  RemoveSubtreeInput,
  ReadComponentSpecInput,
  ReadScreenInput,
  ReadDataInput,
  PublishDataInput,
];
export const renderPageInput = { markup: "<Facet><Screen name=\\"home\\" /></Facet>" } satisfies RenderPageInput;
export const insertInput = { targetId: "n1", markup: "<Text value=\\"Hello\\" />" } satisfies InsertSubtreeInput;
export const publishInput = { path: "metrics", value: { ok: true } } satisfies PublishDataInput;
declare const externalAgent: FacetAgent;
export const agentClientOptions = { serverUrl: "http://localhost:5291", agentId: "external-agent", agent: externalAgent } satisfies ConnectOptions;
declare const contract: ComponentMarkupContract;
declare const toolInputs: ToolInputContract;
void contract;
void toolInputs;
`,
    );
    writeFileSync(
      join(fixture, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            lib: ["ES2022", "DOM"],
            module: "NodeNext",
            moduleResolution: "NodeNext",
            noEmit: true,
            skipLibCheck: false,
            strict: true,
            target: "ES2022",
          },
          include: ["types-smoke.ts"],
        },
        null,
        2,
      )}\n`,
    );
    run(process.execPath, [join(fixture, "node_modules/typescript/bin/tsc")], { cwd: fixture });

    console.log("[package-smoke] exercising installed bin links");
    for (const name of retiredBinNames) {
      const executable = join(fixture, "node_modules", ".bin", name);
      if (existsSync(executable)) fail(`${name} retired bin link was installed`);
    }
    for (const [name, expectation] of Object.entries(expectedBins)) {
      const executable = join(fixture, "node_modules", ".bin", name);
      if (!existsSync(executable)) fail(`${name} bin link was not installed`);
      const output = run(executable, expectation.args, {
        cwd: fixture,
        env: expectation.env,
        exitCode: expectation.exitCode,
        timeout: 10_000,
      });
      if (!output.includes(expectation.output)) {
        fail(`${name} did not produce its expected startup diagnostic: ${expectation.output}`);
      }
    }

    console.log(
      `[package-smoke] PASS (${String(packages.length)} packages, ${String(esmSurfaces.length)} ESM, ${String(cjsSurfaces.length)} CJS, ${String(typeSurfaces.length)} type surfaces, ${String(Object.keys(expectedBins).length)} bins)`,
    );
  } finally {
    if (process.env.FACET_KEEP_PACKAGE_SMOKE !== "1") {
      rmSync(temporaryRoot, { recursive: true, force: true });
    } else {
      console.log(`[package-smoke] kept fixture at ${relative(repoRoot, temporaryRoot)}`);
    }
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
