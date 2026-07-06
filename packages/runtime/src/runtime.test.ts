import { describe, expect, it, vi } from "vitest";
import type {
  ClientEvent,
  CollectedEvent,
  FacetAgent,
  FacetTree,
  ServerMessage,
} from "@facet/core";
import { EMPTY_TREE, foldPatchIntoStage, MAX_PATCH_OPS } from "@facet/core";
import { FacetRuntime } from "./runtime.js";
import { MemoryStageStore, type StageStore } from "./stage-store.js";
import { withInitialStage } from "./assets.js";
import type { Sink, StoredEvent } from "./sink.js";

const visitor = { visitorId: "v" };

/**
 * Replays the DELIVERED server frames the way a browser client does: each patch
 * frame folded with the SAME shared `foldPatchIntoStage`, starting from the
 * client's initial tree. The redesign's invariant is that this equals the
 * server's stored stage with no corrective frame ever appended.
 */
const clientFold = (
  messages: readonly ServerMessage[],
  base: FacetTree = EMPTY_TREE,
): FacetTree => {
  let tree = base;
  for (const m of messages) {
    if (m.kind === "patch") tree = foldPatchIntoStage(tree, m.patches).tree;
  }
  return tree;
};
const agentOf =
  (...messages: ServerMessage[]): FacetAgent =>
  () =>
    Promise.resolve(messages);

const validTree = {
  root: "root",
  nodes: { root: { id: "root", type: "box" as const, children: [] } },
};
const renderPatch: ServerMessage = {
  kind: "patch",
  patches: [{ op: "replace", path: "", value: validTree }],
};

const appendTextBatch = (id: string, value = id): readonly ServerMessage[] => [
  {
    kind: "patch",
    patches: [
      { op: "add", path: "/nodes/root/children/-", value: id },
      { op: "add", path: `/nodes/${id}`, value: { id, type: "text", value } },
    ],
  },
];

