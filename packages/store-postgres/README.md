# @facet/store-postgres

A Postgres adapter for Facet: durable `StageStore` + `Sink` implementations
backed by Postgres/Supabase, so a page and its conversation survive restarts.
Drop them into any runtime seam that takes a `StageStore` / `Sink` (e.g.
`createFacetServer`).

```bash
npm install @facet/store-postgres @facet/runtime @facet/core pg
```

`pg` is a peer dependency — bring your own `Pool`. Call `initSchema(pool)` once
to create the tables, then hand a `PostgresStageStore` / `PostgresSink` to the
server.

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

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
