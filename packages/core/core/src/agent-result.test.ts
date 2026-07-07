import { describe, expect, it } from "vitest";
import { collectMessages, iterateAgentResult } from "./agent-result.js";
import type { FacetAgentResult } from "./agent-result.js";
import type { ClientEvent, FacetAgent, FacetSession, ServerMessage } from "./protocol.js";

const say = (text: string): ServerMessage => ({ kind: "say", text });

async function collectBatches(
  result: FacetAgentResult,
): Promise<readonly (readonly ServerMessage[])[]> {
  const batches: ServerMessage[][] = [];
  for await (const batch of iterateAgentResult(result)) {
    batches.push([...batch]);
  }
  return batches;
}

async function* streamingResult(): AsyncIterable<readonly ServerMessage[]> {
  yield [say("one")];
  yield [say("two"), say("three")];
}

describe("agent result normalization", () => {
  it("iterates an immediate message array as one batch", async () => {
    await expect(collectBatches([say("one"), say("two")])).resolves.toEqual([
      [say("one"), say("two")],
    ]);
  });

  it("iterates a promised message array as one batch", async () => {
    await expect(collectBatches(Promise.resolve([say("async")]))).resolves.toEqual([
      [say("async")],
    ]);
  });

  it("iterates an async iterable result batch-by-batch in yield order", async () => {
    await expect(collectBatches(streamingResult())).resolves.toEqual([
      [say("one")],
      [say("two"), say("three")],
    ]);
  });

  it("collects any agent result form into one flat ordered message array", async () => {
    await expect(collectMessages(streamingResult())).resolves.toEqual([
      say("one"),
      say("two"),
      say("three"),
    ]);
  });

  it("collects a large streaming batch without spreading it onto the call stack", async () => {
    const hugeBatchSize = 200_000;
    const hugeBatch = Array.from({ length: hugeBatchSize }, (_item, index) =>
      say(`item-${String(index)}`),
    );
    async function* hugeResult(): AsyncIterable<readonly ServerMessage[]> {
      yield hugeBatch;
    }

    const messages = await collectMessages(hugeResult());

    expect(messages).toHaveLength(hugeBatchSize);
    expect(messages[0]).toEqual(say("item-0"));
    expect(messages[hugeBatchSize - 1]).toEqual(say(`item-${String(hugeBatchSize - 1)}`));
  });

  it("allows FacetAgent producers to return an async iterable", () => {
    const agent: FacetAgent = (_event: ClientEvent, _session: FacetSession) => streamingResult();

    expect(typeof agent).toBe("function");
  });
});
