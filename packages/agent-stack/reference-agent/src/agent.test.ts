import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PATCH_OPS,
  collectMessages,
  EMPTY_TREE,
  iterateAgentResult,
  validateTree,
} from "@facet/core";
import { parseAgentToolObservation, type AgentToolObservationData } from "@facet/agent-tools";
import type {
  ClientEvent,
  FacetCatalog,
  FacetSession,
  FacetComposition,
  FacetTheme,
  ServerMessage,
} from "@facet/core";
import {
  FacetRuntime,
  MemorySink,
  MemorySummaryStore,
  type Sink,
  type SummaryStore,
} from "@facet/runtime";
import {
  createReferenceAgentWithDependencies,
  type ReferenceAgentDependencies,
  type ReferenceAgentOptions,
} from "./agent.js";
import { resetBackgroundCompactionForTests } from "./harness/background-compaction.js";
import { STUB_TREE, createStubAgent } from "./stub.js";
import { DEFAULT_GUIDE } from "./prompt.js";
import type { ProviderStep, ProviderTurn, ReferenceProvider, ToolCall } from "./provider.js";
import type { ReferenceAgentTraceEvent } from "./harness/trace.js";
import type { ConversationSummary, Summarizer, SummarizerRequest } from "./harness/summary.js";

function createReferenceAgent(
  options: ReferenceAgentOptions & ReferenceAgentDependencies,
): ReturnType<typeof createReferenceAgentWithDependencies> {
  const { summarizerFactory, onBackgroundTask, ...agentOptions } = options;
  return createReferenceAgentWithDependencies(agentOptions, {
    ...(summarizerFactory !== undefined ? { summarizerFactory } : {}),
    ...(onBackgroundTask !== undefined ? { onBackgroundTask } : {}),
  });
}

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

const CATALOG_POLICY: FacetCatalog = {
  name: "reference-catalog",
  description: "Reference agent catalog policy",
  theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
  bricks: [
    { type: "section", variants: ["surface"] },
    { type: "button", variants: ["primary"] },
  ],
  compositions: { mode: "allow", names: ["approved"] },
  primitiveFallback: "allowed",
  policy: {
    order: ["composition", "component", "primitive"],
    editBeforeAppend: true,
    compactScreens: true,
    maxScreenSections: 4,
  },
};

function compositionWithPatchCount(name: string, patchCount: number): FacetComposition {
  const nodeCount = patchCount - 1;
  const children = Array.from({ length: nodeCount - 1 }, (_, index) => `child-${String(index)}`);
  return {
    name,
    root: "composition-root",
    nodes: {
      "composition-root": { id: "composition-root", type: "box", children },
      ...Object.fromEntries(children.map((id) => [id, { id, type: "text" as const, value: id }])),
    },
  };
}

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

interface MockProvider extends ReferenceProvider {
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
  provider: ReferenceProvider,
  extra: {
    guide?: string;
    sink?: MemorySink;
    historyTurns?: number;
    maxSteps?: number;
    budgetPreset?: ReferenceAgentOptions["budgetPreset"];
    budget?: ReferenceAgentOptions["budget"];
    trace?: ReferenceAgentOptions["trace"];
    compositions?: readonly FacetComposition[];
    catalog?: FacetCatalog;
  } = {},
): ReturnType<typeof createReferenceAgent> {
  return createReferenceAgent({
    provider,
    sink: extra.sink ?? new MemorySink(),
    agentId: "quickstart",
    ...(extra.guide !== undefined ? { guide: extra.guide } : {}),
    ...(extra.budgetPreset !== undefined ? { budgetPreset: extra.budgetPreset } : {}),
    ...(extra.budget !== undefined ? { budget: extra.budget } : {}),
    ...(extra.trace !== undefined ? { trace: extra.trace } : {}),
    ...(extra.historyTurns !== undefined ? { historyTurns: extra.historyTurns } : {}),
    ...(extra.maxSteps !== undefined ? { maxSteps: extra.maxSteps } : {}),
    ...(extra.compositions !== undefined ? { compositions: extra.compositions } : {}),
    ...(extra.catalog !== undefined ? { catalog: extra.catalog } : {}),
  });
}

function saysOf(messages: readonly ServerMessage[]): string[] {
  return messages.flatMap((m) => (m.kind === "say" ? [m.text] : []));
}
function patchesOf(messages: readonly ServerMessage[]): readonly ServerMessage[] {
  return messages.filter((m) => m.kind === "patch");
}

async function recordHistory(sink: MemorySink, labels: readonly string[]): Promise<void> {
  for (const [index, label] of labels.entries()) {
    await sink.record("quickstart", "v1", {
      at: index,
      event: { kind: "message", text: `event-${label}` },
      messages: [{ kind: "say", text: `reply-${label}` }],
    });
  }
}

function providerTurnText(turn: ProviderTurn): string {
  return turn.messages.map((message) => ("content" in message ? message.content : "")).join("\n");
}

function toolResultContents(turn: ProviderTurn): string[] {
  return turn.messages.flatMap((message) =>
    message.role === "tool_result" ? [message.content] : [],
  );
}

function toolResultData(turn: ProviderTurn): AgentToolObservationData[] {
  return toolResultContents(turn).map((content) => {
    const parsed = parseAgentToolObservation(content);
    if (parsed === undefined) throw new Error(`expected structured tool observation: ${content}`);
    return parsed;
  });
}

function toolResultSearchText(turn: ProviderTurn): string {
  return toolResultData(turn)
    .map((data) =>
      [data.message, data.next_action, data.summary, ...data.warnings].filter(Boolean).join("\n"),
    )
    .join("\n");
}

async function runAgent(
  agent: ReturnType<typeof createReferenceAgent>,
  event: ClientEvent,
  session: FacetSession = SESSION,
): Promise<readonly ServerMessage[]> {
  return collectMessages(agent(event, session));
}

async function batchesOf(
  agent: ReturnType<typeof createReferenceAgent>,
  event: ClientEvent,
  session: FacetSession = SESSION,
): Promise<readonly (readonly ServerMessage[])[]> {
  const batches: ServerMessage[][] = [];
  for await (const batch of iterateAgentResult(agent(event, session))) {
    batches.push([...batch]);
  }
  return batches;
}

