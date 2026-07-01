import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { FacetSession } from "@facet/core";
import { PostgresSink, PostgresStageStore } from "./postgres-store.js";

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
    query: (text: string, values: readonly unknown[]) => {
      calls.push({ text, values });
      return Promise.resolve({ rows });
    },
  } as unknown as Pool;
  return { pool, calls };
}

const session: FacetSession = {
  agentId: "a",
  visitor: { visitorId: "v" },
  stage: { root: "root", nodes: {} },
};

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
});
