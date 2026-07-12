# Context: tree-data-bindings

Context evidence for the `tree-data-bindings` feature. This doc is the input to
`/spec-bridge`. It records only what the context pass found — file:line
anchors, cross-package consumers, and the risk register. It does not invent
design decisions; open decisions are called out explicitly in the risks.

## Feature intent (one-liner)

Introduce a per-tree `data` warehouse plus a per-node `from` binding: a node
(table/chart/list/metric/stat/keyValue) may bind to a named local dataset in
`tree.data` instead of (or in addition to) carrying its values inline. `from`
is a plain dataset **name**, never a URL/source/fetch. Precedence
(Decision Lock): `from` present ⇒ `from` wins over inline; deterministic.

## Affected packages

- `@facet/core`
- `@facet/react`
- `@facet/agent-tools`
- `@facet/reference-agent`
- `@facet/agent`
- `@facet/ag-ui`

## Code entrypoints

- `/Users/hoon/workspace/apps/facet/packages/core/core/src/tree.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/component-nodes.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/tree-validation.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/classic-component-validation.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/spec.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/index.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/core/src/stage-fold.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/react/src/brick-renderer-types.ts`
- `/Users/hoon/workspace/apps/facet/packages/core/react/src/renderer-render.tsx`
- `/Users/hoon/workspace/apps/facet/packages/core/react/src/brick-renderer-layout.tsx`
- `/Users/hoon/workspace/apps/facet/packages/core/react/src/brick-renderer-chart.tsx`
- `/Users/hoon/workspace/apps/facet/packages/core/react/src/brick-renderer-data.tsx`
- `/Users/hoon/workspace/apps/facet/packages/agent-stack/agent-tools/src/prompt-kit.ts`
- `/Users/hoon/workspace/apps/facet/packages/agent-stack/reference-agent/src/prompt/system.ts`
- `/Users/hoon/workspace/apps/facet/packages/extensions/agent/src/stage.ts`
- `/Users/hoon/workspace/apps/facet/packages/extensions/ag-ui/src/events.ts`

## Risk register

### RISK-INV-1 (INV) — data sanitizer must live inside `validateTree`

Invariant #6 (two-writers coherence) + #2 (no-drift). The data sanitizer MUST
live inside `validateTree` (`@facet/core`), because `foldPatchIntoStage`
(`packages/core/core/src/stage-fold.ts:153` `validateTree(raw)`) is the ONE fold
run identically on server (runtime store) AND client (`@facet/react`
`useFacet`) — its docstring at `stage-fold.ts:33-39` states this is what
prevents drift.

BUT `validateTreeUnsafe` RECONSTRUCTS the output tree from a fixed field list
`{root, nodes, theme?, screens?, entry?}` at
`packages/core/core/src/tree-validation.ts:325-349` and never copies an unknown
top-level `data` field — so today `data` is silently STRIPPED on the first
fold. Consequence: a subsequent `/data/sales` patch (DC-002) hits a missing
container and is dropped by per-op salvage; the feature is inert.