describe("FacetRuntime.handle", () => {
  it("applies patch messages to the stored stage", async () => {
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(renderPatch, { kind: "say", text: "done" }),
    });
    await rt.handle(visitor, { kind: "message", text: "hi" });
    const stage = await rt.stageFor("v");
    expect(stage?.root).toBe("root");
    expect(stage?.nodes["root"]).toMatchObject({ type: "box", children: [] });
  });

  it("leaves the stage unchanged for a say-only response", async () => {
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf({ kind: "say", text: "hi" }) });
    await rt.handle(visitor, { kind: "message", text: "hi" });
    const stage = await rt.stageFor("v");
    expect(stage?.nodes["root"]).toBeDefined(); // still the EMPTY_TREE root, no crash
  });

  it("records the interaction to the sink", async () => {
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf({ kind: "say", text: "hi" }) });
    await rt.handle(visitor, { kind: "message", text: "ask" });
    const history = await rt.historyFor("v");
    expect(history).toHaveLength(1);
    expect(history[0]?.event).toMatchObject({ text: "ask" });
  });

  it("coalesces a turn's patch messages so a forward ref between them is NOT pruned", async () => {
    // Stage.say() flushes pending ops mid-turn, so one turn can arrive as
    // [patch(add child ref "x"), say, patch(add node x)]. Folding each message
    // separately would prune the not-yet-resolvable "x" from root.children; the
    // whole turn must fold as one so the ref and its node land together.
    const addChild: ServerMessage = {
      kind: "patch",
      patches: [{ op: "add", path: "/nodes/root/children/-", value: "x" }],
    };
    const addNode: ServerMessage = {
      kind: "patch",
      patches: [{ op: "add", path: "/nodes/x", value: { id: "x", type: "text", value: "hi" } }],
    };
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(addChild, { kind: "say", text: "working" }, addNode),
    });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    const stage = await rt.stageFor("v");
    expect((stage?.nodes["root"] as unknown as { children: string[] }).children).toEqual(["x"]);
    expect(stage?.nodes["x"]).toBeDefined();
    // Exactly one coalesced patch message is delivered, carrying BOTH ops, at the
    // first patch position (the say keeps its relative order after it).
    const patches = out.messages.filter((m) => m.kind === "patch");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.kind === "patch" && patches[0].patches).toHaveLength(2);
    expect(out.messages.map((m) => m.kind)).toEqual(["patch", "say"]);
    // Client folds exactly the coalesced batch the server folded → no drift.
    expect(clientFold(out.messages)).toEqual(stage);
  });

  it("never throws on a turn whose patch message carries a huge junk-op array", async () => {
    // An in-process agent can hand applyToSession a message the wire cap never
    // saw. The fold caps its issue list and the runtime pushes issues one at a
    // time, so an oversize op array can't RangeError the never-throwing turn.
    const junk: ServerMessage = {
      kind: "patch",
      patches: Array.from({ length: 200_000 }, () => 0) as never,
    };
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(junk, { kind: "say", text: "ok" }),
    });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    expect(out.messages.some((m) => m.kind === "say")).toBe(true);
    expect(await rt.stageFor("v")).toBeDefined(); // stage survived, no throw
  });

  it("drops malformed non-array patch messages instead of delivering them", async () => {
    const badPatch = { kind: "patch", patches: null } as unknown as ServerMessage;
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(badPatch, { kind: "say", text: "still" }),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await rt.handle(visitor, { kind: "message", text: "hi" });

      expect(out.messages).toEqual([{ kind: "say", text: "still" }]);
      expect(await rt.stageFor("v")).toEqual(EMPTY_TREE);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("drops non-JSON-serializable messages before saving or delivering them", async () => {
    const badPatch = {
      kind: "patch",
      patches: [
        {
          op: "add",
          path: "/nodes/big",
          value: { id: "big", type: "text", value: 1n },
        },
      ],
    } as unknown as ServerMessage;
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(badPatch, { kind: "say", text: "still" }),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await rt.handle(visitor, { kind: "message", text: "hi" });

      expect(out.messages).toEqual([{ kind: "say", text: "still" }]);
      expect(await rt.stageFor("v")).toEqual(EMPTY_TREE);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("normalizes JSON-lossy patch messages before folding or delivering them", async () => {
    const lossyPatch = {
      kind: "patch",
      patches: [
        {
          op: "add",
          path: "/nodes/json",
          value: { id: "json", type: "text", value: "json", dropped: () => undefined },
        },
        { op: "add", path: "/nodes/root/children/-", value: "json" },
      ],
    } as unknown as ServerMessage;
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(lossyPatch),
    });

    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    const stage = await rt.stageFor("v");

    expect(out.messages).toEqual([
      {
        kind: "patch",
        patches: [
          {
            op: "add",
            path: "/nodes/json",
            value: { id: "json", type: "text", value: "json" },
          },
          { op: "add", path: "/nodes/root/children/-", value: "json" },
        ],
      },
    ]);
    expect(stage?.nodes["json"]).toMatchObject({ type: "text", value: "json" });
    expect(clientFold(out.messages)).toEqual(stage);
  });

  it("fail-safe: a bad patch op is dropped but the say still returns (no lost turn)", async () => {
    const badPatch: ServerMessage = {
      kind: "patch",
      // append to a parent that doesn't exist → applyPatch throws
      patches: [{ op: "add", path: "/nodes/missing/children/-", value: "x" }],
    };
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(badPatch, { kind: "say", text: "still here" }),
    });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    expect(out.messages.map((m) => m.kind)).toEqual(["patch", "say"]); // both returned, no throw
    expect(await rt.stageFor("v")).toBeDefined(); // stage survived
  });

  it("sanitizes a bad root replace (render null); the client fold converges with NO corrective frame", async () => {
    const nullReplace: ServerMessage = {
      kind: "patch",
      patches: [{ op: "replace", path: "", value: null }],
    };
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf(nullReplace) });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    const stage = await rt.stageFor("v");
    expect(stage?.nodes["root"]).toBeDefined(); // validateTree restored a valid tree, not null
    // No synthetic frame is appended — the delivered list is exactly the agent's.
    expect(out.messages).toEqual([nullReplace]);
    // The client folds the SAME `replace "" null` with foldPatchIntoStage and
    // lands on the identical sanitized tree — no divergence to correct.
    expect(clientFold(out.messages)).toEqual(stage);
  });

  it("persists sink records in event order with an async sink", async () => {
    // The first record resolves after a delay, the second immediately. With a
    // raw fire-and-forget record the fast second would persist before the slow
    // first; a per-session serial queue must keep completion order [e1, e2].
    const persisted: string[] = [];
    const sink: Sink = {
      record: (_agentId: string, _visitorId: string, entry: StoredEvent): Promise<void> => {
        const text = (entry.event as { text?: string }).text;
        const delay = text === "e1" ? 20 : 0;
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            if (text !== undefined) persisted.push(text);
            resolve();
          }, delay);
        });
      },
      history: (): Promise<readonly StoredEvent[]> => Promise.resolve([]),
    };
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf({ kind: "say", text: "ok" }),
      sink,
    });
    await rt.handle(visitor, { kind: "message", text: "e1" });
    await rt.handle(visitor, { kind: "message", text: "e2" });
    // Let the delayed first record settle before asserting order.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(persisted).toEqual(["e1", "e2"]);
  });

  it("records only the agent's own messages into the sink, not the prepended seed frame", async () => {
    const seedTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box" as const, children: ["s"] },
        s: { id: "s", type: "text" as const, value: "seed" },
      },
    };
    const records: StoredEvent[] = [];
    const sink: Sink = {
      record: (_agentId: string, _visitorId: string, entry: StoredEvent): Promise<void> => {
        records.push(entry);
        return Promise.resolve();
      },
      history: (): Promise<readonly StoredEvent[]> => Promise.resolve([]),
    };
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf({ kind: "say", text: "hi" }),
      stageStore: withInitialStage(new MemoryStageStore(), seedTree),
      sink,
    });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    // The DELIVERED list leads with the seed frame (needed for client delivery)…
    expect(out.messages.some((m) => m.kind === "patch")).toBe(true);
    // …but the SINK entry must record only the agent's own say — no patch-kind
    // message — so replayed history never claims "(page updated)" on a say-only
    // seeded first turn, nor stores the seed tree JSON per visitor.
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the record settle
    expect(records).toHaveLength(1);
    expect(records[0]?.messages.some((m) => m.kind === "patch")).toBe(false);
  });

  it("serializes concurrent same-visitor events (no lost update)", async () => {
    let n = 0;
    const agent: FacetAgent = () => {
      n += 1;
      const id = `n${String(n)}`;
      return Promise.resolve([
        {
          kind: "patch",
          patches: [
            { op: "add", path: `/nodes/${id}`, value: { id, type: "text", value: id } },
            { op: "add", path: "/nodes/root/children/-", value: id },
          ],
        } as ServerMessage,
      ]);
    };
    const rt = new FacetRuntime({ agentId: "a", agent });
    await Promise.all([
      rt.handle(visitor, { kind: "message", text: "1" }),
      rt.handle(visitor, { kind: "message", text: "2" }),
    ]);
    const stage = await rt.stageFor("v");
    const root = stage?.nodes["root"] as { children: string[] } | undefined;
    expect(root?.children).toHaveLength(2); // both applied, neither overwrote the other
  });
});

