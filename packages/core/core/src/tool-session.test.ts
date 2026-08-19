import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { validateCatalog, type FacetCatalog } from "./catalog.js";
import {
  evaluateCandidateModel,
  measurePublishPayload,
  writePath,
  type DataModel,
} from "./data-model.js";
import { validateAuthorMarkup } from "./document-validation.js";
import type { ComponentDocument } from "./document.js";
import { parseDataPath, type DataPath } from "./identifiers.js";
import { parseMarkup } from "./markup-parser.js";
import { nextRevision, type StageRevision } from "./revision.js";
import * as toolSession from "./tool-session.js";
import type { FacetTargetedMutationInput, FacetToolSession } from "./tool-session.js";

/**
 * The port is **types only**, so vitest alone cannot check it: every `import
 * type` is erased by esbuild before a test runs. Three things follow, and this
 * file does all three.
 *
 * 1. The structural claim is written as a *satisfying stub* built from core
 *    types and core functions alone. It only compiles if the port is genuinely
 *    inhabitable, and the tests call it, so the fixture is real rather than a
 *    comment. A second, runtime-shaped record with the extra fields
 *    `@facet/runtime`'s `Session` carries proves the port is satisfied
 *    *structurally* — nothing here asserts nominal identity.
 * 2. "Imports nothing from `@facet/runtime` or `@facet/agent-tools`" is checked
 *    twice, mechanically: against the module's own source and against the
 *    declaration `tsc` emits for it. A type-only import is erased at runtime, so
 *    a source-only scan could pass every assertion here while the emitted
 *    `.d.ts` still leaked a dependency — and the emitted declaration is the only
 *    surface a published consumer ever sees.
 * 3. "Declared exactly once in the workspace" is a **scan**, not a sentence: the
 *    whole source tree is walked and every declaration of the name is counted.
 *    The point of D5 is that agent-tools re-exports this declaration and runtime
 *    satisfies it; a second declaration anywhere is the drift the decision
 *    exists to prevent.
 *
 * A test file may reach for a node builtin to do that. The published graph is
 * built from `src/index.ts` and ships `dist` only, so a `*.test.ts` file is
 * outside it; a production module here may not.
 */

/** The primary port name this module publishes, kept out of the scan patterns as text. */
const PORT_NAME = "FacetToolSession";
const PUBLIC_TOOL_SESSION_NAMES = [
  "FacetTargetedMutationInput",
  "FacetTargetedMutationResult",
  PORT_NAME,
];

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

const MODULE_PATH = join(SRC_DIR, "tool-session.ts");

/** `packages/core/core/src` → the workspace root, four levels up. */
const REPO_ROOT = join(SRC_DIR, "..", "..", "..", "..");

/**
 * The barrel-public names an emitted declaration for this module may reference.
 * Every one is on `@facet/core`'s Barrel Export Contract list, which is what
 * makes the port nameable from another package: a public signature that reached
 * a private alias would resolve inside this package and fail at its boundary.
 */
const PUBLIC_TYPE_NAMES: readonly string[] = [
  "AuthorValidationResult",
  "ComponentDocument",
  "DataModel",
  "DataPath",
  "FacetCatalog",
  "FacetTargetedMutationInput",
  "FacetTargetedMutationResult",
  "PayloadEvaluation",
  "StageRevision",
];

/** Source extensions the workspace scan reads. */
const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts"];

/** Directories that hold no authored workspace source. */
const SKIPPED_DIRECTORIES: readonly string[] = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".next",
];

/**
 * Removes comments so a scan reads *code*, not prose. This module's own doc
 * comments necessarily talk about what it must not import, and a check a
 * sentence can trip is not a mechanical check.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Removes whole import statements, so the scan below reads *declarations*.
 * `import { type Thing } from "…"` puts the `type` keyword directly in front of
 * a name it does not declare, and across several lines it can even sit at the
 * start of one — so a scan that kept imports would report every consumer of the
 * port as a second declaration site, which is the opposite of what D5 wants.
 */
function stripImports(source: string): string {
  return source.replace(/\bimport\s[\s\S]*?\bfrom\s*["'][^"']*["']/g, " ");
}

