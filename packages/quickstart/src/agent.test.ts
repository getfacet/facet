import { describe, expect, it, vi } from "vitest";
import {
  MAX_PATCH_OPS,
  collectMessages,
  EMPTY_TREE,
  iterateAgentResult,
  validateTree,
} from "@facet/core";
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
  extra: {
    guide?: string;
    sink?: MemorySink;
    historyTurns?: number;
    maxSteps?: number;
    stamps?: readonly FacetStamp[];
  } = {},
): ReturnType<typeof createQuickstartAgent> {
  return createQuickstartAgent({
    provider,
    sink: extra.sink ?? new MemorySink(),
    agentId: "quickstart",
    ...(extra.guide !== undefined ? { guide: extra.guide } : {}),
    ...(extra.historyTurns !== undefined ? { historyTurns: extra.historyTurns } : {}),
    ...(extra.maxSteps !== undefined ? { maxSteps: extra.maxSteps } : {}),
    ...(extra.stamps !== undefined ? { stamps: extra.stamps } : {}),
  });
}

function saysOf(messages: readonly ServerMessage[]): string[] {
  return messages.flatMap((m) => (m.kind === "say" ? [m.text] : []));
}
function patchesOf(messages: readonly ServerMessage[]): readonly ServerMessage[] {
  return messages.filter((m) => m.kind === "patch");
}

async function runAgent(
  agent: ReturnType<typeof createQuickstartAgent>,
  event: ClientEvent,
  session: FacetSession = SESSION,
): Promise<readonly ServerMessage[]> {
  return collectMessages(agent(event, session));
}

async function batchesOf(
  agent: ReturnType<typeof createQuickstartAgent>,
  event: ClientEvent,
  session: FacetSession = SESSION,
): Promise<readonly (readonly ServerMessage[])[]> {
  const batches: ServerMessage[][] = [];
  for await (const batch of iterateAgentResult(agent(event, session))) {
    batches.push([...batch]);
  }
  return batches;
}

