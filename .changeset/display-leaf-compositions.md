---
"@facet/core": minor
"@facet/assets": minor
"@facet/react": minor
"@facet/agent-tools": minor
"@facet/reference-agent": patch
"@facet/quickstart": patch
---

Remove the `badge` and `alert` display leaves, publish concrete reference
examples in their place, and remove `divider` entirely (PR-5a of the node-model
restructure). Badges and alerts are no longer node types: `@facet/assets` ships
same-Brick Box/Text Presets for neutral and semantic badge/alert treatments.
Larger `DEFAULT_PATTERNS` demonstrate these treatments where relevant, but no
tone-only `badge*` or `alert*` Pattern names are exported. Agents compose the
corresponding box+text nodes with Presets and semantic tokens. A visual separator
is now a plain bordered box.

Breaking: the `badge`/`alert`/`divider` node types, their `BadgeNode`/
`AlertNode`/`DividerNode` interfaces, renderers, and executor entries, together
with retired asset policy
defaults, retired style selectors, and STAGE_SPEC node lines are removed. A stale
tree still carrying one of these types blank-degrades (the renderer skips it, the
validator drops it, the executor refuses to author it) — never throws.