describe("FacetRuntime.handle — stream batches", () => {
  it("streams yielded batches in order, saves each batch, and records one accumulated event", async () => {
    async function* agent(): AsyncIterable<readonly ServerMessage[]> {
      yield appendTextBatch("one");
      yield [{ kind: "say", text: "halfway" }, ...appendTextBatch("two")];
    }
    const frames: ServerMessage[][] = [];
    const rt = new FacetRuntime({ agentId: "a", agent });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" }, (messages) => {
      frames.push([...messages]);
    });

    expect(out.messages).toEqual([]);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual(appendTextBatch("one"));
    expect(frames[1]?.map((m) => m.kind)).toEqual(["say", "patch"]);

    const stage = await rt.stageFor("v");
    expect((stage?.nodes["root"] as { children: string[] } | undefined)?.children).toEqual([
      "one",
      "two",
    ]);
    expect(clientFold(frames.flat())).toEqual(stage);

    const history = await rt.historyFor("v");
    expect(history).toHaveLength(1);
    expect(history[0]?.messages).toEqual([...appendTextBatch("one"), ...frames[1]!]);
  });

  it("records accumulated batches and keeps the partial stage when a stream throws mid-turn", async () => {
    async function* agent(): AsyncIterable<readonly ServerMessage[]> {
      yield appendTextBatch("one");
      yield appendTextBatch("two");
      throw new Error("provider failed");
    }
    const frames: ServerMessage[][] = [];
    const rt = new FacetRuntime({ agentId: "a", agent });

    await expect(
      rt.handle(visitor, { kind: "message", text: "hi" }, (messages) => {
        frames.push([...messages]);
      }),
    ).resolves.toMatchObject({ messages: [], agentMutated: true });

    expect(frames).toEqual([appendTextBatch("one"), appendTextBatch("two")]);
    const stage = await rt.stageFor("v");
    expect((stage?.nodes["root"] as { children: string[] } | undefined)?.children).toEqual([
      "one",
      "two",
    ]);
    const history = await rt.historyFor("v");
    expect(history).toHaveLength(1);
    expect(history[0]?.messages).toEqual([...appendTextBatch("one"), ...appendTextBatch("two")]);
  });

  it("prepends a seed frame to the first non-empty streamed batch only", async () => {
    const seedTree: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["seed"] },
        seed: { id: "seed", type: "text", value: "seed" },
      },
    };
    async function* agent(): AsyncIterable<readonly ServerMessage[]> {
      yield [];
      yield [{ kind: "say", text: "first" }];
      yield [{ kind: "say", text: "second" }];
    }
    const frames: ServerMessage[][] = [];
    const rt = new FacetRuntime({
      agentId: "a",
      agent,
      stageStore: withInitialStage(new MemoryStageStore(), seedTree),
    });

    await rt.handle(visitor, { kind: "message", text: "hi" }, (messages) => {
      frames.push([...messages]);
    });

    expect(frames).toHaveLength(2);
    expect(frames[0]?.map((m) => m.kind)).toEqual(["patch", "say"]);
    expect(frames[0]?.[0]).toEqual({
      kind: "patch",
      patches: [{ op: "replace", path: "", value: seedTree }],
    });
    expect(frames[1]).toEqual([{ kind: "say", text: "second" }]);

    const secondTurnFrames: ServerMessage[][] = [];
    await rt.handle(visitor, { kind: "message", text: "again" }, (messages) => {
      secondTurnFrames.push([...messages]);
    });
    expect(secondTurnFrames.flat().some((m) => m.kind === "patch")).toBe(false);
  });

  it("skips all-test batches without consuming the seed before the next non-empty batch", async () => {
    const seedTree: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["seed"] },
        seed: { id: "seed", type: "text", value: "seed" },
      },
    };
    async function* agent(): AsyncIterable<readonly ServerMessage[]> {
      yield [{ kind: "patch", patches: [{ op: "test", path: "/root", value: "root" }] }];
      yield [{ kind: "say", text: "ready" }];
    }
    const frames: ServerMessage[][] = [];
    const rt = new FacetRuntime({
      agentId: "a",
      agent,
      stageStore: withInitialStage(new MemoryStageStore(), seedTree),
    });

    await rt.handle(visitor, { kind: "message", text: "hi" }, (messages) => {
      frames.push([...messages]);
    });

    expect(frames).toHaveLength(1);
    expect(frames[0]?.map((m) => m.kind)).toEqual(["patch", "say"]);
    expect(frames[0]?.[0]).toEqual({
      kind: "patch",
      patches: [{ op: "replace", path: "", value: seedTree }],
    });
  });

  it("returns streamed batches in order when no frame sink is provided", async () => {
    async function* agent(): AsyncIterable<readonly ServerMessage[]> {
      yield appendTextBatch("one");
      yield [{ kind: "say", text: "two" }];
    }
    const rt = new FacetRuntime({ agentId: "a", agent });

    const out = await rt.handle(visitor, { kind: "message", text: "hi" });

    expect(out.messages).toEqual([...appendTextBatch("one"), { kind: "say", text: "two" }]);
    expect((await rt.historyFor("v"))[0]?.messages).toEqual(out.messages);
  });

  it("delivers a pending seed even when a seeded streamed turn produces no agent batch", async () => {
    const seedTree: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["seed"] },
        seed: { id: "seed", type: "text", value: "seed" },
      },
    };
    async function* agent(): AsyncIterable<readonly ServerMessage[]> {
      yield [];
      yield [{ kind: "patch", patches: [{ op: "test", path: "/root", value: "root" }] }];
    }
    const frames: ServerMessage[][] = [];
    const rt = new FacetRuntime({
      agentId: "a",
      agent,
      stageStore: withInitialStage(new MemoryStageStore(), seedTree),
    });

    const out = await rt.handle(visitor, { kind: "message", text: "hi" }, (messages) => {
      frames.push([...messages]);
    });

    expect(out.agentMutated).toBe(false);
    expect(frames).toEqual([
      [{ kind: "patch", patches: [{ op: "replace", path: "", value: seedTree }] }],
    ]);
    expect((await rt.historyFor("v"))[0]?.messages).toEqual([]);
  });

  it("keeps a pending seed armed when the seed-only frame sink throws", async () => {
    const seedTree: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["seed"] },
        seed: { id: "seed", type: "text", value: "seed" },
      },
    };
    async function* agent(): AsyncIterable<readonly ServerMessage[]> {
      yield [];
      yield [{ kind: "patch", patches: [{ op: "test", path: "/root", value: "root" }] }];
    }
    const rt = new FacetRuntime({
      agentId: "a",
      agent,
      stageStore: withInitialStage(new MemoryStageStore(), seedTree),
    });

    await expect(
      rt.handle(visitor, { kind: "message", text: "hi" }, () => {
        throw new Error("closed");
      }),
    ).resolves.toMatchObject({ messages: [], agentMutated: false });
    expect((await rt.historyFor("v"))[0]?.messages).toEqual([]);

    const frames: ServerMessage[][] = [];
    await rt.handle(visitor, { kind: "message", text: "again" }, (messages) => {
      frames.push([...messages]);
    });
    expect(frames).toEqual([
      [{ kind: "patch", patches: [{ op: "replace", path: "", value: seedTree }] }],
    ]);
  });

  it("records persisted streamed batches and closes the iterator after a later save failure", async () => {
    let session = { agentId: "a", visitor, stage: EMPTY_TREE };
    let saveCalls = 0;
    const store: StageStore = {
      get: () => Promise.resolve(session),
      open: () => Promise.resolve(session),
      save: (next) => {
        saveCalls += 1;
        if (saveCalls === 2) return Promise.reject(new Error("save failed"));
        session = next;
        return Promise.resolve();
      },
    };
    let cleanedUp = false;
    async function* agent(): AsyncIterable<readonly ServerMessage[]> {
      try {
        yield appendTextBatch("one");
        yield appendTextBatch("two");
      } finally {
        cleanedUp = true;
      }
    }
    const frames: ServerMessage[][] = [];
    const rt = new FacetRuntime({ agentId: "a", agent, stageStore: store });

    const out = await rt.handle(visitor, { kind: "message", text: "hi" }, (messages) => {
      frames.push([...messages]);
    });

    expect(out.agentMutated).toBe(true);
    expect(frames).toEqual([appendTextBatch("one")]);
    expect((session.stage.nodes["root"] as unknown as { children: string[] }).children).toEqual([
      "one",
    ]);
    expect((await rt.historyFor("v"))[0]?.messages).toEqual(appendTextBatch("one"));
    expect(cleanedUp).toBe(true);
  });

  it("records persisted streamed batches and closes the iterator when the frame sink throws", async () => {
    let pulledSecond = false;
    let cleanedUp = false;
    async function* agent(): AsyncIterable<readonly ServerMessage[]> {
      try {
        yield appendTextBatch("one");
        pulledSecond = true;
        yield appendTextBatch("two");
      } finally {
        cleanedUp = true;
      }
    }
    const rt = new FacetRuntime({ agentId: "a", agent });

    const out = await rt.handle(visitor, { kind: "message", text: "hi" }, () => {
      throw new Error("delivery failed");
    });

    expect(out).toEqual({ messages: [], agentMutated: true });
    expect(pulledSecond).toBe(false);
    expect(cleanedUp).toBe(true);
    expect(
      ((await rt.stageFor("v"))?.nodes["root"] as unknown as { children: string[] }).children,
    ).toEqual(["one"]);
    expect((await rt.historyFor("v"))[0]?.messages).toEqual(appendTextBatch("one"));
  });

  it("drops malformed streamed batch values without losing already-persisted batches", async () => {
    async function* agent(): AsyncIterable<readonly ServerMessage[]> {
      yield appendTextBatch("one");
      yield {} as never;
    }
    const frames: ServerMessage[][] = [];
    const rt = new FacetRuntime({ agentId: "a", agent });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await rt.handle(visitor, { kind: "message", text: "hi" }, (messages) => {
        frames.push([...messages]);
      });

      expect(out).toEqual({ messages: [], agentMutated: true });
      expect(frames).toEqual([appendTextBatch("one")]);
      expect((await rt.historyFor("v"))[0]?.messages).toEqual(appendTextBatch("one"));
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("FacetRuntime.handle — agentMutated is effect-based", () => {
  it("agentMutated is true for a turn that actually edits the stage", async () => {
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(renderPatch, { kind: "say", text: "done" }),
    });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    expect(out.agentMutated).toBe(true);
  });

  it("agentMutated is false when every patch op fails salvage (stage untouched)", async () => {
    // The agent emits a patch, but every op targets a node id that no longer
    // exists, so the fold applies nothing. The turn carried a patch MESSAGE but
    // mutated the stage NOT AT ALL — agentMutated must be false so the transport
    // does not advance lastApplied and stale a parked late result.
    const allFail: ServerMessage = {
      kind: "patch",
      patches: [
        { op: "remove", path: "/nodes/ghost/children/0" }, // ghost missing → throws
        { op: "replace", path: "/nodes/missing/value", value: "x" }, // missing → throws
      ],
    };
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(allFail, { kind: "say", text: "still here" }),
    });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    expect(out.agentMutated).toBe(false);
    expect(out.messages.some((m) => m.kind === "say" && m.text === "still here")).toBe(true);
    expect(await rt.stageFor("v")).toEqual(EMPTY_TREE); // stage byte-identical to pre-turn
  });

  it("agentMutated is false for a say-only turn", async () => {
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf({ kind: "say", text: "hi" }) });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    expect(out.agentMutated).toBe(false);
  });
});

