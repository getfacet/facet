import { describe, expect, it } from "vitest";
import type { FacetAgent, ServerMessage } from "@facet/core";
import { FacetRuntime } from "./runtime.js";

const visitor = { visitorId: "v" };
const agentOf =
  (...messages: ServerMessage[]): FacetAgent =>
  () =>
    Promise.resolve(messages);

const renderPatch: ServerMessage = {
  kind: "patch",
  patches: [{ op: "replace", path: "", value: { root: "root", nodes: {} } }],
};

describe("FacetRuntime.handle", () => {
  it("applies patch messages to the stored stage", async () => {
    const rt = new FacetRuntime({
      agentId: "a",
      agent: agentOf(renderPatch, { kind: "say", text: "done" }),
    });
    await rt.handle(visitor, { kind: "message", text: "hi" });
    expect(await rt.stageFor("v")).toEqual({ root: "root", nodes: {} });
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
