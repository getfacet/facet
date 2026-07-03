import { describe, expect, it, vi } from "vitest";
import { EMPTY_TREE, validateTree } from "@facet/core";
import type { ClientEvent, FacetSession, FacetStamp, FacetTheme, ServerMessage } from "@facet/core";
import { FacetRuntime, MemorySink } from "@facet/runtime";
import { createQuickstartAgent } from "./agent.js";
import { STUB_TREE, createStubAgent } from "./stub.js";
import { DEFAULT_GUIDE } from "./prompt.js";
import type { ProviderStep, ProviderTurn, QuickstartProvider, ToolCall } from "./provider.js";

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

let callSeq = 0;
function call(name: string, input: unknown): ToolCall {
  callSeq += 1;
  return { id: `c${String(callSeq)}`, name, input };
}
function toolStep(...toolCalls: ToolCall[]): ProviderStep {
  return { text: "", toolCalls };
}
function textStep(text: string): ProviderStep {
  return { text, toolCalls: [] };
}
const END = textStep("");

interface MockProvider extends QuickstartProvider {
  readonly turns: ProviderTurn[];
}

/** A scripted provider: returns steps in order; the last entry repeats. */
function providerOf(...steps: ReadonlyArray<ProviderStep | Error>): MockProvider {
  const turns: ProviderTurn[] = [];
  let next = 0;
  return {
    name: "openai",
    model: "mock",
    turns,
    run(turn: ProviderTurn): Promise<ProviderStep> {
      // Snapshot: the agent mutates one `messages` array across the loop, so we
      // capture a copy of what THIS step received.
      turns.push({ system: turn.system, messages: [...turn.messages] });
      const step = steps[Math.min(next, steps.length - 1)];
      next += 1;
      if (step === undefined) return Promise.reject(new Error("no scripted step"));
      if (step instanceof Error) return Promise.reject(step);
      return Promise.resolve(step);
    },
  };
}

function makeAgent(
  provider: QuickstartProvider,
  extra: { guide?: string; sink?: MemorySink; historyTurns?: number; maxSteps?: number } = {},
): ReturnType<typeof createQuickstartAgent> {
  return createQuickstartAgent({
    provider,
    sink: extra.sink ?? new MemorySink(),
    agentId: "quickstart",
    ...(extra.guide !== undefined ? { guide: extra.guide } : {}),
    ...(extra.historyTurns !== undefined ? { historyTurns: extra.historyTurns } : {}),
    ...(extra.maxSteps !== undefined ? { maxSteps: extra.maxSteps } : {}),
  });
}

function saysOf(messages: readonly ServerMessage[]): string[] {
  return messages.flatMap((m) => (m.kind === "say" ? [m.text] : []));
}
function patchesOf(messages: readonly ServerMessage[]): readonly ServerMessage[] {
  return messages.filter((m) => m.kind === "patch");
}

