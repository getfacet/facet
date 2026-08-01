// @vitest-environment jsdom
/**
 * The proof that navigation is browser view-state and nothing else.
 *
 * `nav:` is the one action that changes what the visitor sees without the agent
 * being involved, which makes it the place a second document writer would most
 * plausibly appear. Three claims close that off.
 *
 * **Navigation writes nothing.** The document and the data model are observed
 * for writes across a valid navigation, a refused one, an agent reference and a
 * re-render; a patch is a write, so zero writes is zero patches (DC-018). The
 * module's own import list is asserted too — nothing that could build or apply
 * a patch is even in scope here.
 *
 * **Only the two schemes exist.** `local:toggle` is refused by name, an // component-hard-cut: allowed-negative
 * unscheme'd string is not an action, and an `agent:` reference is explicitly
 * *not* navigation — it is handed back for the caller to forward, never acted
 * on here (DC-024).
 *
 * **A corrupt target keeps the current valid screen.** A screen the document
 * does not declare, an entry that names nothing, and a re-authored document
 * that dropped the screen the visitor was on all resolve to a screen that
 * exists, never to a blank stage.
 */

import type { ComponentDocument, ComponentNode } from "@facet/core";
import { parseAction } from "@facet/core";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  entryScreen,
  listScreens,
  resolveNavigation,
  resolveScreen,
  useScreenView,
} from "./nav.js";
import type { ScreenNavigation } from "./nav.js";

afterEach(cleanup);

function screen(name: string, children: readonly string[] = []): ComponentNode {
  return { tag: "Screen", props: { name: { kind: "scalar", value: name } }, children };
}

/** A three-screen document, entering on the second so entry is not "the first". */
const DOC: ComponentDocument = {
  entry: "details",
  screens: ["n1", "n2", "n3"],
  nodes: {
    n1: screen("overview"),
    n2: screen("details"),
    n3: screen("pricing"),
  },
};

/**
 * One way core's reader and the renderer's mountable index disagree.
 *
 * `coreAccepts` records what `parseAction` answers, because the class is only
 * interesting where the two differ, and stating core's answer in the table keeps
 * the assertions from quietly agreeing with whatever core does today.
 */
interface Mismatch {
  readonly label: string;
  readonly document: ComponentDocument;
  readonly coreAccepts: boolean;
}

/** A document whose `nodes` map is an array carrying string keys. */
function nodesAsArray(): ComponentDocument {
  const nodes: unknown[] = [];
  (nodes as unknown as Record<string, unknown>)["n1"] = screen("overview");
  return { entry: "overview", screens: ["n1"], nodes } as unknown as ComponentDocument;
}

/** A document whose screen node carries its props as an array. */
function propsAsArray(): ComponentDocument {
  const props: unknown[] = [];
  (props as unknown as Record<string, unknown>)["name"] = { kind: "scalar", value: "overview" };
  return {
    entry: "overview",
    screens: ["n1"],
    nodes: { n1: { tag: "Screen", props, children: [] } },
  } as unknown as ComponentDocument;
}

/** A document whose screen node inherits its `name` prop from a prototype. */
function inheritedName(): ComponentDocument {
  const props = Object.create({ name: { kind: "scalar", value: "overview" } }) as object;
  return {
    entry: "overview",
    screens: ["n1"],
    nodes: { n1: { tag: "Screen", props, children: [] } },
  } as unknown as ComponentDocument;
}

/** A document that inherits one of its own envelope keys from a prototype. */
function inheritedKey(key: "screens" | "nodes"): ComponentDocument {
  const inheritedPart =
    key === "screens" ? { screens: ["n1"] } : { nodes: { n1: screen("overview") } };
  const ownPart: Record<string, unknown> =
    key === "screens"
      ? { entry: "overview", nodes: { n1: screen("overview") } }
      : { entry: "overview", screens: ["n1"] };
  const document = Object.create(inheritedPart) as Record<string, unknown>;
  for (const [name, value] of Object.entries(ownPart)) {
    document[name] = value;
  }
  return document as unknown as ComponentDocument;
}

