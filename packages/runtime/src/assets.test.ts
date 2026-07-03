import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPatch,
  EMPTY_TREE,
  validateTree,
  type FacetAgent,
  type FacetSession,
  type FacetTree,
  type VisitorContext,
} from "@facet/core";
import {
  isSeedableTree,
  loadAssets,
  MemoryAssets,
  withInitialStage,
  type AssetDocuments,
  type AssetsStore,
} from "./assets.js";
import { FileAssets } from "./file-assets.js";
import { MemoryStageStore } from "./stage-store.js";
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

/** A seedable initial tree: a root box with ≥ 1 child. */
const seedTree: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["h"] },
    h: { id: "h", type: "text", value: "Welcome" },
  },
};

const visitor: VisitorContext = { visitorId: "v" };

// --- Shared contract, run against MemoryAssets AND FileAssets -----------------

function fileMake(docs: AssetDocuments): AssetsStore {
  const dir = mkdtempSync(join(tmpdir(), "facet-assets-"));
  docs.themes.forEach((t, i) => writeFileSync(join(dir, `t${i}.theme.json`), JSON.stringify(t)));
  docs.stamps.forEach((s, i) => writeFileSync(join(dir, `s${i}.stamp.json`), JSON.stringify(s)));
  if (docs.initialTree !== undefined) {
    writeFileSync(join(dir, "initial.tree.json"), JSON.stringify(docs.initialTree));
  }
  return new FileAssets(dir);
}

function contract(name: string, make: (docs: AssetDocuments) => AssetsStore): void {
  describe(name, () => {
    it("round-trips valid themes, stamps, and a seedable initial tree", async () => {
      const store = make({ themes: [validTheme], stamps: [validStamp], initialTree: seedTree });
      const loaded = await loadAssets(store, "agent");
      expect(loaded.themes.map((t) => t.name)).toEqual(["midnight"]);
      expect(loaded.stamps.map((s) => s.name)).toEqual(["cta"]);
      expect(loaded.initialTree).toBeDefined();
      expect(loaded.initialTree && isSeedableTree(loaded.initialTree)).toBe(true);
    });

    it("skips invalid documents with issues and keeps valid ones", async () => {
      const store = make({
        themes: [validTheme, invalidTheme],
        stamps: [validStamp, invalidStamp],
        initialTree: seedTree,
      });
      const loaded = await loadAssets(store, "agent");
      expect(loaded.themes.map((t) => t.name)).toEqual(["midnight"]);
      expect(loaded.stamps.map((s) => s.name)).toEqual(["cta"]);
      expect(loaded.issues.length).toBeGreaterThan(0);
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
  it("keeps the first of duplicate theme names and logs an issue", async () => {
    const first = { name: "dup", color: { bg: "#000000" } };
    const second = { name: "dup", color: { bg: "#ffffff" } };
    const loaded = await loadAssets(new MemoryAssets({ themes: [first, second], stamps: [] }), "a");
    expect(loaded.themes).toHaveLength(1);
    expect(loaded.themes[0]?.color?.bg).toBe("#000000");
    expect(loaded.issues.some((i) => i.includes("dup"))).toBe(true);
  });

  it("surfaces backend-level issues from the store", async () => {
    const loaded = await loadAssets(
      new MemoryAssets({ themes: [], stamps: [], issues: ["backend said so"] }),
      "a",
    );
    expect(loaded.issues).toContain("backend said so");
  });
});

describe("FileAssets", () => {
  it("records an issue for an unparseable file, never throws, and boots", async () => {
    const dir = mkdtempSync(join(tmpdir(), "facet-assets-"));
    writeFileSync(join(dir, "broken.theme.json"), "{ not json");
    writeFileSync(join(dir, "ok.theme.json"), JSON.stringify(validTheme));
    const loaded = await loadAssets(new FileAssets(dir), "a");
    expect(loaded.themes.map((t) => t.name)).toEqual(["midnight"]);
    expect(loaded.issues.length).toBeGreaterThan(0);
  });

  it("records an issue for an unreadable directory instead of throwing", async () => {
    const loaded = await loadAssets(
      new FileAssets(join(tmpdir(), "facet-nope-does-not-exist")),
      "a",
    );
    expect(loaded.themes).toEqual([]);
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

  it("is true for a non-empty screens map even with an empty root", () => {
    const tree: FacetTree = {
      root: "home",
      nodes: { home: { id: "home", type: "box", children: [] } },
      screens: { home: "home" },
    };
    expect(isSeedableTree(tree)).toBe(true);
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
    const messages = await runtime.handle(visitor, { kind: "message", text: "hi" });

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
    const second = await runtime.handle(visitor, { kind: "message", text: "two" });
    const hasSeedReplace = second.some(
      (m) => m.kind === "patch" && m.patches.some((p) => p.op === "replace" && p.path === ""),
    );
    expect(hasSeedReplace).toBe(false);
  });
});
