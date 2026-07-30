// @vitest-environment jsdom
/**
 * The `@facet/assets/react` subpath barrel: the default registry, and the entry
 * boundary that keeps it out of the root.
 *
 * `@facet/assets` publishes two entries and they are deliberately unlike each
 * other. The root is plain, Node-safe data — a theme and thirteen component
 * specs — and a server that only needs the catalog must be able to import it
 * without pulling React in behind it. `./react` is the browser half: the
 * thirteen trusted implementations of those same specs. That split is a
 * package-shape decision (RISK-PKG-1, RISK-SHAPE-5) which nothing else in the
 * repository enforces, so the assertions below are its enforcement.
 *
 * Three obligations are proved here, and each one is proved structurally rather
 * than by reading prose:
 *
 * 1. **The barrel is exactly one key** (D-12, Barrel Export Contract list 3).
 *    `DEFAULT_REGISTRY` and nothing else; the five modules under `react/` stay
 *    private, and there is no `export *` to widen the surface by accident.
 * 2. **The registry and the catalog carry the same tag set** (DC-016, DC-002).
 *    Exactly thirteen on both sides — the two halves of the trust boundary that
 *    bootstrap demands be equal. Catalog *order* is not part of the contract, so
 *    these are set comparisons, never sequence comparisons.
 * 3. **The entry boundary holds** (D-09, DC-029). Nothing reachable from the
 *    root entry imports React; nothing reachable from the subpath imports
 *    anything but `@facet/core` and `react`.
 *
 * Obligation 3 is checked by **parsing** each module with the TypeScript
 * compiler and walking the resulting module graph, not by matching text. Both
 * distinctions matter and each has already bitten this feature once. A grep
 * cannot tell an import from a doc comment — `react/surface.tsx` and
 * `react/layout.tsx` both *mention* `@facet/react` in prose, because the Modal
 * frame lives there — so a textual scan reports a boundary breach that does not
 * exist. And a directory scan cannot tell a shipped module from a test fixture:
 * `react/layout.test.tsx` imports three private siblings for a drift proof, and
 * those imports are correct precisely because no consumer can reach them. Only
 * reachability *from an entry point* answers the question the package shape asks.
 *
 * The jsdom docblock above is load-bearing (convention 8): vitest's default
 * environment is `node` and the repository config declares none, so without it
 * the mount pass below cannot render at all.
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { ComponentMountProps, ComponentSpec, MountedComponent, PropSchema } from "@facet/core";
import { themeToCssVars } from "@facet/core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CATALOG } from "./catalog.js";
import * as rootBarrel from "./index.js";
import { Badge, Metric, Text } from "./react/content.js";
import { Button, Field, Table } from "./react/interactive.js";
import { Grid, Row, Screen, Stack } from "./react/layout.js";
import { Card, Empty, Modal } from "./react/surface.js";
import * as barrel from "./react.js";
import { DEFAULT_REGISTRY } from "./react.js";
import { DEFAULT_THEME } from "./theme-default.js";

/** The exact `@facet/assets/react` key set — Barrel Export Contract list 3 (D-12). */
const BARREL_KEYS: readonly string[] = ["DEFAULT_REGISTRY"];

/**
 * Which trusted implementation each tag must resolve to, written out once.
 *
 * This is the pin for the wiring itself. A tag-set comparison proves thirteen
 * names are present; it cannot notice `Card` and `Empty` swapped, or `Badge`
 * pointing at `Text`. Naming the expected implementation per tag is what makes
 * a mis-wired registry a failure rather than a coincidence, and the values come
 * from the private modules directly — this test may import them, a consumer
 * may not.
 */
const EXPECTED: readonly (readonly [string, MountedComponent<ReactNode, ReactNode>])[] = [
  ["Screen", Screen],
  ["Stack", Stack],
  ["Row", Row],
  ["Grid", Grid],
  ["Modal", Modal],
  ["Card", Card],
  ["Empty", Empty],
  ["Text", Text],
  ["Metric", Metric],
  ["Badge", Badge],
  ["Button", Button],
  ["Field", Field],
  ["Table", Table],
];

/** The custom properties a real bootstrap hands every mount. */
const THEME_VARS = themeToCssVars(DEFAULT_THEME);

