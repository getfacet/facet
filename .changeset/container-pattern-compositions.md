---
"@facet/core": minor
"@facet/assets": minor
"@facet/react": minor
"@facet/agent-tools": minor
"@facet/reference-agent": patch
"@facet/quickstart": patch
---

Remove the card, section, and empty-state container-pattern node types and
publish native Pattern references in their place (PR-5b of the node-model
restructure). `@facet/assets` now ships `card`, `section`, and `empty-state`
references backed entirely by concrete `box` and `text` nodes with closed inline
tokens; actions are pressable boxes containing label text. Agents may inspect
these examples as optional guidance and
then author ordinary native nodes; the read never inserts or mutates a stage.

Breaking: their public interfaces and discriminants, renderers, executor
entries, retired asset-policy defaults, style selectors, and STAGE_SPEC lines
are removed. `ContainerNode` is now `BoxNode`. External Themes, Pattern metadata,
and stored trees must replace the retired types with native nodes.
Stale raw nodes blank-degrade as whole subtrees in React, are
dropped by core validation, and are rejected by stage authoring tools without
throwing.
