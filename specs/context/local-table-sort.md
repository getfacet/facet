# Context: `local-table-sort`

Local, browser-owned column sorting for `table` bricks. A column may opt into
sorting via an additive `sortable?: boolean` flag; a visitor clicking a sortable
header cycles `asc → desc → unsorted` as a pure render-time reorder. Sort state
is browser-private view-state (like `currentScreen` / `visibilityOverrides`),
published on the next `view` snapshot only — it fires **zero** transport/agent
events. The server stays the sole writer of stage content.

## Affected packages

- `@facet/core`
- `@facet/react`
- `@facet/reference-agent`
- `@facet/agent-tools`

## Code entrypoints

### `@facet/core`

- `packages/core/core/src/component-nodes.ts:96` — `TableColumn` interface
  `{key, label, align?}`; add additive `sortable?: boolean`.
- `packages/core/core/src/classic-component-validation.ts:385` — `tableColumns()`
  validator (per-field `tokenValue` / `boundedString` pattern); add a closed
  boolean `sortable` with drop-with-issue on a non-boolean.
- `packages/core/core/src/view.ts:34` — `ViewSnapshot` interface; add optional
  `sort?` map (tableNodeId → `{column, direction}`) plus a closed
  `SortDirection` enum beside `VIEWPORTS` / `SCHEMES`.
- `packages/core/core/src/view.ts:60` — `sanitizeView()` boundary clamp (the #36
  single bounds source); add a bounded, capped `sort` sanitize branch mirroring
  the toggled cap (new `MAX_VIEW_SORTED_TABLES`-style cap).

### `@facet/react`

- `packages/core/react/src/StageRenderer.tsx:106` — `useState` holders
  `currentScreen` / `visibilityOverrides` (the view-state pattern); add a
  per-table sort view-state holder here.
- `packages/core/react/src/StageRenderer.tsx:144` — `onViewSnapshot` publish
  effect; feed the current sort spec into the captured snapshot.
- `packages/core/react/src/view-snapshot.ts:25` —
  `captureViewSnapshot(currentScreen, visibilityOverrides, viewport, scheme)`;
  extend the signature to include sort.
- `packages/core/react/src/brick-renderer-types.ts:17` —
  `BrickRenderContext<Press>` (dispatch / classifyPress threading); thread sort
  state + a header-click handler to `renderTable`.
- `packages/core/react/src/brick-renderer-layout.tsx:293` — `renderTable()`:
  columns build (295), `<th>` header (344), `resolveNodeData` rows (310–312);
  make sortable `<th>` clickable, apply a renderer-owned total comparator to
  effective rows before render, cycle `asc → desc → unsorted`.

### `@facet/reference-agent`

- `packages/agent-stack/reference-agent/src/prompt/messages.ts:49` —
  `describeView()` renders the inert `[visitor view]` line; extend to mention the
  current sort.

### `@facet/agent-tools`

