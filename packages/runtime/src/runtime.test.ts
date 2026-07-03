import { describe, expect, it } from "vitest";
import type { ClientEvent, FacetAgent, FacetTree, ServerMessage } from "@facet/core";
import { applyPatch, EMPTY_TREE } from "@facet/core";
import { FacetRuntime } from "./runtime.js";
import { MemoryStageStore } from "./stage-store.js";
import { withInitialStage } from "./assets.js";
import type { Sink, StoredEvent } from "./sink.js";

const visitor = { visitorId: "v" };
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

  it("sanitizes a bad root replace (render null) so the stored stage stays valid", async () => {
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf({ kind: "patch", patches: [{ op: "replace", path: "", value: null }] }),
    });
    await rt.handle(visitor, { kind: "message", text: "hi" });
    const stage = await rt.stageFor("v");
    expect(stage?.nodes["root"]).toBeDefined(); // validateTree restored a valid tree, not null
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

describe("FacetRuntime save-time re-validation convergence", () => {
  // A tree that parents one existing node id under TWO boxes in the same screen.
  // Since round 5 validateTree keeps the child under the first parent and strips
  // the second reference (shared-child collapse) with an issue — so the STORED
  // stage differs from the raw patch fanned out to live tabs, which render the
  // section under both parents. The turn must append a corrective root-replace
  // so every client converges on the sanitized stored tree instead of diverging
  // until reload.
  const sharedChildTree = {
    root: "root",
    nodes: {
      root: { id: "root", type: "box" as const, children: ["b1", "b2"] },
      b1: { id: "b1", type: "box" as const, children: ["shared"] },
      b2: { id: "b2", type: "box" as const, children: ["shared"] },
      shared: { id: "shared", type: "text" as const, value: "hi" },
    },
  };
  const sharedChildPatch: ServerMessage = {
    kind: "patch",
    patches: [{ op: "replace", path: "", value: sharedChildTree }],
  };

  it("appends a corrective root-replace equal to the stored stage and clients converge to it", async () => {
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(sharedChildPatch, { kind: "say", text: "done" }),
    });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    const stored = await rt.stageFor("v");
    // The stored stage lost the second reference to the shared child.
    const b2 = stored?.nodes["b2"] as { children: string[] } | undefined;
    expect(b2?.children).toEqual([]);
    // The DELIVERED list ends with a corrective root-replace whose value
    // deep-equals the stored stage.
    const last = out.messages[out.messages.length - 1];
    expect(last?.kind).toBe("patch");
    expect(last).toEqual({
      kind: "patch",
      patches: [{ op: "replace", path: "", value: stored }],
    });
    // Folding the FULL delivered list over EMPTY_TREE (the client's starting
    // point) converges to the stored stage — no stored-vs-live divergence.
    let tree: FacetTree = EMPTY_TREE;
    for (const m of out.messages) {
      if (m.kind === "patch") tree = applyPatch(tree, m.patches);
    }
    expect(tree).toEqual(stored);
  });

  it("does not record the corrective frame into the sink", async () => {
    const records: StoredEvent[] = [];
    const sink: Sink = {
      record: (_agentId: string, _visitorId: string, entry: StoredEvent): Promise<void> => {
        records.push(entry);
        return Promise.resolve();
      },
      history: (): Promise<readonly StoredEvent[]> => Promise.resolve([]),
    };
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf(sharedChildPatch), sink });
    await rt.handle(visitor, { kind: "message", text: "hi" });
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the record settle
    expect(records).toHaveLength(1);
    // Only the agent's own single patch is recorded — the corrective convergence
    // frame is a delivery mechanism, never a turn reply (like the seed frame).
    expect(records[0]?.messages.filter((m) => m.kind === "patch")).toHaveLength(1);
  });

  it("appends no corrective frame on a clean turn (byte-identical delivered messages)", async () => {
    const say: ServerMessage = { kind: "say", text: "done" };
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf(renderPatch, say) });
    const out = await rt.handle(visitor, { kind: "message", text: "hi" });
    expect(out.messages).toEqual([renderPatch, say]);
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

  it("survives a patch message whose patches field is not an array (turn + chat preserved)", async () => {
    const broken = { kind: "patch", patches: "not-an-array" } as unknown as ServerMessage;
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(broken, { kind: "say", text: "still here" }),
    });
    const { messages } = await rt.handle(visitor, { kind: "message", text: "hi" });
    expect(messages.some((m) => m.kind === "say" && m.text === "still here")).toBe(true);
    const stage = await rt.stageFor("v");
    expect(stage?.nodes["root"]).toBeDefined(); // stage intact, not wiped
  });
});
