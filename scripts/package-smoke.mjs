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
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoots = ["packages/core", "packages/agent-stack", "packages/extensions"];
const expectedPackageCount = 15;
const expectedBins = {
  facet: { args: [], exitCode: 2, output: "FACET_BRIDGE_URL is not set" },
  "facet-bridge": {
    args: [],
    env: { FACET_RUNNER: "invalid-for-package-smoke" },
    exitCode: 1,
    output: "Invalid FACET_RUNNER",
  },
  "facet-quickstart": {
    args: ["--invalid-for-package-smoke"],
    exitCode: 1,
    output: "Unknown flag",
  },
};

function fail(message) {
  throw new Error(`[package-smoke] ${message}`);
}

function isolatedEnvironment(extra = {}) {
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

function packageDirectories() {
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

function exportSurfaces(packageName, exports) {
  if (exports === undefined) return [];
  if (typeof exports === "string" || Array.isArray(exports) || "import" in exports) {
    return [{ specifier: packageName, conditions: exports }];
  }
  return Object.entries(exports).map(([subpath, conditions]) => ({
    specifier: subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`,
    conditions,
  }));
}

function conditionTarget(conditions, condition) {
  if (typeof conditions === "string") return condition === "import" ? conditions : undefined;
  if (conditions === null || Array.isArray(conditions) || typeof conditions !== "object") {
    return undefined;
  }
  const target = conditions[condition];
  return typeof target === "string" ? target : undefined;
}

function assertInstalledSurface(packageDirectory, specifier, condition, target) {
  if (!target.startsWith("./dist/")) {
    fail(`${specifier} ${condition} target is not published from dist: ${target}`);
  }
  if (!existsSync(resolve(packageDirectory, target))) {
    fail(`${specifier} ${condition} target is missing from the installed tarball: ${target}`);
  }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "facet-package-smoke-"));
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
    "@types/pg": "^8.11.0",
    "@types/react": "^19.0.0",
    pg: "^8.0.0",
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
const core = await import("@facet/core");
const assets = await import("@facet/assets");
const tools = await import("@facet/agent-tools");
for (const name of ["BRICK_CONTRACT", "STYLE_VALUE_CONTRACT", "validateTheme", "validatePattern", "validateAuthorTree"]) {
  assert.ok(name in core, \`missing new @facet/core export \${name}\`);
}
for (const name of ["FacetCatalog", "DEFAULT_CATALOG", "FacetComposition", "validateComposition"]) { // style-hard-cut: allowed-negative
  assert.equal(name in core, false, \`retired @facet/core export survived: \${name}\`);
}
assert.deepEqual(Object.keys(assets).sort(), ["DEFAULT_PATTERNS", "DEFAULT_THEME"]);
assert.equal(core.validateTheme(assets.DEFAULT_THEME).issues.length, 0);
assert.ok(assets.DEFAULT_PATTERNS.length > 0);
for (const pattern of assets.DEFAULT_PATTERNS) {
  assert.equal(core.validatePattern(pattern, assets.DEFAULT_THEME).issues.length, 0);
}
for (const name of ["get_brick_spec", "get_style_choices", "get_preset", "get_pattern"]) {
  assert.ok(tools.FACET_STAGE_TOOL_NAMES.includes(name), \`missing tool \${name}\`);
}
for (const name of ["get_composition", "set_theme"]) { // style-hard-cut: allowed-negative
  assert.equal(tools.FACET_STAGE_TOOL_NAMES.includes(name), false, \`retired tool survived: \${name}\`);
}
for (const name of ["createStageToolAssetSnapshot", "selectPatternReference"]) {
  assert.ok(name in tools, \`missing @facet/agent-tools export \${name}\`);
}
for (const name of ["selectCompositionReferences", "executeGetComposition"]) { // style-hard-cut: allowed-negative
  assert.equal(name in tools, false, \`retired @facet/agent-tools export survived: \${name}\`);
}
const snapshot = tools.createStageToolAssetSnapshot({
  theme: assets.DEFAULT_THEME,
  patterns: assets.DEFAULT_PATTERNS,
});
assert.ok(Object.isFrozen(snapshot));
assert.equal(snapshot.patternIndex.length, assets.DEFAULT_PATTERNS.length);
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
import type { AuthorIssue, BrickStyle, FacetPattern, FacetTheme } from "@facet/core";
import type { AssetDocuments, LoadedAssets } from "@facet/runtime";
import type { GetBrickSpecToolInput, GetPatternToolInput, GetPresetToolInput, GetStyleChoicesToolInput, StageToolAssets } from "@facet/agent-tools";
import type { ReferenceAgentAssetSource } from "@facet/reference-agent";
// @ts-expect-error retired hard-cut type
import type { FacetCatalog } from "@facet/core"; // style-hard-cut: allowed-negative
// @ts-expect-error retired hard-cut type
import type { FacetComposition } from "@facet/core"; // style-hard-cut: allowed-negative
// @ts-expect-error retired hard-cut type
import type { GetCompositionToolInput } from "@facet/agent-tools"; // style-hard-cut: allowed-negative
export type PublishedSurfaces = [${typeUses}];
export type NewStyleContract = [
  FacetTheme,
  FacetPattern,
  BrickStyle<"box">,
  AuthorIssue,
  AssetDocuments,
  LoadedAssets,
  StageToolAssets,
  GetBrickSpecToolInput,
  GetStyleChoicesToolInput,
  GetPresetToolInput,
  GetPatternToolInput,
  ReferenceAgentAssetSource,
];
export const brickSpecInput = { type: "box" } satisfies GetBrickSpecToolInput;
export const styleChoicesInput = {
  brick: "progress",
  target: "track",
  property: "height",
} satisfies GetStyleChoicesToolInput;
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
