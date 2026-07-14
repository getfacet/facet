# Context: composition-nesting

Evidence gathered by the context pass for the `composition-nesting` feature —
letting a composition's node map reference another composition (a
`{ use, slots }` reference node) that expands recursively to primitive/native
bricks server-side. This document is the spec writer's factual input. Do not
treat any statement here as a design decision; it records what exists today and
the constraints any design must honor.

## Affected packages

- `@facet/core`
- `@facet/runtime`
- `@facet/agent-tools`
- `@facet/assets`

An additional direct consumer surfaces in the risk register and must be brought
into scope by the spec (see RISK-PKG-1):

- `@facet/agent` (`packages/extensions/agent`) — calls `expandComposition`
  directly.

## Code entrypoints

- `/Users/hoon/workspace/apps/facet/packages/core/core/src/composition-validation.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/expand-composition-core.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/expand-composition-fill.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/tree-validation.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/nodes.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/validate.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/runtime/src/assets.ts`
- `/Users/hoon/workspace/apps/facet/packages/agent-stack/agent-tools/src/executor-page.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/assets/src/compositions.ts`

## Risk register

### RISK-INV-1 (INV) — Shared sanitizer coupling (INVARIANT #6 two-writers coherence + #2 / DC-006)

The composition node map is sanitized by `sanitizeNodeMap` / `sanitizeNode`,
which is the SAME code path `validateTree` uses for the LIVE stage tree. Seam:
`packages/core/core/src/composition-validation.ts:144` calls
`sanitizeNodeMap(input.nodes, issues, { allowSlotMarkers: true })` while
`packages/core/core/src/tree-validation.ts:272` calls
`sanitizeNodeMap(input.nodes, issues)` with NO options; the option interface is
`SanitizeNodeOptions` at
`packages/core/core/src/primitive-node-validation.ts:305`.

