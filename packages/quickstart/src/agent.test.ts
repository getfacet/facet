import { describe, expect, it, vi } from "vitest";
import { EMPTY_TREE, validateTree } from "@facet/core";
import type { ClientEvent, FacetSession, ServerMessage } from "@facet/core";
import { FacetRuntime, MemorySink } from "@facet/runtime";
import { createQuickstartAgent } from "./agent.js";
import { STUB_TREE, createStubAgent } from "./stub.js";
import { DEFAULT_GUIDE } from "./prompt.js";
import type { ProviderTurn, QuickstartProvider } from "./provider.js";

const SESSION: FacetSession = {
  agentId: "quickstart",
  visitor: { visitorId: "v1" },
  stage: EMPTY_TREE,
};

const VALID_TREE = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["greet"] },
    greet: { id: "greet", type: "text", value: "hello" },
  },
};
const VALID_REPLY = JSON.stringify({ say: "done", tree: VALID_TREE });

interface MockProvider extends QuickstartProvider {
  readonly calls: ProviderTurn[];
}

/** A scripted provider: replies (or errors) in order; the last entry repeats. */
function providerOf(...replies: ReadonlyArray<string | Error>): MockProvider {
  const calls: ProviderTurn[] = [];
  let next = 0;
  return {
    name: "openai",
    model: "mock",
    calls,
    generate(turn: ProviderTurn): Promise<string> {
      calls.push(turn);
      const reply = replies[Math.min(next, replies.length - 1)];
      next += 1;
      if (reply === undefined) return Promise.reject(new Error("mock provider has no reply"));
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve(reply);
    },
  };
}

function makeAgent(
  provider: QuickstartProvider,
  extra: { guide?: string; sink?: MemorySink; historyTurns?: number } = {},
): ReturnType<typeof createQuickstartAgent> {
  return createQuickstartAgent({
    provider,
    sink: extra.sink ?? new MemorySink(),
    agentId: "quickstart",
    ...(extra.guide !== undefined ? { guide: extra.guide } : {}),
    ...(extra.historyTurns !== undefined ? { historyTurns: extra.historyTurns } : {}),
  });
}

function saysOf(messages: readonly ServerMessage[]): string[] {
  return messages.flatMap((m) => (m.kind === "say" ? [m.text] : []));
}

function patchesOf(messages: readonly ServerMessage[]): readonly ServerMessage[] {
  return messages.filter((m) => m.kind === "patch");
}

