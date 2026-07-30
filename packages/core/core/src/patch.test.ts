import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import type { ComponentDocument } from "./document.js";
import { MAX_PATCH_OPS, applyPatch } from "./patch.js";
import type { JsonPatchOperation } from "./patch.js";
import type { FacetStage } from "./stage.js";

/**
 * A small but faithful document: one screen root holding one leaf, addressed the
 * way an authored mutation addresses it — `/document/nodes/<id>/…` over the flat
 * id-keyed map, never a positional path into a nested tree.
 */
function fixtureDocument(): ComponentDocument {
  return {
    entry: "Home",
    screens: ["n1"],
    nodes: {
      n1: {
        tag: "Screen",
        props: { name: { kind: "scalar", value: "Home" } },
        children: ["n2"],
      },
      n2: {
        tag: "Text",
        props: { content: { kind: "scalar", value: "hello" } },
        children: [],
      },
    },
  };
}

/** A fresh stage per test, so no test can observe another test's mutation. */
function fixtureStage(): FacetStage {
  return { document: fixtureDocument(), data: { rows: [1, 2, 3], greeting: "hi" } };
}

/** The document half, failing loudly when a test expected a live document. */
function documentOf(stage: FacetStage): ComponentDocument {
  if (stage.document === null) {
    throw new Error("expected a live document half");
  }
  return stage.document;
}

/** The data half as a readable record, for assertions on a published value. */
function dataOf(stage: FacetStage): Record<string, unknown> {
  return stage.data as Record<string, unknown>;
}

/**
 * Asserts an **atomic reject**: the fold answers with the prior stage *by
 * identity*, and the prior stage — `document` **and** `data` — is byte-identical
 * to what it was before the call. Identity alone would pass if the fold mutated
 * in place; the serialization alone would pass if the fold returned a fresh but
 * equal stage. Both together are the all-or-nothing claim.
 */
function expectRejected(stage: FacetStage, operations: readonly JsonPatchOperation[]): void {
  const before = JSON.stringify(stage);
  const priorDocument = stage.document;
  const priorData = stage.data;

  const result = applyPatch(stage, operations);

  expect(result).toBe(stage);
  expect(result.document).toBe(priorDocument);
  expect(result.data).toBe(priorData);
  expect(JSON.stringify(stage)).toBe(before);
}

/**
 * Asserts an **accepted** fold: a new stage is produced, the prior one is left
 * byte-identical, and the answer's own key set is exactly the two stage halves —
 * nothing smuggled in alongside them.
 */
function expectAccepted(stage: FacetStage, operations: readonly JsonPatchOperation[]): FacetStage {
  const before = JSON.stringify(stage);

  const result = applyPatch(stage, operations);

  expect(result).not.toBe(stage);
  expect(Object.keys(result)).toEqual(["document", "data"]);
  expect(JSON.stringify(stage)).toBe(before);
  return result;
}

/** Casts a deliberately illegal operation, which the typed union cannot express. */
function illegal(operation: unknown): JsonPatchOperation {
  return operation as JsonPatchOperation;
}

/** `n` legal append operations, used for the `MAX_PATCH_OPS` accept/reject pair. */
function appendOps(count: number): readonly JsonPatchOperation[] {
  const operations: JsonPatchOperation[] = [];
  for (let index = 0; index < count; index += 1) {
    operations.push({ op: "add", path: "/data/rows/-", value: index });
  }
  return operations;
}

