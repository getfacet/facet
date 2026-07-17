import type { Pool } from "pg";
import type { AssetDocuments, AssetsStore } from "@facet/runtime";

interface AssetsRow {
  readonly theme: unknown | null;
  readonly theme_present: boolean;
  readonly patterns: unknown | null;
  readonly patterns_present: boolean;
  readonly initial_tree: unknown | null;
  readonly initial_tree_present: boolean;
}

export class PostgresAssets implements AssetsStore {
  constructor(private readonly pool: Pool) {}

  async load(agentId: string): Promise<AssetDocuments> {
    const result = await this.pool.query<AssetsRow>(
      `select
         fa.theme,
         fa.theme is not null as theme_present,
         fa.patterns,
         fa.patterns is not null as patterns_present,
         fa.initial_tree,
         fa.initial_tree is not null as initial_tree_present
       from facet_assets fa
       where fa.agent_id = $1`,
      [agentId],
    );
    const row = result.rows[0];
    if (row === undefined) return {};

    const docs: { theme?: unknown; patterns?: unknown; initialTree?: unknown } = {};
    if (row.theme_present) docs.theme = row.theme;
    if (row.patterns_present) docs.patterns = row.patterns;
    if (row.initial_tree_present) docs.initialTree = row.initial_tree;
    return docs;
  }

  async putAssets(agentId: string, docs: AssetDocuments): Promise<void> {
    await this.pool.query(
      `insert into facet_assets (agent_id, theme, patterns, initial_tree, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (agent_id)
       do update set
         theme = excluded.theme,
         patterns = excluded.patterns,
         initial_tree = excluded.initial_tree,
         updated_at = now()`,
      [
        agentId,
        docs.theme === undefined ? null : JSON.stringify(docs.theme),
        docs.patterns === undefined ? null : JSON.stringify(docs.patterns),
        docs.initialTree === undefined ? null : JSON.stringify(docs.initialTree),
      ],
    );
  }
}
