import { describe, expect, it } from "vitest";
import { EMPTY_TREE, type FacetTree } from "./tree.js";
import { MAX_PATCH_OPS, type JsonPatchOperation } from "./patch.js";
import { foldPatchIntoStage } from "./stage-fold.js";
import { validateTree } from "./validate.js";

const rootBox: FacetTree = {
  root: "root",
  nodes: { root: { id: "root", type: "box", style: {}, children: [] } },
};

/** Fold a single batch — the exact call both the server store and the client make. */
const fold = (stage: FacetTree, patches: readonly JsonPatchOperation[]): FacetTree =>
  foldPatchIntoStage(stage, patches).tree;

describe("foldPatchIntoStage — convergence by construction", () => {
  // The redesign's core claim: the SAME pure fold runs on the server (stored
  // stage) and the client (rendered tree), so given identical inputs they
  // produce identical trees — there is nothing left to diverge. Each case below
  // is a former divergence trigger; a "server" and a "client" fold the same
  // input and must deep-equal.
  const converges = (stage: FacetTree, patches: readonly JsonPatchOperation[]): FacetTree => {
    const server = fold(stage, patches);
    const client = fold(stage, patches);
    expect(client).toEqual(server);
    return server;
  };

  it("(a) mixed batch: salvages the good op, drops the throwing one with a bounded issue", () => {
    const patches: JsonPatchOperation[] = [
      { op: "remove", path: "/nodes/ghost/children/0" }, // stale → throws
      { op: "add", path: "/nodes/good", value: { id: "good", type: "text", value: "kept" } },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree.nodes["good"]).toBeDefined(); // good op salvaged
    expect(issues.some((i) => i.includes("dropped an unapplicable patch op"))).toBe(true);
    expect(converges(rootBox, patches).nodes["good"]).toBeDefined();
  });

  it("bounds the dropped-op note — a hostile op path is never echoed verbatim", () => {
    // A pointer into a nonexistent parent throws in applyPatch; the huge path is
    // what describeDroppedOp would echo — it must be collapsed by the key cap.
    const bigPath = "/ghost/" + "z".repeat(10_000_000);
    const patches = [{ op: "remove", path: bigPath }] as unknown as JsonPatchOperation[];
    const { issues } = foldPatchIntoStage(rootBox, patches);
    const joined = issues.join("\n");
    expect(joined.includes("<key too long>")).toBe(true);
    expect(joined.includes(bigPath)).toBe(false);
    expect(joined.length).toBeLessThan(200);
  });

  it("(b) replace /nodes/root with a text node → normalized to EMPTY_TREE", () => {
    const patches: JsonPatchOperation[] = [
      { op: "replace", path: "/nodes/root", value: { id: "root", type: "text", value: "hi" } },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree).toEqual(EMPTY_TREE);
    expect(issues.some((i) => i.includes("root node must be a box"))).toBe(true);
    expect(converges(rootBox, patches)).toEqual(EMPTY_TREE);
  });

  it('(c) replace "" with a root:"root" text-node tree → normalized to EMPTY_TREE', () => {
    const patches: JsonPatchOperation[] = [
      {
        op: "replace",
        path: "",
        value: { root: "root", nodes: { root: { id: "root", type: "text", value: "hi" } } },
      },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree).toEqual(EMPTY_TREE);
    expect(issues.some((i) => i.includes("root node must be a box"))).toBe(true);
    expect(converges(rootBox, patches)).toEqual(EMPTY_TREE);
  });

  it("(d) a text node as a screens target → the screen is dropped", () => {
    const patches: JsonPatchOperation[] = [
      {
        op: "replace",
        path: "",
        value: {
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["txt"] },
            txt: { id: "txt", type: "text", value: "not a screen root" },
          },
          screens: { promo: "txt" },
          entry: "promo",
        },
      },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree.screens).toBeUndefined();
    expect(issues.some((i) => i.includes("is not a box"))).toBe(true);
    expect(converges(rootBox, patches).screens).toBeUndefined();
  });

  it("(e) cross-parent shared child within one screen → collapsed to the first parent", () => {
    const patches: JsonPatchOperation[] = [
      {
        op: "replace",
        path: "",
        value: {
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["b1", "b2"] },
            b1: { id: "b1", type: "box", children: ["shared"] },
            b2: { id: "b2", type: "box", children: ["shared"] },
            shared: { id: "shared", type: "text", value: "hi" },
          },
        },
      },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect((tree.nodes["b1"] as unknown as { children: string[] }).children).toEqual(["shared"]);
    expect((tree.nodes["b2"] as unknown as { children: string[] }).children).toEqual([]);
    expect(issues.some((i) => i.includes("removed shared child"))).toBe(true);
    expect(
      (converges(rootBox, patches).nodes["b2"] as unknown as { children: string[] }).children,
    ).toEqual([]);
  });

  it("(f) replace /root with a dangling id (a node keyed 'root' exists) → falls back to 'root'", () => {
    const patches: JsonPatchOperation[] = [{ op: "replace", path: "/root", value: "ghost" }];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree.root).toBe("root");
    expect(issues.some((i) => i.includes("fell back to"))).toBe(true);
    expect(converges(rootBox, patches).root).toBe("root");
  });
});