/** A document whose `screens` getter throws, which makes core reject every reference. */
function throwingEnvelope(): ComponentDocument {
  const document: Record<string, unknown> = {
    entry: "overview",
    nodes: { n1: screen("overview") },
  };
  Object.defineProperty(document, "screens", {
    enumerable: true,
    get(): never {
      throw new Error("hostile envelope");
    },
  });
  return document as unknown as ComponentDocument;
}

/**
 * The six executed classes. Five run the unsafe direction — core accepts while
 * the renderer's index is empty — and the sixth is core's own hostile-getter
 * behaviour, which is recorded here rather than chased (it is a WU-42
 * adversarial constraint, not this module's to change).
 */
const MISMATCH_CLASSES: readonly Mismatch[] = [
  { label: "screens inherited", document: inheritedKey("screens"), coreAccepts: true },
  { label: "nodes inherited", document: inheritedKey("nodes"), coreAccepts: true },
  { label: "nodes as array", document: nodesAsArray(), coreAccepts: true },
  { label: "props as array", document: propsAsArray(), coreAccepts: true },
  { label: "name inherited", document: inheritedName(), coreAccepts: true },
  { label: "throwing envelope getter", document: throwingEnvelope(), coreAccepts: false },
];

/** Every write attempted against a value or anything reachable from it. */
interface Observation {
  readonly value: unknown;
  readonly writes: readonly string[];
}

/**
 * Wraps `value` in a recursive Proxy that records every attempted write. A
 * patch is a write to the document, so this is the patch observer: nothing that
 * navigates through it can have applied one without being recorded.
 */
function observed(value: unknown): Observation {
  const writes: string[] = [];
  const wrap = (target: unknown, path: string): unknown => {
    if (typeof target !== "object" || target === null) {
      return target;
    }
    return new Proxy(target as Record<string, unknown>, {
      get(holder, key, receiver): unknown {
        const read: unknown = Reflect.get(holder, key, receiver);
        return typeof key === "string" ? wrap(read, path === "" ? key : `${path}.${key}`) : read;
      },
      set(_holder, key): boolean {
        writes.push(`set ${path}.${String(key)}`);
        return true;
      },
      defineProperty(_holder, key): boolean {
        writes.push(`define ${path}.${String(key)}`);
        return true;
      },
      deleteProperty(_holder, key): boolean {
        writes.push(`delete ${path}.${String(key)}`);
        return true;
      },
    });
  };
  return { value: wrap(value, ""), writes };
}

/** Mounts the view-state hook over one document, ready to be re-authored. */
function mountNav(
  document: ComponentDocument,
): ReturnType<
  typeof renderHook<ReturnType<typeof useScreenView>, { readonly document: ComponentDocument }>
> {
  return renderHook(
    (props: { readonly document: ComponentDocument }) => useScreenView(props.document),
    {
      initialProps: { document },
    },
  );
}