/**
 * A second projection in which every token holds a different value.
 *
 * Built by mapping each token to the *next distinct value* in the default
 * theme's own value set, so no token can accidentally keep its value — which a
 * plain rotation would do wherever two tokens agree, and two do (`background`
 * and `onAccent` are both `#ffffff`).
 *
 * The alternate values are deliberately not kind-matched: a colour may land on
 * a spacing token. That is harmless and, where it is not, it is informative. A
 * component that references `var(--facet-space-md)` emits the identical
 * declaration either way, because a `var()` reference is not resolved at
 * declaration time. A component that inlines the value emits something
 * different — or something jsdom drops as invalid. Both are differences, and a
 * difference is exactly what the check is looking for.
 */
const ALT_THEME_VARS: Readonly<Record<string, string>> = (() => {
  const distinct = [...new Set(Object.values(THEME_VARS))].sort();
  return Object.freeze(
    Object.fromEntries(
      Object.entries(THEME_VARS).map(([name, value]) => [
        name,
        distinct[(distinct.indexOf(value) + 1) % distinct.length] ?? value,
      ]),
    ),
  );
})();

/** Matches one `var()` reference inside a declaration value. */
const VAR_REFERENCE = /var\([^)]*\)/gu;

afterEach(cleanup);

function noop(): void {
  return undefined;
}

function sortedKeys(registry: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.keys(registry).sort();
}

function catalogTags(): readonly string[] {
  return DEFAULT_CATALOG.components.map((spec) => spec.tag);
}

function specFor(tag: string): ComponentSpec {
  const spec = DEFAULT_CATALOG.components.find((member) => member.tag === tag);
  if (spec === undefined) {
    throw new Error(`The default catalog declares no ${tag}.`);
  }
  return spec;
}

/**
 * One value of the declared type, so a required prop can be supplied without
 * restating what each component wants. Document validation guarantees required
 * props are present, so a mount fixture without them would exercise a state the
 * renderer cannot produce.
 */
function sampleValue(schema: PropSchema): ComponentMountProps["props"][string] {
  // Narrowed by `in`, not by `type`. The structured branch's discriminant is the
  // alias `StructuredPropType`, itself a union, and TypeScript does not refine a
  // constituent whose discriminant is a union — so a `type !== "array" && type
  // !== "object"` guard leaves that branch alive and `enum` absent. Keying off
  // the property is what narrows, and it belongs on this side: the structured
  // branch is closed and binding-only, so `enum` and `default` are scalar-only
  // by contract and the reader adapts rather than the type widening.
  if (schema.type === "array") {
    return [];
  }
  if (schema.type === "object") {
    return {};
  }
  if ("enum" in schema && schema.enum !== undefined) {
    const [first] = schema.enum;
    if (first !== undefined) {
      return first;
    }
  }
  if (schema.type === "boolean") {
    return true;
  }
  return schema.type === "number" ? 1 : "sample";
}

/** Exactly the props the spec marks required, each with a schema-valid value. */
function requiredProps(spec: ComponentSpec): ComponentMountProps["props"] {
  const props: Record<string, ComponentMountProps["props"][string]> = {};
  for (const [name, schema] of Object.entries(spec.props)) {
    if (schema.required === true) {
      props[name] = sampleValue(schema);
    }
  }
  return props;
}

// --- Mounting, and reading the styles back off the DOM -----------------------

/**
 * Mounts one registered tag under a given theme projection and answers its
 * single root element. More than one root would break the containment the
 * renderer wraps around every subtree, so the count is enforced here rather
 * than assumed by each caller.
 */
function mountRoot(tag: string, themeVars: Readonly<Record<string, string>>): HTMLElement {
  const Component = DEFAULT_REGISTRY[tag];
  if (Component === undefined) {
    throw new Error(`${tag} resolved to no implementation.`);
  }
  const { container } = render(
    <Component
      props={requiredProps(specFor(tag))}
      themeVars={themeVars}
      onAction={noop}
      onValueChange={noop}
    >
      {null}
    </Component>,
  );
  const root = container.firstElementChild;
  if (container.childElementCount !== 1 || !(root instanceof HTMLElement)) {
    throw new Error(
      `${tag} rendered ${container.childElementCount} roots; exactly one is allowed.`,
    );
  }
  return root;
}