describe("FacetRuntime stored-vs-client convergence (shared fold, no corrective frame)", () => {
  // Each case is a former divergence trigger. The runtime now folds patches with
  // the SAME shared foldPatchIntoStage the client runs, so the stored stage
  // ALWAYS equals the client's fold of the delivered frames — and NO synthetic
  // corrective frame is ever appended (the delivered list is exactly the agent's).
  const sharedChildTree = {
    root: "root",
    nodes: {
      root: { id: "root", type: "box" as const, children: ["b1", "b2"] },
      b1: { id: "b1", type: "box" as const, children: ["shared"] },
      b2: { id: "b2", type: "box" as const, children: ["shared"] },
      shared: { id: "shared", type: "text" as const, value: "hi" },
    },
  };
  const replaceWith = (value: unknown): ServerMessage => ({
    kind: "patch",
    patches: [{ op: "replace", path: "", value }],
  });

  it("cross-parent shared child collapses; delivered frames are the agent's own and the client fold matches", async () => {
    const patch = replaceWith(sharedChildTree);
    const say: ServerMessage = { kind: "say", text: "done" };
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf(patch, say) });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    const stored = await rt.stageFor("v");
    // Stored stage lost the second reference to the shared child.
    expect((stored?.nodes["b2"] as { children: string[] } | undefined)?.children).toEqual([]);
    // No corrective frame: delivered list is byte-identical to the agent's messages.
    expect(out.messages).toEqual([patch, say]);
    // Client fold of the delivered frames equals the stored stage.
    expect(clientFold(out.messages)).toEqual(stored);
  });

  it("records only the agent's own messages (no synthetic frame reaches the sink)", async () => {
    const records: StoredEvent[] = [];
    const sink: Sink = {
      record: (_agentId: string, _visitorId: string, entry: StoredEvent): Promise<void> => {
        records.push(entry);
        return Promise.resolve();
      },
      history: (): Promise<readonly StoredEvent[]> => Promise.resolve([]),
    };
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(replaceWith(sharedChildTree)),
      sink,
    });
    await rt.handle(visitor, { kind: "message", text: "hi" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(records).toHaveLength(1);
    expect(records[0]?.messages.filter((m) => m.kind === "patch")).toHaveLength(1);
  });

  it("a clean turn delivers the agent's messages byte-identically", async () => {
    const say: ServerMessage = { kind: "say", text: "done" };
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf(renderPatch, say) });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    expect(out.messages).toEqual([renderPatch, say]);
    expect(clientFold(out.messages)).toEqual(await rt.stageFor("v"));
  });

  // A header node legitimately parented under TWO SCREEN roots — validateTree
  // KEEPS this (claimed resets per walk root). The client fold reproduces it
  // exactly, so no correction is needed and none is sent.
  const crossScreenTree: FacetTree = {
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: [] },
      header: { id: "header", type: "text", value: "shared header" },
      home: { id: "home", type: "box", children: ["header", "homeBody"] },
      homeBody: { id: "homeBody", type: "text", value: "home" },
      about: { id: "about", type: "box", children: ["header", "aboutBody"] },
      aboutBody: { id: "aboutBody", type: "text", value: "about" },
    },
    screens: { home: "home", about: "about" },
    entry: "home",
  };

  it("cross-screen shared node: client fold keeps it under both screens, matching stored", async () => {
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf(replaceWith(crossScreenTree)) });
    const out = await rt.handle(visitor, { kind: "message", text: "build" });
    const stored = await rt.stageFor("v");
    expect((stored?.nodes["home"] as unknown as { children: string[] }).children).toContain(
      "header",
    );
    expect((stored?.nodes["about"] as unknown as { children: string[] }).children).toContain(
      "header",
    );
    expect(clientFold(out.messages)).toEqual(stored);
  });

  it("a patch pointing a screen at a TEXT node: screen dropped, client fold matches", async () => {
    const tree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box" as const, children: ["txt"] },
        txt: { id: "txt", type: "text" as const, value: "not a screen root" },
      },
      screens: { promo: "txt" },
      entry: "promo",
    };
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf(replaceWith(tree)) });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    const stored = await rt.stageFor("v");
    expect(stored?.screens).toBeUndefined();
    expect(clientFold(out.messages)).toEqual(stored);
  });

  it("a replace /root to a dangling id (a 'root' node exists): client fold matches across both turns", async () => {
    const rt = new FacetRuntime({
      agentId: "a",
      agent: (event) =>
        Promise.resolve(
          (event as ClientEvent).kind === "message" && (event as { text?: string }).text === "build"
            ? [renderPatch]
            : [{ kind: "patch", patches: [{ op: "replace", path: "/root", value: "ghost" }] }],
        ),
    });
    const build = await rt.handle(visitor, { kind: "message", text: "build" });
    const out = await rt.handle(visitor, { kind: "message", text: "break" });
    const stored = await rt.stageFor("v");
    expect(stored?.root).toBe("root"); // fell back to the node keyed "root"
    // Fold BOTH turns' delivered frames, exactly as a client that saw both.
    expect(clientFold([...build.messages, ...out.messages])).toEqual(stored);
  });

  it("a mixed batch (one throwing op + one good op) is salvaged identically on both sides", async () => {
    const mixed: ServerMessage = {
      kind: "patch",
      patches: [
        { op: "remove", path: "/nodes/ghost/children/0" }, // stale → throws
        { op: "add", path: "/nodes/good", value: { id: "good", type: "text", value: "kept" } },
      ],
    };
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(mixed, { kind: "say", text: "ok" }),
    });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    const stored = await rt.stageFor("v");
    expect(stored?.nodes["good"]).toBeDefined(); // salvaged op reached the stored stage
    // No corrective frame; the client folds the SAME batch with per-op salvage
    // (foldPatchIntoStage) and lands on the identical stored stage.
    expect(out.messages).toEqual([mixed, { kind: "say", text: "ok" }]);
    expect(clientFold(out.messages)).toEqual(stored);
  });
});

