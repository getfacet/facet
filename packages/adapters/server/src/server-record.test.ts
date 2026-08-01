import { afterEach, describe, expect, it } from "vitest";
import type { ConversationRecord, Sink } from "@facet/runtime";
import { visitorEvent, postEvent, postMessage, start } from "./server.test-support.js";

class RecordingSink implements Sink {
  readonly records: ConversationRecord[] = [];

  async record(_key: string, record: ConversationRecord): Promise<{ readonly ok: true }> {
    this.records.push(record);
    return { ok: true };
  }

  async history(): Promise<readonly ConversationRecord[]> {
    return this.records;
  }
}

let active: { readonly close: () => Promise<void> } | undefined;

afterEach(async () => {
  await active?.close();
  active = undefined;
});

describe("server conversation records", () => {
  it("records normalized visitor and assistant conversation only", async () => {
    const sink = new RecordingSink();
    const { server, base } = await start({
      sink,
      agent: {
        run: async ({ session }) => {
          await session.applyAuthorMutation(
            `<Facet entry="home"><Screen name="home"><Text value="Changed" /></Screen></Facet>`,
          );
          return { text: "answer" };
        },
      },
    });
    active = server;

    const response = await postMessage(base, "s1", "msg1", "question");

    expect(response.status).toBe(202);
    expect(sink.records.map((record) => record.kind)).toEqual(["conversation", "conversation"]);
    expect(sink.records.map((record) => record.role)).toEqual(["visitor", "assistant"]);
    for (const record of sink.records) {
      expect(Object.keys(record).sort()).toEqual([
        "at",
        "kind",
        "messageId",
        "role",
        "text",
        "turnId",
      ]);
      expect(JSON.stringify(record)).not.toContain("ops");
      expect(JSON.stringify(record)).not.toContain("patches");
    }
  });

  it("does not record a busy visitor message while another turn is active", async () => {
    const sink = new RecordingSink();
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { server, base } = await start({
      sink,
      agent: {
        run: async () => {
          started();
          await hold;
          return { text: "done" };
        },
      },
    });
    active = server;

    const first = postEvent(base, "s1", visitorEvent({ eventId: "event1" }));
    await startedPromise;
    const second = await postMessage(base, "s1", "msg2", "busy question");
    release();

    expect(second.status).toBe(409);
    expect((await first).status).toBe(202);
    expect(sink.records.map((record) => record.messageId)).not.toContain("msg2:visitor");
  });

  it("does not record a busy visitor event while a visitor message turn is active", async () => {
    const sink = new RecordingSink();
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { server, base } = await start({
      sink,
      agent: {
        run: async () => {
          started();
          await hold;
          return { text: "done" };
        },
      },
    });
    active = server;

    const first = postMessage(base, "s1", "msg1", "accepted question");
    await startedPromise;
    const second = await postEvent(base, "s1", visitorEvent({ eventId: "event2" }));
    release();

    expect(second.status).toBe(409);
    expect((await first).status).toBe(202);
    expect(sink.records.map((record) => record.messageId)).toEqual([
      "msg1:visitor",
      "msg1:assistant",
    ]);
  });

  it("dedupes a same-messageId retry before another Sink record", async () => {
    const sink = new RecordingSink();
    let calls = 0;
    const { server, base } = await start({
      sink,
      agent: {
        run: async () => {
          calls += 1;
          return { text: "answer" };
        },
      },
    });
    active = server;

    const first = await postMessage(base, "s1", "msg1", "question");
    const second = await postMessage(base, "s1", "msg1", "retry question");

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(calls).toBe(1);
    expect(sink.records.map((record) => record.messageId)).toEqual([
      "msg1:visitor",
      "msg1:assistant",
    ]);
  });
});
