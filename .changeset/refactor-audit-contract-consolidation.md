---
"@facet/core": minor
"@facet/agent-tools": patch
"@facet/react": patch
"@facet/store-postgres": patch
---

Consolidate contract logic identified by the repository structural audit.

- Core now owns property-specific style choices and screen-root resolution, so
  validators, discovery tools, and the React renderer use one closed decision.
  The tree validation result type is now the subject-qualified
  `TreeValidationResult`.
- Agent style discovery no longer advertises `inherit` where the corresponding
  property rejects it, and React reuses one defensive raw-value helper set.
- Postgres `initSchema` provisions all four persistence tables, including the
  rolling-summary table.
- Resource-boundary tests exercise small injected limits instead of repeatedly
  materializing production-sized hostile inputs.