describe("FacetRuntime.record", () => {
  it("record persists a collected tap without invoking the agent", async () => {
    // A local navigate/toggle tap is resolved entirely in the renderer (no agent
    // turn) but must still land in the log so replay reproduces what the visitor
    // saw. `record` persists the CollectedEvent with `messages: []` and NEVER
    // calls the agent (DC-001 / DC-005).
    const agent = vi.fn(agentOf({ kind: "say", text: "unused" }));
    const rt = new FacetRuntime({ agentId: "a", agent });
    const tap: CollectedEvent = { kind: "tap", target: "x", effect: { navigate: "pricing" } };
    await rt.record(visitor, tap);
    const history = await rt.historyFor("v");
    expect(history).toHaveLength(1);
    expect(history[0]?.event).toEqual(tap);
    expect(history[0]?.messages).toEqual([]); // record carries no agent messages
    expect(agent).not.toHaveBeenCalled(); // the brain is never invoked
  });

  it("two records and one turn persist in append order (send order, not sink latency)", async () => {
    // DC-002 at the runtime level: `record` rides the SAME per-visitor
    // `serializeRecord` queue as `persist`, so append order == send order even
    // when the FIRST record's sink write is the slowest. history() order is the
    // gap-detection join key, so it must be send order, never `at`.
    const persisted: string[] = [];
    const sink: Sink = {
      record: (_agentId: string, _visitorId: string, entry: StoredEvent): Promise<void> => {
        const label =
          entry.event.kind === "tap" ? entry.event.target : (entry.event as { text?: string }).text;
        const delay = label === "a" ? 20 : 0; // first record's write is the slowest
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            if (label !== undefined) persisted.push(label);
            resolve();
          }, delay);
        });
      },
      history: (): Promise<readonly StoredEvent[]> => Promise.resolve([]),
    };
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf({ kind: "say", text: "c" }),
      sink,
    });
    const p1 = rt.record(visitor, { kind: "tap", target: "a", effect: { navigate: "a" } });
    const p2 = rt.record(visitor, { kind: "tap", target: "b", effect: { navigate: "b" } });
    const p3 = rt.handle(visitor, { kind: "message", text: "c" });
    await Promise.all([p1, p2, p3]);
    // handle's record is fire-and-forget off the response path — let the slow
    // first record (and the trailing turn record) settle before asserting order.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(persisted).toEqual(["a", "b", "c"]);
  });

  it("record enqueued after a slow handle still persists in send order (no external lane)", async () => {
    // The in-process transports have NO outer per-visitor lane (only @facet/server
    // does). A visitor sends an agent tap (→ handle, SLOW turn) then a local
    // navigate tap (→ record). handle must RESERVE its Sink-write slot on
    // serializeRecord synchronously at call time so the later record can't enqueue
    // its write first. Without that reservation the fast record settles before the
    // still-in-flight handle even enqueues, reversing the append log (the ordered
    // replay/join key). Expected send order is [E1, R1], never [R1, E1].
    let releaseAgent!: () => void;
    const agentGate = new Promise<void>((resolve) => {
      releaseAgent = resolve;
    });
    const slowAgent: FacetAgent = async () => {
      await agentGate; // the turn stays in flight until released
      return [{ kind: "say", text: "E1" }];
    };
    const rt = new FacetRuntime({ agentId: "a", agent: slowAgent });
    const handled = rt.handle(visitor, { kind: "message", text: "E1" }); // agent tap → handle
    const recorded = rt.record(visitor, { kind: "tap", target: "R1", effect: { navigate: "R1" } }); // local tap → record
    releaseAgent(); // now let the slow handle finish and persist its record
    await Promise.all([handled, recorded]);
    const history = await rt.historyFor("v");
    const labels = history.map((e) =>
      e.event.kind === "tap" ? e.event.target : (e.event as { text?: string }).text,
    );
    expect(labels).toEqual(["E1", "R1"]); // send order, NOT [R1, E1]
  });

  it("a throwing agent turn records nothing and does not wedge the visitor's record queue", async () => {
    // The reserved Sink-write slot (reserveRecordSlot) blocks on `await ready`;
    // only the caller's catch resolving it to null drains it. A turn whose AGENT
    // THROWS must resolve that slot (records nothing) so the visitor's
    // serializeRecord queue is not permanently wedged — a later record must still
    // drain. AWAIT the later record to completion so a deadlock TIMES OUT here.
    const throwingAgent: FacetAgent = () => {
      throw new Error("boom");
    };
    const rt = new FacetRuntime({ agentId: "a", agent: throwingAgent });
    await expect(rt.handle(visitor, { kind: "message", text: "E" })).rejects.toThrow("boom");
    expect(await rt.historyFor("v")).toHaveLength(0); // the throwing turn recorded nothing

    // SAME visitor: a later local tap must still drain (the slot was released by
    // resolveRecord(null), not stuck on `await ready`).
    const tap: CollectedEvent = { kind: "tap", target: "R", effect: { navigate: "R" } };
    await rt.record(visitor, tap); // AWAIT to completion — a wedged queue would never settle
    const history = await rt.historyFor("v");
    expect(history).toHaveLength(1);
    expect(history[0]?.event).toEqual(tap); // R drained after the throwing turn
  });

  it("a save-rejecting turn resolves the record slot to null and a later record still drains", async () => {
    // `save` rejecting AFTER the agent ran: handle's catch must resolveRecord(null)
    // so the reserved slot drains (records nothing) instead of blocking the queue.
    // open() returns a session WITHOUT saving, so the turn reaches persist()'s save.
    const saveRejectStore: StageStore = {
      get: () => Promise.resolve(undefined),
      open: (agentId, visitor) => Promise.resolve({ agentId, visitor, stage: EMPTY_TREE }),
      save: () => Promise.reject(new Error("save failed")),
    };
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(renderPatch, { kind: "say", text: "hi" }),
      stageStore: saveRejectStore,
    });
    await expect(rt.handle(visitor, { kind: "message", text: "E" })).rejects.toThrow("save failed");
    expect(await rt.historyFor("v")).toHaveLength(0); // nothing persisted for the failed turn

    // SAME visitor: a later record must still drain (catch's resolveRecord(null) fired).
    const tap: CollectedEvent = { kind: "tap", target: "R2", effect: { navigate: "R2" } };
    await rt.record(visitor, tap); // AWAIT to completion — a deadlocked queue would hang
    const history = await rt.historyFor("v");
    expect(history).toHaveLength(1);
    expect(history[0]?.event).toEqual(tap); // R2 drained after the save-rejecting turn
  });
});