describe("createQuickstartAgent", () => {
  it("malformed provider output leaves the stage untouched and says an error line", async () => {
    // Both attempts of turn 1 get garbage; turn 2 gets a valid reply.
    const provider = providerOf("$$$ not json $$$", "still)) utter(( garbage", VALID_REPLY);
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const first = await agent({ kind: "message", text: "hi" }, SESSION);

      // Stage untouched: no patch message means nothing can change the stored stage.
      expect(patchesOf(first)).toHaveLength(0);
      const says = saysOf(first);
      expect(says).toHaveLength(1);
      expect(says[0]).toMatch(/sorry/i);
      // One concise error line, never more (and never a key — the mock has none).
      expect(errorSpy).toHaveBeenCalledTimes(1);

      // A SECOND turn on the same agent still works.
      const second = await agent({ kind: "message", text: "again" }, SESSION);
      expect(patchesOf(second)).toHaveLength(1);
      expect(saysOf(second)).toEqual(["done"]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("rejected provider ⇒ apologetic say, no patch, no throw", async () => {
    const provider = providerOf(new Error("connect ECONNREFUSED"));
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "hi" }, SESSION);
      expect(patchesOf(out)).toHaveLength(0);
      expect(saysOf(out)).toHaveLength(1);
      expect(saysOf(out)[0]).toMatch(/sorry/i);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("valid {say, tree} JSON ⇒ render patch + say, one provider call", async () => {
    const provider = providerOf(VALID_REPLY);
    const agent = makeAgent(provider);
    const out = await agent({ kind: "message", text: "draw it" }, SESSION);

    const patch = out.find((m) => m.kind === "patch");
    expect(patch).toBeDefined();
    if (patch?.kind === "patch") {
      expect(patch.patches[0]).toMatchObject({ op: "replace", path: "" });
      // The rendered value is the VALIDATED tree — still renderable, no issues lost.
      const value: unknown = (patch.patches[0] as { value?: unknown }).value;
      const { tree, issues } = validateTree(value);
      expect(issues).toEqual([]);
      expect(tree.nodes[tree.root]).toBeDefined();
    }
    expect(saysOf(out)).toEqual(["done"]);
    expect(provider.calls).toHaveLength(1);
  });

  it("unrenderable tree in valid JSON ⇒ retry, then error say with the stage untouched", async () => {
    // Parses fine, validates down to nothing renderable (no valid root).
    const unrenderable = JSON.stringify({ tree: { root: "nope", nodes: {} } });
    const provider = providerOf(unrenderable);
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "hi" }, SESSION);
      expect(patchesOf(out)).toHaveLength(0);
      expect(saysOf(out)[0]).toMatch(/sorry/i);
      expect(provider.calls).toHaveLength(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("an action event's fields appear in the final user message of the provider prompt", async () => {
    const provider = providerOf(JSON.stringify({ say: "noted" }));
    const agent = makeAgent(provider, { guide: "MY CUSTOM GUIDE" });
    const event: ClientEvent = {
      kind: "action",
      action: { kind: "agent", name: "submit", collect: "signup" },
      fields: { email: "a@b.c", name: "Ada" },
    };
    await agent(event, SESSION);

    const turn = provider.calls[0];
    expect(turn).toBeDefined();
    const final = turn?.messages[turn.messages.length - 1];
    expect(final?.role).toBe("user");
    expect(final?.content).toContain("submit");
    expect(final?.content).toContain("a@b.c");
    expect(final?.content).toContain("Ada");
    // Layer ②: the custom guide replaces DEFAULT_GUIDE in the system prompt.
    expect(turn?.system).toContain("MY CUSTOM GUIDE");
  });

  it("uses DEFAULT_GUIDE when no guide is given", async () => {
    const provider = providerOf(JSON.stringify({ say: "hello" }));
    const agent = makeAgent(provider);
    await agent({ kind: "message", text: "hi" }, SESSION);
    expect(provider.calls[0]?.system).toContain(DEFAULT_GUIDE);
  });

  it("provider is called at most twice on persistent failure (single retry)", async () => {
    const provider = providerOf("garbage forever");
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await agent({ kind: "message", text: "hi" }, SESSION);
      expect(provider.calls).toHaveLength(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("recovers within one turn: first attempt fails, retry succeeds ⇒ render + say, no apology", async () => {
    // The whole point of MAX_ATTEMPTS = 2: a bad first reply, a good second one,
    // all inside ONE turn.
    const provider = providerOf("$$$ not json $$$", VALID_REPLY);
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "hi" }, SESSION);
      expect(patchesOf(out)).toHaveLength(1); // the recovered render
      expect(saysOf(out)).toEqual(["done"]); // the good reply's say, not the apology
      expect(provider.calls).toHaveLength(2); // exactly one retry
      expect(errorSpy).not.toHaveBeenCalled(); // no failure line on recovery
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("feeds sink history into the prompt, capped at historyTurns", async () => {
    const sink = new MemorySink();
    await sink.record("quickstart", "v1", {
      at: 0,
      event: { kind: "message", text: "older-line" },
      messages: [{ kind: "say", text: "older-reply" }],
    });
    await sink.record("quickstart", "v1", {
      at: 1,
      event: { kind: "message", text: "newer-line" },
      messages: [{ kind: "say", text: "newer-reply" }],
    });

    const provider = providerOf(JSON.stringify({ say: "ok" }));
    const agent = makeAgent(provider, { sink, historyTurns: 1 });
    await agent({ kind: "message", text: "now" }, SESSION);

    const all = provider.calls[0]?.messages.map((m) => m.content).join("\n") ?? "";
    expect(all).toContain("newer-line");
    expect(all).toContain("newer-reply");
    expect(all).not.toContain("older-line");
  });

  it("honors a historyTurns override above the default (single-source cap)", async () => {
    const sink = new MemorySink();
    for (let i = 0; i < 25; i += 1) {
      await sink.record("quickstart", "v1", {
        at: i,
        event: { kind: "message", text: `line-${i}` },
        messages: [{ kind: "say", text: `reply-${i}` }],
      });
    }
    const provider = providerOf(JSON.stringify({ say: "ok" }));
    const agent = makeAgent(provider, { sink, historyTurns: 25 });
    await agent({ kind: "message", text: "now" }, SESSION);

    const all = provider.calls[0]?.messages.map((m) => m.content).join("\n") ?? "";
    // All 25 replayed — the old double-slice silently capped this at 20.
    expect(all).toContain("line-0");
    expect(all).toContain("line-24");
  });
});

describe("createStubAgent", () => {
  it("STUB_TREE is valid, renderable, and carries the signup form + screens", () => {
    const { tree, issues } = validateTree(STUB_TREE);
    expect(issues).toEqual([]);

    const root = tree.nodes[tree.root];
    expect(root?.type).toBe("box");
    if (root?.type === "box") expect(root.children.length).toBeGreaterThan(0);

    // Signup box with name + email fields.
    const signup = tree.nodes["signup"];
    expect(signup?.type).toBe("box");
    if (signup?.type === "box") {
      const names = signup.children
        .map((id) => tree.nodes[id])
        .flatMap((n) => (n?.type === "field" ? [n.name] : []));
      expect(names).toContain("name");
      expect(names).toContain("email");
    }

    // A pressable box submitting the signup form.
    const presses = Object.values(tree.nodes).flatMap((n) =>
      n.type === "box" && n.onPress !== undefined ? [n.onPress] : [],
    );
    expect(presses).toContainEqual(
      expect.objectContaining({ kind: "agent", name: "submit", collect: "signup" }),
    );

    // Screens home/about with entry home, and navigation both ways.
    expect(Object.keys(tree.screens ?? {}).sort()).toEqual(["about", "home"]);
    expect(tree.entry).toBe("home");
    expect(presses).toContainEqual({ kind: "navigate", to: "about" });
    expect(presses).toContainEqual({ kind: "navigate", to: "home" });
  });

  it("visit renders STUB_TREE; message patches stub-echo + says; action echoes sorted fields", async () => {
    const rt = new FacetRuntime({ agentId: "stub", agent: createStubAgent() });
    const visitor = { visitorId: "v" };

    const onVisit = await rt.handle(visitor, { kind: "visit", visitor });
    expect(patchesOf(onVisit)).toHaveLength(1);
    const stage = await rt.stageFor("v");
    expect(stage?.nodes["signup"]).toBeDefined();
    expect(stage?.screens).toMatchObject({ home: expect.any(String), about: expect.any(String) });

    const onMessage = await rt.handle(visitor, { kind: "message", text: "hello" });
    expect(saysOf(onMessage)).toEqual(["stub: hello"]);
    const echoed = await rt.stageFor("v");
    expect(echoed?.nodes["stub-echo"]).toMatchObject({ type: "text", value: "echo: hello" });

    // A second message UPSERTS the same echo node (no duplicate child ref).
    await rt.handle(visitor, { kind: "message", text: "again" });
    const twice = await rt.stageFor("v");
    expect(twice?.nodes["stub-echo"]).toMatchObject({ value: "echo: again" });
    const echoParent = Object.values(twice?.nodes ?? {}).filter(
      (n) => n.type === "box" && n.children.includes("stub-echo"),
    );
    expect(echoParent).toHaveLength(1);
    if (echoParent[0]?.type === "box") {
      expect(echoParent[0].children.filter((id) => id === "stub-echo")).toHaveLength(1);
    }

    const onAction = await rt.handle(visitor, {
      kind: "action",
      action: { kind: "agent", name: "submit", collect: "signup" },
      fields: { name: "Ada", email: "a@b.c" },
    });
    expect(saysOf(onAction)).toEqual(["submit: email=a@b.c name=Ada"]);

    const bareAction = await rt.handle(visitor, {
      kind: "action",
      action: { kind: "agent", name: "ping" },
    });
    expect(saysOf(bareAction)).toEqual(["ping:"]);
  });

  it("is deterministic: the same event sequence yields deep-equal message sequences", async () => {
    async function run(): Promise<ServerMessage[][]> {
      const rt = new FacetRuntime({ agentId: "stub", agent: createStubAgent() });
      const visitor = { visitorId: "v" };
      const events: ClientEvent[] = [
        { kind: "visit", visitor },
        { kind: "message", text: "hello" },
        { kind: "message", text: "hello again" },
        {
          kind: "action",
          action: { kind: "agent", name: "submit", collect: "signup" },
          fields: { name: "Ada", email: "a@b.c" },
        },
      ];
      const out: ServerMessage[][] = [];
      for (const event of events) {
        out.push([...(await rt.handle(visitor, event))]);
      }
      return out;
    }

    const first = await run();
    const second = await run();
    expect(first).toEqual(second);
  });
});