/** The root plus every element below it, in document order. */
function subtree(root: HTMLElement): readonly Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

/** One element's inline declarations, as `[name, value]` pairs. */
function declarations(element: Element): readonly (readonly [string, string])[] {
  return (element.getAttribute("style") ?? "")
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0)
    .map((declaration) => {
      const separator = declaration.indexOf(":");
      return [
        declaration.slice(0, separator).trim(),
        declaration.slice(separator + 1).trim(),
      ] as const;
    });
}

/** The custom property names one element declares — the theme it re-projects. */
function customProperties(element: Element): readonly string[] {
  return declarations(element)
    .map(([name]) => name)
    .filter((name) => name.startsWith("--"))
    .sort();
}

/**
 * Every ordinary declaration in the subtree, custom properties excluded.
 *
 * The custom properties are the theme projection itself and necessarily differ
 * between two themes; everything else is what the component decided to say, and
 * that is what must not depend on a token's value.
 */
function themedDeclarations(root: HTMLElement): readonly string[] {
  return subtree(root).flatMap((element, index) =>
    declarations(element)
      .filter(([name]) => !name.startsWith("--"))
      .map(([name, value]) => `${index}. ${name}: ${value}`),
  );
}

/** Every `var()` reference the subtree makes, exactly as written. */
function varReferences(root: HTMLElement): readonly string[] {
  return subtree(root).flatMap((element) =>
    declarations(element)
      .filter(([name]) => !name.startsWith("--"))
      .flatMap(([, value]) => value.match(VAR_REFERENCE) ?? []),
  );
}

/** The token names those references name. */
function referencedTokens(root: HTMLElement): readonly string[] {
  return varReferences(root).map(
    (reference) => reference.slice("var(".length, -1).split(",")[0]?.trim() ?? "",
  );
}

// --- The module graph, parsed ------------------------------------------------

/** A module path relative to `src/`, e.g. `react/layout.tsx`. */
type ModulePath = string;

/**
 * This package's `src/` as a plain filesystem path.
 *
 * Paths, not `URL`s: the jsdom environment this suite runs in replaces the
 * global `URL` with jsdom's own, which does not resolve a `file:` base — so
 * `new URL("catalog.ts", import.meta.url)` yields an `http://localhost` URL here
 * and `readFileSync` rejects it. `import.meta.url` itself is still the real file
 * URL, so converting once and joining with `node:path` keeps the reads honest.
 */
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** A module path relative to `src/`, in POSIX form, whatever the host separator. */
function toModulePath(absolute: string): ModulePath {
  return relative(SRC_DIR, absolute).replaceAll("\\", "/");
}

function readSource(file: ModulePath): string {
  return readFileSync(join(SRC_DIR, file), "utf8");
}

function parseSource(file: ModulePath): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readSource(file),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function walk(node: ts.Node, visit: (child: ts.Node) => void): void {
  ts.forEachChild(node, (child) => {
    visit(child);
    walk(child, visit);
  });
}

/**
 * Every module specifier the file actually imports or re-exports — static,
 * dynamic and `import =` alike.
 *
 * Because this reads parsed syntax nodes, a specifier that appears only inside
 * a comment or a string cannot reach the result: comments are trivia and never
 * become an `ImportDeclaration`. That is the whole reason the check is a parse.
 */
function moduleSpecifiers(file: ModulePath): readonly string[] {
  const found: string[] = [];
  walk(parseSource(file), (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const reference = node.moduleReference.expression;
      if (ts.isStringLiteral(reference)) {
        found.push(reference.text);
      }
      return;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteral(argument)) {
        found.push(argument.text);
        return;
      }
      throw new Error(`${file} performs a dynamic import this check cannot resolve.`);
    }
  });
  return found;
}

/** Every `export * from` / `export * as ns from` in the file, parsed. */
function starExports(file: ModulePath): readonly string[] {
  const found: string[] = [];
  walk(parseSource(file), (node) => {
    if (!ts.isExportDeclaration(node) || node.moduleSpecifier === undefined) {
      return;
    }
    const clause = node.exportClause;
    if (clause === undefined || ts.isNamespaceExport(clause)) {
      found.push(node.getText(node.getSourceFile()));
    }
  });
  return found;
}