describe("createQuickstartAgent tool loop", () => {
  it("use_stamp expands a stamp through the closure into one referentially closed batch", async () => {
    const stamp: FacetStamp = {
      name: "card",
      description: "A reusable card",
      slots: { title: "Default title" },
      root: "card",
      nodes: {
        card: { id: "card", type: "box", children: ["title"] },
        title: { id: "title", type: "text", value: "{{title}}" },
      },
    };
    const provider = providerOf(
      toolStep(
        call("use_stamp", { name: "card", params: { title: "Hello" }, at: { parent: "root" } }),
      ),
      END,
    );
    const agent = makeAgent(provider, { stamps: [stamp] });

    const batches = await batchesOf(agent, { kind: "message", text: "use card" });

    expect(batches).toHaveLength(1);
    const patch = batches[0]?.find((m) => m.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind !== "patch") throw new Error("expected patch");
    const nodeAdds = patch.patches.filter((op) => op.op === "add" && op.path.startsWith("/nodes/"));
    const append = patch.patches.find(
      (op) => op.op === "add" && op.path === "/nodes/root/children/-",
    );
    expect(append).toBeDefined();
    const rootId = append?.op === "add" && typeof append.value === "string" ? append.value : "";
    const rootAdd = nodeAdds.find((op) => op.path === `/nodes/${rootId}`);
    expect(rootAdd).toBeDefined();
    expect(rootId).not.toBe("card");
    expect(patch.patches.some((op) => "path" in op && op.path === "/nodes/card")).toBe(false);
    expect(patch.patches.some((op) => "path" in op && op.path === "/nodes/title")).toBe(false);
    expect(JSON.stringify(patch.patches)).toContain("Hello");
    if (rootAdd?.op === "add") {
      const rootNode = rootAdd.value as { readonly children?: readonly string[] };
      const childId = rootNode.children?.[0];
      expect(childId).toBeDefined();
      expect(nodeAdds.some((op) => op.path === `/nodes/${String(childId)}`)).toBe(true);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      )[0]!;
      const idsJson = JSON.parse(obs.slice(obs.indexOf("{"))) as {
        readonly root: string;
        readonly slots: Readonly<Record<string, string>>;
        readonly ids: Readonly<Record<string, string>>;
      };
      expect(idsJson.root).toBe(rootId);
      expect(idsJson.slots["title"]).toBe(childId);
      expect(idsJson.ids["card"]).toBe(rootId);
    }
  });

  it("use_stamp reports an unknown stamp name as a no-op observation", async () => {
    const provider = providerOf(
      toolStep(call("use_stamp", { name: "missing", params: {}, at: { parent: "root" } })),
      END,
    );
    const agent = makeAgent(provider, { stamps: [] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(agent, { kind: "message", text: "use missing" });

      expect(patchesOf(out)).toHaveLength(0);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs.some((o) => o.includes("unknown stamp") && o.includes("missing"))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("use_stamp twice remaps ids disjointly in the same turn", async () => {
    const stamp: FacetStamp = {
      name: "label",
      root: "label",
      nodes: { label: { id: "label", type: "text", value: "Badge" } },
    };
    const provider = providerOf(
      toolStep(
        call("use_stamp", { name: "label", params: {}, at: { parent: "root" } }),
        call("use_stamp", { name: "label", params: {}, at: { parent: "root" } }),
      ),
      END,
    );
    const agent = makeAgent(provider, { stamps: [stamp] });

    const out = await runAgent(agent, { kind: "message", text: "twice" });
    const patch = out.find((m) => m.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind !== "patch") throw new Error("expected patch");
    const appended = patch.patches.flatMap((op) =>
      op.op === "add" && op.path === "/nodes/root/children/-" && typeof op.value === "string"
        ? [op.value]
        : [],
    );
    expect(appended).toHaveLength(2);
    expect(new Set(appended).size).toBe(2);
    for (const id of appended) {
      expect(patch.patches.some((op) => op.op === "add" && op.path === `/nodes/${id}`)).toBe(true);
    }
  });

  it("use_stamp is a no-op for malformed stamps and unknown parents", async () => {
    const malformed = {
      name: "broken",
      root: "missing",
      nodes: { text: { id: "text", type: "text", value: "x" } },
    } as unknown as FacetStamp;
    const provider = providerOf(
      toolStep(
        call("use_stamp", { name: "broken", params: {}, at: { parent: "root" } }),
        call("use_stamp", { name: "broken", params: {}, at: { parent: "ghost" } }),
      ),
      END,
    );
    const agent = makeAgent(provider, { stamps: [malformed] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(agent, { kind: "message", text: "broken" });

      expect(patchesOf(out)).toHaveLength(0);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs.some((o) => o.includes("could not expand"))).toBe(true);
      expect(obs.some((o) => o.includes("parent") && o.includes("ghost"))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("use_stamp rejects a parent that exists but is not a box", async () => {
    const stamp: FacetStamp = {
      name: "label",
      root: "label",
      nodes: { label: { id: "label", type: "text", value: "Inside" } },
    };
    const provider = providerOf(
      toolStep(call("use_stamp", { name: "label", params: {}, at: { parent: "title" } })),
      END,
    );
    const sessionWithTextParent: FacetSession = {
      agentId: "quickstart",
      visitor: { visitorId: "v1" },
      stage: {
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["title"] },
          title: { id: "title", type: "text", value: "Title" },
        },
      },
    };
    const agent = makeAgent(provider, { stamps: [stamp] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(
        agent,
        { kind: "message", text: "bad parent" },
        sessionWithTextParent,
      );

      expect(patchesOf(out)).toHaveLength(0);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs).toContain('error: use_stamp — parent "title" is not a box');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("append_node rejects a parent that exists but is not a box", async () => {
    const provider = providerOf(
      toolStep(
        call("append_node", {
          parentId: "title",
          node: { id: "child", type: "text", value: "Child" },
        }),
      ),
      END,
    );
    const sessionWithTextParent: FacetSession = {
      agentId: "quickstart",
      visitor: { visitorId: "v1" },
      stage: {
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["title"] },
          title: { id: "title", type: "text", value: "Title" },
        },
      },
    };
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(
        agent,
        { kind: "message", text: "bad parent" },
        sessionWithTextParent,
      );

      expect(patchesOf(out)).toHaveLength(0);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs).toContain('error: append_node — parent "title" is not a box');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("use_stamp rejects expansions that would exceed the current patch batch cap", async () => {
    const nodes: Record<string, FacetStamp["nodes"][string]> = {
      root: { id: "root", type: "box", children: [] },
    };
    const children: string[] = [];
    for (let i = 0; i < MAX_PATCH_OPS; i += 1) {
      const id = `n${String(i)}`;
      children.push(id);
      nodes[id] = { id, type: "text", value: id };
    }
    nodes["root"] = { id: "root", type: "box", children };
    const stamp: FacetStamp = { name: "huge", root: "root", nodes };
    const provider = providerOf(
      toolStep(call("use_stamp", { name: "huge", params: {}, at: { parent: "root" } })),
      END,
    );
    const agent = makeAgent(provider, { stamps: [stamp] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(agent, { kind: "message", text: "huge" });

      expect(patchesOf(out)).toHaveLength(0);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs[0]).toContain("would exceed the patch op cap");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("use_stamp reports non-fatal expansion issues in a successful observation", async () => {
    const stamp: FacetStamp = {
      name: "label",
      slots: { title: "Fallback" },
      root: "label",
      nodes: { label: { id: "label", type: "text", value: "{{title}}" } },
    };
    const provider = providerOf(
      toolStep(call("use_stamp", { name: "label", params: 42, at: { parent: "root" } })),
      END,
    );
    const agent = makeAgent(provider, { stamps: [stamp] });

    await runAgent(agent, { kind: "message", text: "bad params" });

    const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
      m.role === "tool_result" ? m.content : "",
    );
    expect(obs[0]).toContain("note:");
    expect(obs[0]).toContain("params is not an object map");
  });

  it("per-step streaming yields one batch for each provider step that changed output", async () => {
    const provider = providerOf(
      toolStep(
        call("append_node", { parentId: "root", node: { id: "one", type: "text", value: "1" } }),
      ),
      toolStep(call("set_node", { node: { id: "two", type: "text", value: "2" } })),
      toolStep(call("say", { text: "done" })),
      END,
    );
    const agent = makeAgent(provider);

    const batches = await batchesOf(agent, { kind: "message", text: "build" });

    expect(batches).toHaveLength(3);
    expect(batches[0]?.map((m) => m.kind)).toEqual(["patch"]);
    expect(batches[1]?.map((m) => m.kind)).toEqual(["patch"]);
    expect(batches[2]).toEqual([{ kind: "say", text: "done" }]);
  });

  it("defers a set_node forward child ref until the target node exists in the same streamed batch", async () => {
    const provider = providerOf(
      toolStep(call("set_node", { node: { id: "panel", type: "box", children: ["child"] } })),
      toolStep(call("set_node", { node: { id: "child", type: "text", value: "ready" } })),
      END,
    );
    const agent = makeAgent(provider);

    const batches = await batchesOf(agent, { kind: "message", text: "build" });

    expect(batches).toHaveLength(1);
    const patch = batches[0]?.find((m) => m.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind === "patch") {
      const paths = patch.patches.map((p) => ("path" in p ? p.path : ""));
      expect(paths).toEqual(["/nodes/child", "/nodes/panel"]);
      expect(patch.patches).toContainEqual({
        op: "add",
        path: "/nodes/panel",
        value: { id: "panel", type: "box", children: ["child"] },
      });
    }
  });

  it("keeps chained set_node forward refs buffered until the full target chain is closed", async () => {
    const provider = providerOf(
      toolStep(call("set_node", { node: { id: "panel", type: "box", children: ["child"] } })),
      toolStep(call("set_node", { node: { id: "child", type: "box", children: ["grandchild"] } })),
      toolStep(call("set_node", { node: { id: "grandchild", type: "text", value: "ready" } })),
      END,
    );
    const agent = makeAgent(provider);

    const batches = await batchesOf(agent, { kind: "message", text: "build" });

    expect(batches).toHaveLength(1);
    const patch = batches[0]?.find((m) => m.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind === "patch") {
      const paths = patch.patches.map((p) => ("path" in p ? p.path : ""));
      expect(paths).toEqual(["/nodes/grandchild", "/nodes/child", "/nodes/panel"]);
    }
  });

  it("defers an append_node box with a forward child ref until the target node exists", async () => {
    const provider = providerOf(
      toolStep(
        call("append_node", {
          parentId: "root",
          node: { id: "panel", type: "box", children: ["child"] },
        }),
      ),
      toolStep(call("set_node", { node: { id: "child", type: "text", value: "ready" } })),
      END,
    );
    const agent = makeAgent(provider);

    const batches = await batchesOf(agent, { kind: "message", text: "build" });

    expect(batches).toHaveLength(1);
    const patch = batches[0]?.find((m) => m.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind === "patch") {
      const paths = patch.patches.map((p) => ("path" in p ? p.path : ""));
      expect(paths).toEqual(["/nodes/child", "/nodes/panel", "/nodes/root/children/-"]);
    }
  });

  it("drops a stale pending op when the same node id is replaced before closure", async () => {
    const provider = providerOf(
      toolStep(
        call("append_node", {
          parentId: "root",
          node: { id: "panel", type: "box", children: ["child"] },
        }),
      ),
      toolStep(call("set_node", { node: { id: "panel", type: "text", value: "replacement" } })),
      toolStep(call("set_node", { node: { id: "child", type: "text", value: "late child" } })),
      END,
    );
    const agent = makeAgent(provider);

    const batches = await batchesOf(agent, { kind: "message", text: "build" });

    expect(batches).toHaveLength(2);
    const paths = batches
      .flatMap((batch) => batch.flatMap((m) => (m.kind === "patch" ? m.patches : [])))
      .map((p) => ("path" in p ? p.path : ""));
    expect(paths).toContain("/nodes/panel");
    expect(paths).toContain("/nodes/child");
    expect(paths).not.toContain("/nodes/root/children/-");
  });

  it("normalizes a box without children instead of throwing from the closure buffer", async () => {
    const provider = providerOf(
      toolStep(call("set_node", { node: { id: "panel", type: "box" } })),
      END,
    );
    const agent = makeAgent(provider);

    const batches = await batchesOf(agent, { kind: "message", text: "build" });

    expect(batches).toHaveLength(1);
    const patch = batches[0]?.find((m) => m.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind === "patch") {
      expect(patch.patches).toContainEqual({
        op: "add",
        path: "/nodes/panel",
        value: { id: "panel", type: "box", children: [] },
      });
    }
  });

  it("does not report a permanently buffered set_node as a completed mutation", async () => {
    const provider = providerOf(
      toolStep(call("set_node", { node: { id: "panel", type: "box", children: ["missing"] } })),
      END,
    );
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(agent, { kind: "message", text: "build" });

      expect(patchesOf(out)).toHaveLength(0);
      expect(saysOf(out)[0]).toMatch(/sorry/i);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs).toContain('queued: "panel" waits for child node(s): missing');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("forces the failure fallback when a turn has emitted edits but still has unresolved buffered nodes", async () => {
    const provider = providerOf(
      toolStep(call("set_node", { node: { id: "panel", type: "box", children: ["missing"] } })),
      toolStep(
        call("append_node", { parentId: "root", node: { id: "ok", type: "text", value: "done" } }),
      ),
      END,
    );
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(agent, { kind: "message", text: "build" });

      expect(patchesOf(out)).toHaveLength(1);
      expect(saysOf(out)[0]).toMatch(/sorry/i);
      expect(errorSpy).toHaveBeenCalledWith(
        "[facet-quickstart] unresolved buffered edits:",
        '"panel" still waits for child node(s): missing',
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reports an append parent that exists only as a pending buffered node", async () => {
    const provider = providerOf(
      toolStep(call("set_node", { node: { id: "panel", type: "box", children: ["missing"] } })),
      toolStep(
        call("append_node", { parentId: "panel", node: { id: "leaf", type: "text", value: "x" } }),
      ),
      END,
    );
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await runAgent(agent, { kind: "message", text: "build" });

      const obs = provider.turns[2]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs).toContain(
        'error: append_node — parent "panel" was created this turn but is still waiting for child node(s): missing. Define those child nodes before appending into it.',
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("renders a full page then says, across a multi-step tool loop", async () => {
    const provider = providerOf(
      toolStep(call("render_page", { tree: VALID_TREE })),
      toolStep(call("say", { text: "here you go" })),
      END,
    );
    const agent = makeAgent(provider);
    const out = await runAgent(agent, { kind: "message", text: "draw it" }, SESSION);

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
    const out = await runAgent(agent, { kind: "message", text: "tweak it" }, SESSION);

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
    const out = await runAgent(agent, { kind: "message", text: "add" }, SESSION);

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
      const out = await runAgent(agent, { kind: "message", text: "add" }, SESSION);
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
      await runAgent(agent, { kind: "message", text: "go" }, SESSION);
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
      const out = await runAgent(agent, { kind: "message", text: "add" }, SESSION);
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
    await runAgent(agent, { kind: "message", text: "build" }, SESSION);
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
    const out = await runAgent(agent, { kind: "visit", visitor: { visitorId: "v1" } }, SESSION);
    // isRenderable must accept it (entry screen "home" is a non-empty box).
    expect(patchesOf(out)).toHaveLength(1);
  });

  it("removes a node and rejects media/field nodes missing required fields", async () => {
    const provider = providerOf(
      toolStep(
        call("render_page", { tree: VALID_TREE }),
        call("remove_node", { nodeId: "greet" }),
        call("set_node", { node: { id: "i", type: "media", kind: "image" } }), // no src
        call("set_node", { node: { id: "f", type: "field" } }), // no name
      ),
      END,
    );
    const agent = makeAgent(provider);
    const out = await runAgent(agent, { kind: "message", text: "edit" }, SESSION);
    const patch = out.find((m) => m.kind === "patch");
    if (patch?.kind === "patch") {
      expect(
        patch.patches.some((p) => p.op === "remove" && "path" in p && p.path === "/nodes/greet"),
      ).toBe(true);
    }
    const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
      m.role === "tool_result" ? m.content : "",
    );
    expect(obs.some((o) => o.includes('"media" node needs string "src"'))).toBe(true);
    expect(obs.some((o) => o.includes('"field" node needs a string "name"'))).toBe(true);
  });

  it("brick-vocab v1 accepts media nodes and rejects old image nodes", async () => {
    const provider = providerOf(
      toolStep(
        call("render_page", { tree: VALID_TREE }),
        call("set_node", {
          node: {
            id: "clip",
            type: "media",
            kind: "video",
            src: "https://example.com/clip.mp4",
            controls: true,
          },
        }),
        call("set_node", {
          node: {
            id: "old",
            type: "image",
            src: "https://example.com/old.png",
            alt: "old",
          },
        }),
        call("set_node", {
          node: {
            id: "badKind",
            type: "media",
            kind: "gif3d",
            src: "https://example.com/bad.gif",
          },
        }),
        call("set_node", {
          node: {
            id: "badSrc",
            type: "media",
            kind: "image",
            src: "javascript:alert(1)",
          },
        }),
      ),
      END,
    );
    const agent = makeAgent(provider);
    const out = await runAgent(agent, { kind: "message", text: "edit" }, SESSION);
    const patch = out.find((m) => m.kind === "patch");
    if (patch?.kind === "patch") {
      expect(patch.patches.some((p) => "path" in p && p.path === "/nodes/clip")).toBe(true);
      expect(patch.patches.some((p) => "path" in p && p.path === "/nodes/old")).toBe(false);
      expect(patch.patches.some((p) => "path" in p && p.path === "/nodes/badKind")).toBe(false);
      expect(patch.patches.some((p) => "path" in p && p.path === "/nodes/badSrc")).toBe(false);
    }
    const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
      m.role === "tool_result" ? m.content : "",
    );
    expect(obs.some((o) => o.includes("ok: set") && o.includes("clip"))).toBe(true);
    expect(obs.some((o) => o.includes('"type" must be one of'))).toBe(true);
    expect(obs.some((o) => o.includes("media"))).toBe(true);
    expect(obs.some((o) => o.includes('kind must be "image" or "video"'))).toBe(true);
    expect(obs.some((o) => o.includes('safe static "src"'))).toBe(true);
  });

  it("set_theme records a /theme add op the model can drive", async () => {
    const provider = providerOf(toolStep(call("set_theme", { name: "midnight" })), END);
    const agent = makeAgent(provider);
    const out = await runAgent(agent, { kind: "message", text: "go dark" }, SESSION);

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
      const out = await runAgent(agent, { kind: "message", text: "go" }, SESSION);
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
      const out = await runAgent(agent, { kind: "message", text: "go" }, SESSION);
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
    await runAgent(agent, { kind: "message", text: "loop" }, SESSION);
    expect(provider.turns).toHaveLength(3);
  });

  it("a bare-prose step (no tool calls) becomes a chat say, not an apology", async () => {
    const provider = providerOf(textStep("I'm your personal page agent — ask me anything!"));
    const agent = makeAgent(provider);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(agent, { kind: "message", text: "who are you?" }, SESSION);
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
      const out = await runAgent(agent, { kind: "message", text: "hi" }, SESSION);
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
      const out = await runAgent(agent, { kind: "message", text: "add" }, SESSION);
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
      const out = await runAgent(agent, { kind: "message", text: "add" }, SESSION);
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
    const out = await runAgent(agent, { kind: "message", text: "draw" }, SESSION);

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
    await runAgent(
      agent,
      {
        kind: "tap",
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
    await runAgent(agent, { kind: "message", text: "now" }, SESSION);

    const all = provider.turns[0]!.messages.map((m) => ("content" in m ? m.content : "")).join(
      "\n",
    );
    expect(all).toContain("newer-line");
    expect(all).not.toContain("older-line");
  });

  it("uses DEFAULT_GUIDE when no guide is given", async () => {
    const provider = providerOf(toolStep(call("say", { text: "hi" })), END);
    const agent = makeAgent(provider);
    await runAgent(agent, { kind: "message", text: "hi" }, SESSION);
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
    await runAgent(agent, { kind: "message", text: "draw" }, SESSION);

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
