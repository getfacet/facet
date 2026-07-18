---
"@facet/agent-tools": patch
"@facet/reference-agent": minor
"@facet/quickstart": minor
"@facet/bridge": patch
---

Clarify agent-stack ownership ahead of the first release. Reference-agent now
uses only canonical `Reference*` implementation names; the `Quickstart*`
factory and option names move to `@facet/quickstart`, with no aliases left in
`@facet/reference-agent`. Test-only compaction controls are no longer part of
the public options. Quickstart also drops unpublished compatibility modules and
duplicated suites, agent-tools shares deterministic structural comparison and
splits its executor by responsibility, and bridge runners share one internal
event-prompt builder. Oversized agent-stack production modules are split into
cohesive internal modules.
