import type { Pool } from "pg";
import type { AssetDocuments, AssetsStore } from "@facet/runtime";

interface AssetsRow {
  readonly themes: unknown | null;
  readonly stamps: unknown | null;
  readonly initial_tree: unknown | null;
}

function jsonbArrayOrEmpty(value: unknown | null | undefined): readonly unknown[] {
  if (value === null || value === undefined) return [];
  return value as readonly unknown[];
}

export class PostgresAssets implements AssetsStore {
  constructor(private readonly pool: Pool) {}

  async load(agentId: string): Promise<AssetDocuments> {
    const result = await this.pool.query<AssetsRow>(
      `select themes, stamps, initial_tree from facet_assets
       where agent_id = $1`,
      [agentId],
    );
    const row = result.rows[0];
    if (row === undefined) return { themes: [], stamps: [] };

    const docs: {
      themes: readonly unknown[];
      stamps: readonly unknown[];
      initialTree?: unknown;
    } = {
      themes: jsonbArrayOrEmpty(row.themes),
      stamps: jsonbArrayOrEmpty(row.stamps),
    };
    if (row.initial_tree !== null && row.initial_tree !== undefined) {
      docs.initialTree = row.initial_tree;
    }
    return docs;
  }

  async putAssets(agentId: string, docs: AssetDocuments): Promise<void> {
    await this.pool.query(
      `insert into facet_assets (agent_id, themes, stamps, initial_tree, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (agent_id)
       do update set
         themes = excluded.themes,
         stamps = excluded.stamps,
         initial_tree = excluded.initial_tree,
         updated_at = now()`,
      [
        agentId,
        JSON.stringify(docs.themes),
        JSON.stringify(docs.stamps),
        docs.initialTree === undefined ? null : JSON.stringify(docs.initialTree),
      ],
    );
  }
}
