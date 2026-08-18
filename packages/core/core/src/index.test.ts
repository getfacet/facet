import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as barrel from "./index.js";

/**
 * The `@facet/core` package gate.
 *
 * This file is outside the published graph. `tsup` builds from `src/index.ts`
 * and the package ships `files: ["dist"]`, so a `*.test.ts` module may reach for
 * `node:child_process` and `node:fs` to assert a property *of* the source and of
 * the emitted declarations — the very thing a production module may not do. Every
 * check below is about the package surface rather than about any one module's
 * behaviour, which is why they live here and not beside the module they inspect.
 *
 * Four gates run, and they are deliberately **four**, not one:
 *
 * 1. **The exact key snapshot** — the barrel's declared key set equals
 *    Barrel Export Contract list 1, asserted as set equality in both directions
 *    so a missing name fails exactly as loudly as an extra one.
 * 2. **The emitted-declaration reachability audit** — `tsc --declaration` over
 *    the graph reachable *from `src/index.ts`*, failing whenever an exported
 *    declaration references a non-barrel local alias.
 * 3. **A clean consumer fixture** — a consumer-shaped file that names every
 *    public result contract through the `@facet/core` specifier.
 * 4. **The package project typecheck** — `tsc --noEmit -p packages/core/core`.
 *
 * Gates 1 and 2 stay apart because a correct key set does **not** imply a clean
 * reachability graph. That gap is not hypothetical: `MarkupProp` and
 * `AUTHOR_ERROR_CODES` reached emitted public declarations earlier in this cut
 * while the key snapshot passed, because the snapshot only ever saw the barrel.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..", "..");
const INDEX_PATH = join(HERE, "index.ts");
const TSC = join(REPO_ROOT, "node_modules", ".bin", "tsc");

/**
 * Barrel Export Contract list 1, verbatim and in contract order — the single
 * source of truth for `@facet/core`'s public surface, shared with
 * `scripts/package-smoke.mjs` and the export-map parity block. A symbol absent
 * from this list is private. Adding one here is a spec change routed through the
 * owner, not a barrel edit.
 */
const PUBLIC_SURFACE: readonly string[] = Object.freeze([
  "parseAction",
  "Action",
  "ActionResult",
  "isAuthoredNumberLiteral",
  "parseAuthoredNumber",
  "BOUNDS",
  "Bounds",
  "buildCatalogIndex",
  "validateCatalog",
  "validateModalConformance",
  "CatalogValidationResult",
  "FacetCatalog",
  "ModalConformanceResult",
  "validateComponentSpec",
  "CollectSpec",
  "ComponentSpec",
  "ComponentSpecValidationResult",
  "PropSchema",
  "StructuredPropType",
  "ThemeRecipeSpec",
  "ConversationMessage",
  "deriveMessageId",
  "truncateConversationText",
  "validateVisitorText",
  "resolveBinding",
  "BindingResolution",
  "describeDataValue",
  "dataValueShape",
  "dataValueFields",
  "dataValueEntryCount",
  "dataValuePresenceCount",
  "DataValueCountPolicy",
  "DataValueDescriptor",
  "DescribeDataValueOptions",
  "DataValueShape",
  "DataModel",
  "writePath",
  "evaluateCandidateModel",
  "DataModelEvaluation",
  "measurePublishPayload",
  "PayloadEvaluation",
  "AuthorValidationResult",
  "validateAuthorMarkup",
  "ComponentDocument",
  "ComponentNode",
  "buildDocument",
  "VisitorEvent",
  "validateVisitorEvent",
  "VisitorEventValidationResult",
  "parseDataPath",
  "isFacetIdentifier",
  "DataPath",
  "BoundedMap",
  "createBoundedMap",
  "AuthorError",
  "AuthorErrorCode",
  "SourceLocation",
  "parseMarkup",
  "MarkupAst",
  "MarkupNode",
  "ParseMarkupResult",
  "serializeDocument",
  "serializeScreen",
  "SerializeResult",
  "SerializeIssue",
  "CollectableMount",
  "ComponentMountProps",
  "MountedComponent",
  "NEUTRAL_COPY_DEFAULTS",
  "resolveNeutralCopy",
  "NeutralCopy",
  "NeutralCopyResolution",
  "applyPatch",
  "MAX_PATCH_OPS",
  "JsonPatchOperation",
  "PatchFrame",
  "ServerFrame",
  "FacetTransport",
  "VisitorEventFrame",
  "AgentControlFrame",
  "TurnOutcome",
  "validateTurnOutcome",
  "TurnOutcomeValidationResult",
  "iterateTurnOutcome",
  "collectTurnOutcome",
  "FacetAgent",
  "FacetStage",
  "UI_PATTERN_BOUNDS",
  "validateUiPatternSet",
  "UiPattern",
  "UiPatternComponentChoice",
  "UiPatternRegion",
  "UiPatternSet",
  "UiPatternValidationIssue",
  "UiPatternValidationIssueCode",
  "UiPatternValidationResult",
  "UiPatternVariant",
  "FacetTargetedMutationInput",
  "FacetTargetedMutationResult",
  "FacetToolSession",
  "StageRevision",
  "CasOutcome",
  "nextRevision",
  "FACET_THEME_CONTRACT",
  "facetThemeToKebabCase",
  "themeTokenRef",
  "themeTokenVar",
  "FacetExtensionTokenRef",
  "FacetFoundationGroupName",
  "FacetFoundationTheme",
  "FacetFoundationTokenRef",
  "FacetRecipeTokenRef",
  "FacetSemanticGroupName",
  "FacetSemanticTheme",
  "FacetSemanticTokenRef",
  "FacetTheme",
  "FacetThemeContract",
  "FacetThemeExtensionDeclaration",
  "FacetThemeGroupSpec",
  "FacetThemeTokenRef",
  "FacetThemeTokenSpec",
  "FacetThemeTokenTableValues",
  "FacetThemeTokenValueKind",
  "FacetThemeTokenValues",
  "FacetThemeValidationOptions",
  "validateTheme",
  "validateThemeExtensionDeclarations",
  "ThemeExtensionDeclarationValidationResult",
  "ThemeValidationResult",
  "themeToCssVars",
]);