describe("FacetRuntime.applyMessages", () => {
  it("applyMessages applies a late result through the per-visitor queue", async () => {
    // agentOf() with no messages: applyMessages must NOT call the agent — it
    // applies already-produced messages. The stage change + sink record come
    // entirely from the passed-in batch.
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf() });
    const event: ClientEvent = { kind: "message", text: "late" };
    const messages: ServerMessage[] = [renderPatch, { kind: "say", text: "late reply" }];
    const out = await rt.applyMessages(visitor, event, messages);
    expect(out.messages).toEqual(messages); // returned so the transport can deliver them
    const stage = await rt.stageFor("v");
    expect(stage?.root).toBe("root"); // late patch persisted to the stored session
    const history = await rt.historyFor("v");
    expect(history).toHaveLength(1);
    expect(history[0]?.event).toMatchObject({ text: "late" }); // recorded with the given event
    expect(history[0]?.messages).toEqual(messages);
  });

  it("applies a late result in enqueue order when racing handle for the same visitor", async () => {
    // handle's agent is slow; applyMessages has no agent and would win a raw
    // race. Both go through the same per-visitor serial queue, so the final
    // stage must reflect ENQUEUE order (handle first, then applyMessages).
    const slowAgent: FacetAgent = () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve([
              {
                kind: "patch",
                patches: [
                  { op: "add", path: "/nodes/h", value: { id: "h", type: "text", value: "h" } },
                  { op: "add", path: "/nodes/root/children/-", value: "h" },
                ],
              } as ServerMessage,
            ]),
          20,
        ),
      );
    const rt = new FacetRuntime({ agentId: "a", agent: slowAgent });
    const lateMessages: ServerMessage[] = [
      {
        kind: "patch",
        patches: [
          { op: "add", path: "/nodes/m", value: { id: "m", type: "text", value: "m" } },
          { op: "add", path: "/nodes/root/children/-", value: "m" },
        ],
      },
    ];
    const handled = rt.handle(visitor, { kind: "message", text: "hi" });
    const applied = rt.applyMessages(visitor, { kind: "message", text: "late" }, lateMessages);
    await Promise.all([handled, applied]);
    const stage = await rt.stageFor("v");
    const root = stage?.nodes["root"] as { children: string[] } | undefined;
    expect(root?.children).toEqual(["h", "m"]); // enqueue order despite the delay
  });

  it("salvages good ops in a late batch when one op is stale (DC-008)", async () => {
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf() });
    const messages: ServerMessage[] = [
      {
        kind: "patch",
        patches: [
          // stale: the node this op targets no longer exists → applyPatch throws
          { op: "remove", path: "/nodes/ghost/children/0" },
          { op: "add", path: "/nodes/good", value: { id: "good", type: "text", value: "kept" } },
        ],
      },
      { kind: "say", text: "late" },
    ];
    const out = await rt.applyMessages(visitor, { kind: "message", text: "x" }, messages);
    expect(out.messages.some((m) => m.kind === "say" && m.text === "late")).toBe(true); // say kept
    const stage = await rt.stageFor("v");
    expect(stage?.nodes["good"]).toBeDefined(); // good op salvaged past the stale one
  });
});

