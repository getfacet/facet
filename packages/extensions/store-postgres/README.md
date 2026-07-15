# @facet/store-postgres

A Postgres adapter for Facet: durable `StageStore`, `Sink`, `AssetsStore`, and
`SummaryStore`
implementations backed by Postgres/Supabase, so a page, its conversation, and
per-agent assets survive restarts. `PostgresStageStore` and `PostgresSink` plug
directly into `createFacetServer`; `PostgresAssets` plugs into any host code
that loads `AssetsStore` documents and wires the loaded themes, compositions,
catalog, and optional initial tree to its renderer/agent setup.

Tier: **Reference Implementation**. This adapter stores Facet stage/session
state only. It is not a hosted-platform schema for tenants, projects, pages,
agent tokens, usage, billing, audit, or abuse controls.

```bash
npm install @facet/store-postgres @facet/server @facet/runtime @facet/core pg
```

`pg` is a peer dependency — bring your own `Pool`. Call `initSchema(pool)` once
to create the three tables (`facet_stage`, `facet_event`, and `facet_assets`),
then hand a `PostgresStageStore` / `PostgresSink` to the server.

```ts
import { Pool } from "pg";
import { initSchema, PostgresStageStore, PostgresSink } from "@facet/store-postgres";
// Rolling-summary store for LLM context compaction (separate schema init):
// import { initSummarySchema, PostgresSummaryStore } from "@facet/store-postgres";
import { createFacetServer } from "@facet/server";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await initSchema(pool);

const server = createFacetServer({
  port: 5291,
  agentId: "live",
  stageStore: new PostgresStageStore(pool),
  sink: new PostgresSink(pool),
});
await server.listen();
```

## Assets: raw JSONB and composition references

`facet_assets` holds one row per agent with four JSONB columns: `themes`,
`compositions`, `catalog`, and `initial_tree`. `PostgresAssets.load(agentId)`
returns them as a raw `AssetDocuments` value — a `themes` array, a
`compositions` array, and optional `catalog` / `initialTree` documents. A
non-array `themes`/`compositions` value is ignored with a bounded issue, never
thrown on.

Use `PostgresAssets` anywhere an `AssetsStore` is accepted. `loadAssets`
remains the validation/fallback gate; the Postgres adapter returns raw JSONB
documents and performs no item-level or composition-semantic validation of its
own. In particular, a JSON array can round-trip through `PostgresAssets` even
when individual documents are invalid; `loadAssets` is the boundary that
sanitizes valid concrete references and skips invalid entries with issues. The reference
`createFacetServer` only accepts `stageStore` and `sink`, so a host that loads
assets must pass `loaded.initialTree` to `withInitialStage`, `loaded.themes` to
its renderer shell, and `loaded.compositions`/`loaded.catalog`/`loaded.themes`
to its agent prompt/tool path.

```ts
import { loadAssets, withInitialStage } from "@facet/runtime";
import { PostgresAssets, PostgresStageStore } from "@facet/store-postgres";

const assets = new PostgresAssets(pool);
const loaded = await loadAssets(assets, "live");

const stageStore = withInitialStage(new PostgresStageStore(pool), loaded.initialTree);
// Pass loaded.themes to the renderer shell.
// Pass loaded.themes, loaded.compositions, and loaded.catalog to the agent.
// Its prompt indexes reference names/descriptions; get_composition returns one
// complete selected document only inside the provider tool loop.
```

The validated composition shape is a self-contained native reference dataset:

```ts
{
  name: "launch-card",
  metadata: { description: "A launch card with one primary action." },
  root: "launch-card.root",
  nodes: {
    "launch-card.root": {
      id: "launch-card.root",
      type: "card",
      title: "Ready to launch?",
      children: [],
    },
  },
}
```

Composition references are agent/provider-side assets. A successful
`get_composition({ name })` read has no stage effect; the model authors any
adapted UI later through ordinary native stage tools, and only those ordinary
patches travel to the runtime/client. Hosts must not place the composition JSON
in their renderer shell or add an asset transport route.

`putAssets(agentId, docs)` is an explicit admin/write operation that replaces
the agent's whole asset row — all four JSONB columns at once. Do not run it as
part of normal server boot unless you intend to overwrite any existing custom
assets for that agent.

```ts
await new PostgresAssets(pool).putAssets("live", {
  themes: [customTheme],
  compositions: [customComposition],
  initialTree: optionalInitialTree,
});
```

The pre-1.0 composition change requires a data migration, not a schema
migration: the `compositions` JSONB column stays as-is, while each stored
document must be rewritten to the concrete `{ name, metadata, root, nodes }`
shape with a required `metadata.description`. `PostgresAssets` deliberately
does not reinterpret older template-like or nested-reference documents. They
still round-trip at the raw adapter boundary but are skipped when the host calls
`loadAssets`; no compatibility conversion or automatic stage insertion occurs.

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