describe("createReferenceAgent tool loop", () => {
  it("use_composition expands a composition through the closure into one referentially closed batch", async () => {
    const composition: FacetComposition = {
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
        call("use_composition", {
          name: "card",
          params: { title: "Hello" },
          at: { parent: "root" },
        }),
      ),
      END,
    );
    const agent = makeAgent(provider, { compositions: [composition] });

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
      const observation = toolResultData(provider.turns[1]!)[0]!;
      expect(observation.data).toBeDefined();
      const idsJson = JSON.parse(observation.data ?? "") as {
        readonly root: string;
        readonly slots: Readonly<Record<string, string>>;
        readonly ids: Readonly<Record<string, string>>;
      };
      expect(observation).toMatchObject({
        status: "ok",
        outcome: "applied_visible",
        applied: true,
        visible_to_visitor: true,
      });
      expect(idsJson.root).toBe(rootId);
      expect(idsJson.slots["title"]).toBe(childId);
      expect(idsJson.ids["card"]).toBe(rootId);
    }
  });

  it("use_composition reports an unknown composition name as a no-op observation", async () => {
    const provider = providerOf(
      toolStep(call("use_composition", { name: "missing", params: {}, at: { parent: "root" } })),
      END,
    );
    const agent = makeAgent(provider, { compositions: [] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(agent, { kind: "message", text: "use missing" });

      expect(patchesOf(out)).toHaveLength(0);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs.some((o) => o.includes("unknown composition") && o.includes("missing"))).toBe(
        true,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("use_composition twice remaps ids disjointly in the same turn", async () => {
    const composition: FacetComposition = {
      name: "label",
      root: "label",
      nodes: { label: { id: "label", type: "text", value: "Badge" } },
    };
    const provider = providerOf(
      toolStep(
        call("use_composition", { name: "label", params: {}, at: { parent: "root" } }),
        call("use_composition", { name: "label", params: {}, at: { parent: "root" } }),
      ),
      END,
    );
    const agent = makeAgent(provider, { compositions: [composition] });

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

  it("use_composition resolves from the immutable composition snapshot captured at agent creation", async () => {
    const composition: FacetComposition = {
      name: "label",
      slots: { title: "Original" },
      root: "label",
      nodes: { label: { id: "label", type: "text", value: "{{title}}" } },
    };
    const provider = providerOf(
      toolStep(call("use_composition", { name: "label", params: {}, at: { parent: "root" } })),
      END,
    );
    const agent = makeAgent(provider, { compositions: [composition] });
    const mutableComposition = composition as {
      slots?: FacetComposition["slots"];
      nodes: Record<string, FacetComposition["nodes"][string]>;
    };
    mutableComposition.slots = { title: "Mutated" };
    mutableComposition.nodes["label"] = { id: "label", type: "text", value: "Mutated" };

    const out = await runAgent(agent, { kind: "message", text: "snapshot" });

    const patch = out.find((m) => m.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind !== "patch") throw new Error("expected patch");
    expect(JSON.stringify(patch.patches)).toContain("Original");
    expect(JSON.stringify(patch.patches)).not.toContain("Mutated");
  });

  it("use_composition rapid sequential provider turns preserve order and emit referentially closed batches", async () => {
    const composition: FacetComposition = {
      name: "pair",
      slots: { title: "Original" },
      root: "pair",
      nodes: {
        pair: { id: "pair", type: "box", children: ["pair-title"] },
        "pair-title": { id: "pair-title", type: "text", value: "{{title}}" },
      },
    };
    const provider = providerOf(
      toolStep(call("use_composition", { name: "pair", params: {}, at: { parent: "root" } })),
      END,
      toolStep(call("use_composition", { name: "pair", params: {}, at: { parent: "root" } })),
      END,
    );
    const agent = makeAgent(provider, { compositions: [composition] });

    const firstTurn = await batchesOf(agent, { kind: "message", text: "first-turn" });
    // Mutating the source between rapid turns must not alter later executions (DC-009).
    (composition.nodes as Record<string, FacetComposition["nodes"][string]>)["pair-title"] = {
      id: "pair-title",
      type: "text",
      value: "Mutated",
    };
    const secondTurn = await batchesOf(agent, { kind: "message", text: "second-turn" });

    for (const turn of [firstTurn, secondTurn]) {
      expect(turn).toHaveLength(1);
      const patch = turn[0]?.find((m) => m.kind === "patch");
      expect(patch?.kind).toBe("patch");
      if (patch?.kind !== "patch") throw new Error("expected patch");
      // Referentially closed: every node id the batch references is defined in
      // the same batch, and the visible append lands last.
      const addedNodeIds = patch.patches.flatMap((op) =>
        op.op === "add" && op.path.startsWith("/nodes/") && !op.path.endsWith("/children/-")
          ? [op.path.slice("/nodes/".length)]
          : [],
      );
      const append = patch.patches.at(-1);
      expect(append).toMatchObject({ op: "add", path: "/nodes/root/children/-" });
      const appendedRoot =
        append?.op === "add" && typeof append.value === "string" ? append.value : "";
      expect(addedNodeIds).toContain(appendedRoot);
      for (const op of patch.patches) {
        if (op.op !== "add" || op.path.endsWith("/children/-")) continue;
        const node = op.value as { readonly children?: readonly string[] };
        for (const childId of node.children ?? []) expect(addedNodeIds).toContain(childId);
      }
      expect(JSON.stringify(patch.patches)).toContain("Original");
      expect(JSON.stringify(patch.patches)).not.toContain("Mutated");
    }
    // Order preserved: the first turn's provider steps precede the second turn's.
    expect(providerTurnText(provider.turns[0]!)).toContain("first-turn");
    expect(providerTurnText(provider.turns[2]!)).toContain("second-turn");
  });

  it("use_composition is a no-op for malformed compositions and unknown parents", async () => {
    const malformed = {
      name: "broken",
      root: "missing",
      nodes: { text: { id: "text", type: "text", value: "x" } },
    } as unknown as FacetComposition;
    const provider = providerOf(
      toolStep(
        call("use_composition", { name: "broken", params: {}, at: { parent: "root" } }),
        call("use_composition", { name: "broken", params: {}, at: { parent: "ghost" } }),
      ),
      END,
    );
    const agent = makeAgent(provider, { compositions: [malformed] });
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

  it("use_composition rejects a parent that exists but is not a container", async () => {
    const composition: FacetComposition = {
      name: "label",
      root: "label",
      nodes: { label: { id: "label", type: "text", value: "Inside" } },
    };
    const provider = providerOf(
      toolStep(call("use_composition", { name: "label", params: {}, at: { parent: "title" } })),
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
    const agent = makeAgent(provider, { compositions: [composition] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(
        agent,
        { kind: "message", text: "bad parent" },
        sessionWithTextParent,
      );

      expect(patchesOf(out)).toHaveLength(0);
      expect(toolResultData(provider.turns[1]!)).toContainEqual(
        expect.objectContaining({
          status: "error",
          outcome: "rejected",
          message: 'error: use_composition — parent "title" is not a container',
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("append_node rejects a parent that exists but is not a container", async () => {
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
      expect(toolResultData(provider.turns[1]!)).toContainEqual(
        expect.objectContaining({
          status: "error",
          outcome: "rejected",
          message: 'error: append_node — parent "title" is not a container',
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("use_composition refuses an expansion beyond the node output cap without emitting patches", async () => {
    // MAX_PATCH_OPS children + the composition root exceed the canonical
    // 1023-node output cap (DC-003), so the expansion refuses with zero
    // partial state before the executor's patch-op accounting even runs.
    const nodes: Record<string, FacetComposition["nodes"][string]> = {
      root: { id: "root", type: "box", children: [] },
    };
    const children: string[] = [];
    for (let i = 0; i < MAX_PATCH_OPS; i += 1) {
      const id = `n${String(i)}`;
      children.push(id);
      nodes[id] = { id, type: "text", value: id };
    }
    nodes["root"] = { id: "root", type: "box", children };
    const composition: FacetComposition = { name: "huge", root: "root", nodes };
    const provider = providerOf(
      toolStep(call("use_composition", { name: "huge", params: {}, at: { parent: "root" } })),
      END,
    );
    const agent = makeAgent(provider, { compositions: [composition] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(agent, { kind: "message", text: "huge" });

      expect(patchesOf(out)).toHaveLength(0);
      const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
        m.role === "tool_result" ? m.content : "",
      );
      expect(obs[0]).toContain("could not expand");
      expect(obs[0]).toContain("1023-node cap");
      expect(obs[0]).toContain("invalid_composition");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("use_composition counts patch ops already flushed before say in the same provider step", async () => {
    const largeNodes: Record<string, FacetComposition["nodes"][string]> = {
      root: { id: "root", type: "box", children: [] },
    };
    const children: string[] = [];
    for (let i = 0; i < MAX_PATCH_OPS - 2; i += 1) {
      const id = `n${String(i)}`;
      children.push(id);
      largeNodes[id] = { id, type: "text", value: id };
    }
    largeNodes["root"] = { id: "root", type: "box", children };
    const compositions: FacetComposition[] = [
      { name: "large", root: "root", nodes: largeNodes },
      {
        name: "label",
        root: "label",
        nodes: { label: { id: "label", type: "text", value: "Too much" } },
      },
    ];
    const provider = providerOf(
      toolStep(
        call("use_composition", { name: "large", params: {}, at: { parent: "root" } }),
        call("say", { text: "between" }),
        call("use_composition", { name: "label", params: {}, at: { parent: "root" } }),
      ),
      END,
    );
    const agent = makeAgent(provider, { compositions });

    const out = await runAgent(agent, { kind: "message", text: "mixed" });

    expect(patchesOf(out)).toHaveLength(1);
    expect(saysOf(out)).toEqual(["between"]);
    const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
      m.role === "tool_result" ? m.content : "",
    );
    expect(obs[2]).toContain("would exceed the patch op cap");
  });

  it("use_composition reports non-fatal expansion issues in a successful observation", async () => {
    const composition: FacetComposition = {
      name: "label",
      slots: { title: "Fallback" },
      root: "label",
      nodes: { label: { id: "label", type: "text", value: "{{title}}" } },
    };
    const provider = providerOf(
      toolStep(call("use_composition", { name: "label", params: 42, at: { parent: "root" } })),
      END,
    );
    const agent = makeAgent(provider, { compositions: [composition] });

    await runAgent(agent, { kind: "message", text: "bad params" });

    const observation = toolResultData(provider.turns[1]!)[0]!;
    expect(observation.message).toContain("note:");
    expect(
      observation.warnings.some((warning) => warning.includes("params is not an object map")),
    ).toBe(true);
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
        value: { id: "panel", type: "box", style: {}, children: ["child"] },
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
        value: { id: "panel", type: "box", style: {}, children: [] },
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
      expect(toolResultData(provider.turns[1]!)).toContainEqual(
        expect.objectContaining({
          status: "pending",
          outcome: "pending",
          message: 'queued: "panel" waits for child node(s): missing',
        }),
      );
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
        "[facet-reference-agent] unresolved buffered edits:",
        "1 unresolved edit(s)",
      );
      expect(errorSpy).toHaveBeenCalledTimes(1);
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

      expect(toolResultData(provider.turns[2]!)).toContainEqual(
        expect.objectContaining({
          status: "pending",
          outcome: "pending",
          message:
            'error: append_node — parent "panel" was created this turn but is still waiting for child node(s): missing. Define those child nodes before appending into it.',
        }),
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

  it("feeds agent-tools patch metadata into successful tool observations", async () => {
    const provider = providerOf(
      toolStep(
        call("append_node", {
          parentId: "root",
          node: { id: "meta", type: "text", value: "metadata" },
        }),
      ),
      END,
    );
    const agent = makeAgent(provider);

    await runAgent(agent, { kind: "message", text: "add metadata" }, SESSION);

    const observation = toolResultData(provider.turns[1]!)[0]!;
    expect(observation).toMatchObject({
      tool: "append_node",
      status: "ok",
      outcome: "applied_visible",
      patch_count: 2,
      changed_node_ids: ["meta", "root"],
      message: 'Appended "meta" under "root".',
    });
    expect(observation.summary).toContain("2 patch ops");
  });

  it("passes tool observations into the next provider step through the harness", async () => {
    const provider = providerOf(
      toolStep(
        call("append_node", {
          parentId: "root",
          node: { id: "observed", type: "text", value: "metadata" },
        }),
      ),
      END,
    );
    const agent = createReferenceAgent({
      provider,
      sink: new MemorySink(),
      agentId: "quickstart",
      budget: { maxObservationChars: 40 },
    });

    await runAgent(agent, { kind: "message", text: "add observed" }, SESSION);

    const obs = provider.turns[1]!.messages.filter((m) => m.role === "tool_result").map((m) =>
      m.role === "tool_result" ? m.content : "",
    );
    expect(obs).toHaveLength(1);
    expect(obs[0]!.length).toBeLessThanOrEqual(40);
    expect(obs[0]).toContain("[truncated:");
  });

  it("reports an error before a provider step exceeds the aggregate patch cap", async () => {
    const provider = providerOf(
      toolStep(
        call("use_composition", { name: "cap-fill", params: {}, at: { parent: "root" } }),
        call("append_node", {
          parentId: "root",
          node: { id: "too-many", type: "text", value: "cap" },
        }),
      ),
      END,
    );
    const agent = makeAgent(provider, {
      budget: { maxToolCallsPerStep: 2, maxContextChars: 1_000_000 },
      compositions: [compositionWithPatchCount("cap-fill", MAX_PATCH_OPS)],
    });

    const out = await runAgent(agent, { kind: "message", text: "add many" }, SESSION);

    const patch = out.find((message) => message.kind === "patch");
    expect(patch).toBeDefined();
    if (patch?.kind === "patch") expect(patch.patches).toHaveLength(MAX_PATCH_OPS);
    const observations = toolResultData(provider.turns[1]!);
    expect(observations[0]).toMatchObject({
      tool: "use_composition",
      status: "ok",
      patch_count: MAX_PATCH_OPS,
    });
    expect(observations.at(-1)?.message).toContain("would exceed the patch op cap");
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
    const observations = toolResultData(secondTurn);
    expect(observations.some((o) => o.status === "error")).toBe(true);

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
      expect(toolResultData(provider.turns[1]!).some((o) => o.status === "error")).toBe(true);
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
      const obs = toolResultSearchText(provider.turns[1]!);
      expect(obs.includes('"text" node needs a string "value"')).toBe(true);
      expect(obs.includes("unknown tool") && obs.includes("append_node")).toBe(true);
      expect(obs.includes("render_page") && obs.includes("renderable content")).toBe(true);
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
    // The append into the freshly-rendered "root" succeeds (root is now known).
    expect(
      toolResultData(provider.turns[2]!).some(
        (o) => o.status === "ok" && o.message.startsWith("Appended"),
      ),
    ).toBe(true);
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
    const obs = toolResultSearchText(provider.turns[1]!);
    expect(obs.includes('"media" node needs string "src"')).toBe(true);
    expect(obs.includes('"field" node needs a string "name"')).toBe(true);
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
    const observations = toolResultData(provider.turns[1]!);
    const obs = toolResultSearchText(provider.turns[1]!);
    expect(observations.some((o) => o.status === "ok" && o.message.includes("clip"))).toBe(true);
    expect(obs.includes('"type" must be one of')).toBe(true);
    expect(obs.includes("media")).toBe(true);
    expect(obs.includes('kind must be "image" or "video"')).toBe(true);
    expect(obs.includes('safe static "src"')).toBe(true);
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
      expect(
        toolResultData(provider.turns[1]!).some(
          (o) => o.status === "error" && o.message.includes("valid theme name"),
        ),
      ).toBe(true);
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
      expect(toolResultData(provider.turns[1]!).some((o) => o.status === "error")).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("catalog policy rejection observations reach the next provider step transcript", async () => {
    const provider = providerOf(
      toolStep(
        call("set_theme", { name: "midnight" }),
        call("append_node", {
          parentId: "root",
          node: {
            id: "sales-chart",
            type: "chart",
            kind: "bar",
            series: [{ label: "Sales", values: [1, 2] }],
          },
        }),
      ),
      END,
    );
    const agent = makeAgent(provider, { catalog: CATALOG_POLICY });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(agent, { kind: "message", text: "switch theme and add chart" });

      expect(patchesOf(out)).toHaveLength(0);
      const observations = toolResultData(provider.turns[1]!);
      expect(observations).toContainEqual(
        expect.objectContaining({
          tool: "set_theme",
          status: "error",
          outcome: "rejected",
          applied: false,
          stage_changed: false,
          visible_to_visitor: false,
        }),
      );
      expect(observations).toContainEqual(
        expect.objectContaining({
          tool: "append_node",
          status: "error",
          outcome: "rejected",
          applied: false,
          stage_changed: false,
          visible_to_visitor: false,
        }),
      );
      const transcript = toolResultSearchText(provider.turns[1]!);
      expect(transcript).toContain("catalog policy locked theme");
      expect(transcript).toContain('rejected theme "midnight"');
      expect(transcript).toContain('catalog policy rejected node type "chart"');
      expect(transcript).toContain("Use an allowed catalog component");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("stops at maxSteps when the model never ends the loop", async () => {
    const provider = providerOf(toolStep(call("say", { text: "again" }))); // repeats forever
    const agent = makeAgent(provider, { maxSteps: 3 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runAgent(agent, { kind: "message", text: "loop" }, SESSION);
      expect(provider.turns).toHaveLength(3);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("budget.maxSteps overrides legacy maxSteps while legacy maxSteps still works", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const legacyProvider = providerOf(toolStep(call("say", { text: "legacy" })));
      const legacyAgent = makeAgent(legacyProvider, { maxSteps: 2 });

      await runAgent(legacyAgent, { kind: "message", text: "legacy loop" }, SESSION);

      expect(legacyProvider.turns).toHaveLength(2);

      const overrideProvider = providerOf(toolStep(call("say", { text: "override" })));
      const overrideAgent = makeAgent(overrideProvider, {
        maxSteps: 1,
        budget: { maxSteps: 3 },
      });

      await runAgent(overrideAgent, { kind: "message", text: "override loop" }, SESSION);

      expect(overrideProvider.turns).toHaveLength(3);
    } finally {
      errorSpy.mockRestore();
    }
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

  it("catalog policy context preserves applied stage on provider failure without throwing", async () => {
    const traceEvents: ReferenceAgentTraceEvent[] = [];
    const provider = providerOf(
      toolStep(
        call("append_node", {
          parentId: "root",
          node: {
            id: "catalog-section",
            type: "section",
            title: "Catalog section",
            variant: "surface",
            children: [],
          },
        }),
      ),
      new Error("openai request failed: HTTP 400"),
    );
    const agent = makeAgent(provider, {
      catalog: CATALOG_POLICY,
      trace: (event) => {
        traceEvents.push(event);
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await runAgent(agent, { kind: "message", text: "add a catalog section" });

      expect(provider.turns[0]!.system).toContain("CATALOG");
      expect(provider.turns[0]!.system).toContain("reference-catalog");
      const patch = out.find((message) => message.kind === "patch");
      expect(patch).toBeDefined();
      if (patch?.kind !== "patch") throw new Error("expected patch");
      const paths = patch.patches.map((operation) => ("path" in operation ? operation.path : ""));
      expect(paths).toContain("/nodes/catalog-section");
      expect(paths).toContain("/nodes/root/children/-");
      expect(saysOf(out)).not.toContain(
        "Sorry — I couldn't update the page this time, so I've left it as it was. Please try again.",
      );
      expect(traceEvents).toContainEqual(
        expect.objectContaining({ type: "turn_error", reason: "http_status", httpStatus: 400 }),
      );
      expect(traceEvents).toContainEqual(
        expect.objectContaining({ type: "stop", reason: "provider_error" }),
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

    expect(toolResultData(provider.turns[1]!).some((o) => o.status === "error")).toBe(true);
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

  it("feeds only the current visitor's sink history into the provider turn", async () => {
    const sink = new MemorySink();
    await sink.record("quickstart", "v1", {
      at: 0,
      event: { kind: "message", text: "private-v1-line" },
      messages: [{ kind: "say", text: "private-v1-reply" }],
    });
    await sink.record("quickstart", "v2", {
      at: 1,
      event: { kind: "message", text: "visible-v2-line" },
      messages: [{ kind: "say", text: "visible-v2-reply" }],
    });

    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = makeAgent(provider, { sink, historyTurns: 10 });
    await runAgent(
      agent,
      { kind: "message", text: "visible-v2-now" },
      {
        ...SESSION,
        visitor: { visitorId: "v2" },
      },
    );

    const all = providerTurnText(provider.turns[0]!);
    expect(all).toContain("visible-v2-line");
    expect(all).toContain("visible-v2-now");
    expect(all).not.toContain("private-v1-line");
    expect(all).not.toContain("private-v1-reply");
  });

  it("budget.maxHistoryTurns overrides legacy historyTurns while legacy historyTurns still works", async () => {
    const sink = new MemorySink();
    await recordHistory(sink, ["older", "middle", "newer"]);

    const legacyProvider = providerOf(toolStep(call("say", { text: "legacy" })), END);
    const legacyAgent = makeAgent(legacyProvider, { sink, historyTurns: 1 });

    await runAgent(legacyAgent, { kind: "message", text: "now" }, SESSION);

    const legacyText = providerTurnText(legacyProvider.turns[0]!);
    expect(legacyText).toContain("event-newer");
    expect(legacyText).not.toContain("event-middle");
    expect(legacyText).not.toContain("event-older");

    const overrideProvider = providerOf(toolStep(call("say", { text: "override" })), END);
    const overrideAgent = makeAgent(overrideProvider, {
      sink,
      historyTurns: 1,
      budget: { maxHistoryTurns: 2 },
    });

    await runAgent(overrideAgent, { kind: "message", text: "now" }, SESSION);

    const overrideText = providerTurnText(overrideProvider.turns[0]!);
    expect(overrideText).toContain("event-newer");
    expect(overrideText).toContain("event-middle");
    expect(overrideText).not.toContain("event-older");
  });

  it('budgetPreset "hosted" and "local-dev" wire larger history budgets', async () => {
    const labels = Array.from({ length: 60 }, (_, index) => `h${String(index)}`);
    const sink = new MemorySink();
    await recordHistory(sink, labels);

    const hostedProvider = providerOf(toolStep(call("say", { text: "hosted" })), END);
    const hostedAgent = makeAgent(hostedProvider, { sink, budgetPreset: "hosted" });

    await runAgent(hostedAgent, { kind: "message", text: "hosted" }, SESSION);

    const hostedText = providerTurnText(hostedProvider.turns[0]!);
    expect(hostedText).toContain("event-h59");
    expect(hostedText).toContain("event-h20");
    expect(hostedText).not.toContain("event-h19");

    const localDevProvider = providerOf(toolStep(call("say", { text: "local" })), END);
    const localDevAgent = makeAgent(localDevProvider, { sink, budgetPreset: "local-dev" });

    await runAgent(localDevAgent, { kind: "message", text: "local" }, SESSION);

    const localDevText = providerTurnText(localDevProvider.turns[0]!);
    expect(localDevText).toContain("event-h59");
    expect(localDevText).toContain("event-h0");
  });

  it("trace receives stop/tool/provider events and callback failures do not break the turn", async () => {
    const events: ReferenceAgentTraceEvent[] = [];
    const trace: ReferenceAgentOptions["trace"] = (event) => {
      events.push(event);
      if (event.type === "provider_attempt") throw new Error("trace sync failure");
      if (event.type === "tool_result") return Promise.reject(new Error("trace async failure"));
      return undefined;
    };
    const provider = providerOf(toolStep(call("say", { text: "traced" })), END);
    const agent = makeAgent(provider, { trace });

    const out = await runAgent(agent, { kind: "message", text: "trace" }, SESSION);

    expect(saysOf(out)).toEqual(["traced"]);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "turn_start",
        "provider_attempt",
        "provider_step",
        "tool_result",
        "batch_yield",
        "stop",
      ]),
    );
    expect(events.filter((event) => event.type === "stop")).toContainEqual(
      expect.objectContaining({ reason: "provider_stop" }),
    );
  });

  it("uses DEFAULT_GUIDE when no guide is given", async () => {
    const provider = providerOf(toolStep(call("say", { text: "hi" })), END);
    const agent = makeAgent(provider);
    await runAgent(agent, { kind: "message", text: "hi" }, SESSION);
    expect(provider.turns[0]!.system).toContain(DEFAULT_GUIDE);
  });

  it("threads operator themes and compositions into the system prompt (names only, no theme CSS)", async () => {
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const theme: FacetTheme = {
      name: "neon",
      description: "a bright neon look",
      color: { bg: "#ff00ff" },
    };
    const composition: FacetComposition = {
      name: "hero",
      description: "a hero band",
      root: "h-root",
      nodes: {
        "h-root": { id: "h-root", type: "box", children: ["h-title"] },
        "h-title": { id: "h-title", type: "text", value: "Welcome" },
      },
    };
    const agent = createReferenceAgent({
      provider,
      sink: new MemorySink(),
      agentId: "quickstart",
      themes: [theme],
      compositions: [composition],
    });
    await runAgent(agent, { kind: "message", text: "draw" }, SESSION);

    const system = provider.turns[0]!.system;
    expect(system).toContain("THEMES");
    expect(system).toContain("neon");
    expect(system).toContain("COMPOSITIONS");
    expect(system).toContain("hero");
    // Theme documents reach the model by NAME only — the raw CSS value never does.
    expect(system).not.toContain("#ff00ff");
  });
});

describe("compaction", () => {
  const SMALL_SUMMARY: ConversationSummary = {
    version: 1,
    visitor: "v",
    pageDecisions: "p",
    collectedData: "",
    pending: "",
    attempts: "",
    omitted: "",
  };

  interface SpySummarizer {
    readonly summarizer: Summarizer;
    readonly calls: SummarizerRequest[];
  }
  function spySummarizer(...args: [] | [ConversationSummary | undefined]): SpySummarizer {
    // A no-arg call defaults to SMALL_SUMMARY; an explicit `undefined` means the
    // summarizer produced nothing (default params would otherwise swallow it).
    const result = args.length === 0 ? SMALL_SUMMARY : args[0];
    const calls: SummarizerRequest[] = [];
    return {
      calls,
      summarizer: (request: SummarizerRequest) => {
        calls.push(request);
        return Promise.resolve(result);
      },
    };
  }

  // Each turn is a user event + agent reply with a long filler so the summarized
  // text is materially larger than a small summary block (min-gain passes).
  async function recordLongHistory(sink: MemorySink, count: number, start = 0): Promise<void> {
    const filler = "x".repeat(200);
    for (let i = start; i < start + count; i += 1) {
      await sink.record("quickstart", "v1", {
        at: i,
        event: { kind: "message", text: `event-${String(i)} ${filler}` },
        messages: [{ kind: "say", text: `reply-${String(i)} ${filler}` }],
      });
    }
  }

  let backgroundTasks: Promise<void>[] = [];
  const onBackgroundTask = (task: Promise<void>): void => {
    backgroundTasks.push(task);
  };
  async function drainBackground(): Promise<void> {
    const pending = backgroundTasks;
    backgroundTasks = [];
    await Promise.all(pending);
  }

  // The min-gain cooldown marker is module-level and keyed by sessionKey, which is
  // shared ("quickstart"/"v1") across these tests — clear it so a skip in one test
  // can never cool down a later one.
  beforeEach(() => {
    resetBackgroundCompactionForTests();
    backgroundTasks = [];
  });

  // A low token budget makes the cross-turn trigger fire on modest history.
  const TRIGGERING_BUDGET: ReferenceAgentOptions["budget"] = { maxContextTokens: 100 };

  it("persists a generation-1 summary in the background and injects it next turn", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const summaryStore = new MemorySummaryStore();
    const spy = spySummarizer();
    const events: ReferenceAgentTraceEvent[] = [];
    const provider = providerOf(toolStep(call("say", { text: "done" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
      trace: (event) => {
        events.push(event);
      },
    });

    await runAgent(agent, { kind: "message", text: "hello" });
    await drainBackground();

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toMatchObject({ kind: "history", generation: 1 });
    expect(spy.calls[0]?.previous).toBeUndefined();
    const stored = await summaryStore.get("quickstart", "v1");
    expect(stored?.generation).toBe(1);
    expect(stored?.coveredThrough).toBe(4);
    // The persisted payload is the summary plus its conversation anchor.
    expect(stored?.payload).toMatchObject(SMALL_SUMMARY);
    expect((stored?.payload as { anchor?: unknown }).anchor).toBe("0:message");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "compaction_triggered", site: "cross_turn" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_done",
        site: "cross_turn",
        generation: 1,
        coveredThrough: 4,
      }),
    );

    // Next turn assembles the injected summary block into the provider context.
    const nextProvider = providerOf(toolStep(call("say", { text: "again" })), END);
    const nextAgent = createReferenceAgent({
      provider: nextProvider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spySummarizer().summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
    });
    await runAgent(nextAgent, { kind: "message", text: "again" });
    await drainBackground();

    expect(providerTurnText(nextProvider.turns[0]!)).toContain("CONVERSATION SUMMARY");
  });

  it("rolls a generation-2 summary that extends generation-1 and rejects a regressive write", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const summaryStore = new MemorySummaryStore();
    const spy = spySummarizer();
    const provider1 = providerOf(toolStep(call("say", { text: "one" })), END);
    const agent1 = createReferenceAgent({
      provider: provider1,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
    });
    await runAgent(agent1, { kind: "message", text: "one" });
    await drainBackground();
    expect((await summaryStore.get("quickstart", "v1"))?.generation).toBe(1);

    await recordLongHistory(sink, 4, 8); // total 12 turns now

    const provider2 = providerOf(toolStep(call("say", { text: "two" })), END);
    const agent2 = createReferenceAgent({
      provider: provider2,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
    });
    await runAgent(agent2, { kind: "message", text: "two" });
    await drainBackground();

    expect(spy.calls).toHaveLength(2);
    expect(spy.calls[1]).toMatchObject({ kind: "history", generation: 2 });
    expect(spy.calls[1]?.previous).toEqual(SMALL_SUMMARY);
    const stored = await summaryStore.get("quickstart", "v1");
    expect(stored?.generation).toBe(2);
    expect(stored?.coveredThrough).toBe(8);

    // A regressive write loses to the monotonic coveredThrough guard.
    const rejected = await summaryStore.put("quickstart", "v1", {
      payload: SMALL_SUMMARY,
      coveredThrough: 3,
      generation: 9,
    });
    expect(rejected).toBe(false);
    expect((await summaryStore.get("quickstart", "v1"))?.generation).toBe(2);
  });

  it("does not summarize when the projected context is below the trigger ratio", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 2);
    const summaryStore = new MemorySummaryStore();
    const spy = spySummarizer();
    const provider = providerOf(toolStep(call("say", { text: "hi" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      onBackgroundTask, // DEFAULT budget → high trigger, small history stays under it
    });
    await runAgent(agent, { kind: "message", text: "hi" });
    await drainBackground();

    expect(spy.calls).toHaveLength(0);
    expect(await summaryStore.get("quickstart", "v1")).toBeUndefined();
  });

  it("traces compaction_failed and writes nothing when the summarizer yields no summary", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const summaryStore = new MemorySummaryStore();
    const spy = spySummarizer(undefined);
    const events: ReferenceAgentTraceEvent[] = [];
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
      trace: (event) => {
        events.push(event);
      },
    });
    const out = await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();

    expect(saysOf(out)).toEqual(["ok"]); // the turn itself completed normally
    expect(spy.calls).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_failed",
        site: "cross_turn",
        reason: "summarizer_failed",
      }),
    );
    expect(await summaryStore.get("quickstart", "v1")).toBeUndefined();
  });

  it("skips the write when the summary is not materially smaller (min-gain guard)", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const summaryStore = new MemorySummaryStore();
    const bigField = "y".repeat(400);
    const bigSummary: ConversationSummary = {
      version: 1,
      visitor: bigField,
      pageDecisions: bigField,
      collectedData: bigField,
      pending: bigField,
      attempts: bigField,
      omitted: bigField,
    };
    const spy = spySummarizer(bigSummary);
    const events: ReferenceAgentTraceEvent[] = [];
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
      trace: (event) => {
        events.push(event);
      },
    });
    await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();

    expect(spy.calls).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_failed",
        site: "cross_turn",
        reason: "min_gain",
      }),
    );
    expect(await summaryStore.get("quickstart", "v1")).toBeUndefined();
  });

  it("never surfaces an unhandled rejection when the store write throws", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const events: ReferenceAgentTraceEvent[] = [];
    const throwingStore: SummaryStore = {
      get: () => Promise.resolve(undefined),
      put: () => Promise.reject(new Error("db down")),
      delete: () => Promise.resolve(),
    };
    const spy = spySummarizer();
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore: throwingStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
      trace: (event) => {
        events.push(event);
      },
    });
    await runAgent(agent, { kind: "message", text: "ok" });
    await expect(drainBackground()).resolves.toBeUndefined();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_failed",
        site: "cross_turn",
        reason: "store_error",
      }),
    );
  });

  it("deletes a mismatched durable record and rebuilds at generation 1 (DC-015)", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const summaryStore = new MemorySummaryStore();
    // A durable record from a previous life of this pair: its marker outruns
    // the (reset) sink, and its high coveredThrough would win the monotonic
    // guard against any gen-1 rebuild unless it is deleted first.
    await summaryStore.put("quickstart", "v1", {
      payload: SMALL_SUMMARY,
      coveredThrough: 50,
      generation: 7,
    });
    const spy = spySummarizer();
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
    });
    await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();

    const stored = await summaryStore.get("quickstart", "v1");
    expect(stored?.generation).toBe(1);
    expect(stored?.coveredThrough).toBeLessThanOrEqual(8);
    // The foreign summary was not folded forward as `previous`.
    expect(spy.calls[0]?.previous).toBeUndefined();
  });

  it("traces stale_write when the store rejects the put as regressive", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const events: ReferenceAgentTraceEvent[] = [];
    const staleStore: SummaryStore = {
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(false),
      delete: () => Promise.resolve(),
    };
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore: staleStore,
      summarizerFactory: () => spySummarizer().summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
      trace: (event) => {
        events.push(event);
      },
    });
    await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_failed",
        site: "cross_turn",
        reason: "stale_write",
      }),
    );
  });

  it("constructs no summarizer when no summaryStore is configured", async () => {
    const factory = vi.fn((): Summarizer => spySummarizer().summarizer);
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink: new MemorySink(),
      agentId: "quickstart",
      summarizerFactory: factory,
      onBackgroundTask,
    });
    await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();

    expect(factory).not.toHaveBeenCalled();
  });

  it("chunks a long backlog across background runs, capping each summarizer input (Finding 1)", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 16);
    const summaryStore = new MemorySummaryStore();
    const spy = spySummarizer();
    // A tiny per-call cap forces the catch-up to fold only a few turns per run.
    const CHUNK_BUDGET: ReferenceAgentOptions["budget"] = {
      maxContextTokens: 100,
      maxSummarizerInputChars: 1000,
    };

    const provider1 = providerOf(toolStep(call("say", { text: "one" })), END);
    const agent1 = createReferenceAgent({
      provider: provider1,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: CHUNK_BUDGET,
      onBackgroundTask,
    });
    await runAgent(agent1, { kind: "message", text: "one" });
    await drainBackground();

    const first = await summaryStore.get("quickstart", "v1");
    // fullEnd = 16 - minRecentTurnsVerbatim(4) = 12; the cap stops well short of it.
    expect(first?.coveredThrough).toBeGreaterThan(0);
    expect(first?.coveredThrough).toBeLessThan(12);
    expect(spy.calls[0]!.content.length).toBeLessThanOrEqual(1000);

    const provider2 = providerOf(toolStep(call("say", { text: "two" })), END);
    const agent2 = createReferenceAgent({
      provider: provider2,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: CHUNK_BUDGET,
      onBackgroundTask,
    });
    await runAgent(agent2, { kind: "message", text: "two" });
    await drainBackground();

    const second = await summaryStore.get("quickstart", "v1");
    // The second background run folds the remainder incrementally, advancing further.
    expect(second!.coveredThrough).toBeGreaterThan(first!.coveredThrough);
    expect(spy.calls[1]!.content.length).toBeLessThanOrEqual(1000);
    // Gen-2 folds gen-1 forward (the vetted anchor still matches the same sink).
    expect(spy.calls[1]?.previous).toEqual(SMALL_SUMMARY);
  });

  it("does not resurface a foreign-anchor summary behind a wiped sink; deletes and rebuilds (Finding 2)", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const summaryStore = new MemorySummaryStore();
    // A durable record from an OLD conversation: its coveredThrough (2) is <= the
    // new history length (8), so the index check ALONE would pass — only the
    // conversation anchor reveals it belongs to a different (wiped) sink.
    await summaryStore.put("quickstart", "v1", {
      payload: { ...SMALL_SUMMARY, anchor: "999:message" },
      coveredThrough: 2,
      generation: 5,
    });
    const spy = spySummarizer();
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
    });
    await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();

    // The foreign summary was NOT folded forward as `previous`.
    expect(spy.calls[0]?.previous).toBeUndefined();
    const stored = await summaryStore.get("quickstart", "v1");
    // Rebuilt fresh at generation 1 carrying the CURRENT conversation's anchor.
    expect(stored?.generation).toBe(1);
    expect((stored?.payload as { anchor?: unknown }).anchor).toBe("0:message");
  });

  it("traces sink_error when the background history read throws (Finding 3a)", async () => {
    const events: ReferenceAgentTraceEvent[] = [];
    const failingSink: Sink = {
      record: () => Promise.resolve(),
      history: () => Promise.reject(new Error("sink offline")),
    };
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink: failingSink,
      agentId: "quickstart",
      summaryStore: new MemorySummaryStore(),
      summarizerFactory: () => spySummarizer().summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
      trace: (event) => {
        events.push(event);
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runAgent(agent, { kind: "message", text: "ok" });
      await expect(drainBackground()).resolves.toBeUndefined();
    } finally {
      errorSpy.mockRestore();
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_failed",
        site: "cross_turn",
        reason: "sink_error",
      }),
    );
  });

  it("traces store_error when the background summary read throws (Finding 3b)", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const events: ReferenceAgentTraceEvent[] = [];
    const throwingStore: SummaryStore = {
      get: () => Promise.reject(new Error("db read down")),
      put: () => Promise.resolve(true),
      delete: () => Promise.resolve(),
    };
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore: throwingStore,
      summarizerFactory: () => spySummarizer().summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
      trace: (event) => {
        events.push(event);
      },
    });
    await runAgent(agent, { kind: "message", text: "ok" });
    await expect(drainBackground()).resolves.toBeUndefined();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_failed",
        site: "cross_turn",
        reason: "store_error",
      }),
    );
  });

  it("traces store_error when deleting a mismatched record throws, turn unaffected (Finding 3c)", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const events: ReferenceAgentTraceEvent[] = [];
    // A mismatched record (marker beyond the sink) forces the blocking-delete path.
    const mismatchedStore: SummaryStore = {
      get: () => Promise.resolve({ payload: SMALL_SUMMARY, coveredThrough: 50, generation: 7 }),
      put: () => Promise.resolve(true),
      delete: () => Promise.reject(new Error("db delete down")),
    };
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore: mismatchedStore,
      summarizerFactory: () => spySummarizer().summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
      trace: (event) => {
        events.push(event);
      },
    });
    const out = await runAgent(agent, { kind: "message", text: "ok" });
    await expect(drainBackground()).resolves.toBeUndefined();

    expect(saysOf(out)).toEqual(["ok"]); // the turn itself is unaffected
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_failed",
        site: "cross_turn",
        reason: "store_error",
      }),
    );
  });

  it("does not re-summarize when a caught-up summary already covers the recent window (R3-1)", async () => {
    // A stored summary that already folds everything except the verbatim tail: the
    // NEXT turn injects the block + a tiny tail, so the projected context — not the
    // full raw history — is what hysteresis must measure. Nothing new to fold in ⇒
    // the background run must fire zero summarizer calls and no trigger trace.
    const sink = new MemorySink();
    await recordLongHistory(sink, 12);
    const history = await sink.history("quickstart", "v1");
    const summaryStore = new MemorySummaryStore();
    await summaryStore.put("quickstart", "v1", {
      payload: { ...SMALL_SUMMARY, anchor: "0:message" }, // matches recordLongHistory's first entry
      coveredThrough: history.length - 4, // minRecentTurnsVerbatim = 4 ⇒ fully caught up
      generation: 3,
    });
    const spy = spySummarizer();
    const events: ReferenceAgentTraceEvent[] = [];
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
      trace: (event) => {
        events.push(event);
      },
    });

    await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();

    expect(spy.calls).toHaveLength(0);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "compaction_triggered", site: "cross_turn" }),
    );
    // The caught-up record is untouched (still generation 3).
    expect((await summaryStore.get("quickstart", "v1"))?.generation).toBe(3);
  });

  it("does not loop the summarizer after a min-gain skip until the cooldown elapses (R3-2)", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 8);
    const summaryStore = new MemorySummaryStore();
    // A summary too big to be a material gain over the turns it replaces ⇒ min-gain skip.
    const bigField = "y".repeat(400);
    const bigSummary: ConversationSummary = {
      version: 1,
      visitor: bigField,
      pageDecisions: bigField,
      collectedData: bigField,
      pending: bigField,
      attempts: bigField,
      omitted: bigField,
    };
    const spy = spySummarizer(bigSummary);

    // Turn 1: the summarizer runs and the write is skipped (min_gain), arming the cooldown.
    const runTurn = async (): Promise<void> => {
      const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
      const agent = createReferenceAgent({
        provider,
        sink,
        agentId: "quickstart",
        summaryStore,
        summarizerFactory: () => spy.summarizer,
        budget: TRIGGERING_BUDGET,
        onBackgroundTask,
      });
      await runAgent(agent, { kind: "message", text: "ok" });
      await drainBackground();
    };

    await runTurn();
    expect(spy.calls).toHaveLength(1);
    expect(await summaryStore.get("quickstart", "v1")).toBeUndefined();

    // Turn 2, no new history (still 8 turns): within compactionCooldownSteps ⇒ ZERO new calls.
    await runTurn();
    expect(spy.calls).toHaveLength(1);

    // After compactionCooldownSteps (4) more turns accumulate, the attempt resumes.
    await recordLongHistory(sink, 4, 8); // 8 → 12 turns
    await runTurn();
    expect(spy.calls).toHaveLength(2);
  });

  it("renders the backlog lazily and never past the summarizer-input cap (R3-3)", async () => {
    const sink = new MemorySink();
    // Distinct per-entry markers so we can pin exactly which entries were rendered.
    const filler = "x".repeat(200);
    for (let i = 0; i < 8; i += 1) {
      await sink.record("quickstart", "v1", {
        at: i,
        event: { kind: "message", text: `TURN_${String(i)} ${filler}` },
        messages: [{ kind: "say", text: `REPLY_${String(i)} ${filler}` }],
      });
    }
    const summaryStore = new MemorySummaryStore();
    const spy = spySummarizer();
    // Each rendered entry is ~450 chars, so a 1000-char cap admits exactly two.
    const CAP_BUDGET: ReferenceAgentOptions["budget"] = {
      maxContextTokens: 100,
      maxSummarizerInputChars: 1000,
    };
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: CAP_BUDGET,
      onBackgroundTask,
    });

    await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();

    const content = spy.calls[0]!.content;
    expect(content.length).toBeLessThanOrEqual(1000);
    // The first two entries are rendered; the third (which would blow the cap) is NOT.
    expect(content).toContain("TURN_0");
    expect(content).toContain("TURN_1");
    expect(content).not.toContain("TURN_2");
    expect((await summaryStore.get("quickstart", "v1"))?.coveredThrough).toBe(2);
  });

  it("bounds a single oversized history entry to the summarizer-input cap (R4)", async () => {
    const sink = new MemorySink();
    // FIRST entry alone dwarfs the cap — it must be truncated, not sent whole,
    // or the background call would fail identically on every future turn.
    await sink.record("quickstart", "v1", {
      at: 0,
      event: { kind: "message", text: `HUGE_${"z".repeat(20_000)}` },
      messages: [{ kind: "say", text: "ok" }],
    });
    for (let i = 1; i < 6; i += 1) {
      await sink.record("quickstart", "v1", {
        at: i,
        event: { kind: "message", text: `TURN_${String(i)}` },
        messages: [{ kind: "say", text: `REPLY_${String(i)}` }],
      });
    }
    const summaryStore = new MemorySummaryStore();
    const spy = spySummarizer();
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: { maxContextTokens: 100, maxSummarizerInputChars: 1000 },
      onBackgroundTask,
    });

    await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();

    const content = spy.calls[0]!.content;
    expect(content.length).toBeLessThanOrEqual(1000);
    expect(content).toContain("HUGE_");
    expect(content).toContain("[truncated:");
    // Progress is still guaranteed: the oversized entry is covered.
    expect((await summaryStore.get("quickstart", "v1"))?.coveredThrough).toBeGreaterThanOrEqual(1);
  });

  it("projects the next turn with the budget's stage bounds, not the 48K default (R5)", async () => {
    // A ~3000-char stage JSON with maxStageJsonChars: 100 renders as a SUMMARY in
    // the real assembly. The projection must measure the same rendering: at
    // maxContextTokens 8600 (trigger 6450) the summary-mode projection stays
    // under, while the full-JSON projection (+~750 tokens of stage JSON) fires.
    // (Retuned from 7600 when the data-binding teaching grew the system prompt.)
    const bigStage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box" as const, children: ["t"] },
        t: { id: "t", type: "text" as const, value: "s".repeat(3000) },
      },
    };
    const bigSession: FacetSession = {
      agentId: "quickstart",
      visitor: { visitorId: "v1" },
      stage: bigStage,
    };
    const seed = async (): Promise<MemorySink> => {
      const sink = new MemorySink();
      await recordLongHistory(sink, 5);
      return sink;
    };
    const runWith = async (maxStageJsonChars: number): Promise<number> => {
      const spy = spySummarizer();
      const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
      const agent = createReferenceAgent({
        provider,
        sink: await seed(),
        agentId: "quickstart",
        summaryStore: new MemorySummaryStore(),
        summarizerFactory: () => spy.summarizer,
        budget: { maxContextTokens: 8600, maxStageJsonChars },
        onBackgroundTask,
      });
      await runAgent(agent, { kind: "message", text: "ok" }, bigSession);
      await drainBackground();
      return spy.calls.length;
    };

    // Real assembly renders the stage as a summary -> projection must not trigger.
    expect(await runWith(100)).toBe(0);
    // Full-JSON bounds -> projection counts the real 3K stage block and triggers.
    expect(await runWith(48_000)).toBeGreaterThan(0);
  });

  it("clears the min-gain cooldown when the sink shrinks (wiped conversation) (R5)", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 12);
    const summaryStore = new MemorySummaryStore();
    // Summarizer returns a HUGE summary so the min-gain check always skips.
    const bigSummary: ConversationSummary = {
      version: 1,
      visitor: "v".repeat(1900),
      pageDecisions: "d".repeat(1900),
      collectedData: "c".repeat(1900),
      pending: "p".repeat(1900),
      attempts: "a".repeat(1900),
      omitted: "o".repeat(1900),
    };
    const skipSpy = spySummarizer(bigSummary);
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => skipSpy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
    });
    await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();
    expect(skipSpy.calls.length).toBe(1); // attempted, then min-gain skipped
    expect(await summaryStore.get("quickstart", "v1")).toBeUndefined();

    // The sink is wiped and a NEW shorter conversation begins: the stale marker
    // (recorded at length 12) must not freeze compaction for the new one.
    const freshSink = new MemorySink();
    await recordLongHistory(freshSink, 8);
    const spy = spySummarizer();
    const freshProvider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const freshAgent = createReferenceAgent({
      provider: freshProvider,
      sink: freshSink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
    });
    await runAgent(freshAgent, { kind: "message", text: "ok" });
    await drainBackground();

    expect(spy.calls.length).toBe(1);
    expect((await summaryStore.get("quickstart", "v1"))?.generation).toBe(1);
  });

  it("cleans up a stale stored record even inside the min-gain cooldown window (R6 ordering)", async () => {
    const sink = new MemorySink();
    await recordLongHistory(sink, 12);
    // Summarizer output too large to clear the min-gain threshold: turn 1 arms
    // the cooldown marker without writing anything.
    const bigSummary: ConversationSummary = {
      version: 1,
      visitor: "v".repeat(1900),
      pageDecisions: "d".repeat(1900),
      collectedData: "c".repeat(1900),
      pending: "p".repeat(1900),
      attempts: "a".repeat(1900),
      omitted: "o".repeat(1900),
    };
    let reads = 0;
    const deleteSpy = vi.fn(() => Promise.resolve());
    // Each turn reads the store twice (context assembly + background run):
    // turn 1 (reads 1-2) sees no record; turn 2 sees a stale one (marker
    // beyond the sink).
    const staleAfterFirst: SummaryStore = {
      get: () => {
        reads += 1;
        return Promise.resolve(
          reads <= 2 ? undefined : { payload: SMALL_SUMMARY, coveredThrough: 999, generation: 7 },
        );
      },
      put: () => Promise.resolve(true),
      delete: deleteSpy,
    };
    const skipSpy = spySummarizer(bigSummary);
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink,
      agentId: "quickstart",
      summaryStore: staleAfterFirst,
      summarizerFactory: () => skipSpy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
    });

    await runAgent(agent, { kind: "message", text: "one" });
    await drainBackground();
    expect(skipSpy.calls.length).toBe(1); // min-gain skip armed the cooldown
    expect(deleteSpy).not.toHaveBeenCalled();

    await runAgent(agent, { kind: "message", text: "two" });
    await drainBackground();
    // Inside the cooldown the summarizer must NOT run again…
    expect(skipSpy.calls.length).toBe(1);
    // …but the blocking stale record must STILL be repaired: the vet/delete
    // block runs BEFORE the cooldown early-return (reverting that order makes
    // this assertion fail).
    expect(deleteSpy).toHaveBeenCalledWith("quickstart", "v1");
  });

  it("makes zero summarizer calls and no store writes on an empty-history sink (R3-4)", async () => {
    // A ForwardSink-style sink that stores nothing: history() is always empty, so
    // there is no anchor to key a summary on and nothing to compact.
    const forwardSink: Sink = {
      record: () => Promise.resolve(),
      history: () => Promise.resolve([]),
    };
    const summaryStore = new MemorySummaryStore();
    const putSpy = vi.spyOn(summaryStore, "put");
    const spy = spySummarizer();
    const provider = providerOf(toolStep(call("say", { text: "ok" })), END);
    const agent = createReferenceAgent({
      provider,
      sink: forwardSink,
      agentId: "quickstart",
      summaryStore,
      summarizerFactory: () => spy.summarizer,
      budget: TRIGGERING_BUDGET,
      onBackgroundTask,
    });

    await runAgent(agent, { kind: "message", text: "ok" });
    await drainBackground();

    expect(spy.calls).toHaveLength(0);
    expect(putSpy).not.toHaveBeenCalled();
    expect(await summaryStore.get("quickstart", "v1")).toBeUndefined();
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