describe("FacetRuntime.applyToSession fail-soft", () => {
  it("salvages good ops when one op in a batch is bad (mixed batch)", async () => {
    const mixed: ServerMessage = {
      kind: "patch",
      patches: [
        { op: "add", path: "/nodes/good", value: { id: "good", type: "text", value: "kept" } },
        { op: "add", path: "/nodes/missing/children/-", value: "x" }, // throws
        { op: "add", path: "/nodes/also", value: { id: "also", type: "text", value: "kept too" } },
      ],
    };
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf(mixed) });
    await rt.handle(visitor, { kind: "message", text: "hi" });
    const stage = await rt.stageFor("v");
    expect(stage?.nodes["good"]).toBeDefined();
    expect(stage?.nodes["also"]).toBeDefined();
  });

  it("survives a patch message whose patches field is non-iterable (turn + chat preserved)", async () => {
    // Genuinely non-iterable values — a STRING is the one non-array value that IS
    // iterable, so it would silently push single-char "ops" and mask the crash the
    // guard exists to prevent. Each must be dropped fail-soft (rest of the turn,
    // says included, still applies and delivers) — never throw through the seam.
    for (const bad of [null, undefined, {}]) {
      const broken = { kind: "patch", patches: bad } as unknown as ServerMessage;
      const rt = new FacetRuntime({
        agentId: "a",
        agent: agentOf(broken, { kind: "say", text: "still here" }),
      });
      const { messages } = await rt.handle(visitor, { kind: "message", text: "hi" });
      expect(messages.some((m) => m.kind === "say" && m.text === "still here")).toBe(true);
      const stage = await rt.stageFor("v");
      expect(stage?.nodes["root"]).toBeDefined(); // stage intact, not wiped
    }
  });

  it("drops a turn whose coalesced patch ops exceed MAX_PATCH_OPS (stage unchanged, say survives, issue logged)", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    try {
      // Two individually wire-valid patch messages (600 ops each) coalesce to 1200
      // > MAX_PATCH_OPS. The fold would reject the whole batch; the runtime must
      // skip it, leave the stage untouched, surface the issue, and NOT deliver the
      // known-rejected coalesced frame — while the turn's say still travels.
      const mkOps = (prefix: string): { op: "add"; path: string; value: unknown }[] =>
        Array.from({ length: 600 }, (_, i) => ({
          op: "add" as const,
          path: `/nodes/${prefix}${String(i)}`,
          value: { id: `${prefix}${String(i)}`, type: "text" as const, value: "x" },
        }));
      const rt = new FacetRuntime({
        agentId: "a",
        agent: agentOf(
          { kind: "patch", patches: mkOps("a") } as ServerMessage,
          { kind: "patch", patches: mkOps("b") } as ServerMessage,
          { kind: "say", text: "still here" },
        ),
      });
      const { messages } = await rt.handle(visitor, { kind: "message", text: "hi" });
      expect(messages.some((m) => m.kind === "say" && m.text === "still here")).toBe(true);
      expect(messages.some((m) => m.kind === "patch")).toBe(false); // no patch frame delivered
      const stage = await rt.stageFor("v");
      expect(stage?.nodes["a0"]).toBeUndefined(); // none of the 1200 ops applied
      expect(stage?.nodes["b0"]).toBeUndefined();
      expect(stage?.nodes["root"]).toBeDefined(); // stage byte-identical to pre-turn
      expect(errors.some((e) => e.includes("patch turn dropped") && e.includes("1200"))).toBe(true);
      expect(MAX_PATCH_OPS).toBe(1024); // guards the 600+600 boundary this test relies on
    } finally {
      spy.mockRestore();
    }
  });
});
