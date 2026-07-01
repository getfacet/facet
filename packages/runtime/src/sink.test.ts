import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileSink,
  ForwardSink,
  MemorySink,
  NullSink,
  type Sink,
  type StoredEvent,
} from "./sink.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "facet-sink-"));
}

const entry = (at: number, text: string): StoredEvent => ({
  at,
  event: { kind: "message", text },
  messages: [{ kind: "say", text: `re:${text}` }],
});

function replayable(name: string, make: () => Sink): void {
  describe(name, () => {
    it("records and replays history in order", () => {
      const sink = make();
      sink.record("a", "v", entry(1, "hi"));
      sink.record("a", "v", entry(2, "bye"));
      const history = sink.history("a", "v");
      expect(history.map((e) => e.at)).toEqual([1, 2]);
      expect(history[0]?.event).toMatchObject({ text: "hi" });
    });

    it("isolates by (agent, visitor)", () => {
      const sink = make();
      sink.record("a", "v1", entry(1, "x"));
      expect(sink.history("a", "v1")).toHaveLength(1);
      expect(sink.history("a", "v2")).toHaveLength(0);
    });
  });
}

replayable("MemorySink", () => new MemorySink());
replayable("FileSink", () => new FileSink(tempDir()));

describe("FileSink durability", () => {
  it("replays after a fresh instance (simulated restart)", () => {
    const dir = tempDir();
    new FileSink(dir).record("agent", "v", entry(1, "remember"));
    expect(new FileSink(dir).history("agent", "v")[0]?.event).toMatchObject({ text: "remember" });
  });
});

describe("NullSink", () => {
  it("keeps nothing", () => {
    const sink = new NullSink();
    sink.record("a", "v", entry(1, "x"));
    expect(sink.history("a", "v")).toHaveLength(0);
  });
});

describe("ForwardSink", () => {
  it("hands each interaction to the forwarder and retains nothing", () => {
    const seen: StoredEvent[] = [];
    const sink = new ForwardSink((_agentId, _visitorId, e) => {
      seen.push(e);
    });
    sink.record("a", "v", entry(1, "fwd"));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.event).toMatchObject({ text: "fwd" });
    expect(sink.history("a", "v")).toHaveLength(0);
  });
});
