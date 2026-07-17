import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { MemorySummaryStore, type StoredSummary, type SummaryStore } from "@facet/runtime";
import { PostgresSummaryStore as BarrelPostgresSummaryStore } from "./index.js";
import {
  initSummarySchema,
  parseSummaryRow,
  PostgresSummaryStore,
} from "./postgres-summary-store.js";

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
      return Promise.resolve({ rows, rowCount: rows.length });
    },
  } as unknown as Pool;
  return { pool, calls };
}

/**
 * A fake `pg.Pool` that actually stores what `put()` writes and replays it from
 * `get()` the way Postgres would: `payload` is JSON round-tripped, the bigint
 * counters come back as strings, and the monotonic `ON CONFLICT ... DO UPDATE
 * ... WHERE excluded.covered_through > facet_summary.covered_through` guard is
 * emulated so a stale write returns zero rows. Lets us assert the full
 * write→read + monotonic contract through the real adapter code, no DB needed.
 */
function roundTripPool(): Pool {
  const rows = new Map<string, { payload: unknown; covered_through: number; generation: number }>();
  const key = (agentId: unknown, visitorId: unknown) => `${String(agentId)} ${String(visitorId)}`;
  return {
    query: (text: string, values: readonly unknown[] = []) => {
      if (/insert into facet_summary/i.test(text)) {
        const k = key(values[0], values[1]);
        const covered = Number(values[3]);
        const existing = rows.get(k);
        if (existing !== undefined && covered <= existing.covered_through) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        rows.set(k, {
          payload: JSON.parse(String(values[2])) as unknown,
          covered_through: covered,
          generation: Number(values[4]),
        });
        return Promise.resolve({ rows: [{ agent_id: values[0] }], rowCount: 1 });
      }
      // Checked before the `from facet_summary` read branch: a DELETE statement
      // also contains "from facet_summary".
      if (/delete from facet_summary/i.test(text)) {
        rows.delete(key(values[0], values[1]));
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (/from facet_summary/i.test(text)) {
        const row = rows.get(key(values[0], values[1]));
        return Promise.resolve({
          rows:
            row === undefined
              ? []
              : [
                  {
                    payload: row.payload,
                    covered_through: String(row.covered_through),
                    generation: String(row.generation),
                  },
                ],
        });
      }
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Pool;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

// The live tier reuses whatever connection the reference Postgres adapter is
// documented against (`DATABASE_URL`); it skips cleanly when the var is unset so
// CI stays green without a database.
const LIVE_URL = process.env.DATABASE_URL;

describe("parseSummaryRow (corrupt rows never throw)", () => {
  it("returns undefined for a non-object row", () => {
    expect(parseSummaryRow(undefined)).toBeUndefined();
    expect(parseSummaryRow(null)).toBeUndefined();
    expect(parseSummaryRow("not a row")).toBeUndefined();
    expect(parseSummaryRow(42)).toBeUndefined();
  });

  it("returns undefined when the payload column is absent", () => {
    expect(parseSummaryRow({ covered_through: "3", generation: "1" })).toBeUndefined();
  });

  it("returns undefined for an invalid covered_through", () => {
    expect(
      parseSummaryRow({ payload: {}, covered_through: "oops", generation: "1" }),
    ).toBeUndefined();
    expect(
      parseSummaryRow({ payload: {}, covered_through: "-1", generation: "1" }),
    ).toBeUndefined();
    expect(
      parseSummaryRow({ payload: {}, covered_through: "1.5", generation: "1" }),
    ).toBeUndefined();
    expect(
      parseSummaryRow({ payload: {}, covered_through: null, generation: "1" }),
    ).toBeUndefined();
  });

  it("returns undefined for an invalid generation", () => {
    expect(
      parseSummaryRow({ payload: {}, covered_through: "3", generation: "nope" }),
    ).toBeUndefined();
    expect(
      parseSummaryRow({ payload: {}, covered_through: "3", generation: "-2" }),
    ).toBeUndefined();
    expect(
      parseSummaryRow({ payload: {}, covered_through: "3", generation: undefined }),
    ).toBeUndefined();
  });

  it("parses a well-formed row, coercing bigint strings and keeping payload opaque", () => {
    const payload = { note: "digest", items: [1, 2, 3] };
    expect(parseSummaryRow({ payload, covered_through: "7", generation: "2" })).toEqual({
      payload,
      coveredThrough: 7,
      generation: 2,
    });
  });

  it("accepts a JSON-null payload as an opaque value", () => {
    expect(parseSummaryRow({ payload: null, covered_through: "0", generation: "0" })).toEqual({
      payload: null,
      coveredThrough: 0,
      generation: 0,
    });
  });
});

describe("initSummarySchema", () => {
  it("creates the facet_summary table keyed by (agent_id, visitor_id)", async () => {
    const { pool, calls } = fakePool();
    await initSummarySchema(pool);

    const ddl = calls.find((call) => /create table if not exists facet_summary/i.test(call.text));
    expect(ddl).toBeDefined();
    const sql = normalizeSql(ddl?.text ?? "");
    expect(sql).toContain("agent_id text not null");
    expect(sql).toContain("visitor_id text not null");
    expect(sql).toContain("payload jsonb not null");
    expect(sql).toContain("covered_through bigint not null");
    expect(sql).toContain("generation bigint not null");
    expect(sql).toContain("updated_at timestamptz not null default now()");
    expect(sql).toContain("primary key (agent_id, visitor_id)");
  });
});

describe("PostgresSummaryStore", () => {
  it("is exported through the package barrel and implements SummaryStore", () => {
    expect(BarrelPostgresSummaryStore).toBe(PostgresSummaryStore);

    const { pool } = fakePool();
    const postgres: SummaryStore = new PostgresSummaryStore(pool);
    const memory: SummaryStore = new MemorySummaryStore();

    expect(postgres).toBeInstanceOf(PostgresSummaryStore);
    expect(memory).toBeInstanceOf(MemorySummaryStore);
  });

  it("get maps a row and coerces the bigint counters to numbers", async () => {
    const payload = { note: "hi" };
    const { pool, calls } = fakePool([{ payload, covered_through: "4", generation: "2" }]);
    const stored = await new PostgresSummaryStore(pool).get("a", "v");

    expect(stored).toEqual({ payload, coveredThrough: 4, generation: 2 });
    expect(calls[0]?.text).toMatch(/from facet_summary/i);
    expect(calls[0]?.values).toEqual(["a", "v"]);
  });

  it("get returns undefined when there is no row", async () => {
    const { pool } = fakePool([]);
    expect(await new PostgresSummaryStore(pool).get("a", "v")).toBeUndefined();
  });

  it("get returns undefined for a corrupt persisted row, never throwing", async () => {
    const { pool } = fakePool([{ payload: {}, covered_through: "corrupt", generation: "1" }]);
    await expect(new PostgresSummaryStore(pool).get("a", "v")).resolves.toBeUndefined();
  });

  it("put rejects invalid counters without touching the database", async () => {
    const { pool, calls } = fakePool();
    const store = new PostgresSummaryStore(pool);

    expect(await store.put("a", "v", { payload: {}, coveredThrough: -1, generation: 0 })).toBe(
      false,
    );
    expect(await store.put("a", "v", { payload: {}, coveredThrough: 1.5, generation: 0 })).toBe(
      false,
    );
    expect(await store.put("a", "v", { payload: {}, coveredThrough: 3, generation: -1 })).toBe(
      false,
    );
    expect(await store.put("a", "v", { payload: {}, coveredThrough: 3, generation: 1.2 })).toBe(
      false,
    );
    expect(calls).toHaveLength(0);
  });

  it("put emits a monotonic ON CONFLICT upsert with a covered_through guard", async () => {
    const { pool, calls } = fakePool([{ agent_id: "a" }]);
    await new PostgresSummaryStore(pool).put("a", "v", {
      payload: { note: "x" },
      coveredThrough: 5,
      generation: 1,
    });

    const call = calls[0];
    expect(call?.values).toEqual(["a", "v", JSON.stringify({ note: "x" }), 5, 1]);
    const sql = normalizeSql(call?.text ?? "");
    expect(sql).toContain("insert into facet_summary");
    expect(sql).toContain("on conflict (agent_id, visitor_id)");
    expect(sql).toContain("do update set");
    expect(sql).toContain("payload = excluded.payload");
    expect(sql).toContain("covered_through = excluded.covered_through");
    expect(sql).toContain("generation = excluded.generation");
    expect(sql).toContain("where excluded.covered_through > facet_summary.covered_through");
    expect(sql).toContain("returning");
  });

  it("deletes an unparseable conflicting row and retries once (no livelock)", async () => {
    const calls: string[] = [];
    let inserts = 0;
    const pool = {
      query: (text: string, values: readonly unknown[] = []) => {
        calls.push(text);
        if (/insert into facet_summary/i.test(text)) {
          inserts += 1;
          // First upsert loses to the malformed row; the retry (post-delete) lands.
          return Promise.resolve(
            inserts === 1 ? { rows: [] } : { rows: [{ agent_id: values[0] }] },
          );
        }
        if (/delete from facet_summary/i.test(text)) return Promise.resolve({ rows: [] });
        if (/from facet_summary/i.test(text)) {
          // A foreign row whose counter is beyond safe-integer range: `get`
          // parses it as absent, so it must not be allowed to block writes.
          return Promise.resolve({
            rows: [{ payload: {}, covered_through: "9223372036854775807", generation: "1" }],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    } as unknown as Pool;

    const store = new PostgresSummaryStore(pool);
    expect(await store.put("a", "v", { payload: {}, coveredThrough: 1, generation: 1 })).toBe(true);
    expect(calls.some((text) => /delete from facet_summary/i.test(text))).toBe(true);
    expect(inserts).toBe(2);
  });

  it("pins the repair DELETE to the observed corrupt counters, NULL-safe (R7)", async () => {
    const deletes: { text: string; values: readonly unknown[] }[] = [];
    let inserts = 0;
    const pool = {
      query: (text: string, values: readonly unknown[] = []) => {
        if (/insert into facet_summary/i.test(text)) {
          inserts += 1;
          return Promise.resolve(
            inserts === 1 ? { rows: [] } : { rows: [{ agent_id: values[0] }] },
          );
        }
        if (/delete from facet_summary/i.test(text)) {
          deletes.push({ text, values });
          return Promise.resolve({ rows: [] });
        }
        if (/from facet_summary/i.test(text)) {
          // A corrupt row whose counters are SQL NULL — plain `=` predicates
          // would never match it and the livelock would return.
          return Promise.resolve({
            rows: [{ payload: {}, covered_through: null, generation: null }],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    } as unknown as Pool;

    const store = new PostgresSummaryStore(pool);
    expect(await store.put("a", "v", { payload: {}, coveredThrough: 1, generation: 1 })).toBe(true);
    // The repair DELETE is pinned to BOTH observed counters, NULL-safely.
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.text).toMatch(/covered_through is not distinct from \$3/i);
    expect(deletes[0]?.text).toMatch(/generation is not distinct from \$4/i);
    expect(deletes[0]?.values.slice(2)).toEqual([null, null]);
    expect(inserts).toBe(2);
  });

  it("repair delete carries the observed unsafe counter values, not a blanket key delete (R7)", async () => {
    const deletes: { values: readonly unknown[] }[] = [];
    let inserts = 0;
    const pool = {
      query: (text: string, values: readonly unknown[] = []) => {
        if (/insert into facet_summary/i.test(text)) {
          inserts += 1;
          return Promise.resolve(
            inserts === 1 ? { rows: [] } : { rows: [{ agent_id: values[0] }] },
          );
        }
        if (/delete from facet_summary/i.test(text)) {
          deletes.push({ values });
          return Promise.resolve({ rows: [] });
        }
        if (/from facet_summary/i.test(text)) {
          return Promise.resolve({
            rows: [{ payload: {}, covered_through: "9223372036854775807", generation: "1" }],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    } as unknown as Pool;

    const store = new PostgresSummaryStore(pool);
    expect(await store.put("a", "v", { payload: {}, coveredThrough: 1, generation: 1 })).toBe(true);
    // Reverting to an unpinned delete(agentId, visitorId) fails here: the bound
    // params must include the exact observed counters.
    expect(deletes[0]?.values).toEqual(["a", "v", "9223372036854775807", "1"]);
  });

  it("keeps losing to a VALID newer row (no delete, no retry)", async () => {
    const calls: string[] = [];
    let inserts = 0;
    const pool = {
      query: (text: string, values: readonly unknown[] = []) => {
        void values;
        calls.push(text);
        if (/insert into facet_summary/i.test(text)) {
          inserts += 1;
          return Promise.resolve({ rows: [] });
        }
        if (/from facet_summary/i.test(text)) {
          return Promise.resolve({
            rows: [{ payload: {}, covered_through: "5", generation: "2" }],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    } as unknown as Pool;

    const store = new PostgresSummaryStore(pool);
    expect(await store.put("a", "v", { payload: {}, coveredThrough: 1, generation: 1 })).toBe(
      false,
    );
    expect(calls.some((text) => /delete from facet_summary/i.test(text))).toBe(false);
    expect(inserts).toBe(1);
  });

  it("round-trips an opaque payload and advances only on a strictly newer covered_through", async () => {
    const store = new PostgresSummaryStore(roundTripPool());
    const first: StoredSummary = { payload: { turn: 1 }, coveredThrough: 2, generation: 0 };
    const newer: StoredSummary = { payload: { turn: 2 }, coveredThrough: 5, generation: 1 };
    const stale: StoredSummary = { payload: { turn: 3 }, coveredThrough: 5, generation: 2 };

    expect(await store.put("a", "v", first)).toBe(true);
    await expect(store.get("a", "v")).resolves.toEqual(first);

    expect(await store.put("a", "v", newer)).toBe(true);
    await expect(store.get("a", "v")).resolves.toEqual(newer);

    // Equal coveredThrough is a stale write — ignored, prior record preserved.
    expect(await store.put("a", "v", stale)).toBe(false);
    await expect(store.get("a", "v")).resolves.toEqual(newer);
  });

  it("keeps summaries isolated by (agent_id, visitor_id)", async () => {
    const store = new PostgresSummaryStore(roundTripPool());
    const a: StoredSummary = { payload: { who: "a" }, coveredThrough: 1, generation: 0 };
    const b: StoredSummary = { payload: { who: "b" }, coveredThrough: 9, generation: 0 };

    expect(await store.put("agent", "va", a)).toBe(true);
    expect(await store.put("agent", "vb", b)).toBe(true);

    await expect(store.get("agent", "va")).resolves.toEqual(a);
    await expect(store.get("agent", "vb")).resolves.toEqual(b);
    await expect(store.get("agent", "vc")).resolves.toBeUndefined();
  });

  it("delete emits a DELETE keyed by (agent_id, visitor_id)", async () => {
    const { pool, calls } = fakePool();
    await new PostgresSummaryStore(pool).delete("a", "v");

    const call = calls[0];
    expect(call?.values).toEqual(["a", "v"]);
    const sql = normalizeSql(call?.text ?? "");
    expect(sql).toContain("delete from facet_summary");
    expect(sql).toContain("where agent_id = $1 and visitor_id = $2");
  });

  it("delete removes the record and resets the monotonic guard", async () => {
    const store = new PostgresSummaryStore(roundTripPool());
    await store.put("a", "v", { payload: { turn: 1 }, coveredThrough: 5, generation: 3 });
    await store.delete("a", "v");
    await expect(store.get("a", "v")).resolves.toBeUndefined();
    // With the row gone, a fresh LOWER coveredThrough put lands.
    const rebuilt: StoredSummary = { payload: { turn: 2 }, coveredThrough: 1, generation: 1 };
    expect(await store.put("a", "v", rebuilt)).toBe(true);
    await expect(store.get("a", "v")).resolves.toEqual(rebuilt);
  });

  it("normalizes an undefined payload to JSON null (guard intact)", async () => {
    const { pool, calls } = fakePool([{ agent_id: "a" }]);
    // A plain fakePool proves the bound param is JSON null, not `undefined`
    // (which the NOT NULL jsonb column would reject).
    expect(
      await new PostgresSummaryStore(pool).put("a", "v", {
        payload: undefined,
        coveredThrough: 1,
        generation: 1,
      }),
    ).toBe(true);
    expect(calls[0]?.values).toEqual(["a", "v", "null", 1, 1]);

    // Through a round-trip pool the stored payload reads back as null, and the
    // monotonic guard is untouched (equal coveredThrough still rejected).
    const store = new PostgresSummaryStore(roundTripPool());
    expect(
      await store.put("a", "v", { payload: undefined, coveredThrough: 1, generation: 1 }),
    ).toBe(true);
    await expect(store.get("a", "v")).resolves.toEqual({
      payload: null,
      coveredThrough: 1,
      generation: 1,
    });
    expect(
      await store.put("a", "v", { payload: undefined, coveredThrough: 1, generation: 2 }),
    ).toBe(false);
  });
});

describe.skipIf(!LIVE_URL)("PostgresSummaryStore (live)", () => {
  it("round-trips, guards monotonicity, and isolates keys against a real database", async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: LIVE_URL });
    const agentId = `wu3-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await initSummarySchema(pool);
      const store = new PostgresSummaryStore(pool);

      const first: StoredSummary = { payload: { turn: 1 }, coveredThrough: 2, generation: 0 };
      const newer: StoredSummary = { payload: { turn: 2 }, coveredThrough: 5, generation: 1 };
      const stale: StoredSummary = { payload: { turn: 3 }, coveredThrough: 5, generation: 2 };

      expect(await store.get(agentId, "v")).toBeUndefined();
      expect(await store.put(agentId, "v", first)).toBe(true);
      await expect(store.get(agentId, "v")).resolves.toEqual(first);

      expect(await store.put(agentId, "v", newer)).toBe(true);
      await expect(store.get(agentId, "v")).resolves.toEqual(newer);

      expect(await store.put(agentId, "v", stale)).toBe(false);
      await expect(store.get(agentId, "v")).resolves.toEqual(newer);

      const other: StoredSummary = { payload: { turn: 9 }, coveredThrough: 1, generation: 0 };
      expect(await store.put(agentId, "w", other)).toBe(true);
      await expect(store.get(agentId, "w")).resolves.toEqual(other);
      await expect(store.get(agentId, "v")).resolves.toEqual(newer);
    } finally {
      await pool
        .query("delete from facet_summary where agent_id = $1", [agentId])
        .catch(() => undefined);
      await pool.end();
    }
  });
});