describe("foldPatchIntoStage — fail-safe posture", () => {
  it("returns a validated tree and a flag issue when patches is not an array", () => {
    const { tree, issues } = foldPatchIntoStage(rootBox, "not-an-array" as unknown as []);
    expect(tree.nodes["root"]).toBeDefined(); // stage preserved, validated
    expect(issues.some((i) => i.includes("not an array"))).toBe(true);
  });

  it("never throws on a fully-throwing batch (nothing salvaged, stage validated)", () => {
    const patches: JsonPatchOperation[] = [
      { op: "remove", path: "/nodes/ghost/children/0" },
      { op: "remove", path: "/nodes/also-ghost" },
    ];
    const run = (): unknown => foldPatchIntoStage(rootBox, patches);
    expect(run).not.toThrow();
    const { tree } = foldPatchIntoStage(rootBox, patches);
    expect(tree.nodes["root"]).toBeDefined(); // unchanged, still valid
  });

  it("always returns a guaranteed-valid tree even from a root-replace to null", () => {
    const { tree } = foldPatchIntoStage(rootBox, [{ op: "replace", path: "", value: null }]);
    expect(tree).toEqual(EMPTY_TREE);
  });
});

describe("foldPatchIntoStage — batch is bounded (DoS belt)", () => {
  it("rejects a batch over MAX_PATCH_OPS whole, in bounded time, with one cap issue", () => {
    // A runaway/hostile turn: hundreds of thousands of junk ops. Without the cap,
    // the salvage loop would build a per-op dropped list and block for seconds.
    const patches = Array.from({ length: 200_000 }, () => 0) as unknown as JsonPatchOperation[];
    const started = Date.now();
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1000); // whole-batch reject, no O(ops × tree) salvage
    expect(tree.nodes["root"]).toBeDefined(); // stage preserved unchanged
    expect(issues.some((i) => i.includes(String(MAX_PATCH_OPS)) && i.includes("cap"))).toBe(true);
    expect(issues.length).toBeLessThanOrEqual(65); // not one issue per op
  });

  it("still salvages a batch exactly AT the cap (boundary is inclusive)", () => {
    const patches: JsonPatchOperation[] = Array.from({ length: MAX_PATCH_OPS }, () => ({
      op: "add",
      path: "/nodes/x",
      value: { id: "x", type: "text", value: "x" },
    }));
    const { tree } = foldPatchIntoStage(rootBox, patches);
    expect(tree.nodes["x"]).toBeDefined(); // applied, not rejected whole
  });
});

describe("foldPatchIntoStage — RFC 6902 test-guard semantics", () => {
  it("a failed `test` drops itself AND every op it guarded (write is NOT applied)", () => {
    const stage: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: {}, children: ["t"] },
        t: { id: "t", type: "text", value: "old", style: {} },
      },
    };
    const patches: JsonPatchOperation[] = [
      { op: "test", path: "/nodes/t/value", value: "expected-but-not-current" }, // fails
      { op: "replace", path: "/nodes/t/value", value: "GUARDED WRITE" }, // must NOT apply
    ];
    const { tree, issues } = foldPatchIntoStage(stage, patches);
    expect((tree.nodes["t"] as unknown as { value: string }).value).toBe("old");
    expect(issues.some((i) => i.includes("test") && i.includes("guard"))).toBe(true);
  });

  it("ops BEFORE a failed guard stay applied; the guard drops only what follows", () => {
    const stage: FacetTree = {
      root: "root",
      nodes: { root: { id: "root", type: "box", style: {}, children: [] } },
    };
    const patches: JsonPatchOperation[] = [
      { op: "add", path: "/nodes/a", value: { id: "a", type: "text", value: "kept" } },
      { op: "test", path: "/nodes/a/value", value: "wrong" }, // fails
      { op: "add", path: "/nodes/b", value: { id: "b", type: "text", value: "guarded" } },
    ];
    const { tree } = foldPatchIntoStage(stage, patches);
    expect(tree.nodes["a"]).toBeDefined(); // before the guard → kept
    expect(tree.nodes["b"]).toBeUndefined(); // after the guard → dropped
  });
});

