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

Pattern reference datasets — complete the pre-1.0 hard cut from reusable
stage fragments to optional, concrete native-node examples. There are no
compatibility aliases: consumers read a selected Pattern and author ordinary
native nodes with the existing stage tools.

- `@facet/core` requires top-level `description` and `useWhen` on `FacetPattern`,
  accepts only self-contained native nodes, and removes the former parameter,
  nested-reference, dependency-graph, and reference-specific stage mutation
  surfaces. All 11 Bricks remain authorable; a Pattern is reference data only.
- `@facet/runtime` keeps validated Patterns as concrete documents and skips
  invalid legacy shapes individually; `@facet/assets` ships concrete,
  self-contained `DEFAULT_PATTERNS` examples.
- `@facet/agent-tools` adds the public
  `selectPatternReference(patterns, name)` snapshot boundary and the exact-name,
  read-only `get_pattern` tool. The system prompt receives
  only each exposed name, description, and useWhen; exact exposure is capped at
  64 Patterns so prompt and lookup stay aligned within the smallest
  context profile. A successful lookup returns the complete selected JSON
  without changing the stage, after which the model authors native nodes
  separately.
- `@facet/reference-agent` preserves an exact Pattern read through its next
  provider handoff and stops before a provider call if the complete context does
  not fit. `@facet/quickstart` follows the same index/read/author flow without
  sending Pattern JSON through browser or reconnect protocols.
- `@facet/agent` removes its Pattern-specific mutation method; use `render`,
  `set`, or `append` for native nodes. `@facet/store-postgres` keeps the same raw
  persistence contract while legacy documents are rejected by runtime asset
  validation.
