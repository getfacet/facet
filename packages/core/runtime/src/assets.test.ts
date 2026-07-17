import { describe, expect, it } from "vitest";
import {
  EMPTY_TREE,
  type FacetAgent,
  type FacetSession,
  type FacetTheme,
  type FacetTree,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import {
  isSeedableTree,
  loadAssets,
  MemoryAssets,
  withInitialStage,
  type AssetDocuments,
  type AssetsStore,
} from "./assets.js";
import { MemoryStageStore, type StageStore } from "./stage-store.js";
import { FacetRuntime } from "./runtime.js";

const seedTree: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["copy"] },
    copy: { id: "copy", type: "text", value: "Welcome" },
  },
};

const visitor: VisitorContext = { visitorId: "visitor" };

function customTheme(name = "brand"): FacetTheme {
  const theme = structuredClone(DEFAULT_THEME);
  return { ...theme, name };
}

function setStringToken(
  group: Readonly<Record<string, string>>,
  name: string,
  value: string,
): void {
  (group as Record<string, string>)[name] = value;
}

function pattern(name = "custom-pattern") {
  return {
    name,
    description: "A custom reference layout.",
    useWhen: "Use for a compact notice.",
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["copy"] },
      copy: { id: "copy", type: "text", value: "Ready", style: { preset: "body" } },
    },
  };
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested, seen);
}

