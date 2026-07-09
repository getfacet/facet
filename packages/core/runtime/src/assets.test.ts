import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyPatch,
  EMPTY_TREE,
  validateTree,
  type FacetComponentDefinition,
  type FacetCatalog,
  type FacetAgent,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { DEFAULT_CATALOG, DEFAULT_STAMPS, DEFAULT_THEME } from "@facet/assets";
import {
  isSeedableTree,
  loadAssets,
  MemoryAssets,
  withInitialStage,
  type AssetDocuments,
  type AssetsStore,
} from "./assets.js";
import { FileAssets } from "./file-assets.js";
import { MemoryStageStore, type StageStore } from "./stage-store.js";
import { FacetRuntime } from "./runtime.js";

// --- Fixtures shared by both references ---------------------------------------

/** A clean partial theme document (Decision 1). */
const validTheme = {
  name: "midnight",
  description: "a dark theme",
  color: { bg: "#111111", fg: "#eeeeee" },
};
/** A `url(` value ⇒ `validateTheme` refuses it (no theme, error issue). */
const invalidTheme = { name: "hostile", color: { bg: "url(http://evil)" } };

/** A legal fragment: a box root with one text child. */
const validStamp = {
  name: "cta",
  description: "a call to action",
  root: "s-root",
  nodes: {
    "s-root": { id: "s-root", type: "box", children: ["s-label"] },
    "s-label": { id: "s-label", type: "text", value: "Go" },
  },
};
/** Root does not resolve ⇒ `validateStamp` refuses it. */
const invalidStamp = {
  name: "broken",
  root: "does-not-exist",
  nodes: { x: { id: "x", type: "text", value: "orphan" } },
};

const validComponentDefinition = {
  name: "customerSummaryCard",
  description: "Reusable customer summary",
  root: "card",
  nodes: {
    card: {
      id: "card",
      type: "card",
      title: "{{customer}}",
      children: ["metric", "action"],
    },
    metric: { id: "metric", type: "metric", label: "ARR", value: "{{arr}}" },
    action: {
      id: "action",
      type: "button",
      label: "Open customer",
      onPress: { name: "open_customer", payload: { id: "acme" } },
    },
  },
};

const compactComponentDefinition = {
  name: "compactSummary",
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["copy"] },
    copy: { id: "copy", type: "text", value: "Summary" },
  },
};

const invalidComponentDefinition = {
  name: "unsafeSummary",
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "card",
      children: [],
      html: "<script>alert(1)</script>",
    },
  },
};

/** A seedable initial tree: a root box with ≥ 1 child. */
const seedTree: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["h"] },
    h: { id: "h", type: "text", value: "Welcome" },
  },
};

const visitor: VisitorContext = { visitorId: "v" };

// Temp dirs created by the FileAssets fixtures, removed after the suite.
const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "facet-assets-"));
  tempDirs.push(dir);
  return dir;
}

// --- Shared contract, run against MemoryAssets AND FileAssets -----------------

function fileMake(docs: AssetDocuments): AssetsStore {
  const dir = makeTempDir();
  docs.themes.forEach((t, i) => writeFileSync(join(dir, `t${i}.theme.json`), JSON.stringify(t)));
  docs.stamps.forEach((s, i) => writeFileSync(join(dir, `s${i}.stamp.json`), JSON.stringify(s)));
  docs.componentDefinitions?.forEach((component, i) =>
    writeFileSync(join(dir, `c${i}.component.json`), JSON.stringify(component)),
  );
  if (docs.catalog !== undefined) {
    writeFileSync(join(dir, "catalog.json"), JSON.stringify(docs.catalog));
  }
  if (docs.initialTree !== undefined) {
    writeFileSync(join(dir, "initial.tree.json"), JSON.stringify(docs.initialTree));
  }
  return new FileAssets(dir);
}

function contract(name: string, make: (docs: AssetDocuments) => AssetsStore): void {
  describe(name, () => {
    it("round-trips valid themes, stamps, and a seedable initial tree (atop the defaults)", async () => {
      const store = make({ themes: [validTheme], stamps: [validStamp], initialTree: seedTree });
      const loaded = await loadAssets(store, "agent");
      // The custom docs coexist with the seeded default base layer.
      expect(loaded.themes.map((t) => t.name)).toContain("midnight");
      expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
      expect(loaded.stamps.map((s) => s.name)).toContain("cta");
      for (const s of DEFAULT_STAMPS) expect(loaded.stamps.map((x) => x.name)).toContain(s.name);
      expect(loaded.initialTree).toBeDefined();
      expect(loaded.initialTree && isSeedableTree(loaded.initialTree)).toBe(true);
    });

    it("skips invalid documents with issues and keeps valid ones (plus the defaults)", async () => {
      const store = make({
        themes: [validTheme, invalidTheme],
        stamps: [validStamp, invalidStamp],
        componentDefinitions: [validComponentDefinition, invalidComponentDefinition],
        initialTree: seedTree,
      });
      const loaded = await loadAssets(store, "agent");
      expect(loaded.themes.map((t) => t.name)).toContain("midnight");
      expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
      expect(loaded.themes.map((t) => t.name)).not.toContain("hostile");
      expect(loaded.stamps.map((s) => s.name)).toContain("cta");
      expect(loaded.stamps.map((s) => s.name)).not.toContain("broken");
      expect(loaded.componentDefinitions.map((definition) => definition.name)).toContain(
        "customerSummaryCard",
      );
      expect(loaded.componentDefinitions.map((definition) => definition.name)).not.toContain(
        "unsafeSummary",
      );
      for (const s of DEFAULT_STAMPS) expect(loaded.stamps.map((x) => x.name)).toContain(s.name);
      expect(loaded.issues.length).toBeGreaterThan(0);
    });

    it("loads validated component definitions without adding them to stamps", async () => {
      const store = make({
        themes: [],
        stamps: [],
        componentDefinitions: [validComponentDefinition],
      });
      const loaded = await loadAssets(store, "agent");
      const definitions: readonly FacetComponentDefinition[] = loaded.componentDefinitions;

      expect(definitions.map((definition) => definition.name)).toEqual(["customerSummaryCard"]);
      expect(definitions[0]?.nodes["action"]).toMatchObject({
        type: "button",
        onPress: { kind: "agent", name: "open_customer", payload: { id: "acme" } },
      });
      expect(loaded.stamps.map((stamp) => stamp.name)).not.toContain("customerSummaryCard");
    });

    it("refuses a garbage initial tree (the EMPTY_TREE trap) with no seed + an issue", async () => {
      const store = make({ themes: [], stamps: [], initialTree: { not: "a tree" } });
      const loaded = await loadAssets(store, "agent");
      expect(loaded.initialTree).toBeUndefined();
      expect(loaded.issues.length).toBeGreaterThan(0);
    });
  });
}