/** Every module specifier a source file names. */
function importSpecifiers(source: string): readonly string[] {
  const code = stripComments(source);
  return [...code.matchAll(/from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
}

/**
 * The declaration `tsc` emits for the module. The sibling modules it names come
 * along, which is the point: the emitted `.d.ts` is where a leaked dependency
 * would show up.
 */
let emittedDeclaration: string | undefined;

function emitDeclaration(): string {
  if (emittedDeclaration !== undefined) {
    return emittedDeclaration;
  }
  const outDir = mkdtempSync(join(tmpdir(), "facet-tool-session-"));
  try {
    execFileSync(
      join(REPO_ROOT, "node_modules", ".bin", "tsc"),
      [
        "--declaration",
        "--emitDeclarationOnly",
        "--strict",
        "--exactOptionalPropertyTypes",
        "--noUncheckedIndexedAccess",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        "--outDir",
        outDir,
        MODULE_PATH,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" },
    );
    emittedDeclaration = readFileSync(join(outDir, "tool-session.d.ts"), "utf8");
    return emittedDeclaration;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** Every authored source file in the workspace, node_modules and builds aside. */
function workspaceSources(directory: string, found: string[] = []): readonly string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        workspaceSources(join(directory, entry.name), found);
      }
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

/** Builds a fixture catalog, failing loudly if the fixture itself is bad. */
function catalogOf(components: readonly unknown[]): FacetCatalog {
  const result = validateCatalog({ components });
  if (!result.ok) {
    throw new Error(`fixture catalog was rejected: ${result.code} at ${result.at}`);
  }
  return result.catalog;
}

/**
 * Every valid catalog registers exactly one `Screen`, in the one conforming
 * shape: a required scalar `name` and nothing else. The absent keys are the
 * contract rather than an omission — a `default` or an `enum` would let a screen
 * be reached under a name the author never wrote, and `bindable` would make the
 * identity a screen is navigated to resolve out of the data model at render
 * time. Each is left off, never set to a falsy value.
 *
 * It is appended last on purpose. Nothing here indexes the member list, but
 * every fixture catalog in this package keeps the required root at the end so a
 * member's index stays the index a rejection would name.
 */
const TEST_CATALOG = catalogOf([
  {
    tag: "Text",
    whenToUse: "Show one run of copy.",
    content: { mode: "none" },
    props: {
      value: { type: "string", guidance: "The copy to show.", required: true, bindable: true },
    },
  },
  {
    tag: "Screen",
    whenToUse: "Hold one named screen of the document.",
    content: { mode: "children" },
    props: {
      name: {
        type: "string",
        guidance: "The name this screen is navigated to by.",
        required: true,
      },
    },
  },
]);

const VALID_MARKUP =
  '<Facet entry="home"><Screen name="home"><Text value="Hello" /></Screen></Facet>';

const UNKNOWN_TAG_MARKUP =
  '<Facet entry="home"><Screen name="home"><Nope value="Hello" /></Screen></Facet>';

/** A path, parsed the way an executor parses one before it reaches the port. */
function pathOf(text: string): DataPath {
  const path = parseDataPath(text);
  if (path === null) {
    throw new Error(`fixture path was rejected: ${text}`);
  }
  return path;
}

/**
 * The minimal stub: a session handle built from core types and core functions
 * alone. It is deliberately a real, if tiny, implementation rather than a set of
 * stubbed returns — every member answers in the contract the port declares, so
 * "satisfiable" means satisfiable by something that works.
 *
 * The reads are getters because the port declares them `readonly`: `readonly` is
 * what a *consumer* may do with a member, not a promise the value never moves.
 * That is exactly how a runtime adapter behaves — a mutation commits, and the
 * next read sees the new stage at the next revision.
 */
function createStubSession(catalog: FacetCatalog): FacetToolSession {
  let document: ComponentDocument | null = null;
  let data: DataModel = {};
  let stageRevision: StageRevision = 0;
  return {
    catalog,
    get document(): ComponentDocument | null {
      return document;
    },
    get data(): DataModel {
      return data;
    },
    get stageRevision(): StageRevision {
      return stageRevision;
    },
    async applyAuthorMutation(markup: string) {
      const parsed = parseMarkup(markup);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      const validated = validateAuthorMarkup(parsed.ast, catalog, data);
      if (validated.ok) {
        document = validated.document;
        stageRevision = nextRevision(stageRevision);
      }
      return validated;
    },
    async applyTargetedMutation(input) {
      return {
        ok: false as const,
        code: "unsupported_targeted_mutation",
        at: "kind",
        detail: `${input.kind} is not implemented by this stub.`,
      };
    },
    async publishData(path: DataPath, value: unknown) {
      const payload = measurePublishPayload(value);
      if (!payload.ok) {
        return payload;
      }
      const candidate = evaluateCandidateModel(writePath(data, path, value));
      if (!candidate.ok) {
        return candidate;
      }
      data = candidate.model;
      stageRevision = nextRevision(stageRevision);
      return payload;
    },
  };
}

/**
 * A consumer-shaped helper, written the way an executor takes its handle. It
 * only compiles if the port really is the parameter type a tool can declare —
 * which is the whole reason the port has a name (D-16).
 */
async function readCurrentScreenTag(session: FacetToolSession): Promise<string | null> {
  const document = session.document;
  if (document === null) {
    return null;
  }
  const rootId = document.screens[0];
  return rootId === undefined ? null : (document.nodes[rootId]?.tag ?? null);
}

describe("the port is a types-only module", () => {
  it("contributes no runtime code, so nothing can be constructed from it", () => {
    expect(Object.keys(toolSession)).toEqual([]);
  });

  it("names neither @facet/runtime nor @facet/agent-tools in its source", () => {
    const specifiers = importSpecifiers(readFileSync(MODULE_PATH, "utf8"));
    expect(specifiers).not.toContain("@facet/runtime");
    expect(specifiers).not.toContain("@facet/agent-tools");
  });

  it("imports only sibling core modules — no package, no builtin, no react", () => {
    const specifiers = importSpecifiers(readFileSync(MODULE_PATH, "utf8"));
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier, `unexpected import: ${specifier}`).toMatch(/^\.\/[\w.-]+\.js$/);
    }
  });

  it("keeps both bans in the declaration tsc emits, where a type import survives", () => {
    const declaration = emitDeclaration();
    for (const specifier of importSpecifiers(declaration)) {
      expect(specifier, `unexpected emitted import: ${specifier}`).toMatch(/^\.\/[\w.-]+\.js$/);
    }
    // Read the *code*: `tsc` carries doc comments into the declaration, and
    // this module's prose necessarily explains which two packages meet at the
    // port. What must not appear is a reference in the declarations themselves.
    expect(stripComments(declaration)).not.toMatch(/@facet\/(?:runtime|agent-tools)/);
  }, 60_000);

  it("emits exactly the public tool-session names", () => {
    const declaration = emitDeclaration();
    const exported = [
      ...declaration.matchAll(/export\s+(?:declare\s+)?(?:interface|type|const|function)\s+(\w+)/g),
    ].map((match) => match[1]);
    expect(exported).toEqual(PUBLIC_TOOL_SESSION_NAMES);
  });

  it("references only barrel-public names, so a consumer can name every part", () => {
    const declaration = emitDeclaration();
    const bindings = [...declaration.matchAll(/import\s+type\s*\{([^}]*)\}/g)].flatMap((match) =>
      (match[1] ?? "")
        .split(",")
        .map((binding) => binding.trim())
        .filter((binding) => binding.length > 0),
    );
    expect(bindings.length).toBeGreaterThan(0);
    for (const binding of bindings) {
      expect(PUBLIC_TYPE_NAMES, `off-barrel name in a public declaration: ${binding}`).toContain(
        binding,
      );
    }
  });
});

describe("the port is declared exactly once in the workspace", () => {
  /**
   * A declaration in statement position: at the start of a line or after a
   * brace or semicolon, optionally exported or ambient. `export type { … } from`
   * is a re-export, not a declaration, and does not match — which is exactly
   * what `@facet/agent-tools` is required to write (D-16).
   */
  const DECLARES = new RegExp(
    `(?:^|[;{}]|\\n)\\s*(?:export\\s+)?(?:declare\\s+)?(?:interface|type|class|enum)\\s+${PORT_NAME}\\b`,
  );

  function declarationSites(): readonly string[] {
    return workspaceSources(REPO_ROOT).filter((file) =>
      DECLARES.test(stripImports(stripComments(readFileSync(file, "utf8")))),
    );
  }

  it("finds that one declaration, and finds it in @facet/core", () => {
    // Guards the walk itself: a scan that silently reached nothing would agree
    // with a workspace holding no declaration at all.
    expect(workspaceSources(REPO_ROOT).length).toBeGreaterThan(50);
    expect(declarationSites()).toEqual([MODULE_PATH]);
  });

  it("would count a second declaration, and does not count a consumer", () => {
    // The pattern is what makes the claim above mechanical, so it is checked on
    // both sides: a redeclaration is caught, and the two shapes a legitimate
    // consumer writes — an inline type import and the `export type` re-export
    // `@facet/agent-tools` owes D-16 — are not mistaken for one.
    const redeclarations: readonly string[] = [
      `export interface ${PORT_NAME} { readonly catalog: unknown }`,
      `type ${PORT_NAME} = { readonly catalog: unknown };`,
      `declare class ${PORT_NAME} {}`,
    ];
    for (const source of redeclarations) {
      expect(DECLARES.test(stripImports(stripComments(source))), source).toBe(true);
    }

    const consumers: readonly string[] = [
      `import { executeFacetTool, type ${PORT_NAME} } from "@facet/core";`,
      `import {\n  type ${PORT_NAME},\n} from "@facet/core";`,
      `export type { ${PORT_NAME} } from "@facet/core";`,
      `export type { ${PORT_NAME} };`,
    ];
    for (const source of consumers) {
      expect(DECLARES.test(stripImports(stripComments(source))), source).toBe(false);
    }
  });
});

describe("a stub built from core types alone satisfies the port", () => {
  it("reads the catalog, the preparing document, the data model and the revision", async () => {
    const session = createStubSession(TEST_CATALOG);
    expect(session.catalog).toBe(TEST_CATALOG);
    expect(session.document).toBeNull();
    expect(session.data).toEqual({});
    expect(session.stageRevision).toBe(0);
    expect(await readCurrentScreenTag(session)).toBeNull();
  });

  it("applies an authored mutation and answers in the core validation contract", async () => {
    const session = createStubSession(TEST_CATALOG);
    const result = await session.applyAuthorMutation(VALID_MARKUP);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("fixture markup was rejected");
    }
    expect(result.document.entry).toBe("home");
    expect(session.document).toBe(result.document);
    expect(session.stageRevision).toBe(1);
    expect(await readCurrentScreenTag(session)).toBe("Screen");
  });

  it("rejects an authored mutation with exactly one structured author error", async () => {
    const session = createStubSession(TEST_CATALOG);
    const result = await session.applyAuthorMutation(UNKNOWN_TAG_MARKUP);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("an unknown tag was accepted");
    }
    expect(result.error.code).toBe("unknown-tag");
    expect(result.error.repair.length).toBeGreaterThan(0);
    expect(session.document).toBeNull();
    expect(session.stageRevision).toBe(0);
  });

  it("publishes bounded data and answers in the core payload contract", async () => {
    const session = createStubSession(TEST_CATALOG);
    const result = await session.publishData(pathOf("sales.total"), 42);
    expect(result.ok).toBe(true);
    expect(session.data).toEqual({ sales: { total: 42 } });
    expect(session.stageRevision).toBe(1);
  });

  it("rejects an over-B-20 payload atomically, leaving prior data and revision", async () => {
    const session = createStubSession(TEST_CATALOG);
    await session.publishData(pathOf("sales.total"), 42);
    const before = session.data;

    const oversized = "x".repeat(BOUNDS.publishDataPayloadChars + 1);
    const result = await session.publishData(pathOf("sales.note"), oversized);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("an over-B-20 payload was accepted");
    }
    expect(result.reason).toBe("publish_payload_chars_exceeded");
    expect(result.bound).toBe("B-20");
    expect(session.data).toBe(before);
    expect(session.stageRevision).toBe(1);
  });
});

