import type { Pool } from "pg";
import type { AssetDocuments, AssetsStore } from "@facet/runtime";

interface AssetsRow {
  readonly themes: unknown | null;
  readonly compositions: unknown | null;
  readonly catalog: unknown | null;
  readonly initial_tree: unknown | null;
}

function jsonbAssetField(
  value: unknown | null | undefined,
  label: "themes" | "compositions",
): { readonly value: readonly unknown[]; readonly issue?: string } {
  if (value === null || value === undefined) return { value: [] };
  if (Array.isArray(value)) return { value };
  return { value: [], issue: `postgres assets \`${label}\` was not an array — ignored` };
}

export class PostgresAssets implements AssetsStore {
  constructor(private readonly pool: Pool) {}

  async load(agentId: string): Promise<AssetDocuments> {
    const result = await this.pool.query<AssetsRow>(
      `select fa.themes, fa.compositions, to_jsonb(fa) -> 'catalog' as catalog, fa.initial_tree
       from facet_assets fa
       where fa.agent_id = $1`,
      [agentId],
    );
    const row = result.rows[0];
    if (row === undefined) return { themes: [], compositions: [] };
    const themes = jsonbAssetField(row.themes, "themes");
    const compositions = jsonbAssetField(row.compositions, "compositions");

    const docs: {
      themes: readonly unknown[];
      compositions: readonly unknown[];
      catalog?: unknown;
      initialTree?: unknown;
      issues?: readonly string[];
    } = {
      themes: themes.value,
      compositions: compositions.value,
    };
    const issues = [themes.issue, compositions.issue].filter(
      (issue): issue is string => issue !== undefined,
    );
    if (issues.length > 0) docs.issues = issues;
    if (row.initial_tree !== null && row.initial_tree !== undefined) {
      docs.initialTree = row.initial_tree;
    }
    if (row.catalog !== null && row.catalog !== undefined) {
      docs.catalog = row.catalog;
    }
    return docs;
  }

  async putAssets(agentId: string, docs: AssetDocuments): Promise<void> {
    await this.pool.query(
      `insert into facet_assets (agent_id, themes, compositions, catalog, initial_tree, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (agent_id)
       do update set
         themes = excluded.themes,
         compositions = excluded.compositions,
         catalog = excluded.catalog,
         initial_tree = excluded.initial_tree,
         updated_at = now()`,
      [
        agentId,
        JSON.stringify(docs.themes),
        JSON.stringify(docs.compositions),
        docs.catalog === undefined ? null : JSON.stringify(docs.catalog),
        docs.initialTree === undefined ? null : JSON.stringify(docs.initialTree),
      ],
    );
  }
}