contract("MemoryAssets", (docs) => new MemoryAssets(docs));
contract("FileAssets", fileMake);

// --- loadAssets specifics -----------------------------------------------------

describe("loadAssets", () => {
  it("catalog defaults to the bundled catalog when no custom catalog is supplied", async () => {
    const loaded = await loadAssets(new MemoryAssets({ themes: [], stamps: [] }), "a");

    expect(loaded.catalog).toEqual(DEFAULT_CATALOG);
    expect(loaded.catalog.theme.switchPolicy).toBe("locked");
  });

  it("catalog loads from memory and file assets with fail-soft validation", async () => {
    const custom: FacetCatalog = {
      name: "custom",
      theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
      bricks: [{ type: "section", variants: ["surface"] }],
      stamps: { mode: "allow", names: ["dashboard-summary"] },
      primitiveFallback: "discouraged",
      policy: {
        order: ["stamp", "brick", "primitive"],
        editBeforeAppend: true,
        compactScreens: true,
        maxScreenSections: 4,
      },
    };

    for (const make of [(docs: AssetDocuments) => new MemoryAssets(docs), fileMake]) {
      const loaded = await loadAssets(make({ themes: [], stamps: [], catalog: custom }), "a");
      expect(loaded.catalog.name).toBe("custom");
      expect(loaded.catalog.stamps).toEqual({ mode: "allow", names: ["dashboard-summary"] });
      expect(loaded.catalog.policy.maxScreenSections).toBe(4);
    }
  });

  it("malformed catalog falls back to the bundled catalog with issues", async () => {
    const loaded = await loadAssets(
      new MemoryAssets({
        themes: [],
        stamps: [],
        catalog: {
          name: "bad name",
          theme: { switchPolicy: "sometimes" },
          bricks: [{ type: "script" }],
        },
      }),
      "a",
    );

    expect(loaded.catalog.name).toBe(DEFAULT_CATALOG.name);
    expect(loaded.catalog.bricks).toEqual(DEFAULT_CATALOG.bricks);
    expect(loaded.issues.some((issue) => issue.includes("catalog"))).toBe(true);
  });

  it("null or incomplete catalog documents fall back to the bundled catalog", async () => {
    for (const catalog of [null, {}]) {
      const loaded = await loadAssets(
        new MemoryAssets({ themes: [], stamps: [], catalog } as unknown as AssetDocuments),
        "a",
      );

      expect(loaded.catalog).toEqual(DEFAULT_CATALOG);
      expect(loaded.catalog.description).toBe(DEFAULT_CATALOG.description);
      expect(loaded.catalog.bricks).toEqual(DEFAULT_CATALOG.bricks);
      expect(loaded.issues.some((issue) => issue.includes("bundled default catalog"))).toBe(true);
    }
  });

  it("seeds the default base layer", async () => {
    // DC-001: an empty/absent operator store still resolves the bundled defaults —
    // the default theme document plus the whole default stamp library.
    const loaded = await loadAssets(new MemoryAssets({ themes: [], stamps: [] }), "a");
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    const stampNames = loaded.stamps.map((s) => s.name);
    for (const s of DEFAULT_STAMPS) expect(stampNames).toContain(s.name);
  });

  it("never throws when the store's load() rejects — defaults still resolve (P3 hardening)", async () => {
    // The "Never throws" contract covers the primary I/O too: a pluggable adapter
    // (a DB/proxy store) that rejects must degrade to the defaults, not crash boot.
    const throwingStore: AssetsStore = { load: () => Promise.reject(new Error("db down")) };
    let loaded: Awaited<ReturnType<typeof loadAssets>> | undefined;
    await expect(
      (async () => {
        loaded = await loadAssets(throwingStore, "a");
      })(),
    ).resolves.toBeUndefined();
    expect(loaded?.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    const okStamps = loaded?.stamps.map((s) => s.name) ?? [];
    for (const s of DEFAULT_STAMPS) expect(okStamps).toContain(s.name);
    expect(loaded?.issues.some((i) => i.includes("assets load failed"))).toBe(true);
  });

  it("never throws when the store rejects with an unstringifiable reason", async () => {
    const throwingStore: AssetsStore = {
      load: () =>
        Promise.reject({
          toString() {
            throw new Error("stringify boom");
          },
        }),
    };
    const loaded = await loadAssets(throwingStore, "a");
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    expect(loaded.issues.some((i) => i.includes("non-error rejection"))).toBe(true);
  });

  it("never throws when the store resolves a non-object — defaults still resolve", async () => {
    const malformedStore: AssetsStore = {
      load: () => Promise.resolve(null as unknown as AssetDocuments),
    };
    const loaded = await loadAssets(malformedStore, "a");
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    const okStamps = loaded.stamps.map((s) => s.name);
    for (const s of DEFAULT_STAMPS) expect(okStamps).toContain(s.name);
    expect(loaded.issues.some((i) => i.includes("not an object"))).toBe(true);
  });

  it("never throws when asset document accessors throw — defaults still resolve", async () => {
    const hostileDocs = Object.defineProperties(
      {},
      {
        issues: {
          get() {
            throw new Error("issues boom");
          },
        },
        themes: {
          get() {
            throw new Error("themes boom");
          },
        },
        stamps: {
          get() {
            throw new Error("stamps boom");
          },
        },
        catalog: {
          get() {
            throw new Error("catalog boom");
          },
        },
        initialTree: {
          get() {
            throw new Error("initial boom");
          },
        },
      },
    );
    const hostileStore: AssetsStore = {
      load: () => Promise.resolve(hostileDocs as AssetDocuments),
    };
    const loaded = await loadAssets(hostileStore, "a");
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    const okStamps = loaded.stamps.map((s) => s.name);
    for (const s of DEFAULT_STAMPS) expect(okStamps).toContain(s.name);
    expect(loaded.issues.some((i) => i.includes("`issues` threw"))).toBe(true);
    expect(loaded.issues.some((i) => i.includes("`themes` threw"))).toBe(true);
    expect(loaded.issues.some((i) => i.includes("`stamps` threw"))).toBe(true);
    expect(loaded.issues.some((i) => i.includes("`catalog` threw"))).toBe(true);
    expect(loaded.issues.some((i) => i.includes("initial tree"))).toBe(true);
  });

  it("returns a fresh bundled catalog object for fallback loads", async () => {
    const first = await loadAssets(new MemoryAssets({ themes: [], stamps: [] }), "a");
    (first.catalog.theme.allowed as unknown as string[]).length = 0;
    (first.catalog.components as unknown as { length: number }).length = 0;
    (first.catalog.compositions as unknown as { mode: "allow"; names: string[] }).names = [
      "mutated",
    ];
    const mediaBrick = DEFAULT_CATALOG.bricks.find((brick) => brick.type === "media");
    const firstMediaBrick = first.catalog.bricks.find((brick) => brick.type === "media");
    (firstMediaBrick?.variants as unknown as string[] | undefined)?.splice(0);
    (first.catalog.bricks as { length: number }).length = 0;
    (first.catalog.policy.order as unknown as string[]).reverse();
    (first.catalog.policy.componentOrder as unknown as string[]).reverse();

    const second = await loadAssets(new MemoryAssets({ themes: [], stamps: [] }), "a");

    expect(second.catalog).toEqual(DEFAULT_CATALOG);
    expect(second.catalog.bricks).toHaveLength(DEFAULT_CATALOG.bricks.length);
    expect(second.catalog.components).toEqual(DEFAULT_CATALOG.components);
    expect(second.catalog.compositions).toEqual(DEFAULT_CATALOG.compositions);
    expect(second.catalog.theme.allowed).toEqual(DEFAULT_CATALOG.theme.allowed);
    expect(second.catalog.bricks.find((brick) => brick.type === "media")?.variants).toEqual(
      mediaBrick?.variants,
    );
    expect(second.catalog.policy.order).toEqual(["stamp", "brick", "primitive"]);
    expect(second.catalog.policy.componentOrder).toEqual([
      "composition",
      "component",
      "primitive",
    ]);
  });

  it("never calls store-supplied array methods while reading themes and stamps", async () => {
    const themes = new Proxy([validTheme], {
      get(target, prop, receiver) {
        if (prop === "map") throw new Error("themes map boom");
        return Reflect.get(target, prop, receiver);
      },
    });
    const stamps = new Proxy([validStamp], {
      get(target, prop, receiver) {
        if (prop === "map") throw new Error("stamps map boom");
        return Reflect.get(target, prop, receiver);
      },
    });
    const loaded = await loadAssets(
      new MemoryAssets({
        themes: themes as readonly unknown[],
        stamps: stamps as readonly unknown[],
      }),
      "a",
    );
    expect(loaded.themes.map((t) => t.name)).toContain("midnight");
    expect(loaded.stamps.map((s) => s.name)).toContain("cta");
  });

  it("never throws when asset arrays are revoked proxies — defaults still resolve", async () => {
    const themes = Proxy.revocable([], {});
    const stamps = Proxy.revocable([], {});
    const issues = Proxy.revocable([], {});
    themes.revoke();
    stamps.revoke();
    issues.revoke();
    const loaded = await loadAssets(
      new MemoryAssets({
        themes: themes.proxy as unknown as readonly unknown[],
        stamps: stamps.proxy as unknown as readonly unknown[],
        issues: issues.proxy as unknown as readonly string[],
      }),
      "a",
    );
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    const okStamps = loaded.stamps.map((s) => s.name);
    for (const s of DEFAULT_STAMPS) expect(okStamps).toContain(s.name);
    expect(loaded.issues.some((i) => i.includes("`issues` was not an array"))).toBe(true);
    expect(loaded.issues.some((i) => i.includes("`themes` was not an array"))).toBe(true);
    expect(loaded.issues.some((i) => i.includes("`stamps` was not an array"))).toBe(true);
  });

  it("never throws when asset array item accessors throw — readable docs still load", async () => {
    const themes = [validTheme, validTheme] as unknown[];
    Object.defineProperty(themes, "1", {
      get() {
        throw new Error("theme item boom");
      },
    });
    const stamps = [validStamp, validStamp] as unknown[];
    Object.defineProperty(stamps, "1", {
      get() {
        throw new Error("stamp item boom");
      },
    });

    const loaded = await loadAssets(
      new MemoryAssets({
        themes: themes as readonly unknown[],
        stamps: stamps as readonly unknown[],
      }),
      "a",
    );
    expect(loaded.themes.map((t) => t.name)).toContain("midnight");
    expect(loaded.stamps.map((s) => s.name)).toContain("cta");
    expect(loaded.issues.some((i) => i.includes("`themes` item 1 threw"))).toBe(true);
    expect(loaded.issues.some((i) => i.includes("`stamps` item 1 threw"))).toBe(true);
  });

  it("bounds and sanitizes backend issue strings before returning them", async () => {
    const rawIssues = Array.from({ length: 100 }, (_, i) =>
      i === 0 ? `\x1b[31m${"x".repeat(500)}` : `issue-${String(i)}`,
    );
    const loaded = await loadAssets(
      new MemoryAssets({ themes: [], stamps: [], issues: rawIssues }),
      "a",
    );
    expect(loaded.issues.length).toBeLessThanOrEqual(65);
    expect(loaded.issues.join("\n")).not.toContain("\x1b");
    expect(loaded.issues[0]?.length).toBeLessThanOrEqual(203);
    expect(loaded.issues).toContain("...further asset issues suppressed");
  });

  it("caps asset document arrays before validating custom themes and stamps", async () => {
    const hugeThemes = Array.from({ length: 1_100 }, (_, i) => ({ name: `theme_${String(i)}` }));
    const hugeStamps = Array.from({ length: 1_100 }, (_, i) => ({
      ...validStamp,
      name: `stamp_${String(i)}`,
    }));
    const hugeComponentDefinitions = Array.from({ length: 1_100 }, (_, i) => ({
      ...compactComponentDefinition,
      name: `component_${String(i)}`,
    }));
    const loaded = await loadAssets(
      new MemoryAssets({
        themes: hugeThemes,
        stamps: hugeStamps,
        componentDefinitions: hugeComponentDefinitions,
      }),
      "a",
    );
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    expect(loaded.themes.map((t) => t.name)).toContain("theme_1023");
    expect(loaded.themes.map((t) => t.name)).not.toContain("theme_1024");
    expect(loaded.stamps.map((s) => s.name)).toContain("stamp_1023");
    expect(loaded.stamps.map((s) => s.name)).not.toContain("stamp_1024");
    expect(loaded.componentDefinitions.map((definition) => definition.name)).toContain(
      "component_1023",
    );
    expect(loaded.componentDefinitions.map((definition) => definition.name)).not.toContain(
      "component_1024",
    );
    expect(loaded.issues.some((i) => i.includes("`themes` had 1100 item(s)"))).toBe(true);
    expect(loaded.issues.some((i) => i.includes("`stamps` had 1100 item(s)"))).toBe(true);
    expect(
      loaded.issues.some((i) => i.includes("`componentDefinitions` had 1100 item(s)")),
    ).toBe(true);
  });

  it("never throws when an initialTree accessor throws — defaults still resolve", async () => {
    const hostileStore: AssetsStore = {
      load: () =>
        Promise.resolve({
          themes: [],
          stamps: [],
          get initialTree(): unknown {
            throw new Error("initial boom");
          },
        } as AssetDocuments),
    };
    const loaded = await loadAssets(hostileStore, "a");
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    for (const s of DEFAULT_STAMPS) expect(loaded.stamps.map((x) => x.name)).toContain(s.name);
    expect(loaded.issues.some((i) => i.includes("initial tree"))).toBe(true);
  });

  it("never throws on a malformed store shape (non-array fields) — defaults survive (P3 hardening)", async () => {
    const malformedStore: AssetsStore = {
      load: () => Promise.resolve({ themes: null, stamps: undefined } as unknown as AssetDocuments),
    };
    const loaded = await loadAssets(malformedStore, "a");
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    const stampNames = loaded.stamps.map((s) => s.name);
    for (const s of DEFAULT_STAMPS) expect(stampNames).toContain(s.name);
    expect(loaded.issues.some((i) => i.includes("was not an array"))).toBe(true);
  });

  it("a custom stamp shadows a same-named default while other defaults survive (DC-003)", async () => {
    // A custom stamp named `hero` (a seeded default name) REPLACES the default in
    // the list — exactly one `hero`, and it is the custom one; the remaining
    // defaults and unrelated valid customs coexist.
    const customHero = {
      name: "hero",
      root: "r",
      nodes: {
        r: { id: "r", type: "box", children: ["mine"] },
        mine: { id: "mine", type: "text", value: "custom hero" },
      },
    };
    const loaded = await loadAssets(
      new MemoryAssets({ themes: [], stamps: [customHero, validStamp] }),
      "a",
    );
    const heroes = loaded.stamps.filter((s) => s.name === "hero");
    expect(heroes).toHaveLength(1);
    expect(heroes[0]?.nodes["mine"]).toBeDefined(); // the custom
    expect(heroes[0]?.nodes["hero.title"]).toBeUndefined(); // NOT the default
    // Other defaults + the unrelated valid custom coexist.
    expect(loaded.stamps.map((s) => s.name)).toContain("card");
    expect(loaded.stamps.map((s) => s.name)).toContain("cta-button");
    expect(loaded.stamps.map((s) => s.name)).toContain("cta");
    // A shadow issue is recorded.
    expect(loaded.issues.some((i) => i.includes("hero") && i.includes("shadow"))).toBe(true);
  });

  it("a custom theme named 'default' shadows the seeded default (DC-007)", async () => {
    // Symmetric with stamps: a custom theme named `default` naming only `color.bg`
    // REPLACES the seeded default document in the themes list (a load-time LIST
    // swap, NOT a field merge). The single `default` entry is the raw custom doc —
    // custom `bg`, and no `space` map (proof loadAssets did not merge; render's
    // `resolveTheme` stays the only merge site, overlaying it onto the floor).
    const customDefault = { name: "default", color: { bg: "#abcdef" } };
    const loaded = await loadAssets(new MemoryAssets({ themes: [customDefault], stamps: [] }), "a");
    const defaults = loaded.themes.filter((t) => t.name === "default");
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.color?.bg).toBe("#abcdef"); // the custom field
    expect(defaults[0]?.space).toBeUndefined(); // NOT merged with the default floor
    expect(loaded.issues.some((i) => i.includes("default") && i.includes("shadow"))).toBe(true);
  });

  it("drops a malformed doc among good ones while defaults survive, never throwing (DC-004)", async () => {
    let loaded: Awaited<ReturnType<typeof loadAssets>> | undefined;
    await expect(
      (async () => {
        loaded = await loadAssets(
          new MemoryAssets({
            themes: [invalidTheme, validTheme],
            stamps: [invalidStamp, validStamp],
          }),
          "a",
        );
      })(),
    ).resolves.toBeUndefined();
    // Defaults + the valid customs survive; the malformed docs are dropped.
    expect(loaded!.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    expect(loaded!.themes.map((t) => t.name)).toContain("midnight");
    expect(loaded!.themes.map((t) => t.name)).not.toContain("hostile");
    for (const s of DEFAULT_STAMPS) expect(loaded!.stamps.map((x) => x.name)).toContain(s.name);
    expect(loaded!.stamps.map((s) => s.name)).toContain("cta");
    expect(loaded!.stamps.map((s) => s.name)).not.toContain("broken");
    expect(loaded!.issues.length).toBeGreaterThan(0);
  });

  it("keeps the first of two same-named custom themes and logs an issue", async () => {
    // Custom-vs-custom (neither name is a seeded default) stays first-wins.
    const first = { name: "dup", color: { bg: "#000000" } };
    const second = { name: "dup", color: { bg: "#ffffff" } };
    const loaded = await loadAssets(new MemoryAssets({ themes: [first, second], stamps: [] }), "a");
    const dups = loaded.themes.filter((t) => t.name === "dup");
    expect(dups).toHaveLength(1);
    expect(dups[0]?.color?.bg).toBe("#000000"); // the first survived
    expect(loaded.issues.some((i) => i.includes("dup") && i.includes("first wins"))).toBe(true);
    // The seeded default base layer coexists.
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
  });

  it("keeps the first of two same-named custom stamps and logs an issue", async () => {
    // Two *.stamp.json can carry the same `name` (name is JSON content, not the
    // filename). The name `hero` is a seeded default: the FIRST custom shadows the
    // default, and the SECOND custom (now custom-vs-custom) is dropped first-wins.
    const first = {
      name: "hero",
      root: "r",
      nodes: {
        r: { id: "r", type: "box", children: ["a"] },
        a: { id: "a", type: "text", value: "first" },
      },
    };
    const second = {
      name: "hero",
      root: "r",
      nodes: {
        r: { id: "r", type: "box", children: ["b"] },
        b: { id: "b", type: "text", value: "second" },
      },
    };
    const loaded = await loadAssets(new MemoryAssets({ themes: [], stamps: [first, second] }), "a");
    const heroes = loaded.stamps.filter((s) => s.name === "hero");
    expect(heroes).toHaveLength(1);
    expect(heroes[0]?.nodes["a"]).toBeDefined(); // the first custom survived
    expect(
      loaded.issues.some((i) => i.includes("duplicate stamp name") && i.includes("hero")),
    ).toBe(true);
    // Unrelated defaults still coexist.
    expect(loaded.stamps.map((s) => s.name)).toContain("card");
  });

  it("merges componentDefinitions before compositions and keeps first duplicate definition", async () => {
    const first = {
      ...compactComponentDefinition,
      name: "summary",
      nodes: {
        root: { id: "root", type: "box", children: ["copy"] },
        copy: { id: "copy", type: "text", value: "first" },
      },
    };
    const duplicate = {
      ...compactComponentDefinition,
      name: "summary",
      nodes: {
        root: { id: "root", type: "box", children: ["copy"] },
        copy: { id: "copy", type: "text", value: "duplicate" },
      },
    };
    const loaded = await loadAssets(
      new MemoryAssets({
        themes: [],
        stamps: [],
        componentDefinitions: [first],
        compositions: [duplicate, compactComponentDefinition],
      }),
      "a",
    );

    const summaries = loaded.componentDefinitions.filter(
      (definition) => definition.name === "summary",
    );
    const copy = summaries[0]?.nodes["copy"] as { value?: string } | undefined;
    expect(summaries).toHaveLength(1);
    expect(copy?.value).toBe("first");
    expect(loaded.componentDefinitions.map((definition) => definition.name)).toContain(
      "compactSummary",
    );
    expect(
      loaded.issues.some(
        (issue) => issue.includes("duplicate component definition") && issue.includes("summary"),
      ),
    ).toBe(true);
  });

  it("drops invalid component definitions while default assets still resolve", async () => {
    const loaded = await loadAssets(
      new MemoryAssets({
        themes: [],
        stamps: [],
        componentDefinitions: [invalidComponentDefinition],
      }),
      "a",
    );

    expect(loaded.componentDefinitions).toEqual([]);
    expect(loaded.themes.map((theme) => theme.name)).toContain(DEFAULT_THEME.name);
    for (const stamp of DEFAULT_STAMPS) {
      expect(loaded.stamps.map((loadedStamp) => loadedStamp.name)).toContain(stamp.name);
    }
    expect(loaded.catalog).toEqual(DEFAULT_CATALOG);
    expect(loaded.issues.some((issue) => issue.includes("component definition"))).toBe(true);
  });

  it("surfaces backend-level issues from the store", async () => {
    const loaded = await loadAssets(
      new MemoryAssets({ themes: [], stamps: [], issues: ["backend said so"] }),
      "a",
    );
    expect(loaded.issues).toContain("backend said so");
  });

  it("never throws when a live document's accessor throws — skips it with an issue", async () => {
    // MemoryAssets / DB adapters hand in live in-process objects, so a document
    // with a throwing getter must be skipped at the boot seam, never crash boot.
    const hostileTheme = {
      name: "x",
      get color(): unknown {
        throw new Error("boom");
      },
    };
    const hostileStamp = {
      name: "s",
      get nodes(): unknown {
        throw new Error("boom");
      },
    };
    let loaded: Awaited<ReturnType<typeof loadAssets>> | undefined;
    await expect(
      (async () => {
        loaded = await loadAssets(
          new MemoryAssets({ themes: [hostileTheme, validTheme], stamps: [hostileStamp] }),
          "a",
        );
      })(),
    ).resolves.toBeUndefined();
    // The clean theme still loaded; the hostile documents were skipped + logged.
    expect(loaded!.themes.map((t) => t.name)).toContain("midnight");
    expect(loaded!.themes.map((t) => t.name)).not.toContain("x");
    expect(loaded!.issues.some((i) => i.includes("skipped"))).toBe(true);
  });
});

describe("FileAssets", () => {
  it("records an issue for an unparseable file, never throws, and boots", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "broken.theme.json"), "{ not json");
    writeFileSync(join(dir, "ok.theme.json"), JSON.stringify(validTheme));
    const loaded = await loadAssets(new FileAssets(dir), "a");
    expect(loaded.themes.map((t) => t.name)).toContain("midnight");
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    expect(loaded.issues.length).toBeGreaterThan(0);
  });

  it("loads sorted *.component.json files as raw component definition documents", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "z.component.json"),
      JSON.stringify({
        ...compactComponentDefinition,
        name: "sortedSummary",
        nodes: {
          root: { id: "root", type: "box", children: ["copy"] },
          copy: { id: "copy", type: "text", value: "z-last" },
        },
      }),
    );
    writeFileSync(
      join(dir, "a.component.json"),
      JSON.stringify({
        ...compactComponentDefinition,
        name: "sortedSummary",
        nodes: {
          root: { id: "root", type: "box", children: ["copy"] },
          copy: { id: "copy", type: "text", value: "a-first" },
        },
      }),
    );

    const loaded = await loadAssets(new FileAssets(dir), "a");
    const definition = loaded.componentDefinitions.find(
      (component) => component.name === "sortedSummary",
    );
    const copy = definition?.nodes["copy"] as { value?: string } | undefined;
    expect(copy?.value).toBe("a-first");
    expect(
      loaded.issues.some(
        (issue) =>
          issue.includes("duplicate component definition") && issue.includes("sortedSummary"),
      ),
    ).toBe(true);
  });

  it("records an issue for an unreadable directory instead of throwing", async () => {
    const loaded = await loadAssets(
      new FileAssets(join(tmpdir(), "facet-nope-does-not-exist")),
      "a",
    );
    // The backend failed, but the seeded default base layer still resolves.
    expect(loaded.themes.map((t) => t.name)).toEqual([DEFAULT_THEME.name]);
    for (const s of DEFAULT_STAMPS) expect(loaded.stamps.map((x) => x.name)).toContain(s.name);
    expect(loaded.issues.length).toBeGreaterThan(0);
  });
});