/** The contract's own count, pinned so a silent list edit is a failure. */
const PUBLIC_SURFACE_SIZE = 130;

/**
 * The exact off-barrel set named by the contract. `markup-lexer.ts` is private
 * as a whole module; these seven are named symbols that must not reach the
 * barrel. The two halves differ. The four `markup-errors.ts` helpers ARE
 * module-exported — the lexer, the parser and document validation import them —
 * so for those "private" means "absent from `index.ts`", never "unexported".
 * The three `markup-parser.ts` names are not module-exported at all: they are
 * non-exported local aliases derived by indexed access from `MarkupNode`, so
 * their barrel-absence holds trivially. Both halves are asserted anyway, so the
 * check stays correct if a later change exports one of the three.
 */
const PRIVATE_NAMES: readonly string[] = Object.freeze([
  "AUTHOR_ERROR_CODES",
  "truncate",
  "authorError",
  "firstError",
  "ReferenceScheme",
  "MarkupValue",
  "MarkupProp",
]);

/** Retired vocabulary: no symbol matching these may exist in the surviving graph. */
const RETIRED_SYMBOLS: readonly RegExp[] = Object.freeze([
  /^STAGE_SPEC$/u, // component-hard-cut: allowed-negative
  /^FacetTree$/u, // component-hard-cut: allowed-negative
  /^BRICK_/u,
  /^say$/u,
  /^reset$/u,
]);

/**
 * The public result contracts a consumer must be able to *name*, not merely
 * receive. Every one is the declared return type of a public callable, so a
 * consumer that cannot write `import type { X } from "@facet/core"` cannot store
 * the result of the call in a typed variable.
 */
const PUBLIC_RESULT_CONTRACTS: readonly string[] = Object.freeze([
  "ParseMarkupResult",
  "AuthorErrorCode",
  "SourceLocation",
  "AuthorValidationResult",
  "FacetTargetedMutationResult",
  "DataModelEvaluation",
  "PayloadEvaluation",
  "BindingResolution",
  "StructuredPropType",
  "ComponentSpecValidationResult",
  "CatalogValidationResult",
  "ModalConformanceResult",
  "ActionResult",
  "VisitorEventValidationResult",
  "NeutralCopyResolution",
  "ThemeExtensionDeclarationValidationResult",
  "ThemeValidationResult",
  "TurnOutcomeValidationResult",
]);

/** One re-export statement parsed out of the barrel. */
interface BarrelReExport {
  readonly typeOnly: boolean;
  readonly names: readonly string[];
  readonly from: string;
}

const RE_EXPORT = /export\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*"([^"]+)";/gu;

function readBarrelSource(): string {
  return readFileSync(INDEX_PATH, "utf8");
}

