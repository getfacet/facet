---
"@facet/core": minor
"@facet/runtime": minor
"@facet/agent-tools": minor
"@facet/agent": minor
---

Composition nesting — a catalog composition can reference another composition, so
shared structure stays DRY instead of being inlined.

- **Reference shape (closed):** a composition's `nodes` map may contain a
  `{ use: <name>, slots?: Record<string,string> }` reference node. Its `slots` are
  the same bounded static strings as slot defaults (no expressions — the no-DSL
  line holds), and the reference shape is admitted **only** inside composition
  definitions — `validateTree` never accepts it, so a reference node is
  structurally impossible in the live stage.
- **Recursive expansion → primitives only.** `expandComposition` resolves each
  `{ use }` reference (via an additive optional `compositions` registry option),
  down to primitive/native-brick nodes; no reference node ever reaches the
  visitor. Both live call-sites (the agent-tools executor and the in-process
  `Stage`) thread the registry and carry a catalog-independent residual-reference
  backstop.
- **Load-time graph validation.** `validateCompositionGraph` (new, exported)
  validates the whole reference graph when the catalog loads: cycles, dangling
  references, and over-depth/over-size chains refuse the affected compositions
  before any agent can use them — a bad graph never reaches a visitor. Fail-safe:
  never throws; bounded issues.

Additive — existing non-nested compositions and 4-arg `expandComposition(...)`
calls are unchanged. This unblocks demoting the component tier to compositions
(components that embed each other can reference instead of inline).