describe("the declared screens are read from the document", () => {
  it("lists every declared screen in document order", () => {
    expect(listScreens(DOC)).toEqual([
      { name: "overview", nodeId: "n1" },
      { name: "details", nodeId: "n2" },
      { name: "pricing", nodeId: "n3" },
    ]);
  });

  it("resolves the entry screen the document names", () => {
    expect(entryScreen(DOC)).toEqual({ name: "details", nodeId: "n2" });
  });

  it("resolves one screen by name, and nothing for a name it does not declare", () => {
    expect(resolveScreen(DOC, "pricing")).toEqual({ name: "pricing", nodeId: "n3" });
    expect(resolveScreen(DOC, "missing")).toBeNull();
  });

  it("skips a screen entry a corrupt document cannot back with a named node", () => {
    const corrupt: ComponentDocument = {
      entry: "overview",
      screens: ["n1", "n404", "n3"],
      nodes: { n1: screen("overview"), n3: { tag: "Screen", props: {}, children: [] } },
    };

    expect(listScreens(corrupt)).toEqual([{ name: "overview", nodeId: "n1" }]);
  });

  it("stays total over a document of any shape", () => {
    const garbage: readonly unknown[] = [undefined, null, 0, "", [], { screens: 1 }, new Map()];

    for (const input of garbage) {
      expect(listScreens(input as ComponentDocument)).toEqual([]);
      expect(entryScreen(input as ComponentDocument)).toBeNull();
      expect(resolveScreen(input as ComponentDocument, "details")).toBeNull();
    }
  });

  it("treats hostile screen arrays as an empty screen list", () => {
    const revoked = Proxy.revocable<string[]>([], {});
    revoked.revoke();
    const hostileIterator = ["n1"];
    Object.defineProperty(hostileIterator, Symbol.iterator, {
      value: (): never => {
        throw new Error("hostile iterator");
      },
    });

    expect(() =>
      listScreens({ entry: "overview", screens: revoked.proxy, nodes: { n1: screen("overview") } }),
    ).not.toThrow();
    expect(
      listScreens({
        entry: "overview",
        screens: hostileIterator,
        nodes: { n1: screen("overview") },
      }),
    ).toEqual([{ name: "overview", nodeId: "n1" }]);
  });

  it("falls back to the first declared screen when the entry names nothing", () => {
    const stray: ComponentDocument = { ...DOC, entry: "gone" };

    expect(entryScreen(stray)).toEqual({ name: "overview", nodeId: "n1" });
  });
});

describe("only nav: navigates", () => {
  it("resolves a declared screen", () => {
    expect(resolveNavigation("nav:pricing", DOC)).toEqual({
      ok: true,
      screen: { name: "pricing", nodeId: "n3" },
    });
  });

  it("refuses a screen the document does not declare", () => {
    expect(resolveNavigation("nav:checkout", DOC)).toEqual({ ok: false, reason: "unknown_screen" });
  });

  it("refuses the browser-local scheme by name", () => {
    expect(resolveNavigation(["local", ":toggle"].join(""), DOC)).toEqual({
      ok: false,
      reason: "unknown_scheme",
    });
  });

  it("hands an agent reference back rather than acting on it", () => {
    expect(resolveNavigation("agent:refresh", DOC)).toEqual({
      ok: false,
      reason: "not_a_navigation",
    });
  });

  it("refuses a target that is not a Facet identifier", () => {
    expect(resolveNavigation("nav:", DOC)).toEqual({ ok: false, reason: "invalid_target" });
    expect(resolveNavigation("nav:not an id", DOC)).toEqual({
      ok: false,
      reason: "invalid_target",
    });
    expect(resolveNavigation("nav:a.b", DOC)).toEqual({ ok: false, reason: "invalid_target" });
  });

  it("refuses anything that is not an action reference at all", () => {
    const garbage: readonly unknown[] = [undefined, null, 42, "details", "", ":x", {}, []];

    for (const input of garbage) {
      const outcome = resolveNavigation(input, DOC);
      expect(outcome.ok).toBe(false);
    }
  });

  it("refuses a data reference, which addresses the model and not a screen", () => {
    expect(resolveNavigation("data:sales.total", DOC)).toEqual({
      ok: false,
      reason: "unknown_scheme",
    });
  });

  it("refuses a navigation core accepts but no mountable node in the document backs", () => {
    // The two readers of "is this a declared screen" are deliberately not
    // identical. `parseAction` reads the name through anything object-shaped,
    // an array carrying a `name` property included; the renderer needs a node
    // to *mount*, so it reads the narrower plain-record rule. Where they
    // disagree the answer has to be a rejection — navigating to a screen with
    // no resolvable root would blank the stage, which is the one outcome the
    // corrupt-target rule exists to prevent. This fixture is that disagreement,
    // made concrete rather than assumed unreachable.
    const arrayProps: unknown[] = [];
    (arrayProps as unknown as Record<string, unknown>)["name"] = {
      kind: "scalar",
      value: "ghost",
    };
    const disagreeing = {
      entry: "overview",
      screens: ["n1", "n9"],
      nodes: { n1: screen("overview"), n9: { tag: "Screen", props: arrayProps, children: [] } },
    } as unknown as ComponentDocument;

    expect(parseAction("nav:ghost", disagreeing).ok).toBe(true);
    expect(resolveNavigation("nav:ghost", disagreeing)).toEqual({
      ok: false,
      reason: "unknown_screen",
    });
  });

  it("pins every executed class in which core and the mountable index disagree", () => {
    // Six classes, executed. Five run the **unsafe** direction — core reports
    // the screen exists and the renderer can derive no node for it — and the
    // sixth is core's own hostile-getter behaviour, pinned as an observation
    // rather than chased. The disagreement is permanent by design: the renderer
    // needs a node to *mount*, so it reads own properties of plain records
    // only, and widening it to match core would mean reading through a
    // prototype. What this table fixes is that every class stays **coherent** —
    // the index is empty and navigation is refused, never one without the
    // other, and never a screen whose root cannot be mounted.
    for (const mismatch of MISMATCH_CLASSES) {
      const label = mismatch.label;
      expect([label, parseAction("nav:overview", mismatch.document).ok]).toEqual([
        label,
        mismatch.coreAccepts,
      ]);
      expect([label, listScreens(mismatch.document)]).toEqual([label, []]);
      expect([label, entryScreen(mismatch.document)]).toEqual([label, null]);
      expect([label, resolveNavigation("nav:overview", mismatch.document)]).toEqual([
        label,
        { ok: false, reason: mismatch.coreAccepts ? "unknown_screen" : "not_an_action" },
      ]);
    }
  });

  it("mounts an empty stage for a document with no mountable screen, and navigates nowhere", () => {
    // With nothing ever shown there is no valid screen to preserve, so the
    // empty stage is the honest outcome — but it must be *coherent*: nothing
    // mounts and nothing navigates.
    for (const mismatch of MISMATCH_CLASSES) {
      const { result } = mountNav(mismatch.document);
      expect([mismatch.label, result.current.current]).toEqual([mismatch.label, null]);
      act(() => {
        result.current.navigate("nav:overview");
      });
      expect([mismatch.label, result.current.current]).toEqual([mismatch.label, null]);
      cleanup();
    }
  });

  it("refuses every screen when the document itself is unusable", () => {
    expect(resolveNavigation("nav:details", null as unknown as ComponentDocument)).toEqual({
      ok: false,
      reason: "unknown_screen",
    });
  });
});

