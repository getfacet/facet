import { describe, expect, it } from "vitest";
import type { ClientEvent, FacetAgent, ServerMessage } from "@facet/core";
import { FacetRuntime } from "./runtime.js";
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
    expect(out.map((m) => m.kind)).toEqual(["patch", "say"]); // both returned, no throw
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

describe("FacetRuntime.applyMessages", () => {
  it("applyMessages applies a late result through the per-visitor queue", async () => {
    // agentOf() with no messages: applyMessages must NOT call the agent — it
    // applies already-produced messages. The stage change + sink record come
    // entirely from the passed-in batch.
    const rt = new FacetRuntime({ agentId: "a", agent: agentOf() });
    const event: ClientEvent = { kind: "message", text: "late" };
    const messages: ServerMessage[] = [renderPatch, { kind: "say", text: "late reply" }];
    const out = await rt.applyMessages(visitor, event, messages);
    expect(out).toEqual(messages); // returned so the transport can deliver them
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
    expect(out.some((m) => m.kind === "say" && m.text === "late")).toBe(true); // say kept, no throw
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
    const messages = await rt.handle(visitor, { kind: "message", text: "hi" });
    expect(messages.some((m) => m.kind === "say" && m.text === "still here")).toBe(true);
    const stage = await rt.stageFor("v");
    expect(stage?.nodes["root"]).toBeDefined(); // stage intact, not wiped
  });
});
