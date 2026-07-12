---
"@facet/agent-tools": patch
"@facet/reference-agent": patch
"@facet/quickstart": patch
"@facet/bridge": patch
---

Clarify agent-stack ownership ahead of the first release. Reference-agent now
uses canonical `Reference*` implementation names while keeping the existing
`Quickstart*` compatibility aliases, and test-only compaction controls are no
longer part of its public options. Quickstart drops unpublished compatibility
modules and duplicated suites, agent-tools shares deterministic structural
comparison and splits its executor by responsibility, and bridge runners share
one internal event-prompt builder. Oversized agent-stack production modules are
split into cohesive internal modules without changing public behavior.
