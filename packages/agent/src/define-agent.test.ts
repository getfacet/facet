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
    await expect(collectMessages(agent(event, session))).resolves.toEqual([
      say("one"),
      say("two"),
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
});
