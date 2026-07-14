# Context: input-consolidation

Context evidence for consolidating the `field` primitive and the `search`
component node into a single `input` primitive. This document captures only the
evidence gathered by the context pass — it introduces no new facts.

## Summary of the change

- Rename the `field` primitive brick → `input` across core vocabulary, renderer,
  agent tooling, prompt/spec surfaces, default assets, and quickstart seeds.
- Remove the `search` component node entirely; its "input + submit + collect"
  behavior is decomposed into an agent-authored `input` + `button` composition
  (no built-in recipe).
- Keep the `"search"` value alive **only** as an input *kind* (the `FIELD_INPUTS`
  member value), never as a node `type`.

## Affected packages

- `@facet/core`
- `@facet/react`
- `@facet/agent-tools`
- `@facet/reference-agent`
- `@facet/assets`
- `@facet/quickstart`

## Code entrypoints (file:line)

### @facet/core

- `packages/core/core/src/nodes.ts:324-342` — `FIELD_INPUTS` const, `FieldInput`
  type, `FieldStyle` iface (166), `FieldNode` iface (`type:"field"`) → rename to
  `INPUT_KINDS` / `InputKind` / `InputStyle` / `InputNode`.
  `PRIMITIVE_BRICK_TYPES` (413) + `PrimitiveBrickNode` (415) list `"field"`.
- `packages/core/core/src/component-nodes.ts:22,226-228,287` — component type
  list has `"search"`; `SearchNode` interface (`type:"search"`) + union member →
  remove entirely.
- `packages/core/core/src/component-validation-control.ts:29,123` —
  `ControlComponentType` union includes `"search"`; `case "search"` validator
  branch → remove.
- `packages/core/core/src/primitive-node-validation.ts:29,37-38,246,252,508` —
  imports `FIELD_INPUTS` / `FieldInput` / `FieldStyle`, `fieldStyle` /
  `fieldOptions` helpers, `validateField()` → rename to input equivalents.
- `packages/core/core/src/spec.ts:10,17,34,44` — `STAGE_SPEC` lists field
  primitive line (17), search node line (34, remove), primitive-fallback list
  (10), and control-only mention (44); update to teach input + drop search.
- `packages/core/core/src/catalog-defaults.ts:61,83` — DEFAULT catalog entries
  `{ type:"search" }` (remove) and `{ type:"field" }` (→ input).

### @facet/react

- `packages/core/react/src/brick-renderer-inputs.tsx:103-142` — `renderSearch()`
  (role=search, type=search, submitLabel) → remove; `renderField()` nearby →
  rename `renderInput`.
- `packages/core/react/src/brick-render-registry.ts:24,92` — imports
  `renderSearch` / `renderField`; registry map key `search:{render:renderSearch}`
  (remove) and field entry (→ input).
- `packages/core/react/src/renderer-press.ts:65,115-116` — `addSearchField` +
  `if (node.type === "search")` snapshot branch → remove; field snapshot path
  stays under the new type name.
- `packages/core/react/src/brick-renderer-shared.ts` + `theme.ts` — field
  styling helpers → input rename.

### @facet/agent-tools

- `packages/agent-stack/agent-tools/src/executor-registry.ts:455-467` — `search:`
  executor entry (name-required, preview) → remove; field entry → input.
- `packages/agent-stack/agent-tools/src/specs.ts:8` — node-arg description lists
  primitives (…field…) + intrinsic components (…search…) → update.
- `packages/agent-stack/agent-tools/src/prompt-kit.ts:28-30` — prompt kit lists
  field primitive + search component in authoring guidance → update.

### @facet/reference-agent

- `packages/agent-stack/reference-agent/src/prompt/stage-summary.ts:104-110`
  (field summarizer, `type=field`), `197-200` (search summarizer, `type=search`,
  remove) — per-type summary handlers registry.

### @facet/assets

- `packages/core/assets/src/theme.ts:104-113` (field recipe), `369-390` (search
  recipe, remove) — `DEFAULT_THEME` recipe maps.
- `packages/core/assets/src/compositions.ts:294,302,430,439` —
  `DEFAULT_COMPOSITIONS` nodes with `type:"field"` → input.

### @facet/quickstart

