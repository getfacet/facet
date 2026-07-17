---
"@facet/store-postgres": minor
---

Add `PostgresAssets`, a durable Postgres-backed `AssetsStore` adapter for one
per-agent Theme, exact Patterns (a `patterns` JSONB column), and an optional
initial tree. `initSchema` now provisions the matching `facet_assets` table
alongside `facet_stage` and `facet_event`.
