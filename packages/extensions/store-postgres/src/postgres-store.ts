import type { Pool } from "pg";
import type { CollectedEvent, FacetSession, ServerMessage, VisitorContext } from "@facet/core";
import { openSession, type Sink, type StageStore, type StoredEvent } from "@facet/runtime";

/**
 * Postgres adapter for Facet's persistence seams — a durable `StageStore` and
 * `Sink` backed by Postgres (Supabase works too). You bring the `pg.Pool`; Facet
 * only ever calls the interface methods, so the runtime/server don't know it's a
 * database. Three tables: `facet_stage` (current page, one row per session),
 * `facet_event` (append-only conversation), and `facet_assets` (per-agent raw
 * asset documents).
 *
 * Run `initSchema(pool)` once at startup, or manage the tables with your own
 * migrations.
 */
export async function initSchema(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists facet_stage (
      agent_id text not null,
      visitor_id text not null,
      session jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (agent_id, visitor_id)
    )
  `);
  await pool.query(`
    create table if not exists facet_event (
      id bigserial primary key,
      agent_id text not null,
      visitor_id text not null,
      at bigint not null,
      event jsonb not null,
      messages jsonb not null,
      recorded_at timestamptz not null default now()
    )
  `);
  await pool.query(
    "create index if not exists facet_event_session on facet_event (agent_id, visitor_id, id)",
  );
  await pool.query(`
    create table if not exists facet_assets (
      agent_id text primary key,
      theme jsonb,
      patterns jsonb,
      initial_tree jsonb,
      updated_at timestamptz not null default now()
    )
  `);
  const assetColumns = await pool.query<{ readonly column_name: string }>(`
    select column_name
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'facet_assets'
    order by column_name
  `);
  const actualColumns = assetColumns.rows.map((row) => row.column_name).sort();
  const expectedColumns = ["agent_id", "initial_tree", "patterns", "theme", "updated_at"];
  if (
    actualColumns.length !== expectedColumns.length ||
    expectedColumns.some((column, index) => actualColumns[index] !== column)
  ) {
    throw new Error(
      "Facet asset schema migration required before use; replace facet_assets with the current schema.",
    );
  }
}

export class PostgresStageStore implements StageStore {
  constructor(private readonly pool: Pool) {}

  async get(agentId: string, visitorId: string): Promise<FacetSession | undefined> {
    const result = await this.pool.query<{ session: FacetSession }>(
      "select session from facet_stage where agent_id = $1 and visitor_id = $2",
      [agentId, visitorId],
    );
    return result.rows[0]?.session;
  }

  async open(agentId: string, visitor: VisitorContext): Promise<FacetSession> {
    return openSession(this, agentId, visitor);
  }

  async save(session: FacetSession): Promise<void> {
    await this.pool.query(
      `insert into facet_stage (agent_id, visitor_id, session, updated_at)
       values ($1, $2, $3, now())
       on conflict (agent_id, visitor_id)
       do update set session = excluded.session, updated_at = now()`,
      [session.agentId, session.visitor.visitorId, JSON.stringify(session)],
    );
  }
}

export class PostgresSink implements Sink {
  constructor(private readonly pool: Pool) {}

  async record(agentId: string, visitorId: string, entry: StoredEvent): Promise<void> {
    await this.pool.query(
      `insert into facet_event (agent_id, visitor_id, at, event, messages)
       values ($1, $2, $3, $4, $5)`,
      [agentId, visitorId, entry.at, JSON.stringify(entry.event), JSON.stringify(entry.messages)],
    );
  }

  async history(agentId: string, visitorId: string): Promise<readonly StoredEvent[]> {
    const result = await this.pool.query<{
      at: string;
      event: CollectedEvent;
      messages: ServerMessage[];
    }>(
      `select at, event, messages from facet_event
       where agent_id = $1 and visitor_id = $2 order by id asc`,
      [agentId, visitorId],
    );
    return result.rows.map((row) => ({
      at: Number(row.at),
      event: row.event,
      messages: row.messages,
    }));
  }
}
