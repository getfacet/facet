# @facet/store-postgres

Postgres/Supabase references for Facet's `StageStore`, `Sink`, `AssetsStore`,
and `SummaryStore` seams.

Role: **Adapters**. This optional Postgres adapter stores Facet session and agent
asset data; it is not a hosted-platform schema for tenants, projects, auth,
billing, metering, audit, or abuse controls.

```bash
npm install @facet/store-postgres @facet/server @facet/runtime @facet/core pg
```

`pg` is a peer dependency. Bring your own `Pool`.

## Stage and conversation storage

`initSchema(pool)` creates three tables:

- `facet_stage(agent_id, visitor_id, session, updated_at)`;
- `facet_event(id, agent_id, visitor_id, at, event, messages, recorded_at)`;
- `facet_assets(agent_id, theme, patterns, initial_tree, updated_at)`.

The current `facet_assets` column-name set is checked after creation. If an
existing table has a missing or extra column name, `initSchema` throws and
requires an explicit migration before use. It does not introspect column types,
nullability, defaults, indexes, or constraints; deployments that manage their
own schema must keep those details aligned with the DDL above.

```ts
import { Pool } from "pg";
import { createFacetServer } from "@facet/server";
import {
  initSchema,
  PostgresSink,
  PostgresStageStore,
} from "@facet/store-postgres";

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

## Per-agent assets

`PostgresAssets` stores raw `AssetDocuments`; it deliberately does not validate
Theme or Pattern semantics. One row contains:

- `theme` — one optional complete Theme JSON object;
- `patterns` — one optional exact Pattern JSON array; and
- `initial_tree` — one optional strict initial Facet tree.

`PostgresAssets.load(agentId)` preserves absence versus explicit JSON values and
returns `{ theme?, patterns?, initialTree? }`. Pass that store to runtime
`loadAssets`, which owns the complete validation, whole-Theme fallback, and
freezing boundary.

```ts
import { loadAssets, withInitialStage } from "@facet/runtime";
import { PostgresAssets, PostgresStageStore } from "@facet/store-postgres";

const assetStore = new PostgresAssets(pool);
const loaded = await loadAssets(assetStore, "live");

const stageStore = withInitialStage(
  new PostgresStageStore(pool),
  loaded.initialTree,
);

// loaded.theme goes to both StageRenderer and the agent asset snapshot.
// loaded.patterns stays agent/provider-side.
```

A stored Pattern uses the same exact shape as `FacetPattern`:

```ts
const launchCard = {
  name: "launch-card",
  description: "A compact launch card with one primary action.",
  useWhen: "A visitor needs one clear next step.",
  root: "launch-card.root",
  nodes: {
    "launch-card.root": {
      id: "launch-card.root",
      type: "box",
      style: { preset: "panel", gap: "sm" },
      children: ["launch-card.title"],
    },
    "launch-card.title": {
      id: "launch-card.title",
      type: "text",
      value: "Ready to launch?",
      style: { preset: "heading" },
    },
  },
};
```

Patterns are exact agent/provider-side references. A `get_pattern({ name })`
read has `no_stage_change`; the model later authors adapted ordinary Bricks and
only those normal patches reach the runtime/client. Do not place Pattern trees
in the renderer shell or add a browser asset route.

`putAssets(agentId, docs)` is an explicit whole-row admin write. It replaces
all three optional asset columns at once; omitted fields become SQL `null`.

```ts
await new PostgresAssets(pool).putAssets("live", {
  theme: customTheme,
  patterns: [launchCard],
  initialTree: optionalInitialTree,
});
```

## Rolling summaries

Call `initSummarySchema(pool)` separately to create
`facet_summary(agent_id, visitor_id, payload, covered_through, generation,
updated_at)`. `PostgresSummaryStore` treats `payload` as opaque JSON and uses a
SQL monotonic guard so only a strictly newer `covered_through` value wins. Pair
it with an equally durable `Sink`.

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
