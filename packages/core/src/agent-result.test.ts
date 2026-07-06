import { describe, expect, it } from "vitest";
import { collectMessages, iterateAgentResult } from "./agent-result.js";
import type { FacetAgentResult } from "./agent-result.js";
import type {
  ClientEvent,
  FacetAgent,
  FacetSession,
  ServerMessage,
} from "./protocol.js";

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

  it("allows FacetAgent producers to return an async iterable", () => {
    const agent: FacetAgent = (_event: ClientEvent, _session: FacetSession) =>
      streamingResult();

    expect(typeof agent).toBe("function");
  });
});
