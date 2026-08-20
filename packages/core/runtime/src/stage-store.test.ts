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
    content: { mode: "none" },
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
      component("ActionButton", {
        props: {
          action: {
            type: "string",
            required: true,
            action: true,
            guidance: "The action reference.",
          },
        },
      }),
      component("Meter", {
        props: {
          amount: {
            type: "number",
            required: true,
            minimum: 1,
            maximum: 5,
            guidance: "A bounded amount.",
          },
        },
      }),
      component("Panel", {
        props: {},
        content: { mode: "children" },
      }),
      component("Image", {
        props: {
          asset: {
            type: "string",
            required: true,
            assetKind: "image",
            guidance: "The host-pinned image asset.",
          },
          alt: { type: "string", required: true, guidance: "Alternative text." },
        },
      }),
      component("Split", {
        content: {
          mode: "slots",
          slots: {
            primary: {
              guidance: "The required primary region.",
              minChildren: 1,
              maxChildren: 1,
              allowedTags: ["Text"],
            },
          },
        },
      }),
      component("Screen", {
        props: {
          name: {
            type: "string",
            required: true,
            guidance: "The screen name the document entry selects.",
          },
        },
        content: { mode: "children" },
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
        content: { mode: "children" },
      }),
      component("Screen", {
        props: {
          name: {
            type: "string",
            required: true,
            guidance: "The screen name the document entry selects.",
          },
        },
        content: { mode: "children" },
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
    assetRegistry: {
      hero: { kind: "image", src: "https://cdn.example.test/hero.png" },
    },
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
  it("preserves a component node's slot through save and read-back", async () => {
    const store = new MemoryStageStore();
    const session = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
          n2: { tag: "Split", props: {}, children: ["n3"] },
          n3: {
            tag: "Text",
            slot: "primary",
            props: { value: scalar("Ready") },
            children: [],
          },
        },
      },
    });

    await expect(store.save("session-a", session, 0)).resolves.toEqual({
      ok: true,
      revision: 0,
    });

    await expect(loadSession(store, "session-a")).resolves.toMatchObject({
      session: { document: { nodes: { n3: { slot: "primary" } } } },
      issues: [],
    });
  });

  it("preserves host-pinned assets and asset references through save and read-back", async () => {
    const store = new MemoryStageStore();
    const session = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
          n2: {
            tag: "Image",
            props: {
              asset: { kind: "reference", scheme: "asset", target: "hero" },
              alt: scalar("Hero"), // component-hard-cut: allowed-negative
            },
            children: [],
          },
        },
      },
    });

    await store.save("session-assets", session, 0);
    const restored = await loadSession(store, "session-assets");

    expect(restored.issues).toEqual([]);
    expect(restored.session.assetRegistry["hero"]?.src).toBe("https://cdn.example.test/hero.png");
    expect(restored.session.document?.nodes["n2"]?.props["asset"]).toEqual({
      kind: "reference",
      scheme: "asset",
      target: "hero",
    });
  });

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
  it("drops children restored beneath a component with content mode none", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
          n2: { tag: "Text", props: { value: scalar("parent") }, children: ["n3"] },
          n3: { tag: "Text", props: { value: scalar("child") }, children: [] },
        },
      },
    });

    const restored = validatePersistedSession(stored);

    expect(restored.issues.map((entry) => entry.code)).toContain("children_not_allowed");
    expect(restored.session.document?.nodes["n1"]?.children).toEqual([]);
  });

  it("drops a restored node with a malformed slot", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
          n2: {
            tag: "Text",
            slot: "not a slot",
            props: { value: scalar("bad") },
            children: [],
          },
        },
      } as unknown as ComponentDocument,
    });

    const restored = validatePersistedSession(stored);

    expect(restored.issues.map((entry) => entry.code)).toContain("invalid_slot");
    expect(restored.session.document?.nodes["n1"]?.children).toEqual([]);
  });

  it("drops structured children that omit their required slot", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
          n2: { tag: "Split", props: {}, children: ["n3"] },
          n3: { tag: "Text", props: { value: scalar("Unslotted") }, children: [] },
        },
      },
    });

    const restored = validatePersistedSession(stored);

    expect(restored.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["missing_child_slot", "missing_slot_children"]),
    );
    expect(restored.session.document?.nodes["n1"]?.children).toEqual([]);
    expect(restored.session.document?.nodes["n2"]).toBeUndefined();
    expect(restored.session.document?.nodes["n3"]).toBeUndefined();
  });

  it("drops named-slot children from an ordinary container", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
          n2: { tag: "Panel", props: {}, children: ["n3"] },
          n3: {
            tag: "Text",
            slot: "primary",
            props: { value: scalar("Misplaced") },
            children: [],
          },
        },
      },
    });

    const restored = validatePersistedSession(stored);

    expect(restored.issues.map((entry) => entry.code)).toContain("slot_not_accepted");
    expect(restored.session.document?.nodes["n2"]?.children).toEqual([]);
    expect(restored.session.document?.nodes["n3"]).toBeUndefined();
  });

  it("enforces structured slot names, allowed tags, and maximum cardinality", () => {
    const unknownSlot = validatePersistedSession(
      baseSession({
        document: {
          entry: "home",
          screens: ["n1"],
          nodes: {
            n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
            n2: { tag: "Split", props: {}, children: ["n3"] },
            n3: {
              tag: "Text",
              slot: "secondary",
              props: { value: scalar("Unknown slot") },
              children: [],
            },
          },
        },
      }),
    );
    expect(unknownSlot.issues.map((entry) => entry.code)).toContain("unknown_slot");
    expect(unknownSlot.session.document?.nodes["n2"]).toBeUndefined();

    const wrongTag = validatePersistedSession(
      baseSession({
        document: {
          entry: "home",
          screens: ["n1"],
          nodes: {
            n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
            n2: { tag: "Split", props: {}, children: ["n3"] },
            n3: { tag: "Panel", slot: "primary", props: {}, children: [] },
          },
        },
      }),
    );
    expect(wrongTag.issues.map((entry) => entry.code)).toContain("slot_tag_not_allowed");
    expect(wrongTag.session.document?.nodes["n2"]).toBeUndefined();

    const tooMany = validatePersistedSession(
      baseSession({
        document: {
          entry: "home",
          screens: ["n1"],
          nodes: {
            n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
            n2: { tag: "Split", props: {}, children: ["n3", "n4"] },
            n3: {
              tag: "Text",
              slot: "primary",
              props: { value: scalar("First") },
              children: [],
            },
            n4: {
              tag: "Text",
              slot: "primary",
              props: { value: scalar("Second") },
              children: [],
            },
          },
        },
      }),
    );
    expect(tooMany.issues.map((entry) => entry.code)).toContain("too_many_slot_children");
    expect(tooMany.session.document?.nodes["n2"]?.children).toEqual(["n3"]);
    expect(tooMany.session.document?.nodes["n4"]).toBeUndefined();
  });

  it("drops persisted event arguments that are references", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
          n2: {
            tag: "Text",
            props: {
              value: scalar("Unsafe argument"),
              arg: { kind: "reference", scheme: "agent", target: "admin" },
            },
            children: [],
          },
        },
      },
    });

    const restored = validatePersistedSession(stored);

    expect(restored.issues.map((entry) => entry.code)).toContain("event_arg_not_literal");
    expect(restored.session.document?.nodes["n1"]?.children).toEqual([]);
  });

  it("bounds corrupt child and screen arrays during restoration", () => {
    const children = Array.from(
      { length: BOUNDS.nodesPerDocument + 100 },
      (_, index) => `missing${index}`,
    );
    const started = Date.now();
    const restored = validatePersistedSession(
      baseSession({
        document: {
          entry: "home",
          screens: Array.from({ length: BOUNDS.screensPerDocument + 1 }, () => "n1"),
          nodes: {
            n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
            n2: { tag: "Panel", props: {}, children },
          },
        },
      }),
    );

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(restored.issues.map((entry) => entry.code)).toContain("too_many_nodes");
    expect(restored.issues.map((entry) => entry.code)).toContain("too_many_screens");
    expect(restored.issues.length).toBeLessThanOrEqual(BOUNDS.nodesPerDocument + 70);
  });

  it("counts non-string child entries against the restoration node budget", () => {
    const restored = validatePersistedSession(
      baseSession({
        document: {
          entry: "home",
          screens: ["n1"],
          nodes: {
            n1: {
              tag: "Screen",
              props: { name: scalar("home") },
              children: new Array(BOUNDS.nodesPerDocument * 2).fill(null),
            },
          },
        },
      }),
    );

    expect(restored.issues.map((entry) => entry.code)).toContain("too_many_nodes");
    expect(restored.issues.length).toBeLessThanOrEqual(BOUNDS.nodesPerDocument + 1);
  });

  it("drops an over-bound persisted scalar before it reaches a component", () => {
    const restored = validatePersistedSession(
      baseSession({
        document: {
          entry: "home",
          screens: ["n1"],
          nodes: {
            n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
            n2: {
              tag: "Text",
              props: { value: scalar("x".repeat(BOUNDS.attributeValueChars + 1)) },
              children: [],
            },
          },
        },
      }),
    );

    expect(restored.issues.map((entry) => entry.code)).toContain("attribute_value_too_long");
    expect(restored.session.document?.nodes["n2"]).toBeUndefined();
  });

  it("rejects a restored screen root assigned to a slot", () => {
    const stored = baseSession({
      document: {
        entry: "home",
        screens: ["n1"],
        nodes: {
          n1: {
            tag: "Screen",
            slot: "primary",
            props: { name: scalar("home") },
            children: [],
          },
        },
      },
    });

    const restored = validatePersistedSession(stored);

    expect(restored.issues.map((entry) => entry.code)).toContain("invalid_screen_slot");
    expect(restored.session.document).toBeNull();
  });

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

  it.each([
    {
      label: "an out-of-range number",
      tag: "Meter",
      props: { amount: scalar("6") },
    },
    {
      label: "a data reference on a non-bindable prop",
      tag: "Text",
      props: { value: { kind: "reference", scheme: "data", target: "status" } },
    },
    {
      label: "a scalar value on an action prop",
      tag: "ActionButton",
      props: { action: scalar("agent:run") },
    },
    {
      label: "an agent reference on an ordinary string prop",
      tag: "Text",
      props: { value: { kind: "reference", scheme: "agent", target: "run" } },
    },
    {
      label: "a nav reference on an ordinary string prop",
      tag: "Text",
      props: { value: { kind: "reference", scheme: "nav", target: "home" } },
    },
  ])("drops a restored node with $label", ({ tag, props }) => {
    const restored = validatePersistedSession(
      baseSession({
        data: { status: "ready" },
        document: {
          entry: "home",
          screens: ["n1"],
          nodes: {
            n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2"] },
            n2: { tag, props, children: [] },
          },
        } as ComponentDocument,
      }),
    );

    expect(restored.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid_prop_value",
        at: expect.stringMatching(/^document\.nodes\.n2\.props\./),
      }),
    );
    expect(restored.session.document?.nodes["n1"]?.children).toEqual([]);
    expect(restored.session.document?.nodes["n2"]).toBeUndefined();
  });

  it("preserves valid scalar, numeric, and action-reference counterparts", () => {
    const restored = validatePersistedSession(
      baseSession({
        document: {
          entry: "home",
          screens: ["n1"],
          nodes: {
            n1: {
              tag: "Screen",
              props: { name: scalar("home") },
              children: ["n2", "n3", "n4"],
            },
            n2: { tag: "Text", props: { value: scalar("Ready") }, children: [] },
            n3: { tag: "Meter", props: { amount: scalar("5") }, children: [] },
            n4: {
              tag: "ActionButton",
              props: { action: { kind: "reference", scheme: "agent", target: "run" } },
              children: [],
            },
          },
        },
      }),
    );

    expect(restored.issues.map((issue) => issue.code)).not.toContain("invalid_prop_value");
    expect(restored.session.document?.nodes["n1"]?.children).toEqual(["n2", "n3", "n4"]);
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