describe("foldPatchIntoStage — mutated (effect-based edit signal)", () => {
  // `mutated` is true iff at least one non-`test` op actually applied. The
  // runtime threads it to TurnResult.agentMutated so a turn whose stage patch
  // was dropped whole never advances "last applied" and stales a parked late
  // result.
  it("is true when a non-`test` op applies", () => {
    const patches: JsonPatchOperation[] = [
      { op: "add", path: "/nodes/x", value: { id: "x", type: "text", value: "x" } },
    ];
    expect(foldPatchIntoStage(rootBox, patches).mutated).toBe(true);
  });

  it("is true when a good op is salvaged past a throwing one (salvage path)", () => {
    const patches: JsonPatchOperation[] = [
      { op: "remove", path: "/nodes/ghost/children/0" }, // stale → throws, salvaged past
      { op: "add", path: "/nodes/good", value: { id: "good", type: "text", value: "kept" } },
    ];
    expect(foldPatchIntoStage(rootBox, patches).mutated).toBe(true);
  });

  it("reports rootReplaced only for root document writes that actually applied", () => {
    const rootWrite: JsonPatchOperation[] = [{ op: "replace", path: "", value: rootBox }];
    expect(foldPatchIntoStage(rootBox, rootWrite).rootReplaced).toBe(true);

    const guarded: JsonPatchOperation[] = [
      { op: "add", path: "/nodes/good", value: { id: "good", type: "text", value: "kept" } },
      { op: "test", path: "/root", value: "not-root" },
      { op: "replace", path: "", value: rootBox },
    ];
    const folded = foldPatchIntoStage(rootBox, guarded);
    expect(folded.mutated).toBe(true);
    expect(folded.tree.nodes["good"]).toBeDefined();
    expect(folded.rootReplaced).toBe(false);
  });

  it("is false for a batch over MAX_PATCH_OPS (rejected whole)", () => {
    const patches = Array.from({ length: 200_000 }, () => 0) as unknown as JsonPatchOperation[];
    expect(foldPatchIntoStage(rootBox, patches).mutated).toBe(false);
  });

  it("is false for a non-array patches field (rejected whole)", () => {
    expect(foldPatchIntoStage(rootBox, "nope" as unknown as []).mutated).toBe(false);
  });

  it("is false when every op fails salvage (nothing applied)", () => {
    // Both ops traverse INTO a node id that does not exist, so each throws in the
    // salvage loop and nothing is applied — a `remove` of a missing top-level key
    // would instead be a successful no-op delete, which correctly counts as applied.
    const patches: JsonPatchOperation[] = [
      { op: "remove", path: "/nodes/ghost/children/0" },
      { op: "replace", path: "/nodes/missing/value", value: "x" },
    ];
    expect(foldPatchIntoStage(rootBox, patches).mutated).toBe(false);
  });

  it("is false for a `test`-only batch (a passing guard changes nothing)", () => {
    const patches: JsonPatchOperation[] = [{ op: "test", path: "/root", value: "root" }];
    expect(foldPatchIntoStage(rootBox, patches).mutated).toBe(false);
  });
});

describe("foldPatchIntoStage — appear/scroll/onHold junk parity with validateTree", () => {
  it("strips junk appear/scroll/onHold written by a live patch, identically to validateTree", () => {
    const junkyNode = {
      id: "junky",
      type: "box",
      style: { appear: "explode", scroll: "sideways" },
      onHold: 42,
      children: [],
    };
    const patches: JsonPatchOperation[] = [
      { op: "add", path: "/nodes/junky", value: junkyNode },
      { op: "add", path: "/nodes/root/children/0", value: "junky" },
    ];
    const folded = foldPatchIntoStage(rootBox, patches);
    const junky = folded.tree.nodes["junky"] as unknown as {
      style?: Record<string, unknown>;
      onHold?: unknown;
    };
    expect(junky).toBeDefined();
    expect(junky.style?.["appear"]).toBeUndefined();
    expect(junky.style?.["scroll"]).toBeUndefined();
    expect(junky.onHold).toBeUndefined();
    expect(folded.issues.some((i) => i.includes("onHold"))).toBe(true);
    expect(folded.issues.some((i) => i.includes("onPress"))).toBe(false);

    // Client re-fold parity: the SAME junk pushed through validateTree directly
    // yields the exact same sanitized node — fold and tree paths never drift.
    const { tree } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: {}, children: ["junky"] },
        junky: junkyNode,
      },
    });
    expect(folded.tree.nodes["junky"]).toEqual(tree.nodes["junky"]);
  });

  it("folds valid appear/scroll/onHold through intact (kept vocabulary, no issues)", () => {
    const patches: JsonPatchOperation[] = [
      {
        op: "add",
        path: "/nodes/panel",
        value: {
          id: "panel",
          type: "box",
          style: { appear: "slide", scroll: true },
          onHold: { name: "peek" },
          children: [],
        },
      },
      { op: "add", path: "/nodes/root/children/0", value: "panel" },
    ];
    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(issues).toHaveLength(0);
    const panel = tree.nodes["panel"] as unknown as {
      style?: Record<string, unknown>;
      onHold?: unknown;
    };
    expect(panel.style?.["appear"]).toBe("slide");
    expect(panel.style?.["scroll"]).toBe("y");
    // legacy bare {name} is stamped kind:"agent" by the shared normalization
    expect(panel.onHold).toEqual({ kind: "agent", name: "peek" });
  });
});

