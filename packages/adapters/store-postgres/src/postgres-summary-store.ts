import type { Pool } from "pg";
import type { StoredSummary, SummaryStore } from "@facet/runtime";
import { isSummaryIndex as isIndex } from "@facet/runtime";

/**
 * Postgres adapter for Facet's rolling-summary seam — a durable `SummaryStore`
 * backed by Postgres (Supabase works too). You bring the `pg.Pool`; the runtime
 * only ever calls the interface methods, so it never knows it's a database. One
 * table, `facet_summary`, holds the brain's OPAQUE per-`(agent, visitor)` digest
 * of conversation history so a long conversation need not replay in full.
 *
 * Run `initSummarySchema(pool)` once at startup, or manage the table with your
 * own migrations.
 */
export async function initSummarySchema(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists facet_summary (
      agent_id text not null,
      visitor_id text not null,
      payload jsonb not null,
      covered_through bigint not null,
      generation bigint not null,
      updated_at timestamptz not null default now(),
      primary key (agent_id, visitor_id)
    )
  `);
}

/** Coerces a jsonb/bigint column (a `bigint` comes back as a string) to a finite non-negative integer, or `undefined` when the value is malformed. */
function toIndex(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : Number.NaN;
  return isIndex(parsed) ? parsed : undefined;
}

/**
 * Parses one `facet_summary` row into a `StoredSummary`, or `undefined` when the
 * row is missing, mis-shaped, or carries invalid counters — never throws. Pure
 * (no database), so it is unit-testable on its own. `payload` stays OPAQUE: any
 * JSON value round-trips through unread, matching the runtime contract.
 */
export function parseSummaryRow(row: unknown): StoredSummary | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const record = row as Record<string, unknown>;
  if (!("payload" in record)) return undefined;
  const coveredThrough = toIndex(record["covered_through"]);
  if (coveredThrough === undefined) return undefined;
  const generation = toIndex(record["generation"]);
  if (generation === undefined) return undefined;
  return { payload: record["payload"], coveredThrough, generation };
}

/**
 * Durable Postgres-backed `SummaryStore`. Pair it with an equally durable Sink:
 * with a volatile sink, a restart orphans the summary (the agent detects the
 * mismatch via the conversation anchor and rebuilds from scratch, discarding the
 * saved memory).
 */
export class PostgresSummaryStore implements SummaryStore {
  constructor(private readonly pool: Pool) {}

  async get(agentId: string, visitorId: string): Promise<StoredSummary | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(
      `select payload, covered_through, generation from facet_summary
       where agent_id = $1 and visitor_id = $2`,
      [agentId, visitorId],
    );
    return parseSummaryRow(result.rows[0]);
  }

  async put(agentId: string, visitorId: string, summary: StoredSummary): Promise<boolean> {
    if (!isIndex(summary.coveredThrough) || !isIndex(summary.generation)) return false;
    const landed = await this.tryUpsert(agentId, visitorId, summary);
    if (landed) return true;
    // Fail-safe parity with FileSummaryStore: a corrupt/foreign row reads back as
    // absent, so it must not block a fresh write forever. When the guarded upsert
    // did not land, inspect the conflicting row; if it fails the same shape guard
    // `get` uses, delete it and retry once. A VALID newer row keeps winning.
    const conflicting = await this.pool.query(
      `select payload, covered_through, generation from facet_summary
       where agent_id = $1 and visitor_id = $2`,
      [agentId, visitorId],
    );
    const row = conflicting.rows[0];
    if (row !== undefined && parseSummaryRow(row) === undefined) {
      // Pin the repair DELETE to the corrupt row we observed (covered_through
      // AND generation, NULL-safe via IS NOT DISTINCT FROM): if another writer
      // replaced it with a VALID record between the select and the delete, the
      // predicate no-ops and the retry loses to the newer row as it should. A
      // corrupt row with SQL NULL counters still matches (plain `=` would
      // no-op on NULL and recreate the write livelock this path repairs).
      const observed = row as Record<string, unknown>;
      await this.pool.query(
        `delete from facet_summary
         where agent_id = $1 and visitor_id = $2
           and covered_through is not distinct from $3
           and generation is not distinct from $4`,
        [agentId, visitorId, observed["covered_through"] ?? null, observed["generation"] ?? null],
      );
      return this.tryUpsert(agentId, visitorId, summary);
    }
    return false;
  }

  private async tryUpsert(
    agentId: string,
    visitorId: string,
    summary: StoredSummary,
  ): Promise<boolean> {
    // The monotonic guard lives in SQL so it holds under concurrency: the
    // `DO UPDATE ... WHERE` clause blocks any write that does not strictly
    // advance `covered_through`, and `RETURNING` yields a row only when the
    // insert or update actually landed.
    const result = await this.pool.query(
      `insert into facet_summary (agent_id, visitor_id, payload, covered_through, generation, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (agent_id, visitor_id)
       do update set
         payload = excluded.payload,
         covered_through = excluded.covered_through,
         generation = excluded.generation,
         updated_at = now()
       where excluded.covered_through > facet_summary.covered_through
       returning agent_id`,
      [
        agentId,
        visitorId,
        // Normalize `undefined` → JSON null before binding: `JSON.stringify(undefined)`
        // is `undefined`, which the driver would reject against the NOT NULL
        // `payload jsonb` column. Pure serialization, never an interpretation of
        // the opaque payload (see SummaryStore interface doc).
        JSON.stringify(summary.payload ?? null),
        summary.coveredThrough,
        summary.generation,
      ],
    );
    return result.rows.length > 0;
  }

  async delete(agentId: string, visitorId: string): Promise<void> {
    await this.pool.query(`delete from facet_summary where agent_id = $1 and visitor_id = $2`, [
      agentId,
      visitorId,
    ]);
  }
}