- `packages/agent-stack/quickstart/src/guide-usecases.ts:19,27` and
  `guide-system.ts:212,224,232` — seed/guide trees author `type:"field"` → input.

### playground (unpublished)

- `apps/playground/src/print-tree.ts:36` (`case "field"`), `73` (`case "search"`,
  remove); `tree-builder.ts:81-91` (`field()` builder, `type:"field"`);
  `gallery.tsx` `field()` calls; `App.tsx` / `gallery.tsx` doc copy
  "box/text/media/field".

## Risk register

### RISK-INV-1 (INV) — two-writers coherence seam is TOUCHED (not OK as brief claims)

Invariant #6 (two-writers coherence) is TOUCHED, not OK as the brief claims
("collect mechanism unchanged"). The press-time field-value harvest string-matches
the node type: `packages/core/react/src/renderer-press.ts:96`
`if (node.type === "field")` gathers input names, and `:115-118`
`if (node.type === "search")` calls `addSearchField` (helper at `:65-70`). This
IS the invariant-#6 seam (its own docstring, `:30-42`, cites invariant #6). The
field→input rename MUST atomically flip `:96` to `node.type === "input"` and drop
the search branch + `addSearchField`. If `:96` is missed, `collectFieldValues`
silently returns `{}` — every submitted value is dropped with NO throw (fail-safe
hides it), i.e. silent UI-in data loss, strictly worse than the blank-render trap
the brief anticipates.

**Mitigation the spec must implement:** a Work Unit updating the
`collectFieldValues` type-guards in the same PR, plus a dedicated collect-path
test (currently DC-002/DC-004 only cover validate+render) asserting an `input`
node's mounted DOM value is harvested by `collectFieldValues` (and a
`type:"search"` node yields `{}` cleanly).

### RISK-INV-2 (INV) — password-exclusion (security) is TOUCHED

Invariant #6 / secret-exclusion coherence (security-relevant) is TOUCHED. The
password-value exclusion — passwords are never harvested into the agent action
event / third-party LLM / history replay — lives INSIDE the field branch at
`packages/core/react/src/renderer-press.ts:100`
`if (node.input === "password") return;` (guarded by the `node.type === "field"`
check at `:96`). A mechanical rename that flips the branch guard but drops or
mis-nests this check would leak password field values into the emitted event — a
regression neither render tests nor typecheck catch.

