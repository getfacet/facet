---
"@facet/agent": minor
"@facet/agent-tools": minor
"@facet/assets": minor
"@facet/core": minor
"@facet/quickstart": minor
"@facet/reference-agent": minor
"@facet/runtime": minor
"@facet/store-postgres": minor
---

Pattern canonicalization — the legacy reusable-fragment API is fully replaced
by optional, read-only Pattern references, intentionally with no compatibility
aliases. `@facet/core` exposes `FacetPattern` and `validatePattern`;
`@facet/assets` ships `DEFAULT_PATTERNS`; `@facet/runtime` loads one exact
`patterns.json` list into `AssetDocuments.patterns`; agent packages advertise a
validated name/description/useWhen index and the read-only `get_pattern` tool;
and `@facet/store-postgres` persists the per-agent list in a `patterns` JSONB
column. Consumers inspect a Pattern when useful and author ordinary stage nodes
separately.