/**
 * Parse the barrel's declared surface from its *source*, not from its runtime
 * namespace. A runtime namespace cannot see a `export type` re-export at all, so
 * reading the source is the only way to snapshot the whole contract — the type
 * half included.
 */
function parseBarrel(source: string): readonly BarrelReExport[] {
  const parsed: BarrelReExport[] = [];
  for (const match of source.matchAll(RE_EXPORT)) {
    const names = (match[2] ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    parsed.push({
      typeOnly: match[1] !== undefined,
      names,
      from: match[3] ?? "",
    });
  }
  return parsed;
}

function declaredKeys(source: string): readonly string[] {
  return parseBarrel(source).flatMap((entry) => entry.names);
}

/**
 * Every exported *declaration name* in a module's source.
 *
 * The alternation spells `function\*?` on purpose: `iterateTurnOutcome` is
 * declared `export function*`, and a naive `^export (type|interface|function|const)`
 * sweep silently misses every generator. A missed generator produces a barrel
 * that typechecks and is quietly short one public symbol.
 */
const EXPORTED_DECLARATION =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:type|interface|class|enum|const|let|var|function\s*\*?)\s+([A-Za-z_$][\w$]*)/gmu;

function exportedDeclarationNames(source: string): readonly string[] {
  return [...source.matchAll(EXPORTED_DECLARATION)].map((match) => match[1] ?? "");
}

/** Relative import specifiers, used to walk the graph and to ban Node/React. */
const IMPORT_SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*"([^"]+)";/gu;

function importSpecifiers(source: string): readonly string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? "");
}

/**
 * The published graph, walked from `src/index.ts` through relative imports.
 *
 * Reachability — not a `src/**` directory scan — is what the invariant is about.
 * A directory scan would sweep in `*.test.ts`, which are not published and are
 * allowed their node builtins; it would also miss the point, since a module that
 * exists but nothing imports ships in no bundle.
 */
function reachableModules(): readonly string[] {
  const seen = new Set<string>();
  const queue = ["index.ts"];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    const source = readFileSync(join(HERE, current), "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith("./")) continue;
      queue.push(specifier.slice(2).replace(/\.js$/u, ".ts"));
    }
  }
  return [...seen].sort();
}

interface TscRun {
  readonly status: number;
  readonly output: string;
}