/** Resolves a `./x.js` specifier against the importing module's own directory. */
function resolveLocal(from: ModulePath, specifier: string): ModulePath {
  const target = join(dirname(join(SRC_DIR, from)), specifier.replace(/\.js$/u, ""));
  for (const extension of [".ts", ".tsx"]) {
    const candidate = `${target}${extension}`;
    try {
      readFileSync(candidate);
      return toModulePath(candidate);
    } catch {
      continue;
    }
  }
  throw new Error(`${from} imports ${specifier}, which resolves to no module in this package.`);
}

interface Reachable {
  /** Every module reachable from the entry, the entry included. */
  readonly modules: readonly ModulePath[];
  /** Every non-relative specifier any of those modules imports. */
  readonly external: readonly string[];
}

/** Walks the module graph from one entry point. Test files are unreachable by construction. */
function reachableFrom(entry: ModulePath): Reachable {
  const modules = new Set<ModulePath>();
  const external = new Set<string>();
  const queue: ModulePath[] = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || modules.has(file)) {
      continue;
    }
    modules.add(file);
    for (const specifier of moduleSpecifiers(file)) {
      if (specifier.startsWith(".")) {
        queue.push(resolveLocal(file, specifier));
      } else {
        external.add(specifier);
      }
    }
  }
  return { modules: [...modules].sort(), external: [...external].sort() };
}

describe("DEFAULT_REGISTRY — thirteen trusted implementations (DC-016, DC-002)", () => {
  it("holds exactly thirteen entries", () => {
    expect(sortedKeys(DEFAULT_REGISTRY)).toHaveLength(13);
  });

  it("carries exactly the catalog's tag set — the two halves of the trust boundary", () => {
    // Sets, not sequences: catalog order is not part of the contract.
    expect(sortedKeys(DEFAULT_REGISTRY)).toEqual([...new Set(catalogTags())].sort());
  });

  it("names no tag the catalog does not declare, and skips none that it does", () => {
    const registered = new Set(Object.keys(DEFAULT_REGISTRY));
    const declared = new Set(catalogTags());
    expect([...registered].filter((tag) => !declared.has(tag))).toEqual([]);
    expect([...declared].filter((tag) => !registered.has(tag))).toEqual([]);
  });

  it("resolves every tag to its own implementation, not merely to some component", () => {
    for (const [tag, implementation] of EXPECTED) {
      expect([tag, DEFAULT_REGISTRY[tag]]).toEqual([tag, implementation]);
    }
  });

  it("pins the thirteen expected tags, so a renamed component cannot pass silently", () => {
    expect(EXPECTED.map(([tag]) => tag).sort()).toEqual(sortedKeys(DEFAULT_REGISTRY));
  });

  it("registers Facet nowhere: the one grammar position stays unimplemented", () => {
    expect(Object.keys(DEFAULT_REGISTRY)).not.toContain("Facet");
  });

  it("registers Screen: a document's screen roots are ordinary mounted components", () => {
    expect(typeof DEFAULT_REGISTRY["Screen"]).toBe("function");
  });

  it("stores callable implementations under every tag", () => {
    for (const tag of Object.keys(DEFAULT_REGISTRY)) {
      expect([tag, typeof DEFAULT_REGISTRY[tag]]).toEqual([tag, "function"]);
    }
  });

  it("is frozen, so the trust boundary cannot lengthen after bootstrap compared the two halves", () => {
    expect(Object.isFrozen(DEFAULT_REGISTRY)).toBe(true);
  });
});

describe("DEFAULT_REGISTRY — every entry mounts (DC-002)", () => {
  it("renders one root element per tag, given the props its own spec requires", () => {
    for (const tag of Object.keys(DEFAULT_REGISTRY)) {
      expect([tag, mountRoot(tag, THEME_VARS).isConnected]).toEqual([tag, true]);
      cleanup();
    }
  });
});