// --- isSeedableTree truth table ----------------------------------------------

describe("isSeedableTree", () => {
  it("is false for an empty root box (EMPTY_TREE)", () => {
    expect(isSeedableTree(EMPTY_TREE)).toBe(false);
  });

  it("is true for a child-bearing root box", () => {
    expect(isSeedableTree(seedTree)).toBe(true);
  });

  it("is false for a non-empty screens map when every screen is blank", () => {
    const tree: FacetTree = {
      root: "home",
      nodes: { home: { id: "home", type: "box", children: [] } },
      screens: { home: "home" },
    };
    expect(isSeedableTree(tree)).toBe(false);
  });

  it("is true for a non-empty screens map whose entry screen has content", () => {
    const tree: FacetTree = {
      root: "shell",
      nodes: {
        shell: { id: "shell", type: "box", children: [] },
        home: { id: "home", type: "box", children: ["copy"] },
        copy: { id: "copy", type: "text", value: "Ready" },
      },
      screens: { home: "home" },
      entry: "home",
    };
    expect(isSeedableTree(tree)).toBe(true);
  });

  it("is false when the entry screen is blank even if another screen has content", () => {
    const tree: FacetTree = {
      root: "shell",
      nodes: {
        shell: { id: "shell", type: "box", children: [] },
        home: { id: "home", type: "box", children: [] },
        about: { id: "about", type: "box", children: ["copy"] },
        copy: { id: "copy", type: "text", value: "About" },
      },
      screens: { home: "home", about: "about" },
      entry: "home",
    };
    expect(isSeedableTree(tree)).toBe(false);
  });

  it("is false for an empty screens map with an empty root", () => {
    expect(isSeedableTree({ ...EMPTY_TREE, screens: {} })).toBe(false);
  });
});

