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

Add the first closed design-system contract across Facet.

`@facet/core` exposes the closed 11-Brick vocabulary, one complete Theme,
Brick-owned Presets, and concrete Pattern reference data. Every Brick remains
available; per-agent assets are exactly one Theme plus one Pattern list and an
optional initial tree. Raw HTML/JS/CSS and raw scalar styles remain disallowed.

`@facet/react`, `@facet/assets`, `@facet/runtime`, and
`@facet/store-postgres` understand the exact Theme/Pattern asset boundary.
`@facet/agent-tools`, `@facet/reference-agent`, and `@facet/quickstart` pass
compact Pattern, Preset, and Brick indexes to LLMs and expose exact read-only
discovery tools. The agent always authors ordinary Bricks after discovery.
`@facet/agent` accepts the closed native-brick vocabulary when code-authored agents
render, set, or append native nodes.
