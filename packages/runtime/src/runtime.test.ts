import { describe, expect, it, vi } from "vitest";
import type { ClientEvent, FacetAgent, FacetTree, ServerMessage } from "@facet/core";
import { EMPTY_TREE, foldPatchIntoStage, MAX_PATCH_OPS } from "@facet/core";
import { FacetRuntime } from "./runtime.js";
import { MemoryStageStore } from "./stage-store.js";
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
