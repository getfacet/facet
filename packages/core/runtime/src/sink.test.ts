import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ForwardSink, MemorySink, NullSink, type Sink, type StoredEvent } from "./sink.js";
import { FileSink } from "./file-sink.js";
import { sessionFilePath } from "./session-file.js";

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
    it("records and replays history in order", async () => {
      const sink = make();
      await sink.record("a", "v", entry(1, "hi"));
      await sink.record("a", "v", entry(2, "bye"));
      const history = await sink.history("a", "v");
      expect(history.map((e) => e.at)).toEqual([1, 2]);
      expect(history[0]?.event).toMatchObject({ text: "hi" });
    });

    it("isolates by (agent, visitor)", async () => {
      const sink = make();
      await sink.record("a", "v1", entry(1, "x"));
      expect(await sink.history("a", "v1")).toHaveLength(1);
      expect(await sink.history("a", "v2")).toHaveLength(0);
    });
  });
}

replayable("MemorySink", () => new MemorySink());
replayable("FileSink", () => new FileSink(tempDir()));

describe("FileSink durability", () => {
  it("replays after a fresh instance (simulated restart)", async () => {
    const dir = tempDir();
    await new FileSink(dir).record("agent", "v", entry(1, "remember"));
    expect((await new FileSink(dir).history("agent", "v"))[0]?.event).toMatchObject({
      text: "remember",
    });
  });
});

describe("FileSink resilient replay", () => {
  it("skips a corrupt line but keeps the good lines around it", async () => {
    const dir = tempDir();
    writeFileSync(
      sessionFilePath(dir, "a", "v", "jsonl"),
      `${JSON.stringify(entry(1, "one"))}\n{ not json\n${JSON.stringify(entry(2, "two"))}\n`,
    );
    const history = await new FileSink(dir).history("a", "v");
    expect(history.map((e) => e.at)).toEqual([1, 2]);
  });

  it("skips a wrong-shape line but keeps the good lines around it", async () => {
    const dir = tempDir();
    writeFileSync(
      sessionFilePath(dir, "a", "v", "jsonl"),
      `${JSON.stringify(entry(1, "one"))}\n${JSON.stringify({ foo: "bar" })}\n${JSON.stringify(entry(2, "two"))}\n`,
    );
    const history = await new FileSink(dir).history("a", "v");
    expect(history.map((e) => e.at)).toEqual([1, 2]);
  });

  it("skips a line whose messages array holds a null element", async () => {
    const dir = tempDir();
    // Array.isArray passes but replay's `message.kind` would throw on the null.
    const badLine = JSON.stringify({ at: 9, event: {}, messages: [null] });
    writeFileSync(
      sessionFilePath(dir, "a", "v", "jsonl"),
      `${JSON.stringify(entry(1, "one"))}\n${badLine}\n${JSON.stringify(entry(2, "two"))}\n`,
    );
    const history = await new FileSink(dir).history("a", "v");
    expect(history.map((e) => e.at)).toEqual([1, 2]);
  });
});

describe("NullSink", () => {
  it("keeps nothing", async () => {
    const sink = new NullSink();
    await sink.record("a", "v", entry(1, "x"));
    expect(await sink.history("a", "v")).toHaveLength(0);
  });
});

describe("ForwardSink", () => {
  it("hands each interaction to the forwarder and retains nothing", async () => {
    const seen: StoredEvent[] = [];
    const sink = new ForwardSink((_agentId, _visitorId, e) => {
      seen.push(e);
    });
    await sink.record("a", "v", entry(1, "fwd"));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.event).toMatchObject({ text: "fwd" });
    expect(await sink.history("a", "v")).toHaveLength(0);
  });
});
