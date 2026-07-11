import {
  collectMessages,
  EMPTY_TREE,
  iterateAgentResult,
  type FacetComposition,
  type FacetSession,
  type ServerMessage,
} from "@facet/core";
import { describe, expect, it } from "vitest";
import { defineAgent, defineStreamingAgent } from "./define-agent.js";

// Built at runtime so the legacy token never appears as a source literal
// (same idiom as theme.test.ts).
const legacy = ["st", "amp"].join("");

const event = { kind: "message", text: "hi" } as const;
const session = {
  agentId: "agent",
  visitor: { visitorId: "visitor" },
  stage: EMPTY_TREE,
};
const sessionWithPanel: FacetSession = {
  agentId: "agent",
  visitor: { visitorId: "visitor" },
  stage: {
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["panel"] },
      panel: { id: "panel", type: "box", children: [] },
    },
  },
};
const labelComposition: FacetComposition = {
  name: "label",
  root: "label",
  nodes: { label: { id: "label", type: "text", value: "Inside" } },
};

function hostileComposition(): FacetComposition {
  const failure = new Error("boom");
  Object.defineProperty(failure, "message", {
    get(): string {
      throw new Error("SENTINEL_LEAK");
    },
  });
  return {
    name: "hostile",
    root: "r",
    get nodes(): FacetComposition["nodes"] {
      throw failure;
    },
  };
}

const say = (text: string): ServerMessage => ({ kind: "say", text });

async function collectBatches(
  result: ReturnType<ReturnType<typeof defineStreamingAgent>>,
): Promise<readonly (readonly ServerMessage[])[]> {
  const batches: ServerMessage[][] = [];
  for await (const batch of iterateAgentResult(result)) {
    batches.push([...batch]);
  }
  return batches;
}

describe("defineAgent", () => {
  it("keeps the back-compat single final batch behavior", async () => {
    const agent = defineAgent(({ stage }) => {
      stage.say("one");
      stage.say("two");
    });

    await expect(collectBatches(agent(event, session))).resolves.toEqual([
      [say("one"), say("two")],
    ]);
    await expect(collectMessages(agent(event, session))).resolves.toEqual([say("one"), say("two")]);
  });

  it(`exposes Stage.useComposition and no ${legacy} method to agent logic`, async () => {
    const agent = defineAgent(({ stage }) => {
      expect(typeof stage.useComposition).toBe("function");
      expect(`use${["St", "amp"].join("")}` in stage).toBe(false);
    });

    await collectMessages(agent(event, session));
  });

  it("seeds Stage.useComposition with ids from the current session", async () => {
    const agent = defineAgent(({ stage }) => {
      stage.useComposition(labelComposition, {}, { parent: "panel" });
    });

    const messages = await collectMessages(agent(event, sessionWithPanel));

    const patch = messages.find((message) => message.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind !== "patch") throw new Error("expected patch");
    expect(patch.patches.some((op) => op.path === "/nodes/panel/children/-")).toBe(true);
  });

  it("emits zero messages for a hostile useComposition expansion and stays usable", async () => {
    const hostile = hostileComposition();
    const silent = defineAgent(({ stage }) => {
      stage.useComposition(hostile, {}, { parent: "panel" });
    });
    await expect(collectMessages(silent(event, sessionWithPanel))).resolves.toEqual([]);

    const recovering = defineAgent(({ stage }) => {
      stage.useComposition(hostile, {}, { parent: "panel" });
      stage.useComposition(labelComposition, {}, { parent: "panel" });
    });
    const messages = await collectMessages(recovering(event, sessionWithPanel));

    expect(messages).toHaveLength(1);
    const patch = messages[0];
    if (patch?.kind !== "patch") throw new Error("expected patch");
    expect(patch.patches).toHaveLength(2);
    expect(patch.patches.some((op) => op.path === "/nodes/panel/children/-")).toBe(true);
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("SENTINEL_LEAK");
    expect(serialized).not.toContain("boom");
  });
});

describe("defineStreamingAgent", () => {
  it("streaming producer emits one non-empty batch per step boundary plus the turn-end tail", async () => {
    const agent = defineStreamingAgent(async function* ({ stage }) {
      stage.say("one");
      yield;
      yield;
      stage.say("two");
      yield;
      stage.say("tail");
    });

    await expect(collectBatches(agent(event, session))).resolves.toEqual([
      [say("one")],
      [say("two")],
      [say("tail")],
    ]);
  });

  it("seeds streaming Stage.useComposition with ids from the current session", async () => {
    const agent = defineStreamingAgent(async function* ({ stage }) {
      stage.useComposition(labelComposition, {}, { parent: "panel" });
      yield;
    });

    const batches = await collectBatches(agent(event, sessionWithPanel));

    const patch = batches[0]?.find((message) => message.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind !== "patch") throw new Error("expected patch");
    expect(patch.patches.some((op) => op.path === "/nodes/panel/children/-")).toBe(true);
  });

  it("streaming useComposition hostile expansion yields no batch and the next valid composition lands", async () => {
    const hostile = hostileComposition();
    const agent = defineStreamingAgent(async function* ({ stage }) {
      stage.useComposition(hostile, {}, { parent: "panel" });
      yield;
      stage.useComposition(labelComposition, {}, { parent: "panel" });
    });

    const batches = await collectBatches(agent(event, sessionWithPanel));

    expect(batches).toHaveLength(1);
    const patch = batches[0]?.[0];
    if (patch?.kind !== "patch") throw new Error("expected patch");
    expect(patch.patches).toHaveLength(2);
    expect(patch.patches.some((op) => op.path === "/nodes/panel/children/-")).toBe(true);
    const serialized = JSON.stringify(batches);
    expect(serialized).not.toContain("SENTINEL_LEAK");
    expect(serialized).not.toContain("boom");
  });

  it("types yielded values as flush boundaries, not message payloads", () => {
    // @ts-expect-error yielded values are ignored; use stage commands, then `yield`.
    defineStreamingAgent(async function* () {
      yield [say("ignored")];
    });
  });
});
