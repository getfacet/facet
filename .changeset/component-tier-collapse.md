---
"@facet/core": minor
"@facet/assets": minor
"@facet/react": minor
"@facet/agent-tools": minor
"@facet/reference-agent": patch
"@facet/quickstart": patch
"@facet/cli": patch
---

Complete the pre-1.0 node-model cutover to one closed vocabulary of 11 native
bricks: `box`, `text`, `media`, `input`, `richtext`, `table`, `chart`, `list`,
`keyValue`, `progress`, and `loading`. The six display bricks keep their existing
rendering and data behavior; only their former component-tier classification is
removed.

Breaking: remove the `button`, `form`, `filterBar`, `metric`, `tabs`, `nav`, and
legacy `stat` node types together with all component unions, registries,
validators, asset fields, renderer dispatch, tool-executor routes, and prompt
guidance. Core exposes one fixed Brick roster, and only `box` may have children.
Stale retired raw nodes blank-degrade in React, core validation drops
them, and stage tools reject them without throwing.

Persisted/operator assets must migrate atomically to one complete Theme, one
Pattern list, and an optional initial tree. Remove retired component policy and
style-selector keys, and rewrite stored trees and Patterns with the final Bricks
or box/text/input structures. There is no compatibility mapper; retired nodes in
trees or references are dropped or invalidate the document at their ordinary
validation boundary.

Add validated reference Patterns for actions, forms, filters, bound summary
values, and local navigation. These examples use ordinary box/text/input trees:
pressable label boxes for actions, `navigate` plus active-look predicates for
browser-local navigation and fixed filters, and `text.from` for bound values.
Pattern reads remain optional and never edit the stage.

Update the default quickstart tour, LLM prompt, tool-call budget, buffer
coherence, playground fixtures, documentation, and tests for native-brick-only
authoring.
