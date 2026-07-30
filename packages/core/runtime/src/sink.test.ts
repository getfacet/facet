import { describe, expect, it } from "vitest";

import { deriveMessageId } from "@facet/core";
import type { ConversationMessage } from "@facet/core";

import { MemorySink } from "./sink.js";
import type { ConversationRecord, Sink } from "./sink.js";

function message(
  turnId: string,
  role: ConversationMessage["role"],
  text: string,
): ConversationRecord {
  return {
    kind: "conversation",
    messageId: deriveMessageId(turnId, role),
    turnId,
    role,
    text,
    at: 10,
  };
}

async function expectUpsertByMessageId(sink: Sink): Promise<void> {
  const first = message("turn-1", "assistant", "First");
  const replacement = { ...first, text: "Replacement", at: 20 };

  await expect(sink.record("session-a", first)).resolves.toEqual({ ok: true });
  await expect(sink.record("session-a", replacement)).resolves.toEqual({ ok: true });

  await expect(sink.history("session-a", 10)).resolves.toEqual([replacement]);
}

describe("MemorySink", () => {
  it("upserts duplicate conversation records by messageId", async () => {
    await expectUpsertByMessageId(new MemorySink());
  });

  it("keeps histories session-scoped and returns the last bounded records", async () => {
    const sink = new MemorySink();
    const first = message("turn-1", "visitor", "One");
    const second = message("turn-2", "assistant", "Two");

    await sink.record("session-a", first);
    await sink.record("session-a", second);
    await sink.record("session-b", message("turn-3", "assistant", "Other"));

    await expect(sink.history("session-a", 1)).resolves.toEqual([second]);
    await expect(sink.history("session-b", 10)).resolves.toHaveLength(1);
  });

  it("records conversation data only, not UI patch payloads", async () => {
    const sink = new MemorySink();
    const record = message("turn-1", "assistant", '<Facet entry="home" />');

    await sink.record("session-a", record);

    expect(Object.keys((await sink.history("session-a", 1))[0] ?? {}).sort()).toEqual([
      "at",
      "kind",
      "messageId",
      "role",
      "text",
      "turnId",
    ]);
  });

  it("surfaces a write failure diagnostically without throwing into the caller", async () => {
    const sink = new MemorySink();
    const hostile = Object.defineProperty(message("turn-1", "assistant", "Boom"), "messageId", {
      get() {
        throw new Error("blocked");
      },
    }) as unknown as ConversationRecord;

    await expect(sink.record("session-a", hostile)).resolves.toMatchObject({
      ok: false,
      code: "sink_write_failed",
    });
    await expect(sink.history("session-a", 10)).resolves.toEqual([]);
  });
});

describe("Sink conformance", () => {
  it("lets a test-supplied custom sink prove upsert-by-messageId", async () => {
    class TestSink implements Sink {
      readonly #records = new Map<string, Map<string, ConversationRecord>>();

      async record(
        key: string,
        record: ConversationRecord,
      ): Promise<
        | { readonly ok: true }
        | { readonly ok: false; readonly code: string; readonly detail: string }
      > {
        const records = this.#records.get(key) ?? new Map<string, ConversationRecord>();
        records.set(record.messageId, record);
        this.#records.set(key, records);
        return { ok: true };
      }

      async history(key: string, limit: number): Promise<readonly ConversationRecord[]> {
        return [...(this.#records.get(key)?.values() ?? [])].slice(-limit);
      }
    }

    await expectUpsertByMessageId(new TestSink());
  });
});
