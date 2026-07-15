---
"@facet/core": minor
"@facet/assets": minor
"@facet/react": minor
"@facet/agent-tools": minor
"@facet/reference-agent": patch
"@facet/quickstart": patch
---

Demote the `badge` and `alert` display leaves to catalog compositions and remove
`divider` entirely (PR-5a of the node-model restructure). Badges and alerts are
no longer node types: `@facet/assets` ships per-tone `badge`/`badge-neutral`/
`badge-success`/`badge-warning`/`badge-danger` and `alert`/`alert-info`/
`alert-success`/`alert-warning`/`alert-danger` compositions in
`DEFAULT_COMPOSITIONS` that expand to box+text primitives with the same baked
tokens the old renderers produced. Agents reference them by name
(`{ "use": "badge-success" }`); a visual separator is now a plain bordered box.

Breaking: the `badge`/`alert`/`divider` node types, their `BadgeNode`/
`AlertNode`/`DividerNode` interfaces, renderers, executor entries, catalog
component defaults, theme recipes, and STAGE_SPEC node lines are removed. A stale
tree still carrying one of these types blank-degrades (the renderer skips it, the
validator drops it, the executor refuses to author it) — never throws.
