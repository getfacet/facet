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

`@facet/core` now exposes a closed 11-brick vocabulary, theme brick recipes,
concrete composition reference data, and a validated
`FacetCatalog` that controls active theme policy, allowed bricks/variants,
composition-reference exposure, and compact/edit guidance. Raw HTML/JS/CSS and
raw scalar styles remain disallowed.

`@facet/react`, `@facet/assets`, `@facet/runtime`, and
`@facet/store-postgres` now understand catalog/theme recipe/default composition
reference data. `@facet/agent-tools`, `@facet/reference-agent`, and
`@facet/quickstart` now pass catalog guidance and a name-description reference
index to LLMs. Catalog policy governs brick, variant, and theme mutations while
composition policy limits which concrete references may be read on demand.
`@facet/agent` accepts the closed native-brick vocabulary when code-authored agents
render, set, or append native nodes.
