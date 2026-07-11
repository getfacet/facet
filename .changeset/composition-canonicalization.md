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

Composition canonicalization — the legacy reusable-fragment API is fully
replaced by the canonical composition vocabulary, intentionally with NO
compatibility aliases (the replaced surface was never released). `@facet/core`
exposes `FacetComposition`, `validateComposition`, and `expandComposition`;
`@facet/assets` ships `DEFAULT_COMPOSITIONS`; `@facet/runtime` loads
`*.composition.json` documents into `AssetDocuments.compositions`;
`@facet/agent-tools`, `@facet/reference-agent`, and `@facet/quickstart`
advertise and execute the `use_composition` tool; `@facet/agent` adds
`Stage.useComposition`; and `@facet/store-postgres` persists per-agent
compositions in a `compositions` JSONB column. The old identifiers are removed
outright — consumers migrate to the composition names.