// --- withInitialStage decorator ----------------------------------------------

describe("withInitialStage", () => {
  it("seeds a fresh session with the initial stage", async () => {
    const store = withInitialStage(new MemoryStageStore(), seedTree);
    const session = await store.open("a", visitor);
    expect(session.stage).toEqual(seedTree);
    expect((await store.get("a", "v"))?.stage).toEqual(seedTree);
  });

  it("leaves an existing session's stage untouched", async () => {
    const base = new MemoryStageStore();
    const existing: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["k"] },
        k: { id: "k", type: "text", value: "kept" },
      },
    };
    await base.save({ agentId: "a", visitor, stage: existing });
    const store = withInitialStage(base, seedTree);
    const session = await store.open("a", visitor);
    expect(session.stage).toEqual(existing);
  });

  it("delegates get and save to the underlying store", async () => {
    const base = new MemoryStageStore();
    const store = withInitialStage(base, seedTree);
    const opened = await store.open("a", visitor);
    const next: FacetSession = { ...opened, stage: EMPTY_TREE };
    await store.save(next);
    expect((await base.get("a", "v"))?.stage).toEqual(EMPTY_TREE);
  });

  it("is a pass-through when the initial tree is undefined or not seedable", async () => {
    const base = new MemoryStageStore();
    expect(withInitialStage(base, undefined)).toBe(base);
    expect(withInitialStage(base, EMPTY_TREE)).toBe(base);
    const session = await withInitialStage(base, undefined).open("a", visitor);
    expect(session.stage).toEqual(EMPTY_TREE);
  });
});

