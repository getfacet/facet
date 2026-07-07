import { describe, expect, it } from "vitest";
import { validateTree } from "@facet/core";
import type { ClientEvent, ServerMessage } from "@facet/core";
import { FacetRuntime } from "@facet/runtime";

import { DEFAULT_GUIDE, TOOLS } from "./prompt.js";
import { STUB_TREE, createStubAgent } from "./stub.js";

function saysOf(messages: readonly ServerMessage[]): string[] {
  return messages.flatMap((m) => (m.kind === "say" ? [m.text] : []));
}

function patchesOf(messages: readonly ServerMessage[]): readonly ServerMessage[] {
  return messages.filter((m) => m.kind === "patch");
}

describe("reference prompt and stub exports", () => {
  it("exports prompt defaults and the deterministic stub surface", () => {
    expect(DEFAULT_GUIDE.length).toBeGreaterThan(0);
    expect(TOOLS.map((tool) => tool.name)).toContain("render_page");
    expect(STUB_TREE.root).toBe("home");
    expect(typeof createStubAgent).toBe("function");
  });
});

describe("createStubAgent", () => {
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
        .flatMap((node) => (node?.type === "field" ? [node.name] : []));
      expect(names).toContain("name");
      expect(names).toContain("email");
    }

    const presses = Object.values(tree.nodes).flatMap((node) =>
      node.type === "box" && node.onPress !== undefined ? [node.onPress] : [],
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

  it("a 'theme <name>' message switches the theme and says stub: theme <name>", async () => {
    const rt = new FacetRuntime({ agentId: "stub", agent: createStubAgent() });
    const visitor = { visitorId: "v" };
    await rt.handle(visitor, { kind: "visit", visitor });

    const out = (await rt.handle(visitor, { kind: "message", text: "theme midnight" })).messages;
    expect(saysOf(out)).toEqual(["stub: theme midnight"]);
    const stage = await rt.stageFor("v");
    expect((stage as { theme?: unknown } | undefined)?.theme).toBe("midnight");

    const plain = (await rt.handle(visitor, { kind: "message", text: "hello" })).messages;
    expect(saysOf(plain)).toEqual(["stub: hello"]);
  });

  it("refuses an invalid 'theme <name>' (spaces/punctuation) with a say and no /theme op", async () => {
    const rt = new FacetRuntime({ agentId: "stub", agent: createStubAgent() });
    const visitor = { visitorId: "v" };
    await rt.handle(visitor, { kind: "visit", visitor });

    const out = (await rt.handle(visitor, { kind: "message", text: "theme Dark Mode!" })).messages;
    expect(saysOf(out)).toEqual(["stub: invalid theme name (letters/digits/_/-, max 64)"]);
    expect(patchesOf(out)).toHaveLength(0);
    const stage = await rt.stageFor("v");
    expect((stage as { theme?: unknown } | undefined)?.theme).toBeUndefined();
  });

  it("is deterministic: the same event sequence yields deep-equal message sequences", async () => {
    async function run(): Promise<ServerMessage[][]> {
      const rt = new FacetRuntime({ agentId: "stub", agent: createStubAgent() });
      const visitor = { visitorId: "v" };
      const events: ClientEvent[] = [
        { kind: "visit", visitor },
        { kind: "message", text: "hello" },
        { kind: "message", text: "theme midnight" },
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
