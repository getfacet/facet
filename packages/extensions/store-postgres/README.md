# @facet/store-postgres

A Postgres adapter for Facet: durable `StageStore`, `Sink`, and `AssetsStore`
implementations backed by Postgres/Supabase, so a page, its conversation, and
per-agent assets survive restarts. `PostgresStageStore` and `PostgresSink` plug
directly into `createFacetServer`; `PostgresAssets` plugs into any host code that
loads `AssetsStore` documents and wires the loaded themes, stamps, and optional
initial tree to its renderer/agent setup.

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

Use `PostgresAssets` anywhere an `AssetsStore` is accepted. `loadAssets` remains
the validation/fallback gate; the Postgres adapter returns raw jsonb documents.
The reference `createFacetServer` only accepts `stageStore` and `sink`, so a host
that loads assets must pass `loaded.initialTree` to `withInitialStage`,
`loaded.themes` to its renderer shell, and `loaded.stamps`/`loaded.themes` to its
agent prompt path.

```ts
import { loadAssets, withInitialStage } from "@facet/runtime";
import { PostgresAssets, PostgresStageStore } from "@facet/store-postgres";

const assets = new PostgresAssets(pool);
const loaded = await loadAssets(assets, "live");

const stageStore = withInitialStage(new PostgresStageStore(pool), loaded.initialTree);
// Pass loaded.themes to the renderer shell.
// Pass loaded.themes and loaded.stamps to the agent prompt path.
```

`putAssets(agentId, docs)` is an explicit admin/write operation that replaces the
agent's whole asset row. Do not run it as part of normal server boot unless you
intend to overwrite any existing custom assets for that agent.

```ts
await new PostgresAssets(pool).putAssets("live", {
  themes: [customTheme],
  stamps: [customStamp],
  initialTree: optionalInitialTree,
});
```

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
