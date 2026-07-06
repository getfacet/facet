import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { CollectedEvent, FacetSession } from "@facet/core";
import type { StoredEvent } from "@facet/runtime";
import { initSchema, PostgresSink, PostgresStageStore } from "./postgres-store.js";

interface Call {
  readonly text: string;
  readonly values: readonly unknown[];
}

/**
 * A fake `pg.Pool` — records the SQL + params and returns canned rows. Lets us
 * verify the adapter's query shape and row mapping without a live database.
 */
function fakePool(rows: readonly unknown[] = []): { pool: Pool; calls: Call[] } {
  const calls: Call[] = [];
  const pool = {
    query: (text: string, values: readonly unknown[] = []) => {
      calls.push({ text, values });
      return Promise.resolve({ rows });
    },
  } as unknown as Pool;
  return { pool, calls };
}

/**
 * A fake `pg.Pool` that actually stores what `record()` inserts and replays it
 * from `history()` — the way `jsonb` would (params are JSON-serialized on write
 * and returned as parsed objects on read, `at` as a bigint string). Lets us
 * assert a full write→read round-trip through the real adapter code.
 */
function roundTripPool(): Pool {
  const stored: { at: number; event: unknown; messages: unknown }[] = [];
  return {
    query: (text: string, values: readonly unknown[]) => {
      if (/insert into facet_event/i.test(text)) {
        stored.push({
          at: Number(values[2]),
          event: JSON.parse(String(values[3])),
          messages: JSON.parse(String(values[4])),
        });
        return Promise.resolve({ rows: [] });
      }
      if (/from facet_event/i.test(text)) {
        return Promise.resolve({
          rows: stored.map((r) => ({ at: String(r.at), event: r.event, messages: r.messages })),
        });
      }
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Pool;
}

const session: FacetSession = {
  agentId: "a",
  visitor: { visitorId: "v" },
  stage: { root: "root", nodes: {} },
};

describe("initSchema", () => {
  it("initSchema creates the facet_assets table", async () => {
    const { pool, calls } = fakePool();
    await initSchema(pool);

    expect(calls.some((call) => /create table if not exists facet_assets/i.test(call.text))).toBe(
      true,
    );
  });
});

describe("PostgresStageStore", () => {
  it("save upserts the session as a jsonb param", async () => {
    const { pool, calls } = fakePool();
    await new PostgresStageStore(pool).save(session);
    expect(calls[0]?.text).toMatch(/insert into facet_stage/i);
    expect(calls[0]?.values[0]).toBe("a");
    expect(calls[0]?.values[1]).toBe("v");
    expect(JSON.parse(String(calls[0]?.values[2]))).toMatchObject({ agentId: "a" });
  });

  it("get returns the row's session", async () => {
    const { pool } = fakePool([{ session }]);
    expect(await new PostgresStageStore(pool).get("a", "v")).toEqual(session);
  });

  it("get returns undefined when there is no row", async () => {
    const { pool } = fakePool([]);
    expect(await new PostgresStageStore(pool).get("a", "v")).toBeUndefined();
  });
});

describe("PostgresSink", () => {
  it("record inserts event + messages as jsonb params", async () => {
    const { pool, calls } = fakePool();
    await new PostgresSink(pool).record("a", "v", {
      at: 5,
      event: { kind: "message", text: "hi" },
      messages: [{ kind: "say", text: "yo" }],
    });
    expect(calls[0]?.text).toMatch(/insert into facet_event/i);
    expect(calls[0]?.values[2]).toBe(5);
    expect(JSON.parse(String(calls[0]?.values[3]))).toMatchObject({ text: "hi" });
  });

  it("history maps rows and coerces the bigint timestamp to a number", async () => {
    const { pool } = fakePool([{ at: "7", event: { kind: "message", text: "x" }, messages: [] }]);
    const history = await new PostgresSink(pool).history("a", "v");
    expect(history[0]?.at).toBe(7);
    expect(history[0]?.event).toMatchObject({ text: "x" });
  });

  it("round-trips a collected tap event", async () => {
    const sink = new PostgresSink(roundTripPool());

    // A local navigate tap: the durable log currency (`CollectedEvent`) carries a
    // resolved `effect` + the pressed box's `target` and NO agent turn (messages []).
    const tap: CollectedEvent = {
      kind: "tap",
      target: "cta",
      effect: { navigate: "pricing" },
      seq: 3,
    };
    const visit: CollectedEvent = { kind: "visit", visitor: { visitorId: "v" }, seq: 1 };
    const message: CollectedEvent = { kind: "message", text: "hi", seq: 2 };

    await sink.record("a", "v", { at: 100, event: visit, messages: [] });
    await sink.record("a", "v", {
      at: 300,
      event: message,
      messages: [{ kind: "say", text: "hello" }],
    });
    await sink.record("a", "v", { at: 500, event: tap, messages: [] });

    const history: readonly StoredEvent[] = await sink.history("a", "v");
    expect(history).toHaveLength(3);

    // The tap survives the reader as the SAME `CollectedEvent` — effect, target and
    // seq intact — proving durable rows round-trip as the log currency (DC-006).
    const row = history[2];
    expect(row?.at).toBe(500);
    expect(row?.messages).toEqual([]);
    const collected = row?.event;
    expect(collected).toEqual(tap);
    // Reader row type is `CollectedEvent`: the tap shape (effect/target) is reachable.
    if (collected?.kind === "tap") {
      expect(collected.effect).toEqual({ navigate: "pricing" });
      expect(collected.target).toBe("cta");
    }

    // A visit and a message still round-trip unchanged.
    expect(history[0]?.event).toEqual(visit);
    expect(history[1]?.event).toEqual(message);
    expect(history[1]?.messages).toEqual([{ kind: "say", text: "hello" }]);
  });
});
