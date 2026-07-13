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
        .flatMap((n) => (n?.type === "field" ? [n.name] : []));
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

  it("a 'theme <name>' message switches the theme and says stub: theme <name>", async () => {
    const rt = new FacetRuntime({ agentId: "stub", agent: createStubAgent() });
    const visitor = { visitorId: "v" };
    await rt.handle(visitor, { kind: "visit", visitor });

    const out = (await rt.handle(visitor, { kind: "message", text: "theme midnight" })).messages;
    expect(saysOf(out)).toEqual(["stub: theme midnight"]);
    // The theme name lands on the persisted stage (through the runtime save path).
    const stage = await rt.stageFor("v");
    expect((stage as { theme?: unknown } | undefined)?.theme).toBe("midnight");
    // A plain "theme" prefix message still echoes; a non-theme message is untouched.
    const plain = (await rt.handle(visitor, { kind: "message", text: "hello" })).messages;
    expect(saysOf(plain)).toEqual(["stub: hello"]);
  });

  it("refuses an invalid 'theme <name>' (spaces/punctuation) with a say and no /theme op", async () => {
    const rt = new FacetRuntime({ agentId: "stub", agent: createStubAgent() });
    const visitor = { visitorId: "v" };
    await rt.handle(visitor, { kind: "visit", visitor });

    // "Dark Mode!" fails isValidThemeName — the stub must refuse it, matching the
    // real agent's set_theme gate, so no `add /theme` frame reaches live clients
    // while the stored stage strips it (a stored-vs-live divergence).
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
