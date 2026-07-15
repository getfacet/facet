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

Composition reference datasets — complete the pre-1.0 hard cut from reusable
stage fragments to optional, concrete native-node examples. There are no
compatibility aliases: consumers that previously applied a composition as a
stage operation must instead read a selected example and author ordinary native
nodes with the existing stage tools.

- `@facet/core` now requires `metadata.description` on `FacetComposition`,
  accepts only self-contained native nodes, and removes the former parameter,
  nested-reference, dependency-graph, and composition-specific stage mutation
  surfaces. Catalog authoring order is only `component -> primitive`;
  composition policy controls reference exposure separately.
- `@facet/runtime` keeps validated compositions as concrete documents and skips
  invalid legacy shapes individually; `@facet/assets` ships concrete,
  self-contained `DEFAULT_COMPOSITIONS` examples.
- `@facet/agent-tools` adds the public
  `selectCompositionReferences(compositions, catalog?)` snapshot boundary and
  the exact-name, read-only `get_composition` tool. The system prompt receives
  only each exposed name and description; exposure stops deterministically at
  128 selected references so prompt and lookup stay aligned within the smallest
  context profile. A successful lookup returns the complete selected JSON
  without changing the stage, after which the model authors native nodes
  separately.
- `@facet/reference-agent` preserves an exact composition read through its next
  provider handoff and stops before a provider call if the complete context does
  not fit. `@facet/quickstart` follows the same index/read/author flow without
  sending composition JSON through browser or reconnect protocols.
- `@facet/agent` removes its composition-specific mutation method; use `render`,
  `set`, or `append` for native nodes. `@facet/store-postgres` keeps the same raw
  persistence contract while legacy documents are rejected by runtime asset
  validation.