**Mitigation the spec must implement:** preserve the `input === "password"`
exclusion verbatim under the renamed `input` branch, and add an explicit test
that an `input:"password"` value is EXCLUDED from `collectFieldValues` output
(behavior-preservation coverage beyond DC-002's render-only scope).

### RISK-INV-3 (INV) — UI-in reachability of the decomposed search + non-atomic removal

Invariant #6/#1 (UI-in reaches the agent) is TOUCHED by the decomposition
decision, and the removal is not atomic across the composition machinery the
brief enumerates. Today `search` bundles input+submit+collect in one form; its
onSubmit harvests the co-located value because collect resolves to the search
node itself (`renderer-press.ts` `addSearchField` `:65-70`). Decomposing
"search+submit" into `input`+`button` requires the button's `onPress.collect`
(read at `packages/core/react/src/renderer-press.ts:231`) to point at a box
containing the `input`; if the agent omits it, the submit fires but harvests
nothing — the typed query never reaches the agent (silent UI-in loss). Since the
composition is agent-authored (no built-in recipe), the mitigation lives in
`STAGE_SPEC`/prompt-kit under DC-005: the teaching MUST show the submit button
needs `collect` wired to the input's container, or the pattern is functionally
broken.

Additionally the `search` handling in the composition machinery must be removed in
the SAME PR or a lagging search member blank-degrades (invariant-#6/atomicity):

- `packages/core/core/src/expand-composition-remap.ts:156` (`case "search"`
  onSubmit remap)
- `expand-composition-fill.ts:325` (`fillSearch`) + `:626` (`leavesSearch`)
- `component-validation-control.ts:29`/`:123` (`ControlComponentType` + validator)
- `catalog-defaults.ts:61`
- the `DEFAULT_COMPOSITIONS` `type:"field"` members at
  `packages/core/assets/src/compositions.ts:294,302,430,439` (must migrate to
  `type:"input"`, else the seeded compositions blank-degrade)

Grep-proven consumers; all must land atomically.

### RISK-API-1 (API) — BREAKING rename of @facet/core barrel type exports

BREAKING rename of `@facet/core` barrel type exports `FieldNode` / `FieldInput` /
`FieldStyle` / `FIELD_INPUTS` → `InputNode` / `InputKind` / `InputStyle` /
`INPUT_KINDS` (defined `packages/core/core/src/nodes.ts:166,325-346`, re-exported
via `index.ts:2` `export * from ./nodes.js`). CROSS-PACKAGE TYPE-IMPORT CONSUMER
(grep-proven, only one by name): `apps/playground/src/gallery.test.ts:2`
`import type { BoxNode, FieldNode, MediaNode } from "@facet/core"` and
`gallery.test.ts:37` `nodes.filter((n): n is FieldNode => n.type === "field")`.
Also `PRIMITIVE_BRICK_TYPES` (`nodes.ts:413`) and `PrimitiveBrickNode`
(`nodes.ts:415`) carry the `"field"`/`FieldNode` member.

**Resolution the spec must implement:** rename all four exported symbols + the
`PRIMITIVE_BRICK_TYPES` literal member `"field"`→`"input"`; migrate
`gallery.test.ts` import to `InputNode` and its narrow to `n.type === "input"`.
Keep the `FIELD_INPUTS` member value `"search"` (`nodes.ts:330`) — it is the
input KIND, not the removed node type.

### RISK-API-2 (API) — BREAKING removal of the `search` component node type

BREAKING REMOVAL of the `search` component node type from `@facet/core`:
`SearchNode` interface (`packages/core/core/src/component-nodes.ts:226`) and the
`"search"` member of the exported `ComponentNodeType` union
(`component-nodes.ts:22`, member of `ComponentNode` at `:287`) and
`ControlComponentType` (`component-validation-control.ts:29`). CROSS-PACKAGE
CONSUMER (grep-proven): `packages/agent-stack/reference-agent/src/prompt/stage-summary.ts:3`
`import { type ComponentNodeType }` and `:64`
`type SummarizableNodeType = PrimitiveBrickType | ComponentNodeType` — this drives
a handler Record whose keys include a `search:` entry (`stage-summary.ts:197`,
emits `type=search name=…`) and a `field:` entry (`:104`, emits `type=field`).
Removing `"search"` from the union makes the `search` Record key an excess-property
type error; the `PrimitiveBrickType` rename makes the `field` key invalid.

**Resolution:** delete the `SearchNode` type + all union members atomically in
core; in `stage-summary.ts` remove the `search` handler and rename the `field`
handler → `input` (and the `type=field` string → `type=input`).

### RISK-API-3 (API) — BREAKING published LLM-facing STAGE_SPEC string surface

BREAKING published LLM-facing string surface: `STAGE_SPEC` is exported from the
`@facet/core` barrel (`packages/core/core/src/index.ts:25`
`export * from ./spec.js`; const at `spec.ts:8`). It hardcodes the vocabulary:
`spec.ts:17` documents `- field: { "type":"field", … "input"?:(…"search"…) }` and
`spec.ts:34` documents a separate `- search: { "type":"search", … "submitLabel"?,
"onSubmit"?:Action … }` node. CONSUMER: reference-agent feeds `STAGE_SPEC` to the
model; DC-005 pins it via `spec.test.ts`.

**Resolution:** rewrite line 17 as `- input:` with `"type":"input"` (keep the
`"search"` value inside the input-kind enum), and DELETE line 34 (the search node)
entirely — the `"search"` token must survive ONLY as an input kind, never as a
`type`.

### RISK-API-4 (API) — BREAKING published DATA surfaces in @facet/assets + core catalog-defaults

BREAKING published DATA surfaces in `@facet/assets` (barrel
`packages/core/assets/src/index.ts` exports `theme.js`/`compositions.js`/
`catalog.js`) and `@facet/core` catalog-defaults. The default catalog lists a
`search` component: `packages/core/core/src/catalog-defaults.ts:61`
`{ type: "search", variants: ["default"], guidance: … }`. `DEFAULT_COMPOSITIONS`
embed `type: "field"` nodes: `packages/core/assets/src/compositions.ts:294,302,430,439`.
`DEFAULT_THEME` carries a `search` component recipe:
`packages/core/assets/src/theme.ts:369-390`. COUPLING: catalog entries are
validated against `ComponentNodeType` by `validateComposition` — a `search`
catalog entry left after core removes the type becomes a dangling/degrading entry.

**Resolution:** in the SAME PR remove the `search` catalog-defaults entry + the
`search` theme recipe block, and rename every composition `type:"field"`→
`type:"input"`; verify `DEFAULT_CATALOG`/`DEFAULT_COMPOSITIONS`/`DEFAULT_THEME`
re-validate clean.

### RISK-API-5 (API) — BREAKING string-literal `type:"field"`/`type:"search"` handling across published packages

BREAKING string-literal `type:"field"`/`type:"search"` handling in published
runtime/agent packages that the brief lists but the spec must enumerate as
concrete edits (each is a live switch/Record arm; a missed one blank-degrades).
PROVEN production (non-test) sites:

- `@facet/react` — `renderer-render.tsx:607` `case "field"`; `renderer-press.ts:96`
  (`node.type === "field"`) and `:115` (`node.type === "search"`);
  `renderer-motion.ts:218` `case "field"`; `brick-render-registry.ts:36`
  `BrickRendererType = ComponentNodeType | "field"` (NOTE: `brick-render-registry`
  is NOT in the `@facet/react` barrel — `index.ts` only re-exports
  `StageRenderer`/`useFacet`/theme/`ChatDock`/view-snapshot — so
  `BrickRendererType`/`BRICK_RENDERERS` are package-internal, not a public break);
  `brick-renderer-inputs.tsx:111`/`407` (`componentRecipe(theme,"search"|"field")`).
- `@facet/agent-tools` — `executor-registry.ts:182`
  `'a "field" node needs a string "name"'` and `:460`
  `'a "search" node needs a string "name"'`.
- `@facet/reference-agent` — `stub.ts:38,44` `type:"field"`.
- `@facet/quickstart` seed — `guide-system.ts:212,224,232` +
  `guide-usecases.ts:19,27`.
- `apps/playground` — `print-tree.ts:36` `case "field"`; `tree-builder.ts:91`
  `type:"field"`.

**Resolution:** rename every `field`→`input` arm and DELETE every `search` arm
atomically across these packages in one PR (DC-003).

### RISK-API-6 (API) — GAP: coupled public styling slot `field` omitted by DC-001

GAP: a coupled PUBLIC styling surface the brief's rename list (DC-001) OMITS,
risking a silent visual regression. `@facet/react` exports `fieldStyle`
(`theme.ts:547`, barrel `index.ts:3`) and the theme type
`ComponentRecipePart["field"]` (`theme.ts:207-209` iterates the fixed
styleable-slot set `["box","text","media","field"]`); the resolver reads it at
`recipe-parts.ts:56` `recipeStyleBundle(part, "field")`. The matching
`@facet/assets` DATA writes those bundles:
`theme.ts:106/111/113/373/376/377/385/389/390` all key `field: { width: "full" }`
(and note `:113`/`:377` also use a PART-name key `input:` — so renaming the
styleable slot field→input would COLLIDE with the existing `input` part name).
This `field` styleable-slot key is a DIFFERENT namespace from the node
`type:"field"`, is not in DC-001, and shares the token name.

FAILURE SCENARIO if an implementer over-renames: react resolver looks up slot
`"input"` while assets data still provides slot `"field"` (or vice-versa) →
`recipeStyleBundle` returns undefined → EMPTY_PART → inputs silently lose
`width:full` styling (fail-safe, no throw, but wrong render).

**Resolution the spec MUST state explicitly:** KEEP the react styleable-slot key +
`fieldStyle` fn named `field` (cleanest — the brief already scopes out styling
sweeps, and the slot collides with the `input` part name), OR rename it to
`input` atomically across BOTH react (`theme.ts`/`recipe-parts.ts`) AND assets
(`theme.ts` data) with the part-name collision resolved. Do not leave it
undecided.