/**
 * The theme mechanism, proved at the registry rather than per module.
 *
 * `react/layout.test.tsx` and `react/interactive.test.tsx` already prove their
 * own components style themselves through the theme's custom properties. This
 * suite is **not** those assertions repeated thirteen times, and the difference
 * is what makes it worth running:
 *
 * - **The registry is the iteration source.** Each module suite sweeps a
 *   hand-written list of the components it owns, so neither can notice a tag
 *   that no module suite claims, or a fourteenth that appears with no sweep
 *   behind it. Sweeping `Object.keys(DEFAULT_REGISTRY)` asserts the property of
 *   *what the package publishes*, which is what a host actually bootstraps.
 * - **Nothing is vacuously clean.** A component that inlined no value and
 *   referenced no token would satisfy every "does not misuse the theme" check by
 *   not using it, so the sweep also demands each tag reference the theme at all.
 * - **The value-independence check is a different instrument.** The module
 *   suites look for a marker string pasted into a declaration. This renders each
 *   component twice, under two themes that share no token value, and demands the
 *   declarations be identical. It needs no marker and no cooperation from the
 *   theme fixture, so it also catches a value that reached the DOM transformed
 *   rather than verbatim.
 *
 * The fallback ban is asserted only here.
 */
describe("DEFAULT_REGISTRY — one theme mechanism, across all thirteen", () => {
  it("sweeps all thirteen registered tags, so no component escapes the mechanism", () => {
    // The guard on every sweep below: they iterate the registry, so a tag added
    // without a trusted implementation of the mechanism is swept by definition
    // rather than by someone remembering to extend a list.
    expect(Object.keys(DEFAULT_REGISTRY)).toHaveLength(13);
  });

  it("builds an alternate theme in which every single token's value differs", () => {
    // The fixture proves itself first. A rotation that left one token's value
    // unchanged would make the value-independence check below vacuous for that
    // token, and it would pass for the wrong reason.
    const unchanged = Object.keys(THEME_VARS).filter(
      (name) => ALT_THEME_VARS[name] === THEME_VARS[name],
    );
    expect(unchanged).toEqual([]);
    expect(Object.keys(ALT_THEME_VARS).sort()).toEqual(Object.keys(THEME_VARS).sort());
  });

  it("puts the complete projected token set on every one of the thirteen roots", () => {
    // `mountStyle(themeVars, …)` is the mechanism: every root re-declares the
    // active theme, so a component renders correctly wherever it is mounted —
    // including the Modal frame's portal, which sits outside the screen subtree.
    const projected = Object.keys(THEME_VARS).sort();
    for (const tag of Object.keys(DEFAULT_REGISTRY)) {
      expect([tag, customProperties(mountRoot(tag, THEME_VARS))]).toEqual([tag, projected]);
      cleanup();
    }
  });

  it("styles every tag from the theme: none is merely unstyled and so vacuously clean", () => {
    // Without this, a component that inlined nothing and referenced nothing
    // would satisfy every check above by doing no theming at all.
    for (const tag of Object.keys(DEFAULT_REGISTRY)) {
      const referenced = referencedTokens(mountRoot(tag, THEME_VARS));
      cleanup();
      expect([tag, referenced.length > 0]).toEqual([tag, true]);
    }
  });

  it("styles by reference, not by value: a different theme changes no declaration", () => {
    // The one decisive discriminator between the two strategies. A component
    // that writes `var(--facet-color-text)` emits the same declaration whatever
    // the token holds; a component that reads the value out of `themeVars` and
    // inlines it emits a different one. Nothing else about a rendered subtree
    // separates the mechanisms this cleanly.
    for (const tag of Object.keys(DEFAULT_REGISTRY)) {
      const real = themedDeclarations(mountRoot(tag, THEME_VARS));
      cleanup();
      const alternate = themedDeclarations(mountRoot(tag, ALT_THEME_VARS));
      cleanup();
      expect([tag, alternate]).toEqual([tag, real]);
    }
  });

  it("references only tokens the projection actually declares", () => {
    for (const tag of Object.keys(DEFAULT_REGISTRY)) {
      const referenced = referencedTokens(mountRoot(tag, THEME_VARS));
      cleanup();
      expect([tag, referenced.filter((name) => !Object.hasOwn(THEME_VARS, name))]).toEqual([
        tag,
        [],
      ]);
    }
  });

  it("carries no var() fallback: a missing token is a host failure, not a component's to paper over", () => {
    // Bootstrap validates the complete theme before anything mounts, so
    // `var(--facet-color-text, inherit)` would be a component absorbing a
    // configuration error the trust boundary already refuses to let through.
    for (const tag of Object.keys(DEFAULT_REGISTRY)) {
      const references = varReferences(mountRoot(tag, THEME_VARS));
      cleanup();
      expect([tag, references.filter((one) => !/^var\(--facet-[a-z0-9-]+\)$/u.test(one))]).toEqual([
        tag,
        [],
      ]);
    }
  });
});