// --- withInitialStage takeSeeded contract ------------------------------------

describe("withInitialStage takeSeeded", () => {
  it("flags a freshly seeded session exactly once, then never again", async () => {
    const store = withInitialStage(new MemoryStageStore(), seedTree);
    await store.open("a", visitor); // creates + seeds
    expect(store.takeSeeded?.("a", "v")).toBe(true); // consume-once
    expect(store.takeSeeded?.("a", "v")).toBe(false);
  });

  it("never flags an already-existing session", async () => {
    const base = new MemoryStageStore();
    await base.save({ agentId: "a", visitor, stage: seedTree });
    const store = withInitialStage(base, seedTree);
    await store.open("a", visitor); // returns the existing session, no seed
    expect(store.takeSeeded?.("a", "v")).toBe(false);
  });

  it("a pass-through store (no/unseedable tree) exposes no takeSeeded", () => {
    const base = new MemoryStageStore();
    // Pass-through returns the underlying store unchanged, which never implements it.
    expect(withInitialStage(base, undefined).takeSeeded).toBeUndefined();
    expect(withInitialStage(base, EMPTY_TREE).takeSeeded).toBeUndefined();
  });
});

// --- the seeded key set is bounded (hygiene cap) -----------------------------

describe("withInitialStage seeded-key cap", () => {
  it("caps the seeded set at MAX_SEEDED, evicting the oldest armed key (FIFO)", async () => {
    // A distinct visitor whose first turn never persists (agent throw / save
    // reject) leaves its key armed forever; without a cap a stream of one-off
    // broken-agent visitors leaks in-process memory unbounded. Mirror the
    // runtime's MAX_PENDING_SEEDS bound: the oldest armed key is evicted.
    const store = withInitialStage(new MemoryStageStore(), seedTree);
    const CAP = 10_000;
    for (let i = 0; i <= CAP; i += 1) {
      // Fresh open per distinct visitor, NO takeSeeded — so every key stays armed.
      await store.open("a", { visitorId: `v${String(i)}` });
    }
    // The first visitor's key was evicted when the cap was exceeded (FIFO)…
    expect(store.takeSeeded?.("a", "v0")).toBe(false);
    // …while the newest visitor's key is still armed.
    expect(store.takeSeeded?.("a", `v${String(CAP)}`)).toBe(true);
  });
});