describe("the screen the visitor is on is browser view-state", () => {
  it("starts on the entry screen", () => {
    const { result } = mountNav(DOC);

    expect(result.current.current).toEqual({ name: "details", nodeId: "n2" });
  });

  it("moves to a declared screen and stays there", () => {
    const { result } = mountNav(DOC);

    act(() => {
      result.current.navigate("nav:pricing");
    });

    expect(result.current.current).toEqual({ name: "pricing", nodeId: "n3" });
  });

  it("keeps the current valid screen when the target is corrupt", () => {
    const { result } = mountNav(DOC);
    act(() => {
      result.current.navigate("nav:overview");
    });

    for (const inert of [
      "nav:checkout",
      ["local", ":toggle"].join(""),
      "agent:refresh",
      "overview",
      null,
    ]) {
      act(() => {
        result.current.navigate(inert);
      });
      expect(result.current.current).toEqual({ name: "overview", nodeId: "n1" });
    }
  });

  it("reports why a refused navigation was refused", () => {
    const { result } = mountNav(DOC);
    let refused: ReturnType<typeof resolveNavigation> | null = null;

    act(() => {
      refused = result.current.navigate("nav:checkout");
    });

    expect(refused).toEqual({ ok: false, reason: "unknown_screen" });
  });

  it("keeps the visitor where they are when a re-authored document still declares it", () => {
    const { result, rerender } = mountNav(DOC);
    act(() => {
      result.current.navigate("nav:pricing");
    });

    rerender({
      document: {
        entry: "overview",
        screens: ["a1", "a2"],
        nodes: { a1: screen("overview"), a2: screen("pricing") },
      },
    });

    expect(result.current.current).toEqual({ name: "pricing", nodeId: "a2" });
  });

  it("falls back to the new entry when the re-authored document dropped that screen", () => {
    const { result, rerender } = mountNav(DOC);
    act(() => {
      result.current.navigate("nav:pricing");
    });

    rerender({
      document: { entry: "overview", screens: ["a1"], nodes: { a1: screen("overview") } },
    });

    expect(result.current.current).toEqual({ name: "overview", nodeId: "a1" });
  });

  it("drops a request the document dropped, so it cannot resurrect later", () => {
    // A request that outlives the document declaring it is a stale intent. If
    // it were merely dormant, a third document that happens to re-declare the
    // name would move the visitor with no interaction at all — minutes later,
    // in the middle of something else. Falling back clears the request.
    const { result, rerender } = mountNav(DOC);
    act(() => {
      result.current.navigate("nav:pricing");
    });

    rerender({
      document: { entry: "overview", screens: ["a1"], nodes: { a1: screen("overview") } },
    });
    expect(result.current.current).toEqual({ name: "overview", nodeId: "a1" });

    rerender({
      document: {
        entry: "overview",
        screens: ["b1", "b2"],
        nodes: { b1: screen("overview"), b2: screen("pricing") },
      },
    });

    expect(result.current.current).toEqual({ name: "overview", nodeId: "b1" });
  });

  it("never transitions a shown screen to a blank stage, in any mismatch class", () => {
    // The rule the six classes exist to enforce. Once a valid screen has been
    // shown, a document the renderer cannot index must not blank the stage:
    // core still reports screens, so "no screens" is a disagreement, not a fact
    // about the page. The visitor keeps looking at the last screen that was
    // real rather than at nothing.
    for (const mismatch of MISMATCH_CLASSES) {
      const { result, rerender } = mountNav(DOC);
      act(() => {
        result.current.navigate("nav:pricing");
      });
      expect(result.current.current).toEqual({ name: "pricing", nodeId: "n3" });

      rerender({ document: mismatch.document });

      expect([mismatch.label, result.current.current]).toEqual([
        mismatch.label,
        { name: "pricing", nodeId: "n3" },
      ]);
      cleanup();
    }
  });

  it("preserves the current screen when a re-authored document declares none at all", () => {
    const { result, rerender } = mountNav(DOC);
    act(() => {
      result.current.navigate("nav:overview");
    });

    rerender({ document: { entry: "gone", screens: [], nodes: {} } });

    expect(result.current.current).toEqual({ name: "overview", nodeId: "n1" });
  });

  it("keeps navigation refused while the preserved screen stays on show", () => {
    const { result, rerender } = mountNav(DOC);
    act(() => {
      result.current.navigate("nav:pricing");
    });
    rerender({ document: nodesAsArray() });

    let outcome: ReturnType<typeof resolveNavigation> | null = null;
    act(() => {
      outcome = result.current.navigate("nav:overview");
    });

    expect(outcome).toEqual({ ok: false, reason: "unknown_screen" });
    expect(result.current.current).toEqual({ name: "pricing", nodeId: "n3" });
  });

  it("shows the recovered screen on the very first render, with no stale frame", () => {
    // `result.current` after `act` cannot see this: React collapses the render
    // in which state settles, so a preserved screen that *latched* — winning
    // over a document that can be indexed — looks identical once the dust
    // settles, while in a browser it paints one frame of the wrong screen.
    // Tracing every render is what separates "floor" from "latch".
    const trace: string[] = [];
    let api: ScreenNavigation | null = null;
    function Trace(props: { readonly document: ComponentDocument }): ReactNode {
      const navigation = useScreenView(props.document);
      api = navigation;
      trace.push(navigation.current === null ? "(blank)" : navigation.current.name);
      return null;
    }

    const { rerender } = render(createElement(Trace, { document: DOC }));
    act(() => {
      api?.navigate("nav:pricing");
    });
    rerender(createElement(Trace, { document: nodesAsArray() }));
    const beforeRecovery = trace.length;
    rerender(
      createElement(Trace, {
        document: { entry: "overview", screens: ["z1"], nodes: { z1: screen("overview") } },
      }),
    );

    // Every render under the recovered document names the recovered screen —
    // "pricing" does not appear once, not even for a frame.
    expect(trace.slice(beforeRecovery)).not.toContain("pricing");
    expect(trace.slice(beforeRecovery).at(-1)).toBe("overview");
    expect(trace.slice(beforeRecovery).every((name) => name === "overview")).toBe(true);
  });

  it("returns to the document's own screens as soon as one can be indexed again", () => {
    // Preservation is a floor, not a latch: a readable document takes over.
    const { result, rerender } = mountNav(DOC);
    act(() => {
      result.current.navigate("nav:pricing");
    });
    rerender({ document: nodesAsArray() });
    expect(result.current.current).toEqual({ name: "pricing", nodeId: "n3" });

    rerender({
      document: { entry: "overview", screens: ["z1"], nodes: { z1: screen("overview") } },
    });

    expect(result.current.current).toEqual({ name: "overview", nodeId: "z1" });
  });

  it("reports no screen at all for a document that declares none", () => {
    const { result } = mountNav({ entry: "x", screens: [], nodes: {} });

    expect(result.current.current).toBeNull();
  });
});