describe("foldPatchIntoStage — brick-vocab v1 validation parity", () => {
  it("folds media, scroll axes, and columns through the shared sanitizer", () => {
    const patches: JsonPatchOperation[] = [
      {
        op: "add",
        path: "/nodes/carousel",
        value: {
          id: "carousel",
          type: "box",
          style: { scroll: "x", columns: 3 },
          children: ["clip", "legacy"],
        },
      },
      {
        op: "add",
        path: "/nodes/clip",
        value: {
          id: "clip",
          type: "media",
          kind: "video",
          src: "https://cdn.example.com/clip.mp4",
          poster: "/poster.png",
          controls: true,
        },
      },
      {
        op: "add",
        path: "/nodes/legacy",
        value: {
          id: "legacy",
          type: "image",
          src: "https://picsum.photos/seed/legacy/600/400",
          alt: "legacy",
        },
      },
      { op: "add", path: "/nodes/root/children/0", value: "carousel" },
    ];

    const folded = foldPatchIntoStage(rootBox, patches);
    expect(folded.issues).toHaveLength(0);
    expect(folded.tree.nodes["carousel"]).toMatchObject({
      type: "box",
      style: { scroll: "x", columns: 3 },
    });
    expect(folded.tree.nodes["clip"]).toMatchObject({
      type: "media",
      kind: "video",
      poster: "/poster.png",
      controls: true,
    });
    expect(folded.tree.nodes["legacy"]).toMatchObject({ type: "media", kind: "image" });

    const direct = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: {}, children: ["carousel"] },
        carousel: {
          id: "carousel",
          type: "box",
          style: { scroll: "x", columns: 3 },
          children: ["clip", "legacy"],
        },
        clip: {
          id: "clip",
          type: "media",
          kind: "video",
          src: "https://cdn.example.com/clip.mp4",
          poster: "/poster.png",
          controls: true,
        },
        legacy: {
          id: "legacy",
          type: "image",
          src: "https://picsum.photos/seed/legacy/600/400",
          alt: "legacy",
        },
      },
    });
    expect(folded.tree).toEqual(direct.tree);
  });

  it("strips junk media kind, scroll axis, and columns with bounded issues", () => {
    const patches: JsonPatchOperation[] = [
      {
        op: "add",
        path: "/nodes/junky",
        value: {
          id: "junky",
          type: "box",
          style: { scroll: "sideways", columns: "lots" },
          children: ["badMedia"],
        },
      },
      {
        op: "add",
        path: "/nodes/badMedia",
        value: {
          id: "badMedia",
          type: "media",
          kind: "gif3d",
          src: "https://cdn.example.com/bad.gif",
        },
      },
      { op: "add", path: "/nodes/root/children/0", value: "junky" },
    ];

    const { tree, issues } = foldPatchIntoStage(rootBox, patches);
    expect(tree.nodes["badMedia"]).toBeUndefined();
    const junky = tree.nodes["junky"] as unknown as { style?: Record<string, unknown> };
    expect(junky.style?.["scroll"]).toBeUndefined();
    expect(junky.style?.["columns"]).toBeUndefined();
    expect(issues.some((issue) => issue.includes("media"))).toBe(true);
    expect(issues.some((issue) => issue.includes("scroll"))).toBe(true);
    expect(issues.some((issue) => issue.includes("columns"))).toBe(true);
    expect(issues.join("\n").length).toBeLessThan(500);
  });
});

describe("foldPatchIntoStage — dropped-op list is bounded", () => {
  it("a large all-throwing salvage yields at most a bounded issue list, no throw", () => {
    // Under the cap so the salvage loop runs (not the whole-batch reject); every
    // op throws, so the dropped list would be one-per-op without the bound.
    const patches = Array.from(
      { length: MAX_PATCH_OPS },
      () => 0,
    ) as unknown as JsonPatchOperation[];
    const run = (): readonly string[] => foldPatchIntoStage(rootBox, patches).issues;
    expect(run).not.toThrow();
    const issues = run();
    expect(issues.length).toBeLessThanOrEqual(65);
    // Spread-pushing the returned list must not blow the call stack downstream.
    expect(() => {
      const sink: string[] = [];
      sink.push(...issues);
    }).not.toThrow();
  });
});