describe("@facet/assets/react barrel — the exact key set (D-12)", () => {
  it("exports exactly DEFAULT_REGISTRY, and nothing else", () => {
    expect(Object.keys(barrel).sort()).toEqual([...BARREL_KEYS].sort());
  });

  it("re-exports the same value the barrel declares", () => {
    expect(barrel.DEFAULT_REGISTRY).toBe(DEFAULT_REGISTRY);
  });

  it("leaks no private component: the five modules under react/ stay unreachable by name", () => {
    for (const name of [...EXPECTED.map(([tag]) => tag), "token", "space", "mountStyle"]) {
      expect([name, Object.keys(barrel).includes(name)]).toEqual([name, false]);
    }
  });

  it("uses explicit named re-exports only — no export * anywhere in the barrel (D-12)", () => {
    expect(starExports("react.tsx")).toEqual([]);
  });

  it("keeps DEFAULT_REGISTRY off the root entry: the two entries do not overlap", () => {
    expect(Object.keys(rootBarrel)).not.toContain("DEFAULT_REGISTRY");
  });
});

describe("@facet/assets entry boundary — the root is React-free (RISK-PKG-1, D-09)", () => {
  it("reaches only the six Node-safe data modules from the root entry", () => {
    expect(reachableFrom("index.ts").modules).toEqual([
      "catalog.ts",
      "index.ts",
      "specs-content.ts",
      "specs-interactive.ts",
      "specs-layout.ts",
      "specs-surface.ts",
      "theme-default.ts",
    ]);
  });

  it("depends on @facet/core alone from the root entry — no react, no react-dom, no node:*", () => {
    expect(reachableFrom("index.ts").external).toEqual(["@facet/core"]);
  });

  it("reaches no .tsx module from the root entry", () => {
    expect(reachableFrom("index.ts").modules.filter((file) => file.endsWith(".tsx"))).toEqual([]);
  });
});

describe("@facet/assets/react entry boundary — @facet/core and react only (D-09, DC-029)", () => {
  it("reaches the barrel plus its five private modules, and no test fixture", () => {
    expect(reachableFrom("react.tsx").modules).toEqual([
      "react.tsx",
      "react/content.tsx",
      "react/interactive.tsx",
      "react/layout.tsx",
      "react/style.ts",
      "react/surface.tsx",
    ]);
  });

  it("imports exactly @facet/core and react, and nothing else at all", () => {
    expect(reachableFrom("react.tsx").external).toEqual(["@facet/core", "react"]);
  });

  it("imports @facet/react nowhere, though two modules name it in prose (D-09)", () => {
    // The edge runs assets → core, never assets → renderer; naming the renderer
    // in a doc comment is not importing it, which is why this reads parsed
    // imports and not source text.
    expect(reachableFrom("react.tsx").external).not.toContain("@facet/react");
  });

  it("reaches no module the root entry also reaches: the two graphs share nothing", () => {
    const root = new Set(reachableFrom("index.ts").modules);
    expect(reachableFrom("react.tsx").modules.filter((file) => root.has(file))).toEqual([]);
  });

  it("names only this package's own private modules — no deep import of another package", () => {
    const specifiers = moduleSpecifiers("react.tsx").filter((one) => one.startsWith("."));
    expect([...new Set(specifiers)].sort()).toEqual([
      "./react/content.js",
      "./react/interactive.js",
      "./react/layout.js",
      "./react/surface.js",
    ]);
  });
});

describe("react.tsx — source hygiene", () => {
  it("carries no NUL byte", () => {
    for (const file of ["react.tsx", "react.test.tsx"]) {
      expect([file, readFileSync(join(SRC_DIR, file)).indexOf(0)]).toEqual([file, -1]);
    }
  });
});
