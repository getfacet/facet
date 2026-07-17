---
"@facet/core": minor
"@facet/assets": patch
"@facet/runtime": patch
"@facet/react": patch
"@facet/agent-tools": patch
"@facet/quickstart": patch
"@facet/agent": patch
---

Apply the repository-wide P2/P3 refactor audit cleanup: centralize tree-field,
JSON Pointer, runtime asset-issue, Quickstart navigation, and React style
projection logic; make Theme validation report contrast warnings; separate the
tool-neutral stage contract from agent-runner instructions; remove dead aliases
and helpers; and split the renderer interaction regression suite by concern.

`@facet/core` additionally exports `escapeJsonPointerToken` so patch-producing
packages share the same RFC 6901 token escaping implementation.