describe("loadAssets exact snapshot", () => {
  it("distinguishes missing Patterns from explicit none", async () => {
    const missing = await loadAssets(new MemoryAssets({}), "agent");
    const empty = await loadAssets(new MemoryAssets({ patterns: [] }), "agent");
    const malformed = await loadAssets(new MemoryAssets({ patterns: null }), "agent");
    const presentUndefined = await loadAssets(new MemoryAssets({ patterns: undefined }), "agent");

    expect(missing.patterns).toEqual(DEFAULT_PATTERNS);
    expect(empty.patterns).toEqual([]);
    expect(malformed.patterns).toEqual([]);
    expect(presentUndefined.patterns).toEqual([]);
    expect(missing.issues).toEqual([]);
    expect(empty.issues).toEqual([]);
    expect(malformed.issues.some((issue) => issue.includes("patterns"))).toBe(true);
    expect(presentUndefined.issues.some((issue) => issue.includes("patterns"))).toBe(true);
  });

  it("resolves one complete custom Theme or falls back whole to the default", async () => {
    const brand = customTheme();
    setStringToken(brand.tokens.paint.light.color, "accent", "#123456");
    const custom = await loadAssets(new MemoryAssets({ theme: brand, patterns: [] }), "agent");
    expect(custom.theme.name).toBe("brand");
    expect(custom.theme.tokens.paint.light.color.accent).toBe("#123456");

    for (const bad of [
      { ...customTheme("incomplete"), tokens: {} },
      (() => {
        const theme = customTheme("negative");
        setStringToken(theme.tokens.fontSize, "xs", "-1px");
        return theme;
      })(),
      (() => {
        const theme = customTheme("oversized");
        setStringToken(theme.tokens.fontSize, "xs", "257px");
        return theme;
      })(),
      (() => {
        const theme = customTheme("wrong-unit");
        setStringToken(theme.tokens.space, "md", "2vh");
        return theme;
      })(),
    ]) {
      const loaded = await loadAssets(new MemoryAssets({ theme: bad, patterns: [] }), "agent");
      expect(loaded.theme).toEqual(DEFAULT_THEME);
      expect(loaded.theme).not.toBe(DEFAULT_THEME);
      expect(loaded.issues.some((issue) => issue.includes("theme"))).toBe(true);
    }
  });

  it("validates the exact Pattern list against the effective Theme", async () => {
    const valid = pattern();
    const invalid = { ...pattern("invalid"), useWhen: "" };
    const incompatible = pattern("missing-preset");
    incompatible.nodes.copy.style.preset = "does-not-exist";

    const loaded = await loadAssets(
      new MemoryAssets({ patterns: [valid, invalid, incompatible] }),
      "agent",
    );
    expect(loaded.patterns.map((entry) => entry.name)).toEqual(["custom-pattern"]);
    expect(loaded.issues.some((issue) => issue.includes("pattern[1]"))).toBe(true);
    expect(loaded.issues.some((issue) => issue.includes("pattern[2]"))).toBe(true);

    const themeWithoutPresets: Omit<FacetTheme, "presets"> & {
      presets?: FacetTheme["presets"];
    } = structuredClone(customTheme("plain"));
    delete themeWithoutPresets.presets;
    const incompatibleWithTheme = await loadAssets(
      new MemoryAssets({ theme: themeWithoutPresets, patterns: [valid] }),
      "agent",
    );
    expect(incompatibleWithTheme.patterns).toEqual([]);
    expect(incompatibleWithTheme.issues.some((issue) => issue.includes("Preset"))).toBe(true);

    const overCap = await loadAssets(
      new MemoryAssets({
        patterns: Array.from({ length: 65 }, (_, index) => pattern(`p-${index}`)),
      }),
      "agent",
    );
    expect(overCap.patterns).toEqual([]);
    expect(overCap.issues.some((issue) => issue.includes("64"))).toBe(true);
  });

  it("reports retired raw keys without interpreting them", async () => {
    const retiredThemeKey = ["theme", "s"].join("");
    const retiredPatternKey = ["compo", "sitions"].join("");
    const retiredGuideKey = ["cat", "alog"].join("");
    let retiredGetterCalls = 0;
    const docs = Object.defineProperties(
      { patterns: [] },
      Object.fromEntries(
        [retiredThemeKey, retiredPatternKey, retiredGuideKey].map((key) => [
          key,
          {
            enumerable: true,
            get: () => {
              retiredGetterCalls += 1;
              throw new Error("retired data must stay unread");
            },
          },
        ]),
      ),
    ) as AssetDocuments;

    const loaded = await loadAssets(new MemoryAssets(docs), "agent");
    expect(loaded.theme).toEqual(DEFAULT_THEME);
    expect(loaded.patterns).toEqual([]);
    expect(loaded.issues.some((issue) => issue.includes(retiredThemeKey))).toBe(true);
    expect(loaded.issues.some((issue) => issue.includes(retiredPatternKey))).toBe(true);
    expect(loaded.issues.some((issue) => issue.includes(retiredGuideKey))).toBe(true);
    expect(retiredGetterCalls).toBe(0);
    expect(retiredGuideKey in loaded).toBe(false);
  });

  it("is total for hostile stores, documents, arrays, and issue text", async () => {
    const throwing: AssetsStore = { load: () => Promise.reject(new Error("db\u0000down")) };
    await expect(loadAssets(throwing, "agent")).resolves.toMatchObject({
      theme: { name: DEFAULT_THEME.name },
    });

    const hostileDocs = Object.defineProperties(
      {},
      {
        theme: {
          get: () => {
            throw new Error("theme boom");
          },
        },
        patterns: {
          get: () => {
            throw new Error("patterns boom");
          },
        },
        initialTree: {
          get: () => {
            throw new Error("tree boom");
          },
        },
        issues: {
          get: () => {
            throw new Error("issues boom");
          },
        },
      },
    );
    const hostileStore: AssetsStore = {
      load: () => Promise.resolve(hostileDocs as AssetDocuments),
    };
    const hostile = await loadAssets(hostileStore, "agent");
    expect(hostile.theme).toEqual(DEFAULT_THEME);
    expect(hostile.patterns).toEqual([]);
    expect(hostile.initialTree).toBeUndefined();
    expect(hostile.issues.length).toBeGreaterThan(0);

    const issues = Array.from({ length: 100 }, (_, index) => `${index}\u0000${"x".repeat(400)}`);
    const bounded = await loadAssets(new MemoryAssets({ patterns: [], issues }), "agent");
    expect(bounded.issues.length).toBeLessThanOrEqual(64);
    expect(bounded.issues.every((issue) => issue.length <= 203 && !issue.includes("\u0000"))).toBe(
      true,
    );
  });

  it("returns a deep-detached and deeply frozen snapshot", async () => {
    const theme = customTheme();
    const originalAccent = theme.tokens.paint.light.color.accent;
    const sourcePattern = pattern();
    const sourceTree = structuredClone(seedTree);
    const loaded = await loadAssets(
      new MemoryAssets({ theme, patterns: [sourcePattern], initialTree: sourceTree }),
      "agent",
    );

    setStringToken(theme.tokens.paint.light.color, "accent", "#ffffff");
    sourcePattern.nodes.copy.value = "mutated";
    (sourceTree.nodes as Record<string, FacetTree["nodes"][string]>).copy = {
      id: "copy",
      type: "text",
      value: "mutated",
    };

    expect(loaded.theme.tokens.paint.light.color.accent).toBe(originalAccent);
    expect(loaded.patterns[0]?.nodes.copy).toMatchObject({ value: "Ready" });
    expect(loaded.initialTree?.nodes.copy).toMatchObject({ value: "Welcome" });
    expectDeepFrozen(loaded);
  });

  it("strictly rejects an invalid initial tree instead of repairing it", async () => {
    const invalid = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["copy"] },
        copy: { id: "copy", type: "text", value: "Bad", style: { fontSize: "huge" } },
      },
    };
    const loaded = await loadAssets(
      new MemoryAssets({ patterns: [], initialTree: invalid }),
      "agent",
    );
    expect(loaded.initialTree).toBeUndefined();
    expect(loaded.issues.some((issue) => issue.includes("initial tree"))).toBe(true);
  });
});

