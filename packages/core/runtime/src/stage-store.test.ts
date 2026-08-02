import { describe, expect, it } from "vitest";

import { BOUNDS, validateCatalog, validateTheme } from "@facet/core";
import type {
  ComponentDocument,
  DataModel,
  FacetCatalog,
  FacetThemeExtensionDeclaration,
} from "@facet/core";

import { validTestTheme } from "../../../../test-support/theme-fixture.js";
import { bootstrapSession } from "./bootstrap.js";
import { MemoryStageStore, loadSession, validatePersistedSession } from "./stage-store.js";
import type { SessionIssue, StageStore } from "./stage-store.js";
import type { Session } from "./session.js";

function component(tag: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag,
    whenToUse: `Use ${tag} when the page needs it.`,
    props: {},
    acceptsChildren: false,
    ...overrides,
  };
}

function catalogRecord(): Record<string, unknown> {
  return {
    components: [
      component("Text", {
        props: {
          value: { type: "string", guidance: "Short text." },
          arg: { type: "string", guidance: "The event argument." },
        },
      }),
      component("Panel", {
        props: {},
        acceptsChildren: true,
      }),
      component("Screen", {
        props: {
          name: {
            type: "string",
            required: true,
            guidance: "The screen name the document entry selects.",
          },
        },
        acceptsChildren: true,
      }),
    ],
  };
}

function acceptedCatalog(source: Record<string, unknown>): FacetCatalog {
  const result = validateCatalog(source);
  if (!result.ok) {
    throw new Error(`expected catalog acceptance, got ${result.code} at ${result.at}`);
  }
  return result.catalog;
}

function catalogWithTextRecipe(): FacetCatalog {
  return acceptedCatalog({
    components: [
      component("Text", {
        props: {
          value: { type: "string", guidance: "Short text." },
          arg: { type: "string", guidance: "The event argument." },
        },
        themeRecipe: { tokens: { accent: "color" } },
      }),
      component("Panel", {
        props: {},
        acceptsChildren: true,
      }),
      component("Screen", {
        props: {
          name: {
            type: "string",
            required: true,
            guidance: "The screen name the document entry selects.",
          },
        },
        acceptsChildren: true,
      }),
    ],
  });
}

function scalar(value: string): { readonly kind: "scalar"; readonly value: string } {
  return { kind: "scalar", value };
}

function validDocument(): ComponentDocument {
  return {
    entry: "home",
    screens: ["n1"],
    nodes: {
      n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
      n2: { tag: "Text", props: { value: scalar("Ready") }, children: [] },
    },
  };
}

function baseSession(
  overrides: {
    readonly document?: ComponentDocument | null;
    readonly data?: DataModel;
    readonly stageRevision?: number;
  } = {},
): Session {
  const boot = bootstrapSession({
    catalog: catalogRecord() as unknown as FacetCatalog,
    theme: validTestTheme(),
  });
  if (!boot.ok) {
    throw new Error(`expected bootstrap acceptance, got ${boot.code}`);
  }
  const document = overrides.document ?? validDocument();
  return Object.freeze({
    ...boot.session,
    document,
    data: overrides.data ?? {},
    stageRevision: overrides.stageRevision ?? 0,
    phase: document === null ? "preparing" : "live",
  });
}

function withRevision(session: Session, stageRevision: number): Session {
  return Object.freeze({ ...session, stageRevision });
}

function snapshot(result: {
  readonly session: Session;
  readonly issues: readonly SessionIssue[];
}): unknown {
  return {
    issues: result.issues,
    phase: result.session.phase,
    stageRevision: result.session.stageRevision,
    data: result.session.data,
    document: result.session.document,
  };
}

function expectStableNormalization(stored: Session, expectsDocument: boolean): void {
  const before = JSON.stringify(stored);
  const first = validatePersistedSession(stored);
  const second = validatePersistedSession(stored);

  expect(first.issues.length).toBeGreaterThan(0);
  expect(first.session.document === null).toBe(!expectsDocument);
  expect(snapshot(second)).toEqual(snapshot(first));
  expect(JSON.stringify(stored)).toBe(before);
}