describe("navigation emits no patch", () => {
  it("writes nothing to the document across navigation and refused interaction", () => {
    const watched = observed(DOC);
    const before = JSON.stringify(DOC);
    const { result, rerender } = mountNav(watched.value as ComponentDocument);

    act(() => {
      result.current.navigate("nav:pricing");
    });
    act(() => {
      result.current.navigate("nav:checkout");
    });
    act(() => {
      result.current.navigate("agent:refresh");
    });
    rerender({ document: watched.value as ComponentDocument });

    expect(watched.writes).toEqual([]);
    expect(JSON.stringify(DOC)).toBe(before);
    expect(result.current.current).toEqual({ name: "pricing", nodeId: "n3" });
  });

  it("has nothing in scope that could build or apply one", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "nav.ts"), "utf8");
    const code = stripComments(source);

    expect(importedFrom(code)).toEqual(["./safe-read.js", "@facet/core", "react"]);
    for (const forbidden of ["applyPatch", "JsonPatchOperation", "PatchFrame", "op:", '"add"']) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("counts every import form, so the ban cannot be read as stronger than it is", () => {
    // A ban that only matches `from "…"` is a ban with two doors left open: a
    // side-effect import and a dynamic one both bring a module into scope
    // without the keyword. This pins the reader itself against a synthetic
    // source, so the assertion above means what it says.
    const synthetic = [
      'import { a } from "static-form";',
      'import "side-effect-form";',
      'const later = await import("dynamic-form");',
      "export * from './single-quoted-form.js';",
      "void later;",
    ].join("\n");

    expect(importedFrom(synthetic)).toEqual([
      "./single-quoted-form.js",
      "dynamic-form",
      "side-effect-form",
      "static-form",
    ]);
  });
});

/**
 * Removes line and block comments, so a source-text assertion cannot be
 * satisfied — or defeated — by prose. String literals are preserved, since the
 * import specifiers being asserted live in them.
 */
function stripComments(source: string): string {
  let out = "";
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (quote !== null) {
      out += char;
      if (char === "\\") {
        out += next;
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Every module specifier the source brings into scope, sorted and de-duplicated.
 *
 * All four forms count, and both quote styles. A reader that matched only
 * `from "…"` would leave two doors open — a side-effect `import "x"` and a
 * dynamic `import("x")` each load a module without the keyword — which would
 * make the import ban above read as stronger than it actually is.
 */
function importedFrom(code: string): readonly string[] {
  const specifiers = new Set<string>();
  const forms = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ];
  for (const form of forms) {
    for (const match of code.matchAll(form)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.add(specifier);
      }
    }
  }
  return [...specifiers].sort();
}