describe("applyPatch — the authorized operation table", () => {
  it("folds an authored operation under /document", () => {
    const stage = fixtureStage();
    const result = expectAccepted(stage, [
      {
        op: "replace",
        path: "/document/nodes/n2/props/content",
        value: { kind: "scalar", value: "changed" },
      },
    ]);

    expect(documentOf(result).nodes["n2"]?.props["content"]).toEqual({
      kind: "scalar",
      value: "changed",
    });
    // The other half is carried through untouched.
    expect(result.data).toEqual({ rows: [1, 2, 3], greeting: "hi" });
  });

  it("adds and relinks a node the way an authored mutation does", () => {
    const stage = fixtureStage();
    const result = expectAccepted(stage, [
      {
        op: "add",
        path: "/document/nodes/n3",
        value: { tag: "Text", props: {}, children: [] },
      },
      { op: "add", path: "/document/nodes/n1/children/-", value: "n3" },
    ]);

    expect(documentOf(result).nodes["n3"]).toEqual({ tag: "Text", props: {}, children: [] });
    expect(documentOf(result).nodes["n1"]?.children).toEqual(["n2", "n3"]);
  });

  it("removes a node and its parent link", () => {
    const stage = fixtureStage();
    const result = expectAccepted(stage, [
      { op: "remove", path: "/document/nodes/n1/children/0" },
      { op: "remove", path: "/document/nodes/n2" },
    ]);

    expect(Object.keys(documentOf(result).nodes)).toEqual(["n1"]);
    expect(documentOf(result).nodes["n1"]?.children).toEqual([]);
  });

  it("folds a publish operation under /data", () => {
    const stage = fixtureStage();
    const result = expectAccepted(stage, [{ op: "add", path: "/data/sales", value: { q1: 10 } }]);

    expect(dataOf(result)["sales"]).toEqual({ q1: 10 });
    // The other half is carried through untouched.
    expect(result.document).toEqual(fixtureDocument());
  });

  it("replaces and removes inside the data half, including into an array", () => {
    const stage = fixtureStage();
    const result = expectAccepted(stage, [
      { op: "replace", path: "/data/greeting", value: "bye" },
      { op: "add", path: "/data/rows/-", value: 4 },
      { op: "add", path: "/data/rows/0", value: 0 },
    ]);

    expect(dataOf(result)["greeting"]).toBe("bye");
    expect(dataOf(result)["rows"]).toEqual([0, 1, 2, 3, 4]);

    const removed = expectAccepted(result, [{ op: "remove", path: "/data/greeting" }]);
    expect(Object.prototype.hasOwnProperty.call(removed.data, "greeting")).toBe(false);
  });

  it("replaces a whole half: /document back to null, /data back to empty", () => {
    const preparing = expectAccepted(fixtureStage(), [
      { op: "replace", path: "/document", value: null },
    ]);
    expect(preparing.document).toBeNull();
    expect(preparing.data).toEqual({ rows: [1, 2, 3], greeting: "hi" });

    const cleared = expectAccepted(fixtureStage(), [{ op: "replace", path: "/data", value: {} }]);
    expect(cleared.data).toEqual({});
    expect(cleared.document).toEqual(fixtureDocument());
  });

  it("rejects exact-root raw markup document writes without blocking document objects", () => {
    const rawMarkup = '<Facet entry="home"><Screen name="home" /></Facet>';
    expectRejected(fixtureStage(), [{ op: "add", path: "/document", value: rawMarkup }]);
    expectRejected(fixtureStage(), [{ op: "replace", path: "/document", value: rawMarkup }]);

    const result = expectAccepted(fixtureStage(), [
      { op: "replace", path: "/document", value: fixtureDocument() },
    ]);
    expect(result.document).toEqual(fixtureDocument());
  });

  it("root-replaces the ENTIRE stage on a resync, both halves atomically", () => {
    const stage = fixtureStage();
    const resynced: FacetStage = {
      document: {
        entry: "Other",
        screens: ["n7"],
        nodes: {
          n7: { tag: "Screen", props: { name: { kind: "scalar", value: "Other" } }, children: [] },
        },
      },
      data: { totals: { revenue: 42 } },
    };

    const result = expectAccepted(stage, [{ op: "replace", path: "", value: resynced }]);

    expect(result.document).toEqual(resynced.document);
    expect(result.data).toEqual(resynced.data);
    // Not a document-only snapshot: the data half moved with it.
    expect(result.data).not.toEqual(stage.data);
  });

  it("resyncs a stage the prior one could not even be cloned from", () => {
    // A corrupt in-memory stage is exactly when a resync must still work: the
    // root replace never reads the prior root, so it does not depend on it.
    const corrupt = { document: null, data: { boom: () => undefined } } as unknown as FacetStage;
    const clean: FacetStage = { document: fixtureDocument(), data: { ok: true } };

    const result = applyPatch(corrupt, [{ op: "replace", path: "", value: clean }]);

    expect(result).not.toBe(corrupt);
    expect(result.data).toEqual({ ok: true });
    expect(result.document).toEqual(fixtureDocument());
  });

  it("returns a fresh stage for an empty batch, so identity is a reliable oracle", () => {
    const stage = fixtureStage();
    const result = applyPatch(stage, []);

    expect(result).not.toBe(stage);
    expect(JSON.stringify(result)).toBe(JSON.stringify(stage));
  });
});

