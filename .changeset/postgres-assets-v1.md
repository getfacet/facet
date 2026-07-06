---
"@facet/store-postgres": minor
---

Add `PostgresAssets`, a durable Postgres-backed `AssetsStore` adapter for
per-agent themes, stamps, and optional initial trees. `initSchema` now provisions
the matching `facet_assets` table alongside `facet_stage` and `facet_event`.
