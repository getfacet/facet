---
"@facet/agent-tools": minor
"@facet/reference-agent": patch
"@facet/quickstart": patch
---

Add `@facet/agent-tools` as the reusable provider-agnostic Facet stage tool
package, including canonical tool specs, execution, inspection, result types,
and local stage-shadow helpers.

`@facet/reference-agent` now consumes that shared tool layer while preserving
its public compatibility exports. `@facet/quickstart` continues composing the
reference agent from the grouped `packages/agent-stack/*` package layout.