// --- the seed reaches the client as the turn's first patch frame -------------

describe("withInitialStage seed frame reaches the client", () => {
  /** An agent that appends one node under the seed root (a first-turn incremental
   * edit — exactly the shape that broke the client when the seed never shipped). */
  const appendAgent: FacetAgent = () => [
    {
      kind: "patch",
      patches: [
        { op: "add", path: "/nodes/added", value: { id: "added", type: "text", value: "more" } },
        { op: "add", path: "/nodes/root/children/-", value: "added" },
      ],
    },
  ];

  it("prepends the seed as the turn's first patch and stays drift-free with the client", async () => {
    const runtime = new FacetRuntime({
      agentId: "a",
      agent: appendAgent,
      stageStore: withInitialStage(new MemoryStageStore(), seedTree),
    });
    const { messages } = await runtime.handle(visitor, { kind: "message", text: "hi" });

    // messages[0] is the seed root-replace; the agent's own patch follows it.
    const first = messages[0];
    expect(first?.kind).toBe("patch");
    if (first?.kind === "patch") {
      expect(first.patches[0]).toEqual({ op: "replace", path: "", value: seedTree });
    }
    expect(messages.length).toBeGreaterThan(1);

    // Simulate the CLIENT: fold the SAME ordered messages over EMPTY_TREE with the
    // same pure applyPatch. It must land on exactly the server's saved stage — the
    // drift check (invariant #2) that would have caught the blank-page bug (without
    // the seed frame the client stays on EMPTY_TREE and loses the seeded nodes).
    // Normalize through the same save-time validateTree so the comparison is of
    // structure, not the server's benign `style: {}` fill-in.
    let clientStage: FacetTree = EMPTY_TREE;
    for (const message of messages) {
      if (message.kind === "patch") clientStage = applyPatch(clientStage, message.patches);
    }
    expect(validateTree(clientStage).tree).toEqual(await runtime.stageFor("v"));
  });

  it("does not re-emit the seed on a second event for the same visitor", async () => {
    const runtime = new FacetRuntime({
      agentId: "a",
      agent: appendAgent,
      stageStore: withInitialStage(new MemoryStageStore(), seedTree),
    });
    await runtime.handle(visitor, { kind: "message", text: "one" });
    const { messages: second } = await runtime.handle(visitor, { kind: "message", text: "two" });
    const hasSeedReplace = second.some(
      (m) => m.kind === "patch" && m.patches.some((p) => p.op === "replace" && p.path === ""),
    );
    expect(hasSeedReplace).toBe(false);
  });
});

