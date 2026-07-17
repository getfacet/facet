import { describe, expect, it } from "vitest";
import { validateTree, type ClientEvent, type ServerMessage } from "@facet/core";
import { FacetRuntime } from "@facet/runtime";
import { STUB_TREE, createStubAgent } from "./stub.js";

function saysOf(messages: readonly ServerMessage[]): string[] {
  return messages.flatMap((message) => (message.kind === "say" ? [message.text] : []));
}

function patchesOf(messages: readonly ServerMessage[]): readonly ServerMessage[] {
  return messages.filter((message) => message.kind === "patch");
}

describe("createStubAgent", () => {
  it("authors only Preset and direct style syntax", async () => {
    const { tree, issues } = validateTree(STUB_TREE);
    expect(issues).toEqual([]);
    expect(tree.nodes.home?.style).toEqual({ preset: "panel", gap: "lg" });
    expect(tree.nodes.hero?.style).toEqual({ preset: "heading" });
    expect(tree.nodes.submit?.style).toEqual({ preset: "primaryAction" });
    expect(tree.nodes["submit-label"]?.style).toEqual({ preset: "actionLabel" });

    const retiredKeys = [["vari", "ant"].join(""), ["to", "ne"].join(""), ["sche", "me"].join("")];
    const serialized = JSON.stringify(STUB_TREE);
    for (const key of retiredKeys) expect(serialized).not.toContain(`"${key}"`);

    const rt = new FacetRuntime({ agentId: "stub", agent: createStubAgent() });
    const visitor = { visitorId: "styled-retry" };
    await rt.handle(visitor, { kind: "visit", visitor });
    await rt.handle(visitor, { kind: "message", text: "first" });
    await rt.handle(visitor, { kind: "message", text: "retry" });
    const retried = await rt.stageFor(visitor.visitorId);
    expect(retried?.nodes["stub-echo"]).toMatchObject({
      type: "text",
      value: "echo: retry",
      style: { preset: "body", color: "accent" },
    });
  });

  it("STUB_TREE is valid, renderable, and carries the signup form + screens", () => {
    const { tree, issues } = validateTree(STUB_TREE);
    expect(issues).toEqual([]);

    const root = tree.nodes[tree.root];
    expect(root?.type).toBe("box");
    if (root?.type === "box") expect(root.children.length).toBeGreaterThan(0);

    const signup = tree.nodes["signup"];
    expect(signup?.type).toBe("box");
    if (signup?.type === "box") {
      const names = signup.children
        .map((id) => tree.nodes[id])
        .flatMap((n) => (n?.type === "input" ? [n.name] : []));
      expect(names).toContain("name");
      expect(names).toContain("email");
    }

    const presses = Object.values(tree.nodes).flatMap((n) =>
      n.type === "box" && n.onPress !== undefined ? [n.onPress] : [],
    );
    expect(presses).toContainEqual(
      expect.objectContaining({ kind: "agent", name: "submit", collect: "signup" }),
    );
    expect(Object.keys(tree.screens ?? {}).sort()).toEqual(["about", "home"]);
    expect(tree.entry).toBe("home");
    expect(presses).toContainEqual({ kind: "navigate", to: "about" });
    expect(presses).toContainEqual({ kind: "navigate", to: "home" });
  });

  it("visit renders STUB_TREE; message patches stub-echo + says; action echoes sorted fields", async () => {
    const rt = new FacetRuntime({ agentId: "stub", agent: createStubAgent() });
    const visitor = { visitorId: "v" };

    const onVisit = (await rt.handle(visitor, { kind: "visit", visitor })).messages;
    expect(patchesOf(onVisit)).toHaveLength(1);
    const stage = await rt.stageFor("v");
    expect(stage?.nodes["signup"]).toBeDefined();

    const onMessage = (await rt.handle(visitor, { kind: "message", text: "hello" })).messages;
    expect(saysOf(onMessage)).toEqual(["stub: hello"]);
    const echoed = await rt.stageFor("v");
    expect(echoed?.nodes["stub-echo"]).toMatchObject({ type: "text", value: "echo: hello" });

    const onAction = (
      await rt.handle(visitor, {
        kind: "tap",
        action: { kind: "agent", name: "submit", collect: "signup" },
        fields: { name: "Ada", email: "a@b.c" },
      })
    ).messages;
    expect(saysOf(onAction)).toEqual(["submit: email=a@b.c name=Ada"]);
  });

  it("is deterministic: the same event sequence yields deep-equal message sequences", async () => {
    async function run(): Promise<ServerMessage[][]> {
      const rt = new FacetRuntime({ agentId: "stub", agent: createStubAgent() });
      const visitor = { visitorId: "v" };
      const events: ClientEvent[] = [
        { kind: "visit", visitor },
        { kind: "message", text: "hello" },
        { kind: "message", text: "retry" },
        {
          kind: "tap",
          action: { kind: "agent", name: "submit", collect: "signup" },
          fields: { name: "Ada", email: "a@b.c" },
        },
      ];
      const out: ServerMessage[][] = [];
      for (const event of events) out.push([...(await rt.handle(visitor, event)).messages]);
      return out;
    }
    expect(await run()).toEqual(await run());
  });
});
