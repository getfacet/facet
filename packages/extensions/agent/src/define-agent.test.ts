import { collectMessages, EMPTY_TREE, iterateAgentResult, type ServerMessage } from "@facet/core";
import { describe, expect, it } from "vitest";
import { defineAgent, defineStreamingAgent } from "./define-agent.js";

const event = { kind: "message", text: "hi" } as const;
const session = {
  agentId: "agent",
  visitor: { visitorId: "visitor" },
  stage: EMPTY_TREE,
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

  it("exposes native Stage authoring to agent logic", async () => {
    const removedMethod = ["use", "Composition"].join("");
    const removedThemeMethod = ["th", "eme"].join("");
    const agent = defineAgent(({ stage }) => {
      expect(removedMethod in stage).toBe(false);
      expect(removedThemeMethod in stage).toBe(false);
      stage
        .set({ id: "panel", type: "box", children: [] })
        .append("panel", { id: "label", type: "text", value: "Inside" });
    });

    const messages = await collectMessages(agent(event, session));

    expect(messages).toHaveLength(1);
    const patch = messages[0];
    if (patch?.kind !== "patch") throw new Error("expected patch");
    expect(patch.patches).toEqual([
      { op: "add", path: "/nodes/panel", value: { id: "panel", type: "box", children: [] } },
      {
        op: "add",
        path: "/nodes/label",
        value: { id: "label", type: "text", value: "Inside" },
      },
      { op: "add", path: "/nodes/panel/children/-", value: "label" },
    ]);
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

  it("streams native Stage edits at yield boundaries", async () => {
    const agent = defineStreamingAgent(async function* ({ stage }) {
      stage.set({ id: "label", type: "text", value: "Inside" });
      yield;
      stage.set({ id: "second", type: "text", value: "Second" });
    });

    const batches = await collectBatches(agent(event, session));

    expect(batches).toEqual([
      [
        {
          kind: "patch",
          patches: [
            {
              op: "add",
              path: "/nodes/label",
              value: { id: "label", type: "text", value: "Inside" },
            },
          ],
        },
      ],
      [
        {
          kind: "patch",
          patches: [
            {
              op: "add",
              path: "/nodes/second",
              value: { id: "second", type: "text", value: "Second" },
            },
          ],
        },
      ],
    ]);
  });

  it("types yielded values as flush boundaries, not message payloads", () => {
    // @ts-expect-error yielded values are ignored; use stage commands, then `yield`.
    defineStreamingAgent(async function* () {
      yield [say("ignored")];
    });
  });
});
