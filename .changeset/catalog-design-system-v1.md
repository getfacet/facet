---
"@facet/core": minor
"@facet/react": minor
"@facet/assets": minor
"@facet/runtime": minor
"@facet/agent-tools": minor
"@facet/reference-agent": minor
"@facet/quickstart": minor
"@facet/store-postgres": minor
"@facet/agent": minor
---

Add catalog + design-system v1 support across Facet.

`@facet/core` now exposes a closed v1 high-level brick vocabulary, theme
component recipes, bounded stamp metadata, and a validated `FacetCatalog` that
controls active theme policy, allowed bricks/variants/stamps, primitive
fallback, and agent authoring order. The primitive base remains available as the
universal fallback; raw HTML/JS/CSS and raw scalar styles remain disallowed.

`@facet/react`, `@facet/assets`, `@facet/runtime`, and
`@facet/store-postgres` now understand catalog/theme recipe/default stamp data.
`@facet/agent-tools`, `@facet/reference-agent`, and `@facet/quickstart` now pass
catalog guidance to LLMs and enforce catalog policy before emitting patches,
including catalog_policy-style rejections for disallowed bricks, variants,
stamps, and locked theme switches. `@facet/agent` accepts the expanded container
vocabulary when code-authored agents append nodes or use stamps.