describe("createQuickstartAgent tool loop", () => {
  it("renders a full page then says, across a multi-step tool loop", async () => {
    const provider = providerOf(
      toolStep(call("render_page", { tree: VALID_TREE })),
      toolStep(call("say", { text: "here you go" })),
      END,
    );
    const agent = makeAgent(provider);
    const out = await agent({ kind: "message", text: "draw it" }, SESSION);

    const patch = out.find((m) => m.kind === "patch");
    expect(patch).toBeDefined();
    if (patch?.kind === "patch") {
      expect(patch.patches[0]).toMatchObject({ op: "replace", path: "" });
    }
    expect(saysOf(out)).toEqual(["here you go"]);
    expect(provider.turns).toHaveLength(3); // render, say, end
  });

  it("makes incremental edits (append + set) without a full redraw", async () => {
    const provider = providerOf(
      toolStep(
        call("append_node", { parentId: "root", node: { id: "n1", type: "text", value: "added" } }),
        call("set_node", { node: { id: "greet", type: "text", value: "updated" } }),
      ),
      END,
    );
    const agent = makeAgent(provider);
    const out = await agent({ kind: "message", text: "tweak it" }, SESSION);

    const patch = out.find((m) => m.kind === "patch");
    expect(patch).toBeDefined();
    if (patch?.kind === "patch") {
      // append records add-node + add-child; set records add-node — a partial edit, no full replace.
      const paths = patch.patches.map((p) => ("path" in p ? p.path : ""));
      expect(paths).toContain("/nodes/n1");
      expect(paths).toContain("/nodes/root/children/-");
      expect(paths).toContain("/nodes/greet");
      expect(paths).not.toContain(""); // no whole-tree replace
    }
  });

  it("feeds a bad tool arg back as an error observation and recovers on retry", async () => {
    const provider = providerOf(
      toolStep(call("append_node", { parentId: "root", node: { type: "text", value: "no id" } })), // invalid
      toolStep(
        call("append_node", { parentId: "root", node: { id: "ok", type: "text", value: "hi" } }),
      ),
      END,
    );
    const agent = makeAgent(provider);
    const out = await agent({ kind: "message", text: "add" }, SESSION);

    // The 2nd turn's messages carry the error observation from the failed call.
    const secondTurn = provider.turns[1]!;
    const observations = secondTurn.messages
      .filter((m) => m.role === "tool_result")
      .map((m) => (m.role === "tool_result" ? m.content : ""));
    expect(observations.some((o) => o.startsWith("error:"))).toBe(true);

    // Only the valid append reached the stage.
    const patch = out.find((m) => m.kind === "patch");
    if (patch?.kind === "patch") {
      const paths = patch.patches.map((p) => ("path" in p ? p.path : ""));
      expect(paths).toContain("/nodes/ok");
      expect(paths).not.toContain("/nodes/undefined");
    }
  });

  it("rejects a node validateTree would drop (text with no value) instead of a false 'ok'", async () => {
    // A text node missing `value` shallow-passes id+type but validateTree drops
    // it — the tool must report an error, not "ok: appended" (silent no-op).
    const provider = providerOf(
      toolStep(call("append_node", { parentId: "root", node: { id: "bad", type: "text" } })),
      END,
    );
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "add" }, SESSION);
      // No successful mutation ⇒ the turn apologizes rather than silently doing nothing.
      expect(patchesOf(out)).toHaveLength(0);
      expect(saysOf(out)[0]).toMatch(/sorry/i);
      // The model saw an error observation for the bad node.
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs.some((o) => o.startsWith("error:"))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("gives specific, actionable error observations the model can fix", async () => {
    // Capture the observation strings fed back to the model across a turn.
    const provider = providerOf(
      toolStep(
        call("append_node", { parentId: "root", node: { id: "t", type: "text" } }), // no value
        call("frobnicate", {}), // unknown tool
        call("render_page", {
          tree: { root: "root", nodes: { root: { id: "root", type: "box", children: [] } } },
        }), // empty root
      ),
      END,
    );
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await agent({ kind: "message", text: "go" }, SESSION);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs.some((o) => o.includes('"text" node needs a string "value"'))).toBe(true);
      expect(obs.some((o) => o.includes("unknown tool") && o.includes("append_node"))).toBe(true);
      expect(obs.some((o) => o.includes("render_page") && o.includes("at least one child"))).toBe(
        true,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("rejects append_node to a parent that does not exist (no orphan)", async () => {
    // EMPTY_TREE has only "root"; "ghost" was never created this turn.
    const provider = providerOf(
      toolStep(
        call("append_node", { parentId: "ghost", node: { id: "n", type: "text", value: "x" } }),
      ),
      END,
    );
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "add" }, SESSION);
      expect(patchesOf(out)).toHaveLength(0); // nothing mutated ⇒ no orphan op emitted
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs.some((o) => o.includes("does not exist"))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("appends into a parent created earlier in the same turn (render_page then append)", async () => {
    const provider = providerOf(
      toolStep(call("render_page", { tree: VALID_TREE })), // creates root + greet
      toolStep(
        call("append_node", { parentId: "root", node: { id: "n", type: "text", value: "more" } }),
      ),
      END,
    );
    const agent = makeAgent(provider);
    await agent({ kind: "message", text: "build" }, SESSION);
    const obs = provider.turns[2]!.messages.filter((m) => m.role === "tool_result").map((m) =>
      m.role === "tool_result" ? m.content : "",
    );
    // The append into the freshly-rendered "root" succeeds (root is now known).
    expect(obs.some((o) => o.startsWith("ok: appended"))).toBe(true);
  });

  it("accepts a screens-only render_page whose shell root is empty but entry screen has content", async () => {
    const screensTree = {
      root: "shell",
      nodes: {
        shell: { id: "shell", type: "box", children: [] },
        home: { id: "home", type: "box", children: ["h"] },
        h: { id: "h", type: "text", value: "Home" },
      },
      screens: { home: "home" },
      entry: "home",
    };
    const provider = providerOf(toolStep(call("render_page", { tree: screensTree })), END);
    const agent = makeAgent(provider);
    const out = await agent({ kind: "visit", visitor: { visitorId: "v1" } }, SESSION);
    // isRenderable must accept it (entry screen "home" is a non-empty box).
    expect(patchesOf(out)).toHaveLength(1);
  });

  it("removes a node and rejects image/field nodes missing required fields", async () => {
    const provider = providerOf(
      toolStep(
        call("render_page", { tree: VALID_TREE }),
        call("remove_node", { nodeId: "greet" }),
        call("set_node", { node: { id: "i", type: "image", src: "x" } }), // no alt
        call("set_node", { node: { id: "f", type: "field" } }), // no name
      ),
      END,
    );
    const agent = makeAgent(provider);
    const out = await agent({ kind: "message", text: "edit" }, SESSION);
    const patch = out.find((m) => m.kind === "patch");
    if (patch?.kind === "patch") {
      expect(
        patch.patches.some((p) => p.op === "remove" && "path" in p && p.path === "/nodes/greet"),
      ).toBe(true);
    }
    const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
      m.role === "tool_result" ? m.content : "",
    );
    expect(obs.some((o) => o.includes('"image" node needs string "src" and "alt"'))).toBe(true);
    expect(obs.some((o) => o.includes('"field" node needs a string "name"'))).toBe(true);
  });

  it("set_theme records a /theme add op the model can drive", async () => {
    const provider = providerOf(toolStep(call("set_theme", { name: "midnight" })), END);
    const agent = makeAgent(provider);
    const out = await agent({ kind: "message", text: "go dark" }, SESSION);

    const patch = out.find((m) => m.kind === "patch");
    expect(patch).toBeDefined();
    if (patch?.kind === "patch") {
      expect(patch.patches).toContainEqual({ op: "add", path: "/theme", value: "midnight" });
    }
  });

  it("set_theme with an invalid theme name is an error observation and emits no /theme op", async () => {
    // "Ocean Breeze" has a space, so it fails isValidThemeName. It must never
    // reach the wire (the runtime's save-time re-validate would strip it,
    // diverging the stored stage from the live clients).
    const provider = providerOf(toolStep(call("set_theme", { name: "Ocean Breeze" })), END);
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "go" }, SESSION);
      // No /theme patch was emitted — the invalid name degraded to an observation.
      expect(patchesOf(out)).toHaveLength(0);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs.some((o) => o.startsWith("error:") && o.includes("valid theme name"))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("set_theme with a non-string name is an error observation, not a throw", async () => {
    const provider = providerOf(toolStep(call("set_theme", { name: 42 })), END);
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "go" }, SESSION);
      // Nothing was applied — the bad arg degraded to an observation, the turn survived.
      expect(patchesOf(out)).toHaveLength(0);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs.some((o) => o.startsWith("error:"))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("stops at maxSteps when the model never ends the loop", async () => {
    const provider = providerOf(toolStep(call("say", { text: "again" }))); // repeats forever
    const agent = makeAgent(provider, { maxSteps: 3 });
    await agent({ kind: "message", text: "loop" }, SESSION);
    expect(provider.turns).toHaveLength(3);
  });

  it("a bare-prose step (no tool calls) becomes a chat say, not an apology", async () => {
    const provider = providerOf(textStep("I'm your personal page agent — ask me anything!"));
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "who are you?" }, SESSION);
      expect(patchesOf(out)).toHaveLength(0);
      expect(saysOf(out)).toEqual(["I'm your personal page agent — ask me anything!"]);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("a turn that produces nothing ends in one apologetic say + one error line", async () => {
    const provider = providerOf(END); // no tools, no text
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "hi" }, SESSION);
      expect(patchesOf(out)).toHaveLength(0);
      expect(saysOf(out)).toHaveLength(1);
      expect(saysOf(out)[0]).toMatch(/sorry/i);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("a provider rejection mid-loop keeps prior edits and never throws", async () => {
    const provider = providerOf(
      toolStep(
        call("append_node", { parentId: "root", node: { id: "x", type: "text", value: "hi" } }),
      ),
      new Error("connect ECONNREFUSED"),
    );
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "add" }, SESSION);
      // The append survived (mutated) so no apology is issued.
      const patch = out.find((m) => m.kind === "patch");
      expect(patch).toBeDefined();
      expect(saysOf(out)).not.toContain(
        "Sorry — I couldn't update the page this time, so I've left it as it was. Please try again.",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("never surfaces intermediate reasoning as the reply after a mid-loop failure", async () => {
    const provider = providerOf(
      {
        text: "Let me update that for you.",
        toolCalls: [
          call("append_node", { parentId: "root", node: { id: "x", type: "text", value: "hi" } }),
        ],
      },
      new Error("network blip"),
    );
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await agent({ kind: "message", text: "add" }, SESSION);
      // The append survived, but the model's mid-step preamble must NOT become the reply.
      expect(saysOf(out)).not.toContain("Let me update that for you.");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("an unrenderable render_page tree is rejected (stage untouched), then recovers", async () => {
    const provider = providerOf(
      toolStep(call("render_page", { tree: { root: "nope", nodes: {} } })), // not renderable
      toolStep(call("render_page", { tree: VALID_TREE })),
      END,
    );
    const agent = makeAgent(provider);
    const out = await agent({ kind: "message", text: "draw" }, SESSION);

    const firstTurnObs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map(
      (m) => (m.role === "tool_result" ? m.content : ""),
    );
    expect(firstTurnObs.some((o) => o.startsWith("error:"))).toBe(true);
    // The valid render still applied.
    const patch = out.find((m) => m.kind === "patch");
    expect(patch).toBeDefined();
  });

  it("an action event's fields appear in the first turn's final user message", async () => {
    const provider = providerOf(toolStep(call("say", { text: "noted" })), END);
    const agent = makeAgent(provider, { guide: "MY CUSTOM GUIDE" });
    await agent(
      {
        kind: "action",
        action: { kind: "agent", name: "submit", collect: "signup" },
        fields: { email: "a@b.c", name: "Ada" },
      },
      SESSION,
    );

    const first = provider.turns[0]!;
    const finalUser = first.messages[first.messages.length - 1]!;
    const content = "content" in finalUser ? finalUser.content : "";
    expect(content).toContain("submit");
    expect(content).toContain("a@b.c");
    expect(first.system).toContain("MY CUSTOM GUIDE");
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

    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = makeAgent(provider, { sink, historyTurns: 1 });
    await agent({ kind: "message", text: "now" }, SESSION);

    const all = provider.turns[0]!.messages.map((m) => ("content" in m ? m.content : "")).join(
      "\n",
    );
    expect(all).toContain("newer-line");
    expect(all).not.toContain("older-line");
  });

  it("uses DEFAULT_GUIDE when no guide is given", async () => {
    const provider = providerOf(toolStep(call("say", { text: "hi" })), END);
    const agent = makeAgent(provider);
    await agent({ kind: "message", text: "hi" }, SESSION);
    expect(provider.turns[0]!.system).toContain(DEFAULT_GUIDE);
  });

  it("threads operator themes and stamps into the system prompt (names only, no theme CSS)", async () => {
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const theme: FacetTheme = {
      name: "neon",
      description: "a bright neon look",
      color: { bg: "#ff00ff" },
    };
    const stamp: FacetStamp = {
      name: "hero",
      description: "a hero band",
      root: "h-root",
      nodes: {
        "h-root": { id: "h-root", type: "box", children: ["h-title"] },
        "h-title": { id: "h-title", type: "text", value: "Welcome" },
      },
    };
    const agent = createQuickstartAgent({
      provider,
      sink: new MemorySink(),
      agentId: "quickstart",
      themes: [theme],
      stamps: [stamp],
    });
    await agent({ kind: "message", text: "draw" }, SESSION);

    const system = provider.turns[0]!.system;
    expect(system).toContain("THEMES");
    expect(system).toContain("neon");
    expect(system).toContain("STAMPS");
    expect(system).toContain("hero");
    // Theme documents reach the model by NAME only — the raw CSS value never does.
    expect(system).not.toContain("#ff00ff");
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
        kind: "action",
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
          kind: "action",
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