If the spec teaches the shared sanitizer to admit the new `{ use, slots }`
reference shape UNCONDITIONALLY, then `validateTree` would also accept a
reference node authored directly into the live stage — but the client/renderer
has NO composition catalog, so a reference node either resolves nowhere
(server/client drift = two-writers break) or ships as a phantom `composition`
node type that must never exist in the stage (violates DC-005/DC-006 and the
closed-vocabulary invariant #1).

MITIGATION the spec MUST implement: gate the reference shape behind a NEW
composition-only option (e.g. `allowReference?: boolean`) added to
`SanitizeNodeOptions`, passed ONLY from `validateComposition` exactly as
`allowSlotMarkers` is — never from `validateTree` (which stays option-less at
tree-validation.ts:272). References MUST be fully resolved to primitive/native
nodes server-side during expansion BEFORE any tree is validated or any patch is
emitted, so a reference node type is structurally impossible to reach the
stage/client. Backstop already present: expanded output is re-checked against
the catalog at `packages/agent-stack/agent-tools/src/executor-page.ts:167`
(`nodesCatalogViolation`), which the spec should keep as the defensive fail-safe
for any residual unresolved reference.

### RISK-INV-2 (INV) — No catalog-level graph pass exists, and expansion has no resolver (INVARIANT #1 fail-safe + #3 validate-before-use)

Cycle (`card→badge→card`) and dangling-reference (`card→badge` with no `badge`)
detection is STRUCTURALLY IMPOSSIBLE where validation currently lives, because
compositions are validated ONE AT A TIME in isolation: the runtime load loop at
`packages/core/runtime/src/assets.ts:314-375` calls `validateComposition(raw)`
per document and appends each result to a flat `compositions[]` list (line 367)
— no pass ever sees the full set of names, so a per-doc validator cannot resolve
a reference or find a cycle (DC-002/DC-003 cannot be satisfied by extending
`validateComposition(input)` alone).

Compounding seam: `expandCompositionInner` at
`packages/core/core/src/expand-composition-core.ts:22-95` receives a SINGLE
`composition` object and has NO access to the catalog/registry of other
compositions (call site
`packages/agent-stack/agent-tools/src/executor-page.ts:147-154` passes only the
one found composition), so it cannot expand a `{ use: 'badge' }` reference at all
today.

MITIGATION the spec MUST implement:
(a) add a NEW catalog-level graph-validation pass that runs AFTER all
compositions are collected+deduped (after assets.ts:375) — build the reference
graph, refuse/prune any composition on a cycle, dangling ref, or over-depth
chain with a bounded issue (fail-safe, never throws);
(b) thread a composition resolver/registry (name → validated composition) INTO
`expandComposition`/`expandCompositionInner` as a new parameter so references
resolve recursively to primitives, keeping the load-time graph pass as the
primary gate and a defensive visited-set + depth cap at expand-time as the
never-throw backstop (mirroring the existing `reachableComposition` +
`MAX_EXPANDED_NODES` guards at expand-composition-core.ts:60-77).

### RISK-INV-3 (INV) — Reference shape admission + slot-value bounding (INVARIANT #1 backend/UI-out + #2 no-DSL)

`inspectCompositionNodes` at
`packages/core/core/src/composition-validation.ts:184-211` currently REFUSES any
node whose `type` is not a known brick (`isAllowedCompositionNodeType`, line
204) and refuses a fixed `FORBIDDEN_COMPOSITION_FIELDS` set (line 27-47: `url`,
`fetch`, `binding`, `expression`, `query`, `resolver`, …) — so a
`{ use, slots }` reference node is rejected today (correct fail-safe, but blocks
the feature).

MITIGATION the spec MUST implement: extend `inspectCompositionNodes` /
`isAllowedCompositionNodeType` to admit a CLOSED reference shape
`{ use: <name>, slots?: Record<string,string> }` ONLY (no other keys survive),
and route its `slots` values through the SAME bounded-string sanitizer used for
composition slot defaults at `sanitizeCompositionSlots`
(composition-validation.ts:354-388: `MAX_FIELD_VALUE_CHARS` truncation,
`isValidSlotName` gate, forbidden-key drop). This keeps reference slot values as
bounded static strings — never expressions/conditionals/loops — so the no-DSL
line (#2) and the UI-out/no-backend line (#1) hold; the reference must carry no
`url`/`fetch`/`binding`/`query`/`resolver` field (keep it inside the
FORBIDDEN_COMPOSITION_FIELDS regime).

Note: invariant #5 (flow-only/overlay) is genuinely OK for this feature —
expansion yields the same primitive nodes with no positioning change — no
mitigation required there.

### RISK-API-1 (API) — `expandComposition()` registry-threading: hidden runtime break at both live call-sites

Current signature
`expandComposition(composition: unknown, params, at, options: {existingIds?, mintId?})`
at `packages/core/core/src/expand-composition.ts:27-40` expands ONE
self-contained composition; it has no way to look up a `{use:<name>}`
reference's target. Nested expansion requires a compositions registry/lookup
passed in. The TWO non-core call-sites are:
`packages/agent-stack/agent-tools/src/executor-page.ts:147-154` (passes only
`{existingIds: Object.keys(shadow.nodes)}`) and
`packages/extensions/agent/src/stage.ts:86` (passes only
`{existingIds: this.knownIds}`).

Resolution the spec MUST implement: add the registry as an OPTIONAL field on
`ExpandCompositionOptions` (e.g. `compositions?: readonly FacetComposition[]` or
a name->comp map) so existing 4-arg calls still typecheck (additive), BUT update
BOTH call-sites to pass the full loaded compositions list — otherwise a
composition containing a reference node silently degrades/drops the reference at
expand for the live agent-tools executor and the in-process Stage. Both sites
already hold the compositions list nearby (executor-page receives
`compositions: readonly FacetComposition[]` at line 73; assets/runtime owns the
loaded array), so threading is mechanical but mandatory.

Grep proof: only these two sites call `expandComposition(` outside core/test
(verified via `grep -rn 'expandComposition(' packages apps` excluding
core+tests).

### RISK-API-2 (API) — `validateComposition()` cannot detect cycles/dangling refs in isolation: the load path must change

Current signature
`validateComposition(input: unknown): CompositionValidationResult`
(`packages/core/core/src/composition-validation.ts:99`) validates a SINGLE
composition with no knowledge of sibling compositions; the brief asks it to
check the reference graph (no cycle a->b->a, all refs resolve, bounded depth),
which is inherently cross-composition. Sole load-time consumer:
`packages/core/runtime/src/assets.ts:317` calls `validateComposition(raw)`
inside a per-document loop (loadComposition at line 314) that validates each comp
independently, defaults-then-custom, with no assembled set.

Resolution the spec MUST pick and implement: EITHER
(a) add an optional second parameter carrying known composition names/registry —
`validateComposition(input, knownNames?)` — which is source-additive (single-arg
calls still compile) but insufficient alone because the per-comp loop doesn't yet
know later/custom names, so it forces a SECOND graph pass; OR
(b, cleaner) keep `validateComposition` per-comp and add a NEW additive export
`validateCompositionGraph(compositions): {issues}` invoked in assets.ts AFTER the
load loop (line 375) to refuse cyclic/dangling/over-depth comps (splice them out
of the `compositions` array + push bounded issues, mirroring the existing
dedupe/shadow removal at line 340-341).

Barrel export goes through `packages/core/core/src/validate.ts:9` (where
`validateComposition` is re-exported today).

### RISK-API-3 (API) — `FacetComposition.nodes` must widen to admit a non-`FacetNode` reference shape, confined so it doesn't leak into post-expansion node-map types

Today `FacetComposition.nodes: Readonly<Record<NodeId, FacetNode>>`
(`packages/core/core/src/composition-validation.ts:69`). A reference node
`{use:name, slots?:{..strings}}` is authored INSIDE a composition's node map but
must NOT be a `FacetNode` union member (DC-005/DC-006 forbid it reaching
validateTree/renderer/executor).

Resolution: define+export a closed `CompositionRef` type and widen ONLY
`FacetComposition.nodes` to `Record<NodeId, FacetNode | CompositionRef>`, while
`ExpandCompositionResult.nodes`
(`packages/core/core/src/expand-composition.ts:18`) and `UseCompositionResult`
STAY `Record<NodeId, FacetNode>` (expansion yields primitives only).

Additive-safe for PRODUCERS: the default composition data in
`packages/core/assets/src/compositions.ts:9` (`readonly FacetComposition[]`, node
maps at lines 28, 64, 91, 122, 198, 231, 285, 337, 385, 421) and
`packages/core/assets/src/composition-chart-table.ts:3` currently hold pure
FacetNode values — still assignable to the widened union.

Additive-safe for CONSUMERS at compiler level: verified no code outside
`@facet/core` iterates a raw pre-expansion `composition.nodes` —
`packages/extensions/agent/src/stage.ts:94` and
`packages/agent-stack/agent-tools/src/executor-page.ts:167,191` iterate
`expanded.nodes` (the ExpandCompositionResult, pure FacetNode), not the source
composition.

Export the new `CompositionRef` through
`packages/core/core/src/validate.ts` (same barrel as `FacetComposition`,
index.ts:11 `export * from ./validate.js`) so `@facet/assets` can author
references typed.

### RISK-API-4 (API) — The reference node must be kept OUT of every published brick/catalog union or it leaks to the stage

`FacetNode` / `PRIMITIVE_BRICK_TYPES` / `COMPONENT_NODE_TYPES` /
`CATALOG_BRICK_TYPES` (`packages/core/core/src/catalog-types.ts:13-16`) and the
composition node-type allow-list `isAllowedCompositionNodeType`
(`packages/core/core/src/composition-validation.ts:204-211`) currently admit only
primitives+components (+legacy `image`). If a `CompositionRef` type is added to
`FacetNode` or to these lists, it would:
(1) become an authorable STAGE node the agent could emit (violates DC-006 — the
executor `validateTree` at `packages/agent-stack/agent-tools` would accept it),
and
(2) surface in the prompt's `composedOf` metadata list
(`COMPOSITION_METADATA_NODE_TYPES` derives from those unions,
composition-validation.ts:270-272).

Resolution the spec MUST implement: recognize the reference shape ONLY inside
`inspectCompositionNodes`/`sanitizeNodeMap` for composition DEFINITIONS (a new
dedicated branch), never add it to `FacetNode`, `PRIMITIVE_BRICK_TYPES`,
`COMPONENT_NODE_TYPES`, `CATALOG_BRICK_TYPES`, or
`COMPOSITION_METADATA_NODE_TYPES`; and confirm `validateTree` (the stage gate)
still rejects a stage-authored reference node (fail-safe skip).

Additive note: `packages/agent-stack/agent-tools/src/types.ts:93`
(`compositions?: readonly FacetComposition[]`) and
`packages/agent-stack/reference-agent/src/prompt/system.ts:48` pick up the
widened `FacetComposition` additively — verified the prompt path
(prompt-kit.ts `compositionLine` at :281-292) reads only
name/description/top-level `slots` names/metadata, never `.nodes`, so reference
nodes never reach the LLM prompt.

### RISK-PKG-1 (PKG) — `expandComposition` needs a composition-registry, but a direct consumer omitted from the affected-package list calls it with no registry

`expandComposition`'s public signature must gain a composition-registry/lookup so
it can resolve `{use: <name>}` reference nodes into sibling compositions — but a
DIRECT consumer omitted from the affected-package list
[@facet/core, @facet/runtime, @facet/agent-tools, @facet/assets] calls it with a
single composition and NO registry.

Evidence: `packages/extensions/agent/src/stage.ts:86`
`expandComposition(composition, params, at, { existingIds: this.knownIds })`
inside `useComposition` (stage.ts:80) has no access to the full composition set
(`@facet/agent` package.json depends only on `@facet/core`; grep shows no
`compositions` list in stage.ts). By contrast
`packages/agent-stack/agent-tools/src/executor-page.ts:147` already receives
`compositions: readonly FacetComposition[]` (param at executor-page.ts:73) and
can thread it.

Resolution the spec MUST implement:
(a) add `@facet/extensions/agent` to the affected-consumer scope, AND
(b) make the registry an OPTIONAL field on `ExpandCompositionOptions`
(`packages/core/core/src/expand-composition.ts:22`) so absent-registry callers
compile unchanged and any reference node fail-safe-skips/degrades (never throws)
— preserving backward compat for the non-nested path (DC-006/DC-007).
Thread the registry from executor-page.ts:147 and stage.ts:86.

### RISK-PKG-2 (PKG) — Catalog-wide reference-graph validation cannot live inside per-composition `validateComposition`

Catalog-wide reference-graph validation (cycle/dangling/depth) cannot live inside
the per-composition `validateComposition(input: unknown)`
(`packages/core/core/src/composition-validation.ts:99`) because the runtime load
path calls it ONE composition at a time in a loop —
`packages/core/runtime/src/assets.ts:317` `result = validateComposition(raw)`
inside loadComposition, and there is no catalog-wide pass after the loop.
Cycle/dangling detection needs the full assembled set
(`compositions: FacetComposition[]`, assets.ts:311).

Resolution: spec MUST add a NEW pure catalog-level function in `@facet/core`
(e.g. `validateCompositionGraph(compositions)`) or a `knownNames` context param,
EXPORT it through the barrel chain composition-validation.ts →
`packages/core/core/src/validate.ts:9`
(`export { validateComposition } from "./composition-validation.js"`) → index.ts
(`export * from "./validate.js"` at
`packages/core/core/src/index.ts:11`), and WIRE the call at the load site in
runtime/assets.ts AFTER the per-composition loop assembles `compositions`.
Dependency direction stays runtime→core (no cycle introduced; runtime already
depends on `@facet/core`).

### RISK-PKG-3 (PKG) — The graph validator must receive compositions as DATA and MUST NOT import `DEFAULT_COMPOSITIONS` from `@facet/assets`

`@facet/core` is dependency-free (verified:
`packages/core/core/package.json` has no dependencies block; every `@facet/*`
mention under `packages/core/core/src` is a code COMMENT, not an import — grep
confirmed in data-binding.ts / protocol.ts / stage-fold.ts / tree.ts /
theme-validation.ts). The default+custom composition set is assembled in the
runtime, not core: `DEFAULT_COMPOSITIONS` lives in
`packages/core/assets/src/compositions.ts:9` and assets→core is the ONLY allowed
direction (`packages/core/assets/package.json` depends on `@facet/core`).

Resolution: spec MUST keep the new validator pure (compositions passed in as an
argument); adding a core→`@facet/assets` import to reach the defaults would break
core's dependency-free invariant AND create an assets↔core import cycle. The
graph must be validated over the runtime-assembled array (assets.ts:311), never
by core reaching into assets.

### RISK-PKG-4 (PKG) — New public surface must be threaded through core's barrel; the expand-composition surface uses an EXPLICIT NAMED export list

New public surface (the closed reference-node shape type and the catalog
graph-validator) must be threaded through core's barrel, and the
expand-composition surface uses an EXPLICIT NAMED export list — not `export *` —
so a new type is easy to omit.

Evidence: `packages/core/core/src/index.ts:13-20` re-exports `expandComposition`
+ its types by name
(`export { expandComposition } ...` / named type block), and
`packages/core/core/src/validate.ts:9,14` re-exports `validateComposition` and
`CompositionValidationResult` / `FacetComposition` by name from
composition-validation.js.

Resolution: spec MUST enumerate the exact barrel additions (new reference-node
type + graph-validator fn/result type) at
`packages/core/core/src/validate.ts` and
`packages/core/core/src/expand-composition.ts`, and confirm they surface through
index.ts, so consumers (runtime/assets.ts, agent-tools/executor-page.ts) can
import them — a Definition-of-Done requirement (new public API exported through
the barrel index.ts).