- `packages/agent-stack/agent-tools/src/prompt-kit.ts` / `types.ts` — shared
  view/observation prompt-kit surface (#36); the sort rides the same view line;
  extend if a dedicated observation mention is wanted.

## Risk register

### RISK-INV-1 (INV) — INVARIANT #6 (two-writers coherence): the core design seam

The browser view-state holders live as private React state in `StageRenderer` at
`packages/core/react/src/StageRenderer.tsx:106-114` (`currentScreen` +
`visibilityOverrides`), mutated ONLY inside `handlePress` (lines 175–221) and
never reachable by any server/patch path. The sort spec must be a THIRD holder of
exactly this shape (a `Map<NodeId, {column, direction}>` via a new `useState`),
mutated only in a new header-click branch of `handlePress`.

The re-apply-on-patch guarantee lives at
`packages/core/react/src/brick-renderer-layout.tsx:310-312`, where `renderTable`
resolves rows FRESH every render via `resolveNodeData(node, context.data)` then
caps/filters them — `context.data` is documented READ-ONLY at
`packages/core/react/src/brick-renderer-types.ts` (the "A2UI dual-writer hazard"
comment).

RESOLUTION the spec must implement: apply the sort as a PURE render-time reorder
of the already-resolved+capped `rows` (immediately after
`brick-renderer-layout.tsx:312`), keyed by node id from the new `StageRenderer`
sort-state; the renderer must NEVER write back into `context.data`, `node.rows`,
or cache the projected/sorted array. Because rows are re-resolved+re-sorted on
every render, a server `data` patch automatically re-applies the current sort
(DC-003) with the server remaining sole writer. The spec must explicitly forbid
memoizing/caching sorted rows across data patches.

### RISK-INV-2 (INV) — INVARIANT #6: hidden "no new writer / no round-trip" contradiction

"No new stage-content writer / no round-trip" has a HIDDEN CONTRADICTION the
brief's note glosses over. The brief claims sort is "exactly the navigate/toggle
discipline extended to row order," but navigate/toggle fire
`recordLocalTap` → `onRecord` (`StageRenderer.tsx:163-173`, called at :183 and
:204), and `onRecord` is wired through `useFacet.ts:123` to `transport.record`,
which does `POST /record` to the Sink
(`packages/core/client/src/sse-transport.ts:64-66`). That IS a network write on
every navigate/toggle. But DC-007 requires a sort header click to fire ZERO
network/agent events and DC-001 asserts "zero transport sends."

RESOLUTION: the spec must state that sort DEVIATES from navigate/toggle — it must
NOT call `recordLocalTap` / `onRecord` at all; the sort rides ONLY the next
`view` snapshot on an already-forwarded event. DC-001's assertion must explicitly
cover no `POST /record` (assert `transport.record` is not called), not just no
`/event`, otherwise a copy-paste of the navigate/toggle handler silently violates
the invariant.

### RISK-INV-3 (INV) — INVARIANT #6: view-state publish + untrusted-boundary seam (stale-dependency bug risk)

`view.sort` must be added to `ViewSnapshot` at
`packages/core/core/src/view.ts:34` AND given its own clause in `sanitizeView` at
`packages/core/core/src/view.ts:60-106` — that function copies ONLY known flat
fields (screen/toggled/viewport/scheme), so an un-sanitized `sort` map is
silently dropped at every boundary (server `/event`, ag-ui input, persisted read
per the `view.ts:18-24` docstring), breaking DC-005.

The sort clause must mirror the `toggled` bound (`view.ts:85-100`): a plain-object
map keyed by table node id (string ≤ `MAX_FIELD_VALUE_CHARS`), value =
`{column: string ≤ cap, direction: closed enum}`, capped like
`MAX_VIEW_TOGGLED_KEYS`, non-recursing, wrapped in the existing try/catch, never
throwing.

On the renderer side, `sort` must be added to `captureViewSnapshot`
(`packages/core/react/src/view-snapshot.ts:25-60`) AND the publish `useEffect`
dependency array at `StageRenderer.tsx:151` — currently
`[onViewSnapshot, currentScreen, visibilityOverrides, viewport, scheme]` — MUST
gain the new sort-state, or a sort change never re-publishes and DC-005 fails
silently.

### RISK-INV-4 (INV) — INVARIANT #3 (fail-safe): validation + comparator seam

The `sortable` flag's soft-renderability check is `isRenderableTableColumn` at
`packages/core/core/src/tree.ts:315-317` (it only requires string key+label). Per
the brief's policy table, a NON-boolean `sortable` must be treated as
not-sortable (drop-the-flag-with-issue), never rejecting the whole column — so
validation must coerce/ignore, not throw.

The comparator applied in `renderTable`
(`packages/core/react/src/brick-renderer-layout.tsx:293-312`, which today has NO
try/catch around row/cell handling) must be renderer-owned, CLOSED (numeric vs
string vs boolean vs empty), STABLE, and TOTAL so a mixed-type column
(numbers+strings) and absent cells can never throw (DC-004). A sort spec naming a
column that is not `sortable`, absent from `columns`, or malformed must fall back
to natural (unsorted) order.

RESOLUTION: keep the comparator a pure total function of `(cell, cell)` with a
fixed type-rank ordering + tie-break by original index (stability); guard the
whole sort application so any unexpected throw degrades to the
resolved-but-unsorted `rows` (`renderNode` already skips/never-throws around the
node, but the comparator itself must be total, not rely on the outer skip).

### RISK-INV-5 (INV) — INVARIANT #6/#5: dispatch channel threading + inert clone safety

`renderTable` (`brick-renderer-layout.tsx:293`) receives `BrickRenderContext`
(`packages/core/react/src/brick-renderer-types.ts`), which carries `nodeId`,
`dispatch`, `navigate`, `data` but NO sort channel; today the header `<th>` at
`brick-renderer-layout.tsx:343-356` renders plain non-interactive text. A new
context read (current sort spec for this `nodeId`) + a header-click dispatcher
must be threaded through the context exactly like `navigate` (a `StageRenderer`
setter passed down), NOT via any new transport.

CRITICAL coherence point: the inert previous-screen render at
`StageRenderer.tsx:290-303` passes `renderMode: 'inert'`, and `renderTable`
already honors `inert` / `aria-hidden` (`brick-renderer-layout.tsx:294,329`) —
the sort dispatcher MUST be a no-op when `inert` (the transition clone is
`pointerEvents:'none'` at `StageRenderer.tsx:288`, but the spec must guarantee no
live sort writer is wired on the inert clone, or a second writer to view-state
could exist mid-transition).

FLOW-ONLY (#5, brief marks OK, confirmed): sortable headers must stay `<th>` in
the existing table flow — the flag adds a click affordance + an in-cell direction
indicator, never absolute/overlay positioning; the spec must confirm any
sort-direction glyph is inline (no positioned caret).

### RISK-API-1 (API) — CHANGED PUBLISHED SURFACE (@facet/core, additive): `TableColumn.sortable`

`TableColumn` gains `sortable?: boolean`. The interface is at
`packages/core/core/src/component-nodes.ts:96-100` and is re-exported publicly
(`component-nodes.js` → `nodes.ts:257` `export * from ./component-nodes.js` →
`index.ts:2`), so it is a barrel export of `@facet/core`. Pattern = closed-field
validator that DROPS unknown fields: the column validator `tableColumns` at
`packages/core/core/src/classic-component-validation.ts:385-402` builds each
column object from only key/label/align; an emitted `sortable` is silently
discarded today.

Consumer sweep:
- (a) tool executor `packages/agent-stack/agent-tools/src/executor-input.ts:240-241`
  passes `columns: value['columns'] ?? []` straight into `validateTree` → SAFE
  passthrough, no migration.
- (b) content gate `isRenderableTableColumn`
  `packages/core/core/src/tree.ts:315-317` checks only key+label → UNAFFECTED, a
  sortable column still gates identically (DC-006 back-compat holds).
- (c) `apps/playground` constructs tables via the agent-tools builders, not raw
  `TableColumn` (grep found no direct `TableColumn` literal) → no migration.

RESOLUTION the spec must implement: add `readonly sortable?: boolean` to
`TableColumn`; in `tableColumns` read it as a bounded boolean and DROP-WITH-ISSUE
on a non-boolean (Policy & Edge row 1); do NOT touch `isRenderableTableColumn`.
Additive, no consumer breaks.

### RISK-API-2 (API) — CHANGED PUBLISHED SURFACE (@facet/core, additive but HIGH-COUPLING): `ViewSnapshot.sort` + `SortDirection`

`ViewSnapshot` gains `sort?` (tableNodeId → `{column, direction}`) plus a new
closed `SortDirection` enum. Type + sanitizer are public via
`packages/core/core/src/view.ts:34` and `:60`, re-exported at `index.ts:8`.

CRITICAL detected pattern: `ViewSnapshot` is NOT spread-copied at its boundaries
— it is REBUILT field-by-field, so any additive field is silently dropped at
every rebuild point unless each is extended. The rebuild points:
- (1) core `sanitizeView` `view.ts:60-106` constructs an explicit `cleaned`
  object with only screen/toggled/viewport/scheme → if not extended, the server
  boundary (`packages/core/server/src/server-validation.ts:153`
  `sanitizeView(event.view)`) STRIPS `sort` and DC-005 fails.
- (2) react `captureViewSnapshot`
  `packages/core/react/src/view-snapshot.ts:25-60` builds `snapshot` explicitly
  from currentScreen/visibilityOverrides/viewport/scheme → must populate `sort`
  from the new `StageRenderer` sort state or the agent never sees the sort.

SAFE consumers (route through the two above, no per-field rebuild): `withView`
`packages/agent-stack/quickstart/src/page/view-attach.ts:20` spreads whole snap;
client `view-storage.ts:19,36` both funnel through `sanitizeView`; ag-ui
`packages/extensions/ag-ui/src/server-input.ts:200,256` call `sanitizeView`;
protocol `CollectedEvent` / `ClientEvent` view (`protocol.ts:86-143`) all
reference the imported `ViewSnapshot` type so they extend automatically.

RESOLUTION: define `SortDirection` (closed enum, e.g. `['asc','desc']`) and the
`sort` map shape in `view.ts`; extend `sanitizeView` with a bounded map (string
tableId key ≤ `MAX_FIELD_VALUE_CHARS`, column string bounded, direction in the
closed enum, cap number of tables via a new `MAX_VIEW_SORT_KEYS` mirroring
`MAX_VIEW_TOGGLED_KEYS`, oldest-dropped); extend `captureViewSnapshot` to emit
it; add covering sanitize tests. No breaking change — every field is optional and
protocol types inherit it for free.

### RISK-API-3 (API) — CHANGED PUBLISHED SURFACE (@facet/agent-tools + @facet/reference-agent, additive): prompt/observation surface

The LLM-facing prompt/observation surface must learn about `sortable` and
`view.sort`. `prompt-kit.ts` is a public barrel export; its column/data guidance
(`packages/agent-stack/agent-tools/src/prompt-kit.ts:36` enumerates table column
semantics) and the view line (`prompt-kit.ts:24` already surfaces
screen/toggled/viewport/scheme) do not mention sort. Pattern =
documentation/prompt constant, not a typed API contract, so extending it cannot
break a consumer; the tool executor path (`executor-input.ts:223-241`) already
passes columns through untouched so no schema edit is needed there.

RESOLUTION: extend the prompt-kit column guidance to mention the per-column
`sortable` opt-in and extend the view observation line (and `STAGE_SPEC` via
`/update-docs`) to report the current `view.sort`. Purely additive text; version
the agent-tools/reference-agent packages as a minor.