describe("isSeedableTree", () => {
  it("accepts content and refuses an empty tree without throwing", () => {
    expect(isSeedableTree(seedTree)).toBe(true);
    expect(isSeedableTree(EMPTY_TREE)).toBe(false);
    expect(isSeedableTree(null as unknown as FacetTree)).toBe(false);
  });
});

describe("withInitialStage", () => {
  it("seeds a fresh session once and leaves existing sessions untouched", async () => {
    const base = new MemoryStageStore();
    const store = withInitialStage(base, seedTree);
    expect((await store.open("agent", visitor)).stage).toEqual(seedTree);
    expect(store.takeSeeded?.("agent", visitor.visitorId)).toBe(true);
    expect(store.takeSeeded?.("agent", visitor.visitorId)).toBe(false);

    const existing: FacetSession = {
      agentId: "agent",
      visitor,
      stage: { root: "other", nodes: { other: { id: "other", type: "text", value: "kept" } } },
    };
    await base.save(existing);
    expect((await store.open("agent", visitor)).stage).toEqual(existing.stage);
  });

  it("passes through an absent or unseedable tree", () => {
    const base = new MemoryStageStore();
    expect(withInitialStage(base)).toBe(base);
    expect(withInitialStage(base, EMPTY_TREE)).toBe(base);
  });

  it("prepends the seed frame so client and server remain coherent", async () => {
    const appendAgent: FacetAgent = () => [
      {
        kind: "patch",
        patches: [
          { op: "add", path: "/nodes/added", value: { id: "added", type: "text", value: "more" } },
          { op: "add", path: "/nodes/root/children/-", value: "added" },
        ],
      },
    ];
    const runtime = new FacetRuntime({
      agentId: "agent",
      agent: appendAgent,
      stageStore: withInitialStage(new MemoryStageStore(), seedTree),
    });
    const { messages } = await runtime.handle(visitor, { kind: "message", text: "hi" });
    const first: ServerMessage | undefined = messages[0];
    expect(first).toMatchObject({
      kind: "patch",
      patches: [{ op: "replace", path: "", value: seedTree }],
    });
  });

  it("does not arm a seed when saving it fails", async () => {
    const rejecting: StageStore = {
      get: async () => undefined,
      save: async () => Promise.reject(new Error("write failed")),
      open: async () => {
        throw new Error("unused");
      },
    };
    const store = withInitialStage(rejecting, seedTree);
    await expect(store.open("agent", visitor)).rejects.toThrow("write failed");
    expect(store.takeSeeded?.("agent", visitor.visitorId)).toBe(false);
  });
});
