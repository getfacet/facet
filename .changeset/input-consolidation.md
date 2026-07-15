---
"@facet/core": minor
"@facet/react": minor
"@facet/agent-tools": minor
"@facet/reference-agent": minor
"@facet/assets": minor
---

Consolidate the input-capturing vocabulary (hard cutover — pre-1.0, breaking).

- **`field` → `input`.** The native input brick is renamed: node type
  `"field"` → `"input"`, and the exported types `FieldNode`/`FieldInput`/
  `FieldStyle`/`FIELD_INPUTS` → `InputNode`/`InputKind`/`InputStyle`/
  `INPUT_KINDS`. Behavior is byte-identical — same `name`/`input` kind/`options`/
  `label`/`placeholder`, same fail-safe on an unknown kind (→ default text).
- **`search` node type removed.** A search box is now `input:"search"` (that
  input kind already existed); a search box *with submit* is an `input` plus a
  pressable label box whose `onPress` carries `collect`. The
  standalone `search` node — and its `submitLabel`/`onSubmit`/`value` submit
  affordance — is gone. STAGE_SPEC + the prompt kit teach the new model.
- **Theme recipe follows the rename.** The top-level `field` brick recipe in
  `DEFAULT_THEME` is renamed → `input` (so the input brick keeps its default
  chrome); the theme-internal style-slot/sub-part named `field` is unchanged.

Migration: emit `type:"input"` instead of `type:"field"`; replace a `search`
node with `input:"search"` plus a pressable label box for submit. Password input values
remain excluded from collected event data. Pre-deploy hard cutover — stale
`field`/`search` trees fail-safe degrade (skipped), never throw.