describe("the port is satisfied structurally, never nominally", () => {
  it("accepts a runtime-shaped session carrying the fields the port does not name", async () => {
    // `@facet/runtime`'s `Session` also holds a theme, neutral copy and a phase.
    // The port names none of them, and this assignment is what proves it does
    // not have to: a wider record satisfies a narrower structural port.
    const runtimeShaped = {
      catalog: TEST_CATALOG,
      theme: { foundation: {}, semantic: {} },
      copy: { preparing: "Preparing your page." },
      phase: "preparing" as const,
      document: null,
      data: {} as DataModel,
      stageRevision: 7,
      applyAuthorMutation: async (markup: string) =>
        createStubSession(TEST_CATALOG).applyAuthorMutation(markup),
      applyTargetedMutation: async (input: FacetTargetedMutationInput) =>
        createStubSession(TEST_CATALOG).applyTargetedMutation(input),
      publishData: async (path: DataPath, value: unknown) =>
        createStubSession(TEST_CATALOG).publishData(path, value),
    };
    const port: FacetToolSession = runtimeShaped;

    expect(port.stageRevision).toBe(7);
    expect(port.catalog).toBe(TEST_CATALOG);
    const applied = await port.applyAuthorMutation(VALID_MARKUP);
    expect(applied.ok).toBe(true);
  });
});
