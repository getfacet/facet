# @facet/store-postgres

A Postgres adapter for Facet: durable `StageStore`, `Sink`, and `AssetsStore`
implementations backed by Postgres/Supabase, so a page, its conversation, and
per-agent assets survive restarts. Drop them into any runtime seam that takes a
`StageStore` / `Sink` / `AssetsStore` (e.g. `createFacetServer`).

```bash
npm install @facet/store-postgres @facet/server @facet/runtime @facet/core pg
```

`pg` is a peer dependency — bring your own `Pool`. Call `initSchema(pool)` once
to create the three tables (`facet_stage`, `facet_event`, and `facet_assets`),
then hand a `PostgresStageStore` / `PostgresSink` to the server. Use
`PostgresAssets` anywhere an `AssetsStore` is accepted.

```ts
import { Pool } from "pg";
import { loadAssets, withInitialStage } from "@facet/runtime";
import { initSchema, PostgresAssets, PostgresStageStore, PostgresSink } from "@facet/store-postgres";
import { createFacetServer } from "@facet/server";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await initSchema(pool);

const assets = new PostgresAssets(pool);
await assets.putAssets("live", {
  themes: [],
  stamps: [],
});
const loaded = await loadAssets(assets, "live");

const server = createFacetServer({
  port: 5291,
  agentId: "live",
  stageStore: withInitialStage(new PostgresStageStore(pool), loaded.initialTree),
  sink: new PostgresSink(pool),
});
await server.listen();
```

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