describe("applyPatch — the unauthorized operation table", () => {
  const unauthorized: readonly (readonly [string, JsonPatchOperation])[] = [
    // The three RFC 6902 operations Facet does not authorize.
    ["move", illegal({ op: "move", from: "/data/greeting", path: "/data/moved" })],
    ["copy", illegal({ op: "copy", from: "/data/greeting", path: "/data/copied" })],
    ["test", illegal({ op: "test", path: "/data/greeting", value: "hi" })],
    // Anything outside the vocabulary at all.
    ["an invented op", illegal({ op: "append", path: "/data/rows", value: 1 })],
    ["a missing op", illegal({ path: "/data/greeting", value: "x" })],
    ["a non-string op", illegal({ op: 7, path: "/data/greeting", value: "x" })],
    // Operation objects carrying anything beyond their exact key set.
    ["an extra member", illegal({ op: "remove", path: "/data/greeting", value: "hi" })],
    ["a smuggled from", illegal({ op: "replace", path: "/data/greeting", value: "x", from: "/" })],
    ["a missing value", illegal({ op: "replace", path: "/data/greeting" })],
    ["a non-string path", illegal({ op: "replace", path: 7, value: "x" })],
    // Pointers that are not stage pointers.
    ["a relative pointer", illegal({ op: "replace", path: "data/greeting", value: "x" })],
    ["an unknown stage half", illegal({ op: "add", path: "/other", value: 1 })],
    ["a near-miss half", illegal({ op: "add", path: "/documents/nodes/n2", value: 1 })],
    ["an invalid tilde escape", illegal({ op: "add", path: "/data/a~2b", value: 1 })],
    ["a dangling tilde escape", illegal({ op: "add", path: "/data/a~", value: 1 })],
    // The old document-rooted vocabulary: the fold is stage-rooted, never this.
    [
      "a document-rooted pointer",
      illegal({ op: "replace", path: "/nodes/n2/props/content", value: { kind: "scalar" } }),
    ],
    ["a document-rooted entry", illegal({ op: "replace", path: "/entry", value: "Other" })],
    // The root is a resync, and a resync is a replace — nothing else.
    ["an add at the root", illegal({ op: "add", path: "", value: { document: null, data: {} } })],
    ["a remove at the root", illegal({ op: "remove", path: "" })],
    // Prototype-chain tokens, anywhere in the pointer.
    ["__proto__", illegal({ op: "add", path: "/data/__proto__/polluted", value: 1 })],
    ["prototype", illegal({ op: "add", path: "/data/prototype", value: 1 })],
    ["constructor", illegal({ op: "add", path: "/document/nodes/constructor", value: 1 })],
    // Ordinary RFC 6902 application failures are rejects, not exceptions.
    ["a missing target", illegal({ op: "remove", path: "/data/absent" })],
    ["a replace of an absent key", illegal({ op: "replace", path: "/data/absent", value: 1 })],
    ["an out-of-range index", illegal({ op: "replace", path: "/data/rows/9", value: 1 })],
    ["a padded index", illegal({ op: "replace", path: "/data/rows/01", value: 1 })],
    ["an append token on replace", illegal({ op: "replace", path: "/data/rows/-", value: 1 })],
    ["a walk through a scalar", illegal({ op: "add", path: "/data/greeting/deeper", value: 1 })],
  ];

  for (const [label, operation] of unauthorized) {
    it(`rejects ${label} with the entire stage unchanged`, () => {
      expectRejected(fixtureStage(), [operation]);
    });
  }

  it("rejects a root replace whose value is not a stage", () => {
    const notStages: readonly unknown[] = [
      42,
      null,
      [],
      "stage",
      { document: null },
      { data: {} },
      { document: null, data: {}, extra: 1 },
      { document: 7, data: {} },
      { document: null, data: null },
      { document: null, data: [] },
    ];
    for (const value of notStages) {
      expectRejected(fixtureStage(), [illegal({ op: "replace", path: "", value })]);
    }
  });

  it("rejects any batch that would leave the stage without both halves", () => {
    expectRejected(fixtureStage(), [{ op: "remove", path: "/data" }]);
    expectRejected(fixtureStage(), [{ op: "remove", path: "/document" }]);
    expectRejected(fixtureStage(), [{ op: "replace", path: "/data", value: 42 }]);
    expectRejected(fixtureStage(), [{ op: "add", path: "/extra", value: 1 }]);
  });

  it("never pollutes Object.prototype through a rejected pointer", () => {
    expectRejected(fixtureStage(), [
      illegal({ op: "add", path: "/data/__proto__/polluted", value: "yes" }),
    ]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("applyPatch — atomicity", () => {
  it("discards every earlier operation when a later one is unauthorized", () => {
    const stage = fixtureStage();
    expectRejected(stage, [
      { op: "add", path: "/data/first", value: 1 },
      { op: "replace", path: "/document/nodes/n2/props/content", value: { kind: "scalar" } },
      illegal({ op: "move", from: "/data/rows/0", path: "/data/rows/2" }),
    ]);
  });

  it("discards every earlier operation when a later one simply fails to apply", () => {
    const stage = fixtureStage();
    expectRejected(stage, [
      { op: "add", path: "/data/first", value: 1 },
      { op: "add", path: "/data/second", value: 2 },
      { op: "remove", path: "/data/absent" },
    ]);
  });

  it("advances the stage when the same batch is legal — the assertions are not vacuous", () => {
    const stage = fixtureStage();
    const result = expectAccepted(stage, [
      { op: "add", path: "/data/first", value: 1 },
      { op: "add", path: "/data/second", value: 2 },
    ]);

    expect(dataOf(result)["first"]).toBe(1);
    expect(dataOf(result)["second"]).toBe(2);
  });

  it("never aliases an operation's value into the stage", () => {
    const stage = fixtureStage();
    const operations: readonly JsonPatchOperation[] = [
      { op: "add", path: "/data/nested", value: { items: ["a"] } },
      { op: "add", path: "/data/nested/items/-", value: "b" },
    ];
    const payload = JSON.stringify(operations);

    const result = applyPatch(stage, operations);

    expect((dataOf(result)["nested"] as { items: string[] }).items).toEqual(["a", "b"]);
    // The caller's patch payload is what the server forwards to the browser; a
    // fold that inserted by reference would have appended "b" into it too.
    expect(JSON.stringify(operations)).toBe(payload);
  });
});

describe("applyPatch — the batch bound", () => {
  it("accepts a batch at MAX_PATCH_OPS and rejects the one exactly past it", () => {
    const atLimit = appendOps(MAX_PATCH_OPS);
    const onePast = appendOps(MAX_PATCH_OPS + 1);
    expect(onePast.length - atLimit.length).toBe(1);

    const accepted = expectAccepted(fixtureStage(), atLimit);
    expect((dataOf(accepted)["rows"] as readonly unknown[]).length).toBe(3 + MAX_PATCH_OPS);

    expectRejected(fixtureStage(), onePast);
  });

  it("leaves headroom above the largest batch a bounded mutation can produce", () => {
    // B-02 bounds nodes per mutation; the widest authored batch is one write per
    // node plus one parent relink. A cap below that would make a legal mutation
    // unfoldable, so the two are pinned against each other here.
    expect(MAX_PATCH_OPS).toBeGreaterThan(2 * BOUNDS.nodesPerMutation);
  });
});

describe("applyPatch — totality", () => {
  it("never throws, whatever the operation list is", () => {
    const stage = fixtureStage();
    const hostile: readonly unknown[] = [
      undefined,
      null,
      "not a list",
      42,
      [undefined],
      [null],
      ["not an operation"],
      [{ op: "add" }],
      { length: 1 },
    ];
    for (const operations of hostile) {
      expect(() => applyPatch(stage, operations as readonly JsonPatchOperation[])).not.toThrow();
      expect(applyPatch(stage, operations as readonly JsonPatchOperation[])).toBe(stage);
    }
  });

  it("never throws on a value the structured clone cannot carry", () => {
    const stage = fixtureStage();
    const uncloneable: readonly unknown[] = [
      () => undefined,
      Symbol("nope"),
      { nested: () => undefined },
    ];
    for (const value of uncloneable) {
      expectRejected(stage, [illegal({ op: "add", path: "/data/x", value })]);
    }
  });

  it("never throws on a throwing getter or a corrupt prior stage", () => {
    const throwing = {
      document: null,
      get data(): never {
        throw new Error("hostile getter");
      },
    } as unknown as FacetStage;

    expect(() => applyPatch(throwing, [{ op: "add", path: "/data/x", value: 1 }])).not.toThrow();
    expect(applyPatch(throwing, [{ op: "add", path: "/data/x", value: 1 }])).toBe(throwing);

    const corrupt = { document: null } as unknown as FacetStage;
    expect(() => applyPatch(corrupt, [{ op: "add", path: "/data/x", value: 1 }])).not.toThrow();
    expect(applyPatch(corrupt, [{ op: "add", path: "/data/x", value: 1 }])).toBe(corrupt);
  });

  it("terminates on a deeply nested pointer instead of exhausting the stack", () => {
    const stage = fixtureStage();
    const deep = `/data/${Array.from({ length: 10_000 }, (_unused, index) => `k${index}`).join("/")}`;

    expect(() => applyPatch(stage, [{ op: "add", path: deep, value: 1 }])).not.toThrow();
    expectRejected(stage, [{ op: "add", path: deep, value: 1 }]);
  });
});

describe("applyPatch — the fold is the same on server and browser", () => {
  it("is pure: the same prior stage and batch always produce the same answer", () => {
    const operations: readonly JsonPatchOperation[] = [
      { op: "add", path: "/data/sales", value: { q1: 10 } },
      { op: "replace", path: "/document/nodes/n2/props/content", value: { kind: "scalar" } },
    ];

    const server = applyPatch(fixtureStage(), operations);
    const browser = applyPatch(fixtureStage(), operations);

    expect(JSON.stringify(browser)).toBe(JSON.stringify(server));
  });

  it("folds a batch step by step to the same stage it folds in one call", () => {
    const first: JsonPatchOperation = { op: "add", path: "/data/a", value: 1 };
    const second: JsonPatchOperation = { op: "add", path: "/data/b", value: 2 };

    const together = applyPatch(fixtureStage(), [first, second]);
    const stepwise = applyPatch(applyPatch(fixtureStage(), [first]), [second]);

    expect(JSON.stringify(stepwise)).toBe(JSON.stringify(together));
  });
});