// --- the seed re-arms when the first turn fails to deliver --------------------

describe("withInitialStage seed re-arms on a failed turn", () => {
  /** Appends one node under the seed root — the first-turn incremental edit. */
  const appendAgent: FacetAgent = () => [
    {
      kind: "patch",
      patches: [
        { op: "add", path: "/nodes/added", value: { id: "added", type: "text", value: "more" } },
        { op: "add", path: "/nodes/root/children/-", value: "added" },
      ],
    },
  ];

  /** Fold a turn's messages over EMPTY_TREE (the client) and assert it lands on
   * the server's saved stage — the invariant #2 drift check the seed frame exists
   * to preserve. */
  async function expectNoDrift(runtime: FacetRuntime, messages: readonly ServerMessage[]) {
    let clientStage: FacetTree = EMPTY_TREE;
    for (const message of messages) {
      if (message.kind === "patch") clientStage = applyPatch(clientStage, message.patches);
    }
    expect(validateTree(clientStage).tree).toEqual(await runtime.stageFor("v"));
  }

  it("re-emits the seed on the next turn when the agent throws on the first turn", async () => {
    let calls = 0;
    const flakyAgent: FacetAgent = (event, session) => {
      calls += 1;
      if (calls === 1) throw new Error("first-turn boom");
      return appendAgent(event, session);
    };
    const runtime = new FacetRuntime({
      agentId: "a",
      agent: flakyAgent,
      stageStore: withInitialStage(new MemoryStageStore(), seedTree),
    });

    // Turn 1 throws — the seed was armed but never delivered (nothing persisted).
    await expect(runtime.handle(visitor, { kind: "message", text: "one" })).rejects.toThrow();

    // Turn 2 succeeds: the seed leads, then the agent's own patch — no drift.
    const { messages } = await runtime.handle(visitor, { kind: "message", text: "two" });
    const first = messages[0];
    expect(first?.kind).toBe("patch");
    if (first?.kind === "patch") {
      expect(first.patches[0]).toEqual({ op: "replace", path: "", value: seedTree });
    }
    expect(messages.length).toBeGreaterThan(1);
    await expectNoDrift(runtime, messages);
  });

  it("re-emits the seed on the next turn when the first turn's save rejects", async () => {
    const seededStore = withInitialStage(new MemoryStageStore(), seedTree);
    let failNextSave = true;
    // Wrap ONLY the runtime-facing save so it rejects exactly once. `open` still
    // seeds through the underlying store (its own save isn't this wrapped one), so
    // the fresh seeded session IS persisted while the first turn fails to save.
    const flakyStore: StageStore = {
      get: (a, v) => seededStore.get(a, v),
      open: (a, v) => seededStore.open(a, v),
      save: (s) => {
        if (failNextSave) {
          failNextSave = false;
          return Promise.reject(new Error("save boom"));
        }
        return seededStore.save(s);
      },
      takeSeeded: (a, v) => seededStore.takeSeeded?.(a, v) ?? false,
    };
    const runtime = new FacetRuntime({ agentId: "a", agent: appendAgent, stageStore: flakyStore });

    // Turn 1 arms the seed, then save rejects — the seed frame never reached the
    // client, and the flag was already consumed. It must survive to re-emit.
    await expect(runtime.handle(visitor, { kind: "message", text: "one" })).rejects.toThrow();

    const { messages } = await runtime.handle(visitor, { kind: "message", text: "two" });
    const first = messages[0];
    expect(first?.kind).toBe("patch");
    if (first?.kind === "patch") {
      expect(first.patches[0]).toEqual({ op: "replace", path: "", value: seedTree });
    }
    await expectNoDrift(runtime, messages);
  });

  it("re-emits the CURRENT stage, not the stale seed, after a save that committed then rejected", async () => {
    const seededStore = withInitialStage(new MemoryStageStore(), seedTree);
    let failNextSave = true;
    // The async-store failure class the re-emit must survive: the write COMMITS,
    // then the acknowledgement is lost (e.g. a connection drop post-COMMIT).
    const commitThenRejectStore: StageStore = {
      get: (a, v) => seededStore.get(a, v),
      open: (a, v) => seededStore.open(a, v),
      save: async (s) => {
        await seededStore.save(s);
        if (failNextSave) {
          failNextSave = false;
          throw new Error("post-commit boom");
        }
      },
      takeSeeded: (a, v) => seededStore.takeSeeded?.(a, v) ?? false,
    };
    let calls = 0;
    const agent: FacetAgent = (event, session) => {
      calls += 1;
      return calls === 1 ? appendAgent(event, session) : [{ kind: "say", text: "hi" }];
    };
    const runtime = new FacetRuntime({ agentId: "a", agent, stageStore: commitThenRejectStore });

    // Turn 1: the edit commits, then save rejects — the turn fails but the
    // stored stage is already ahead of the original seed.
    await expect(runtime.handle(visitor, { kind: "message", text: "one" })).rejects.toThrow();

    // Turn 2's re-emitted frame must carry the stage this turn ran against (the
    // committed seed+edit), never rewind the page to the original seed.
    const { messages } = await runtime.handle(visitor, { kind: "message", text: "two" });
    const first = messages[0];
    expect(first?.kind).toBe("patch");
    if (first?.kind === "patch") {
      const op = first.patches[0];
      expect(op?.op).toBe("replace");
      const value = op?.op === "replace" ? op.value : undefined;
      expect(value).toEqual(await runtime.stageFor("v"));
      expect(value).not.toEqual(seedTree);
    }
    await expectNoDrift(runtime, messages);
  });

  it("re-emits the seed after the initial seed save committed then rejected", async () => {
    const sessions = new Map<string, FacetSession>();
    const keyOf = (agentId: string, visitorId: string): string => `${agentId}:${visitorId}`;
    let failFirstSave = true;
    const baseStore: StageStore = {
      get: (agentId, visitorId) => Promise.resolve(sessions.get(keyOf(agentId, visitorId))),
      open: async (agentId, v) => {
        const existing = sessions.get(keyOf(agentId, v.visitorId));
        if (existing !== undefined) return existing;
        const session: FacetSession = { agentId, visitor: v, stage: EMPTY_TREE };
        await baseStore.save(session);
        return session;
      },
      save: async (session) => {
        sessions.set(keyOf(session.agentId, session.visitor.visitorId), session);
        if (failFirstSave) {
          failFirstSave = false;
          throw new Error("post-commit seed save boom");
        }
      },
    };
    const runtime = new FacetRuntime({
      agentId: "a",
      agent: appendAgent,
      stageStore: withInitialStage(baseStore, seedTree),
    });

    await expect(runtime.handle(visitor, { kind: "message", text: "one" })).rejects.toThrow(
      /post-commit seed save boom/,
    );

    const { messages } = await runtime.handle(visitor, { kind: "message", text: "two" });
    const first = messages[0];
    expect(first?.kind).toBe("patch");
    if (first?.kind === "patch") {
      expect(first.patches[0]).toEqual({ op: "replace", path: "", value: seedTree });
    }
    await expectNoDrift(runtime, messages);
  });

  it("does not evict another pending seed when retrying an already armed save miss at the cap", async () => {
    const maxSeeded = 10_000;
    const sessions = new Map<string, FacetSession>();
    const keyOf = (agentId: string, visitorId: string): string => `${agentId}:${visitorId}`;
    const baseStore: StageStore = {
      get: (agentId, visitorId) => Promise.resolve(sessions.get(keyOf(agentId, visitorId))),
      open: async (agentId, v) => {
        const existing = sessions.get(keyOf(agentId, v.visitorId));
        if (existing !== undefined) return existing;
        const session: FacetSession = { agentId, visitor: v, stage: EMPTY_TREE };
        await baseStore.save(session);
        return session;
      },
      save: async (session) => {
        if (session.visitor.visitorId === "retry") {
          throw new Error("pre-commit seed save boom");
        }
        sessions.set(keyOf(session.agentId, session.visitor.visitorId), session);
      },
    };
    const store = withInitialStage(baseStore, seedTree);

    for (let i = 0; i < maxSeeded - 1; i += 1) {
      await store.open("a", { visitorId: `old${String(i)}` });
    }
    await expect(store.open("a", { visitorId: "retry" })).rejects.toThrow(
      /pre-commit seed save boom/,
    );
    await expect(store.open("a", { visitorId: "retry" })).rejects.toThrow(
      /pre-commit seed save boom/,
    );

    expect(store.takeSeeded?.("a", "old0")).toBe(true);
  });

  it("re-arms a committed seed after pending eviction when runtime never consumed it", async () => {
    const maxSeeded = 10_000;
    const sessions = new Map<string, FacetSession>();
    const keyOf = (agentId: string, visitorId: string): string => `${agentId}:${visitorId}`;
    let failRetrySave = true;
    const baseStore: StageStore = {
      get: (agentId, visitorId) => Promise.resolve(sessions.get(keyOf(agentId, visitorId))),
      open: async (agentId, v) => {
        const existing = sessions.get(keyOf(agentId, v.visitorId));
        if (existing !== undefined) return existing;
        const session: FacetSession = { agentId, visitor: v, stage: EMPTY_TREE };
        await baseStore.save(session);
        return session;
      },
      save: async (session) => {
        sessions.set(keyOf(session.agentId, session.visitor.visitorId), session);
        if (session.visitor.visitorId === "retry" && failRetrySave) {
          failRetrySave = false;
          throw new Error("post-commit seed save boom");
        }
      },
    };
    const store = withInitialStage(baseStore, seedTree);

    await expect(store.open("a", { visitorId: "retry" })).rejects.toThrow(
      /post-commit seed save boom/,
    );
    for (let i = 0; i < maxSeeded; i += 1) {
      await store.open("a", { visitorId: `filler${String(i)}` });
    }
    expect(store.takeSeeded?.("a", "retry")).toBe(false);

    await store.open("a", { visitorId: "retry" });
    expect(store.takeSeeded?.("a", "retry")).toBe(true);
  });

  it("prepends the seed on the applyMessages path, once", async () => {
    const runtime = new FacetRuntime({
      agentId: "a",
      agent: appendAgent,
      stageStore: withInitialStage(new MemoryStageStore(), seedTree),
    });
    const event = { kind: "message", text: "trigger" } as const;

    const { messages: first } = await runtime.applyMessages(visitor, event, [
      { kind: "say", text: "late" },
    ]);
    expect(first[0]).toEqual({
      kind: "patch",
      patches: [{ op: "replace", path: "", value: seedTree }],
    });
    expect(first[1]).toEqual({ kind: "say", text: "late" });

    // A second apply for the same visitor must NOT re-prepend the seed.
    const { messages: second } = await runtime.applyMessages(visitor, event, [
      { kind: "say", text: "again" },
    ]);
    const hasSeedReplace = second.some(
      (m) => m.kind === "patch" && m.patches.some((p) => p.op === "replace" && p.path === ""),
    );
    expect(hasSeedReplace).toBe(false);
  });
});