describe("MemoryStageStore CAS", () => {
  it("rejects a stale save with the current revision and never merges it", async () => {
    const store = new MemoryStageStore();
    const initial = baseSession();
    const updated = withRevision(initial, 1);

    await expect(store.save("session-a", initial, 0)).resolves.toEqual({ ok: true, revision: 0 });
    await expect(store.save("session-a", updated, 0)).resolves.toEqual({ ok: true, revision: 1 });
    await expect(store.save("session-a", initial, 0)).resolves.toEqual({
      ok: false,
      reason: "conflict",
      currentRevision: 1,
    });
    await expect(loadSession(store, "session-a")).resolves.toMatchObject({
      session: { stageRevision: 1 },
      issues: [],
    });
  });

  it("checks a live-authority guard at the persistence commit point", async () => {
    const store = new MemoryStageStore();
    const initial = baseSession();
    const updated = withRevision(initial, 1);

    await expect(store.save("session-a", initial, 0, () => true)).resolves.toEqual({
      ok: true,
      revision: 0,
    });
    await expect(store.save("session-a", updated, 0, () => false)).resolves.toEqual({
      ok: false,
      reason: "conflict",
      currentRevision: 0,
    });

    await expect(loadSession(store, "session-a")).resolves.toMatchObject({
      session: { stageRevision: 0 },
      issues: [],
    });
  });

  it("does not consult the live-authority guard after a stale CAS loses", async () => {
    const store = new MemoryStageStore();
    const initial = baseSession();
    const stale = withRevision(initial, 2);
    let guardCalls = 0;

    await store.save("session-a", initial, 0, () => true);
    await expect(
      store.save("session-a", stale, 1, () => {
        guardCalls += 1;
        return true;
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "conflict",
      currentRevision: 0,
    });

    expect(guardCalls).toBe(0);
    await expect(loadSession(store, "session-a")).resolves.toMatchObject({
      session: { stageRevision: 0 },
      issues: [],
    });
  });

  it("detaches saved and read-back session data from mutable accepted references", async () => {
    const store = new MemoryStageStore();
    const data = { rows: [{ name: "Ada", nested: { score: 1 } }] };
    const initial = baseSession({ data });

    await expect(store.save("session-a", initial, 0, () => true)).resolves.toEqual({
      ok: true,
      revision: 0,
    });
    data.rows[0]!.nested.score = 99;
    data.rows.push({ name: "Grace", nested: { score: 2 } });

    const firstRead = (await store.get("session-a")) as Session;
    expect(firstRead.data).toEqual({ rows: [{ name: "Ada", nested: { score: 1 } }] });

    (firstRead.data as { rows: Array<{ nested: { score: number } }> }).rows[0]!.nested.score = 77;

    await expect(loadSession(store, "session-a")).resolves.toMatchObject({
      session: { data: { rows: [{ name: "Ada", nested: { score: 1 } }] } },
      issues: [],
    });
  });

  it("allows a test-supplied custom store to satisfy the interface", async () => {
    class TestStore implements StageStore {
      stored: unknown | null = null;

      async get(): Promise<unknown | null> {
        return this.stored;
      }

      async save(
        _key: string,
        session: Session,
        _expectedRevision: number,
      ): Promise<{ readonly ok: true; readonly revision: number }> {
        this.stored = session;
        return { ok: true, revision: session.stageRevision };
      }
    }

    const store = new TestStore();

    await store.save("session-a", baseSession(), 0);

    expect((await loadSession(store, "session-a")).session.phase).toBe("live");
  });
});

describe("validatePersistedSession fail-safe restore", () => {
  it("degrades a cyclic restored document to a bounded safe subset", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
          n2: { tag: "Panel", props: {}, children: ["n1"] },
        },
      },
    });

    expectStableNormalization(stored, true);
  });

  it("degrades an over-B-03-depth restored document without unbounded recursion", () => {
    const nodes: Record<string, unknown> = {
      n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
    };
    for (let index = 2; index <= BOUNDS.elementDepth + 3; index += 1) {
      nodes[`n${index}`] = {
        tag: "Panel",
        props: {},
        children: index === BOUNDS.elementDepth + 3 ? [] : [`n${index + 1}`],
      };
    }
    const stored = baseSession({
      document: { entry: "home", screens: ["n1"], nodes: nodes as ComponentDocument["nodes"] },
    });

    expectStableNormalization(stored, true);
  });

  it("drops unknown tags and undeclared props from a restored document", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2", "n3"] },
          n2: { tag: "Unknown", props: {}, children: [] },
          n3: { tag: "Text", props: { value: scalar("ok"), rogue: scalar("no") }, children: [] },
        },
      },
    });

    const restored = validatePersistedSession(stored);

    expect(restored.issues.map((issue) => issue.code)).toEqual(["unknown_tag", "undeclared_prop"]);
    expect(restored.session.document?.nodes["n1"]?.children).toEqual([]);
  });

  it("treats prototype-named props as undeclared own props during restore", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: {
            tag: "Screen",
            props: { name: scalar("home"), constructor: scalar("pwn") },
            children: [],
          },
        },
      },
    });

    const restored = validatePersistedSession(stored);

    expect(restored.issues.map((issue) => issue.code)).toContain("undeclared_prop");
    expect(restored.issues.map((issue) => issue.at)).toContain(
      "document.nodes.n1.props.constructor",
    );
    expect(restored.session.document).toBeNull();
  });

  it("drops a restored node that is referenced from multiple parents", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2", "n3"] },
          n2: { tag: "Panel", props: {}, children: ["n4"] },
          n3: { tag: "Panel", props: {}, children: ["n4"] },
          n4: { tag: "Text", props: { value: scalar("shared") }, children: [] },
        },
      },
    });

    const restored = validatePersistedSession(stored);

    expect(restored.issues.map((issue) => issue.code)).toContain("duplicate_node_parent");
    expect(restored.session.document?.nodes["n2"]?.children).toEqual(["n4"]);
    expect(restored.session.document?.nodes["n3"]?.children).toEqual([]);
  });

  it("degrades an exact lowercase persisted arg past B-23 instead of preserving an actionable subtree", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2", "n3"] },
          n2: {
            tag: "Text",
            props: {
              value: scalar("bad"),
              arg: scalar("x".repeat(BOUNDS.collectedValueChars + 1)),
            },
            children: [],
          },
          n3: { tag: "Text", props: { value: scalar("ok") }, children: [] },
        },
      },
    });

    const restored = validatePersistedSession(stored);

    expect(restored.issues.map((issue) => issue.code)).toContain("event_arg_too_long");
    expect(restored.session.document?.nodes["n1"]?.children).toEqual(["n3"]);
    expect(restored.session.document?.nodes["n2"]).toBeUndefined();
  });

  it("falls back to a safe empty preparing session when the envelope is unusable", () => {
    const stored = baseSession({
      document: {
        entry: "missing",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: [] },
        },
      },
    });

    expectStableNormalization(stored, false);
  });

  it("restores a valid fallback theme for a recipe-owning catalog when the theme is corrupt", () => {
    const catalog = catalogWithTextRecipe();
    const theme = validTestTheme({
      catalog,
      recipes: { text: { accent: "#2563eb" } },
    });
    const boot = bootstrapSession({ catalog, theme });
    if (!boot.ok) {
      throw new Error(`expected bootstrap acceptance, got ${boot.code}`);
    }

    const restored = validatePersistedSession({
      ...boot.session,
      document: validDocument(),
      phase: "live",
      theme: null,
    });
    const themeResult = validateTheme(restored.session.theme, {
      catalog: restored.session.catalog,
      extensions: restored.session.themeExtensions,
    });

    expect(restored.issues.map((issue) => issue.code)).toContain("theme_not_an_object");
    expect(themeResult.ok).toBe(true);
    expect(restored.session.theme.recipes?.["text"]?.["accent"]).toBe("initial");
  });

  it("restores fallback extension tokens when extension declarations survived but theme did not", () => {
    const catalog = catalogWithTextRecipe();
    const themeExtensions: readonly FacetThemeExtensionDeclaration[] = Object.freeze([
      Object.freeze({
        namespace: "chart",
        tokens: Object.freeze({ seriesA: "color" }),
      }),
    ]);
    const theme = validTestTheme({
      catalog,
      themeExtensions,
      recipes: { text: { accent: "#2563eb" } },
      extensions: { chart: { seriesA: "#9333ea" } },
    });
    const boot = bootstrapSession({ catalog, theme, themeExtensions });
    if (!boot.ok) {
      throw new Error(`expected bootstrap acceptance, got ${boot.code}`);
    }

    const restored = validatePersistedSession({
      ...boot.session,
      document: validDocument(),
      phase: "live",
      theme: null,
    });
    const themeResult = validateTheme(restored.session.theme, {
      catalog: restored.session.catalog,
      extensions: restored.session.themeExtensions,
    });

    expect(restored.issues.map((issue) => issue.code)).toContain("theme_not_an_object");
    expect(themeResult.ok).toBe(true);
    expect(restored.session.theme.extensions?.["chart"]?.["seriesA"]).toBe("initial");
  });

  it("normalizes a throwing node getter instead of letting it survive into lanes", () => {
    const document = validDocument();
    const nodes = { ...document.nodes };
    Object.defineProperty(nodes, "n2", {
      get() {
        throw new Error("hostile node");
      },
    });
    const stored = baseSession({ document: { ...document, nodes } });
    const descriptorBefore = Object.getOwnPropertyDescriptor(nodes, "n2");

    const restored = validatePersistedSession(stored);

    expect(restored.issues.some((issue) => issue.code === "node_read_failed")).toBe(true);
    expect(restored.session.document?.nodes["n1"]?.children).toEqual([]);
    const descriptorAfter = Object.getOwnPropertyDescriptor(nodes, "n2");
    expect(descriptorAfter?.get).toBe(descriptorBefore?.get);
    expect(descriptorAfter?.enumerable).toBe(descriptorBefore?.enumerable);
    expect(descriptorAfter?.configurable).toBe(descriptorBefore?.configurable);
  });
});