function runTsc(args: readonly string[]): TscRun {
  const result = spawnSync(TSC, [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function withTempDirectory<T>(run: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "facet-core-barrel-"));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const BASE_CONFIG = join(REPO_ROOT, "tsconfig.base.json");

/**
 * Write a throwaway project that inherits the repo's real compiler options and
 * names its inputs with `files` rather than `include`.
 *
 * `files` is the load-bearing choice for gate 2: it makes tsc pull in exactly
 * the transitive import closure of what is listed, which *is* the published
 * graph. An `include` over `src` would sweep in the `*.test.ts` files that are
 * allowed their node builtins and would turn a reachability audit into the
 * directory scan the contract rules out.
 */
function writeProject(
  directory: string,
  name: string,
  compilerOptions: Record<string, unknown>,
  files: readonly string[],
): string {
  const configPath = join(directory, name);
  writeFileSync(
    configPath,
    JSON.stringify({ extends: BASE_CONFIG, compilerOptions, files }),
    "utf8",
  );
  return configPath;
}

describe("gate 1 — the exact barrel key snapshot", () => {
  it("declares exactly Barrel Export Contract list 1, no more and no less", () => {
    const keys = declaredKeys(readBarrelSource());
    const declared = new Set(keys);
    const expected = new Set(PUBLIC_SURFACE);

    // Both directions, reported separately: an omission is as much a contract
    // break as a leak, and a single set comparison hides which one happened.
    const missing = [...expected].filter((name) => !declared.has(name)).sort();
    const extra = [...declared].filter((name) => !expected.has(name)).sort();

    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    expect(keys.length).toBe(PUBLIC_SURFACE_SIZE);
    expect(declared.size).toBe(PUBLIC_SURFACE_SIZE);
  });

  it("pins the contract list itself at 130 unique keys", () => {
    expect(PUBLIC_SURFACE).toHaveLength(PUBLIC_SURFACE_SIZE);
    expect(new Set(PUBLIC_SURFACE).size).toBe(PUBLIC_SURFACE_SIZE);
  });

  it("uses explicit named re-exports only — no wildcard, no default, no alias", () => {
    const source = readBarrelSource();

    // Comments are stripped first: the barrel's own header *names* the banned
    // form in prose to explain why it is banned, and a check that cannot tell
    // documentation from code would forbid documenting the rule.
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");

    // D-12. A wildcard is not a style preference: it republishes whatever a
    // module happens to export, which is precisely how private helpers leaked
    // into the public API earlier in this cut.
    expect(code).not.toMatch(/export\s*\*/u);
    expect(code).not.toMatch(/export\s+default/u);

    // No renaming: the barrel key must be the module's own declaration name, so
    // one grep answers "where does this public symbol come from".
    const parsed = parseBarrel(source);
    expect(parsed.flatMap((entry) => entry.names).filter((name) => /\s/u.test(name))).toEqual([]);

    // Every `export` outside a comment is one of the parsed re-exports —
    // nothing is declared in this file, only forwarded.
    expect(code.match(/\bexport\b/gu) ?? []).toHaveLength(parsed.length);
  });

  it("re-exports every type with `export type` and every value with `export`", () => {
    const runtimeKeys = Object.keys(barrel).sort();
    const valueKeys = parseBarrel(readBarrelSource())
      .filter((entry) => !entry.typeOnly)
      .flatMap((entry) => entry.names)
      .sort();

    // `verbatimModuleSyntax` erases `export type` entirely, so the runtime
    // namespace is exactly the value half of the barrel. Any drift means a type
    // was re-exported as a value (a build-time failure under `isolatedModules`)
    // or a value was hidden behind `export type` (a runtime hole).
    expect(runtimeKeys).toEqual(valueKeys);
  });

  it("exposes the complete newly public set", () => {
    const declared = new Set(declaredKeys(readBarrelSource()));
    for (const name of PUBLIC_RESULT_CONTRACTS) {
      expect(declared.has(name), `${name} must be on the barrel`).toBe(true);
    }
    // The generator that a one-line regex inventory misses.
    expect(declared.has("iterateTurnOutcome")).toBe(true);
  });

  it("keeps the seven private names off the barrel", () => {
    const declared = new Set(declaredKeys(readBarrelSource()));
    const leaked = PRIVATE_NAMES.filter((name) => declared.has(name));
    expect(leaked).toEqual([]);
  });

  it("re-exports nothing from the private lexer module", () => {
    const modules = parseBarrel(readBarrelSource()).map((entry) => entry.from);

    // `markup-lexer.ts` is private as a whole module: it is reachable because
    // `markup-parser.ts` imports it, and it is public through nothing.
    expect(modules).not.toContain("./markup-lexer.js");

    // Every source is a relative sibling — the barrel never forwards a package.
    for (const specifier of modules) {
      expect(specifier).toMatch(/^\.\/[a-z-]+\.js$/u);
    }
  });

  it("carries no retired symbol anywhere in the reachable graph", () => {
    const offenders: string[] = [];
    for (const module of reachableModules()) {
      const source = readFileSync(join(HERE, module), "utf8");
      for (const name of exportedDeclarationNames(source)) {
        if (RETIRED_SYMBOLS.some((pattern) => pattern.test(name))) {
          offenders.push(`${module}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    for (const name of declaredKeys(readBarrelSource())) {
      expect(RETIRED_SYMBOLS.some((pattern) => pattern.test(name))).toBe(false);
    }
  });
});

describe("gate 2 — emitted-declaration reachability audit", () => {
  /**
   * Emit `.d.ts` for the graph reachable from `src/index.ts` and inspect what
   * TypeScript actually wrote. Reading the source cannot prove this property:
   * whether a public signature names a private alias is a fact about the emitted
   * declaration, and only the emitter knows it.
   */
  it("emits no public declaration that references a non-barrel local alias", () => {
    withTempDirectory((directory) => {
      const outDir = join(directory, "out");
      const configPath = writeProject(
        directory,
        "tsconfig.audit.json",
        {
          noEmit: false,
          declaration: true,
          emitDeclarationOnly: true,
          outDir,
          rootDir: HERE,
        },
        [INDEX_PATH],
      );

      const emit = runTsc(["-p", configPath]);
      expect(emit.output).toBe("");
      expect(emit.status).toBe(0);

      const emitted = readdirSync(outDir).filter((name) => name.endsWith(".d.ts"));
      expect(emitted.length).toBeGreaterThan(0);

      const publicNames = new Set(PUBLIC_SURFACE);
      const crossModuleLeaks: string[] = [];
      const localLeaks: string[] = [];
      let sawLocalImport = false;

      for (const file of emitted) {
        const declaration = readFileSync(join(outDir, file), "utf8");

        // (a) Cross-module: a declaration that names a symbol from a sibling
        // module forces tsc to write an import for it. Every such name must be
        // package-public, or the emitted `.d.ts` carries a name no consumer can
        // import.
        //
        // Both emitted spellings are matched — `import type { X }` and
        // `import { type X }` — and both quote styles. This regex was single-
        // quote-only at first and therefore matched nothing at all: the check
        // reported a clean graph because it never read one. A gate that cannot
        // fail is worse than no gate, so `sawLocalImport` records that it fired.
        for (const match of declaration.matchAll(
          /import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*["'](\.[^"']+)["'];/gu,
        )) {
          sawLocalImport = true;
          for (const raw of (match[1] ?? "").split(",")) {
            const name = raw.trim().replace(/^type\s+/u, "");
            if (name.length === 0) continue;
            if (!publicNames.has(name))
              crossModuleLeaks.push(`${file}: ${name} (from ${match[2]})`);
          }
        }

        // (b) Same module: tsc writes a top-level declaration without `export`
        // only when an exported declaration reached for a local alias. That is
        // the `MarkupProp` leak, caught structurally rather than by name.
        for (const line of declaration.split("\n")) {
          if (/^(?:declare\s|interface\s|type\s|class\s|enum\s|abstract\s)/u.test(line)) {
            localLeaks.push(`${file}: ${line.trim()}`);
          }
        }
      }

      expect({ crossModuleLeaks, localLeaks }).toEqual({
        crossModuleLeaks: [],
        localLeaks: [],
      });

      // Non-vacuity: these modules genuinely reference each other's types, so a
      // run that found zero local imports found nothing because it was broken.
      expect(sawLocalImport).toBe(true);
      expect(emitted).toContain("markup-lexer.d.ts");
    });
  }, 120_000);

  it("imports neither `node:*` nor `react` anywhere in the published graph", () => {
    const offenders: string[] = [];
    for (const module of reachableModules()) {
      const source = readFileSync(join(HERE, module), "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith("node:") || specifier === "react" || /^react\//u.test(specifier)) {
          offenders.push(`${module}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reaches only modules that belong to this package", () => {
    const modules = reachableModules();
    expect(modules).toContain("index.ts");
    for (const module of modules) {
      expect(module.endsWith(".test.ts")).toBe(false);
    }
  });
});

describe("gate 3 — clean consumer fixture", () => {
  it("lets a consumer name every public result contract through `@facet/core`", () => {
    withTempDirectory((directory) => {
      const fixturePath = join(directory, "consumer.ts");
      const names = [...PUBLIC_RESULT_CONTRACTS];
      writeFileSync(
        fixturePath,
        [
          `import type { ${names.join(", ")} } from "@facet/core";`,
          "",
          ...names.map((name, index) => `declare const value${index}: ${name};`),
          "",
          `export type Named = [${names.map((_, index) => `typeof value${index}`).join(", ")}];`,
          "",
        ].join("\n"),
        "utf8",
      );

      const configPath = writeProject(directory, "tsconfig.consumer.json", { noEmit: true }, [
        fixturePath,
      ]);

      const check = runTsc(["-p", configPath]);
      expect(check.output).toBe("");
      expect(check.status).toBe(0);
    });
  }, 120_000);
});

describe("gate 4 — the package project typecheck", () => {
  it("typechecks `packages/core/core` with no errors", () => {
    const check = runTsc(["--noEmit", "-p", join("packages", "core", "core")]);
    expect(check.output).toBe("");
    expect(check.status).toBe(0);
  }, 120_000);
});

describe("the manifest", () => {
  it("declares no dependencies and describes the component-markup role", () => {
    const manifest: unknown = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    expect(typeof manifest === "object" && manifest !== null).toBe(true);
    const record = manifest as Record<string, unknown>;

    // `@facet/core` is the one package everything else depends on, so it depends
    // on nothing. The field is absent rather than empty.
    expect("dependencies" in record).toBe(false);
    expect(record["name"]).toBe("@facet/core");

    const description = String(record["description"] ?? "");
    expect(description).toMatch(/markup/iu);
    expect(description).not.toMatch(/brick|stage spec|tree/iu);

    const keywords = record["keywords"];
    expect(Array.isArray(keywords)).toBe(true);
    expect((keywords as readonly string[]).length).toBeGreaterThan(0);
  });
});