Resolution the spec must implement: add a pure `sanitizeDataWarehouse` (closed
`Array<Record<string, string|number|boolean>>` schema, name-length cap,
forbidden-key-safe, non-recursive, per-dataset row/cell caps reusing
`MAX_TABLE_ROWS`/`MAX_TABLE_CELL_CHARS`) called inside `validateTreeUnsafe`, and
copy the survivor onto the returned tree object at
`tree-validation.ts:325-349` — NEVER only in the renderer, or server-stored
tree and client tree diverge (breaks #2/#6).

### RISK-INV-2 (INV) — `from` is a bounded dataset NAME, never a URL/source/resolver

Invariant #1 (responsibility boundary: UI-out, no backend/fetch). `from` must be
validated as a plain bounded dataset-NAME string only. Two seams:

- **(a) Per-node sanitizers drop `from`.** They RECONSTRUCT each node from a
  fixed known-field set and DROP `from`: table/chart at
  `packages/core/core/src/classic-component-validation.ts:104-134`, list at
  `:185`, metric/stat via `metricNode` at `:209`, plus `keyValue` in
  `component-validation.ts`. The spec must add per-node `from` copy+validation in
  each of these (string, length-capped like a dataset name, forbidden-key-safe)
  so a bound node actually carries `from`.
- **(b) Keep the no-fetch surface.** Grep confirms NO fetch/XMLHttpRequest/http
  surface exists in `packages/core/react/src/brick-renderer-*.tsx` today — the
  mitigation is to keep it that way: the validator must reject any non-name
  `from` value and the spec must forbid introducing a resolver. `from` is the
  same trust tier as inline `rows`, just a name into the local warehouse.

### RISK-INV-3 (INV) — content gates must resolve `from`, not read inline only

Invariant #3 (fail-safe) + seed/offline coherence.
`treeHasContent`/`treeRenderableNodeIds` (`packages/core/core/src/tree.ts:83-97`,
`nodeRendersItself` at `:161-223`) decide "shows something real" from INLINE
data only and have no access to `tree.data`. `chartHasRenderableData`
(`tree.ts:287-302`) requires inline `series` values; metric/stat (`:191-193`)
require inline value string; list/keyValue (`:195-207`) require inline items.

So a legitimately-populated data-backed node (`from:'sales'`, empty inline
series) is judged NON-content, and both delegators — the runtime seed gate
`isSeedableTree` and the server offline gate `hasBuiltStage`
(`tree.ts:78-85` docstring) — would REFUSE to seed a populated initial tree.
Conversely DC-003 requires a dangling `from` to count as non-content.

Resolution: thread the sanitized `data` warehouse into
`treeRenderableNodeIds`/`nodeRendersItself` and resolve `from` before the
content decision (populated dataset ⇒ content; absent/dangling/empty ⇒
non-content), wrapped in the existing try/catch so it never throws.

### RISK-INV-4 (INV) — renderer stays read-only; no client-side data writer

Invariant #6 (two-writers coherence; DC-006). `BrickRenderContext`
(`packages/core/react/src/brick-renderer-types.ts:17-28`) carries NO tree/data
reference; the data renderers read inline values via
`safeOwnValue(node, 'items'|'series'|'value')`
(`packages/core/react/src/brick-renderer-data.tsx:87,265` etc.).

To resolve `from` the spec must thread the resolved `data` warehouse into the
render context as a READ-ONLY derived input (e.g. a new `data` field on
`BrickRenderContext`, populated once in `StageRenderer` from the validated tree)
and forbid caching projected data in component state — any `useState`/`useEffect`
that stored the projection would be a NEW client-side stage/data writer and
break the server-sole-writer invariant (the exact A2UI dual-writer hazard the
brief avoids).

Resolution: projection is a pure render-time function of `(node, context.data)`;
no `setState` of data; `StageRenderer` passes the warehouse down unchanged.

### RISK-INV-5 (INV) — one shared precedence helper across every read seam

Coherence of the precedence rule (Decision Lock: `from` present ⇒ `from` wins
over inline; deterministic). The SAME precedence must be applied at every seam
that reads a node's data, or the gates disagree.

Concretely, `treeHasContent`'s `nodeRendersItself`
(`packages/core/core/src/tree.ts:183-207`) currently answers "content?" from
inline `columns`/`series`/`items`, while the renderer
(`brick-renderer-data.tsx`) would answer from the resolved `from` dataset — so a
node with inline columns + `from:'ghost'` (dangling) could be counted as content
by the seed gate yet render EMPTY, or vice-versa.

Resolution: define one shared resolve-precedence helper in `@facet/core`
(from-present ⇒ warehouse dataset, else inline) and call it from BOTH the content
gate (`tree.ts`) and the renderer projection (`@facet/react`), so the "shows
something" decision and the actual render can never diverge.

### RISK-API-1 (API) — `treeHasContent`/`treeRenderableNodeIds` behavior change

CHANGED PUBLISHED-SURFACE BEHAVIOR: `treeHasContent`/`treeRenderableNodeIds`
(exported from `@facet/core`, barrel
`packages/core/core/dist/index.d.ts:1115`). The content judge
`nodeRendersItself(node: Record<string,unknown>)` is NODE-LOCAL and never sees
the tree — the `table` case checks only `node.columns` and `chart` checks
`node.series` (`packages/core/core/src/tree.ts:184-192`). A `from:"sales"` node
with NO inline rows/series (Example 1, DC-001) will therefore be judged EMPTY,
changing the contract for 5 proven consumers:

1. `packages/core/runtime/src/initial-stage.ts:9` `isSeedableTree` →
   `treeHasContent`, called by `withInitialStage` at
   `packages/core/runtime/src/assets.ts:411` — a fully data-bound INITIAL tree
   would be refused seeding.
2. `packages/core/server/src/offline.ts:31-43` `hasBuiltStage` →
   `treeHasContent` — the offline visit face would OVERWRITE a real data-bound
   built stage (regression).
3. `packages/core/react/src/renderer-motion.ts:90`.
4. `packages/agent-stack/agent-tools/src/executor-page.ts:272`.
5. `packages/agent-stack/agent-tools/src/observation.ts:79`
   `treeRenderableNodeIds`.

RESOLUTION the spec must implement: thread `tree.data` down
`treeRenderableNodeIds` → `collectRenderableNode` → `nodeRendersItself`
(signature change) so a resolvable `from` (dataset present + non-empty after
sanitize) counts as content while dangling/absent/malformed `from` stays
non-content (DC-003). All 5 consumers then inherit the corrected predicate for
free — but the change must be a single core edit, not per-consumer, to preserve
the "single canonical shows-something form" documented at
`packages/core/core/src/tree.ts:78-82`.

### RISK-API-2 (API) — breaking vs additive: are inline arrays now optional?

BREAKING vs ADDITIVE decision the spec must lock: whether adding `from?` makes
the inline arrays OPTIONAL. `TableNode.rows`, `ChartNode.series`,
`KeyValueNode.items`, `ListNode.items` are currently REQUIRED
(`packages/core/core/src/component-nodes.ts:109`, `:126`, `:159`, `:197`).

If they go optional (so a from-only node can omit inline data), every
UNCONDITIONAL accessor breaks under strict
`noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`:

- in-core: `packages/core/core/src/expand-composition-fill.ts:107`
  `node.rows.map(...)`, `:127` `node.series.map(...)`, `:85/:94/:146/:172`
  `node.items.map(...)`, `:404` `node.rows.flatMap(...)`.
- consumer: `packages/agent-stack/agent-tools/src/executor-inspect.ts:139`
  `facetNode.rows.length`, `:141` `facetNode.series.length`, `:147/:155`
  `facetNode.items.length`.

RESOLUTION: spec-bridge must pick ONE —

- **(a)** keep inline arrays REQUIRED (from-bound nodes still carry `rows: []`) =
  purely additive `from?`, zero accessor breaks, but weakens the "author once"
  ergonomics; or
- **(b)** make them optional and add `?? []` guards at all 8 sites above plus any
  new render paths.

This is unresolved by the brief's Decision Lock and is the highest-churn API
choice.

### RISK-API-3 (API) — renderer resolution site (internal, additive-safe, must be threaded)

RENDERER RESOLUTION SITE (internal surface, additive-safe but must be threaded):
the react data/chart renderers read inline data only —
`packages/core/react/src/brick-renderer-chart.tsx:31` `safeOwnValue(raw,
"series")` — and their context `BrickRenderContext`
(`packages/core/react/src/brick-renderer-types.ts:16-27`) carries NO tree/data
handle. To project `from` the dataset must be threaded into the renderer.

RESOLUTION: `renderer-render.tsx` already threads the whole `tree`
(`packages/core/react/src/renderer-render.tsx:34` and `:76`), so `tree.data` is
reachable; add a resolved-dataset (or `data`) field to `BrickRenderContext` and
resolve `from` at the data/chart/list/keyValue/metric render sites. Verified
NON-BREAKING externally: `BrickRenderContext` is not re-exported from the
`@facet/react` barrel (`packages/core/react/src/index.ts` has no
`brick-renderer`/`BrickRenderContext` export), so the added field is
internal-only.

### RISK-API-4 (API) — agent-facing observability coupling (@facet/agent-tools)

AGENT-FACING OBSERVABILITY COUPLING (published `@facet/agent-tools`
inspection/observation output): even if RISK-API-2 keeps inline arrays required
with `rows: []`, `describeNode` reports inline counts, not resolved ones —
`packages/agent-stack/agent-tools/src/executor-inspect.ts:139` emits
`table ... rows=${facetNode.rows.length}`, `:141`
`chart ... series=${facetNode.series.length}`, `:147` keyValue items, `:155`
list items. A `from`-bound node then inspects as `rows=0`/`series=0`, so the
agent's own structured observation (`observation.ts`) misrepresents what the
visitor sees and can trigger redundant re-emits or wrong compaction.

RESOLUTION: the inspect/observation layer must resolve `from` against
`tree.data` (when `from` is present) before reporting counts, consistent with
the RISK-API-1 core predicate change; spec must add a Work Unit for
`@facet/agent-tools`, not treat it as "none expected" (the brief marks
agent-tools additive prompt-only, which under-scopes this).
