import {
  collectMessages,
  EMPTY_TREE,
  iterateAgentResult,
  type FacetSession,
  type FacetStamp,
  type ServerMessage,
} from "@facet/core";
import { describe, expect, it } from "vitest";
import { defineAgent, defineStreamingAgent } from "./define-agent.js";

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
const labelStamp: FacetStamp = {
  name: "label",
  root: "label",
  nodes: { label: { id: "label", type: "text", value: "Inside" } },
};

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

  it("seeds Stage.useStamp with ids from the current session", async () => {
    const agent = defineAgent(({ stage }) => {
      stage.useStamp(labelStamp, {}, { parent: "panel" });
    });

    const messages = await collectMessages(agent(event, sessionWithPanel));

    const patch = messages.find((message) => message.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind !== "patch") throw new Error("expected patch");
    expect(patch.patches.some((op) => op.path === "/nodes/panel/children/-")).toBe(true);
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

  it("seeds streaming Stage.useStamp with ids from the current session", async () => {
    const agent = defineStreamingAgent(async function* ({ stage }) {
      stage.useStamp(labelStamp, {}, { parent: "panel" });
      yield;
    });

    const batches = await collectBatches(agent(event, sessionWithPanel));

    const patch = batches[0]?.find((message) => message.kind === "patch");
    expect(patch?.kind).toBe("patch");
    if (patch?.kind !== "patch") throw new Error("expected patch");
    expect(patch.patches.some((op) => op.path === "/nodes/panel/children/-")).toBe(true);
  });

  it("types yielded values as flush boundaries, not message payloads", () => {
    // @ts-expect-error yielded values are ignored; use stage commands, then `yield`.
    defineStreamingAgent(async function* () {
      yield [say("ignored")];
    });
  });
});
