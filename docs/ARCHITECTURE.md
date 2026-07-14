# Architecture

This document explains how Facet is put together and why. For the elevator
pitch, see the [README](../README.md).

## The problem

An agent's public link is, today, one of two things: a static page (same for
everyone, dead) or a chat box (dynamic, but it's just text). Neither lets the
agent present a *page* that is built for the specific person reading it and that
evolves as they talk.

Facet's job is to make "one agent, one link" mean "a page that is alive and
personal for every visitor at once."

## Two layers

A Facet page is the **Stage** plus the **Chat dock**.

- The **Stage** is the dynamic body. It is owned by the agent and rebuilt per
  visitor. It is represented as a declarative tree of bricks, never as markup.
- The **Chat dock** is persistent UI the visitor uses to talk to the agent. It
  is not part of the generated spec; it is the control surface that produces
  `message` events.

The Stage diverges along two axes:

- **Who** — `VisitorContext` (referrer, locale, prior relationship) shapes the
  first paint before any conversation.
- **What they say** — each `message`/`action` event lets the agent patch the
  Stage further.

## Why a closed vocabulary plus catalog (the central bet)

Every existing way to let an agent build UI sits at one of two extremes:

- **Semantic widgets** (A2UI, Adaptive Cards, DivKit, Thesys C1): the agent picks
  from a catalog of finished components (Card, Button, Chart). Safe and easy to
  get right in one shot, but *not free* — anything not in the catalog is
  impossible.
- **Raw HTML/iframe** (MCP-UI, MCP Apps, "generate a website" tools): the agent
  writes actual page code. Total freedom, but unsafe (injection) and prone to
  visual breakage.

Facet takes the empty middle: a **closed core vocabulary** the agent composes
freely, guided by a catalog when a project wants stronger design-system policy.
The trick that makes this safe *and* one-shot-reliable is that freedom and
fragility are separated onto different axes:

- Freedom comes from **composition**: primitive bricks stay the universal base,
  intrinsic components cover common product/app UI, catalog compositions provide
  reusable fragments, and recipe components can expand to ordinary validated
  nodes.
- Safety comes from **constraining the vocabulary, not handing over markup**:
  nodes are typed data (no raw HTML/JS), style values are **tokens** not scalars,
  layout is **flow-only** (no absolute positioning), every prop has a
  **default**, and the renderer is **fail-safe**.

So "broken" splits into two kinds, and both are designed out: *crashes /
injection / overlap* are made structurally impossible; *ugliness* is prevented
because tokens and recipes force every choice onto a coherent scale. One-shot
leverage (the thing semantic catalogs were good at) comes from catalog policy,
theme recipes, and composition metadata, while primitive fallback keeps the system from
becoming an opaque widget-only catalog.

## Primitive Bricks And Components

`FacetNode` is a closed union in `packages/core/core/src/nodes.ts`. The union can
grow only by adding typed node shapes, validators, tool policy, and renderer
support on purpose; it never accepts raw HTML, JS, CSS, or arbitrary component
code.

The primitive base remains valid as fallback:

- `box` — the universal flow container. Flow layout (`direction: row|col`),
  token styles (including `appear`, `scroll`, and `columns`), optional
  `onPress`/`onHold`, and optional `hidden`.
- `text` — a string with token text styles.
- `media` — a static safe `src`, optional `alt`, `kind: "image" | "video"`, and
  token styles. Legacy stored `image` nodes normalize to media images.
- `input` — a native input (`name`, `input` kind incl. `search`, capped `options`
  for select/radio, token styles). Consolidates the former `field`/`search`
  surfaces; a search box is `input:"search"`, and a search-with-submit is an
  `input`+`button` composition.
- `richtext` — a flowing block of prose carrying MIXED inline formatting the
  single-string `text` node cannot express. A primitive LEAF: it holds its own
  `blocks` (`paragraph`/`heading`/`listItem`/`quote`) whose `runs` flow inline,
  each run carrying CLOSED semantic `marks` (`bold`/`italic`/`underline`/
  `strike`/`code`/`link`) — never raw HTML/markdown/CSS; an unknown mark drops
  and the text is kept. Heading `level` (1–3) and list `depth` (0–5) are clamped
  to renderer-owned flow indent, never author pixels. A `link` mark targets
  either an INTERNAL Action (the same union as `onPress`) or a gated EXTERNAL
  `{ href }` (only http(s)/protocol-relative/local; `javascript:`/`data:` and
  other schemes drop to inert text) — a link is navigated, never fetched.

Components are split by ownership:

- **Intrinsic components** are Facet-core vocabulary. They must be generic across
  app domains, useful as familiar agent-facing nouns, renderer-owned, safe
  without client-side business logic, and hard enough to reproduce from
  primitives that a typed node materially improves reliability.
- **Recipe components/compositions** are operator or catalog data. They expand
  to ordinary validated nodes and theme recipes; they do not add new raw code or
  new client-side behavior.

The v1 intrinsic components are still just typed stage data:

- `button` — a leaf action brick with `label`, optional `variant`/`tone`,
  `disabled`, `onPress`, and `onHold`.
- `section` — a normal-flow container with optional `title`, `eyebrow`, `body`,
  `variant`, and `children`.
- `card` — a normal-flow container with optional `title`, `body`, `variant`,
  `tone`, `onPress`/`onHold`, and `children`.
- `tabs` — local navigation over existing screen/view-state semantics. It does
  not write stage content or call the agent.
- `nav` — app or section navigation over the same local screen/view-state
  semantics.
- `table` — display-only tabular data with capped columns, rows, and cells.
- `chart` — display-only chart data with capped series and points.
- `metric`, `keyValue`, `badge`, `progress`, `alert`, `list`, `divider`,
  `emptyState`, and `loading` — compact display and feedback components with
  bounded payloads. `stat` remains a legacy alias for `metric`.
- `form` and `filterBar` — input/control surfaces only. Backend work
  stays with the agent through actions and later patches.

Only `box`, `section`, `card`, and `form` are containers in v1. Tables, charts,
and filter bars are display/control-only; there is no client fetch,
agent-authored sort/filter engine, data-source/resolver/query binding, expression
language, or inline script. (Binding a data-bearing node to the in-tree `data`
warehouse by NAME via `from` is allowed and is not a data source — see "Data
warehouse + bindings"; it stays agent-authored declared content. A table column
opted into `sortable` reorders locally, but the comparator is a closed
renderer-owned mechanism, not a sort engine the agent writes — see "Local table
sort".) Overlap stays impossible EXCEPT through two bounded, renderer-owned
descriptors — never a general z-index/absolute-positioning escape hatch:

- a `box`'s `backdrop` — a bounded two-layer background painted BELOW normal-flow
  content (negative z; see "Landing-grade vocabulary"); and
- a `box`'s `overlay: { kind: "modal" | "drawer" }` — the box floats ABOVE flow in
  a renderer-fixed positive-z band (modal centered, drawer at the end edge, each
  with a scrim), opened/closed via the existing local `toggle`. The author gives
  only the closed `kind`; the renderer owns placement, scrim, z, focus, and close.
  (`popover` + an anchored variant remain out of v1, added additively later.)

## Renderer Layout Contract

The renderer enforces the containment rule for every primitive brick, intrinsic
component, and expanded recipe component:

- **Parent owns placement.** A parent's direction, gap, align, justify, columns,
  and wrap place only its immediate children.
- **Child owns internal layout.** A child can choose its own internal structure
  and variant, but only inside the placement slot its parent gives it.
- **Renderer owns containment.** Children may not force the parent wider than
  its own box. Default horizontal overflow is hidden/bounded; long text wraps;
  media, charts, tables, and controls get `max-width: 100%` and `min-width: 0`.
- Horizontal scrolling is allowed only in renderer-owned bounded regions such as
  tables or an explicit `scroll: "x"` box.
- Absolute/fixed positioning remains outside the stage vocabulary.

This contract is intentionally central: component renderers must satisfy it at
their root element, and recipe components satisfy it after expansion because they
become ordinary validated nodes.

`onPress` is a small **behavior language** — a discriminated union so the agent
can pre-declare what an interaction does:

- `{ kind: "agent", name, payload? }` — send an event to the agent (the open-ended
  path; a bare `{ name }` is treated as this). This is the only kind that reaches
  the transport.
- `{ kind: "navigate", to }` — switch to another pre-drawn screen.
- `{ kind: "toggle", target }` — show/hide an in-flow node.

`navigate`/`toggle` run **instantly in the browser with no agent turn** — the
renderer owns that view-state (which screen is showing, per-node visibility)
while the server stays the only writer of stage content, so the two never
contend. Pre-draw the reachable screens (how deep is the agent's call) and let
the browser flip between them for free; reserve `kind:"agent"` for anything that
needs new reasoning. Clicking a `sortable` table column header is the same shape
of local view-state (a per-table sort spec the renderer applies at render time —
see "Local table sort"): no event kind, no transport, no agent turn.

Style values are **tokens** defined in `packages/core/core/src/tokens.ts`
(`Space`, `FontFamily`, `FontSize`, `Color`, `Radius`, …). Token names are the
agent-facing vocabulary; the concrete default token values live in
`@facet/assets` (`packages/core/assets/src/theme.ts`), while `@facet/react`
resolves those data maps to CSS at render time. Reskinning every page is a data
change and the agent never deals in pixels, hex, or font stacks. The token names
are kept compatible-in-spirit with the W3C Design Tokens (DTCG) format.

**Landing-grade vocabulary.** The token set reaches beyond dashboard scale so an
agent can compose a landing/marketing page (a full-height hero, dark bands,
gradients) without pixels or raw CSS. `FontSize` extends to `4xl/5xl/6xl` for
display type, and closed token groups add `minHeight` (`half`/`screen`),
`maxWidth` (a centered content column), `tracking` (letter-spacing), `leading`
(line-height), `gradient`, `backdropScrim`, `scheme`, and `highlight`. Two are
not plain token swaps: `scheme:"dark"` selects a per-subtree dark color palette
(`ColorScheme`, a distinct authored token from view-state's report-only device
`Scheme`), and a `box`'s optional `backdrop: "<mediaNodeId>"` paints a referenced
media node as a **bounded background layer** behind the box's normal-flow
children. Layering stays flow-safe by construction: the backdrop yields exactly
two renderer-synthesized layers (the media cover + a readability scrim) at
NEGATIVE z-index inside a stacking-context host, so the flow children always
paint above them and no author z-index/absolute-positioning is ever emitted onto
content. The backdrop resolves read-only to a MEDIA node only (never recurses)
through the existing safe-`src` gate, and it counts against the render budget.

### The brick-vs-field growth rule (two axes)

New capability requests hit one recurring question: does this become a **new
brick**, or a **field on an existing brick**? Facet answers it on two axes, so
the vocabulary grows deliberately instead of by accretion.

- **Axis 1 — DATA (content).** When the ask is to show a NEW KIND of content
  that needs renderer computation `box`+`text` cannot express — draw shapes
  (`chart`), capture input (`input`), project rows (`table`), carry mixed inline
  prose (`richtext`) — add a **new native data brick**. Never pile more fields
  or modes onto `text` to fake it. `text`'s recent growth (`from`, `active`) is
  the exception that proves the rule: those are not text-specific fields but
  cross-cutting mixin packs (`DataBound`, `ActiveLook`) applied uniformly, so
  `text` itself accretes no ad-hoc surface.
- **Axis 2 — STRUCTURE (behavior/presentation).** When `box` gains a new WAY IT
  BEHAVES OR PRESENTS — pressable, layered/overlapping, hidden — add it as a
  **named concern pack on `box`** (a deliberate act, like adding a token), never
  a loose ad-hoc field. `box` today composes as
  `BaseNode & Styleable & ActiveLook & ContainerFields & Pressable & Layered`
  (plus a direct `hidden`), each pack a bounded, named unit rather than a
  scatter of one-off props.
- **The fuzzy-middle tie-breaker.** If a capability needs a renderer
  COMPUTATION that `box`+`text` cannot express, it is a **brick**; if it is just
  a way `box` overlaps, decorates, or behaves, it is a **box concern (a pack)**.
  Worked example: `overlay` requires no new content computation — only a bounded
  way `box` floats over its siblings — so it is a `box` concern and lives on the
  `Layered` pack (alongside `backdrop`), not a new brick.

## Catalog policy

`FacetCatalog` is the agent-facing usage manual for the active project. It says
which primitive bricks, components, variants, and compositions are allowed,
whether primitive fallback is allowed or discouraged, whether theme switching is
locked, and whether the agent should prefer compact screens or
edit-before-append behavior. Missing or malformed catalog input falls back to
`DEFAULT_CATALOG` with bounded issues. The normalized model exposes `bricks`,
`components`, a required `compositions` policy (`{ mode: "all" }` by default, or
`{ mode: "allow", names }`), `primitiveFallback`, and a usage `policy` whose
canonical `order` is `["composition", "component", "primitive"]`.

The catalog is deliberately neutral UI vocabulary/policy. It is not LiveFrame and
it is not a hosted control plane. Tenant/project lookup, browser auth, agent
auth, billing, usage metering, rate limits, abuse operations, audit logs, secrets
management, and custom-domain routing stay outside Facet in the platform edge or
operator environment.

## Catalog, Themes, Compositions, And Seeds: Reskin As Data

The renderer-owns-the-CSS rule above makes a reskin a one-file change; the theme
layer makes it a **data** change — without moving the pixel boundary into the
spec. Raw CSS values enter Facet in exactly one place — `validateTheme` in
`@facet/core` — and only as **operator data**, never as tree content or model
output. A `FacetTheme` is a partial override document (token name → CSS value)
plus optional `recipes` for components, variants, and closed internal recipe
parts such as field labels/controls, tabs, table cells, chart plots, progress
tracks/fills, list rows, and divider rules. The validator is the single gate it
passes: an allowlist per token group, recipe style group, and recipe part name, a deny-list
(`url()`, `var()`, `expression()`, `javascript:` and injection characters are
refused), dimension clamps so a theme can't push content off-screen, a bounded
font-family grammar for typography values, safe parseable opaque colors (hex,
`rgb()`/`rgba()`, `hsl()`/`hsla()`, and a conservative named-color table), and a
WCAG contrast check that is *measured as a warning, never a rejection* (Facet
measures; the caller sets policy). The same color parser gates the value and
feeds the contrast measurement, so an accepted color cannot skip the warning
path. Output maps are built on `Object.create(null)` so a hostile key can never
resolve. The validator is pure and dependency-free, so it runs identically on
the server and in the browser.

The stage tree carries only a **name**: `FacetTree.theme?: string`,
kept-if-string by `validateTree`. `STAGE_SPEC` teaches the agent to set it to a
theme name it has been given and nothing else — **the LLM never authors theme
values**. Nodes carry `variant`/`tone` selectors where supported; primitive
`box`/`text`/`media`/`input` may also choose a theme recipe variant, while
primitive styles still carry token names. Recipe parts are not stage syntax; they
are renderer-owned subrecipes inside validated operator theme data. Resolution is
a boot-shipped map plus local lookups: the validated theme documents ship to the
browser **once**, inline in the quickstart HTML shell as an escaped
`window.__FACET_THEMES__` global, `resolveTheme` (`@facet/react`) maps the
tree's theme name to a resolved token map, `resolveRecipe` maps a component +
variant/tone to token-only style bundles, and the renderer resolves recipe parts
for internal brick affordances. Unknown theme names, recipes, variants, tones,
or parts fall back to the default recipe/style path. This is pure lookup — the
browser writes no stage state — and it introduces **no new protocol message**:
`@facet/server` and `@facet/client` are untouched, and a live theme switch is
just a normal `/theme` patch re-resolved locally when catalog policy allows it.

The document library itself is a **pluggable adapter, exactly like `StageStore`**:
`AssetsStore` is an interface with a browser-safe `MemoryAssets` reference in
`@facet/runtime`'s main barrel and a file-backed `FileAssets` behind
`@facet/runtime/node` (so a browser bundle never drags in `node:fs`); a database
adapter would live outside, the `@facet/store-postgres` precedent. `loadAssets`
runs the core validators once at boot (no hot reload), resolves catalog, theme,
composition, and initial-tree assets fail-soft, caps hostile asset/issue arrays before
iterating them, and skips any invalid document with a logged issue — the same
skip-and-log posture the file stage store already uses.

**Compositions** — `*.composition.json` validated `{ root, nodes, slots? }`
fragments — reach the quickstart LLM as names, slot names, descriptions, and
bounded metadata such as `category`, `useWhen`, `avoidWhen`, `tags`,
`preferredParent`, `composedOf`, and `followUpEdits`. Full composition JSON,
`root`, `nodes`, slot defaults, and unknown fields are not prompt surface. The
model calls the `use_composition` tool; the server resolves the name from the
immutable per-agent composition snapshot, fills whole-value `{{slot}}` markers,
remaps every internal id to a fresh id, drops unreachable nodes and composition
actions that point outside the expanded subtree, and emits ordinary JSON Patch
ops through the same closure buffer as hand-authored nodes. The parent must be a
known container (`box`, `section`, `card`, or `form`), and an expansion that
would overflow one patch batch is refused before any partial patch is emitted.
There is **no client-side composition expansion** anywhere: `validateTree` and
the fail-safe renderer see only normal bricks.

Seeding a page before the first model call is a `StageStore` **decorator**,
`withInitialStage`, that opens a fresh session on a validated initial tree
instead of `EMPTY_TREE`. Because every `open()` runs under the runtime's
per-`(agent, visitor)` serial queue and *before* the agent's first turn, the seed
is inside the same serialized stage-write path (the server stays the only writer)
and is visible to that first turn, which then refines it. The seed also
**travels the patch channel**: the browser's first connection rehydrated before
the session existed, so the store reports the fresh seed once (`takeSeeded`) and
the runtime prepends a root `replace` as that turn's first frame — ordered,
replayable, and applied by the same `applyPatch` on both sides. The frame is
consumed only when the turn persists; a failed first turn re-emits it, and a
durable commit-then-reject first save can recover the seed report even after the
bounded pending-key set evicts the original armed key. A
reconnect gets the seed the normal way, via the rehydrate snapshot. For the
very first paint the quickstart shell also ships the seed (and the resolved
theme's canvas colors) with the page itself — `useFacet` can start from a
boot-shipped tree, so nothing waits on the model; the seed frame then applies
idempotently. The zero-config `facet-quickstart` path uses its own compact
four-tab quickstart tour seed when no explicit guide or operator initial tree is
present, while custom `initial.tree.json` assets still win. One
trap is closed deliberately: `validateTree` returns `EMPTY_TREE` on garbage,
which would silently seed a blank page and flip the server's offline face, so a
tree that isn't *seedable* (the initial render root has visible, renderable
content such as text, media, fields, controls, or data-backed bricks) is refused
as a seed and boot falls back to today's model-first paint. Empty containers,
blank entry screens, empty table/chart/tabs/list leaves, and empty radio groups
with no label or options are not seedable.

## The stage tree

A Stage is a `FacetTree`: a flat map of nodes keyed by id, with one node whose id
is `root`.

```ts
interface FacetTree {
  root: NodeId;
  nodes: Record<NodeId, FacetNode>;
  screens?: Record<string, NodeId>; // named screens → their root node id
  entry?: string; // which screen shows first
  data?: Record<string, Dataset>; // named datasets; bind by name via node `from`
}
```

The flat-list-with-id-references shape (the same idea as Google A2UI) lets an
agent stream and patch a tree incrementally — adding one node at a time — instead
of re-emitting a whole page on every change.

**Data warehouse + bindings.** A `data`-bearing node (`table`, `chart`, `list`,
`keyValue`, `metric`, `stat`, and — for a single cell — `text`) may carry inline
data (`table.rows`, `chart.series`, a `text.value`, …) OR reference a named
dataset in the optional top-level `data` warehouse via `from: "<name>"` (a
single-cell node adds `column`/`row`, default row 0, exactly like `metric`) —
so one dataset feeds many views and a single
`/data/<name>` (or `/data/<name>/<i>/<col>`) patch updates every bound view at
once. A dataset is a closed `Array<Record<string, string | number | boolean>>`
(row-records) — the same cell type as `table.rows`, never nested/arbitrary JSON.
`from` wins over inline; a dangling/absent/malformed `from` renders the node
empty (never throws), and fills in when a later patch adds the data. This is
data as **declared, agent-authored content** (UI-OUT), NOT a fetch/resolver/query
— Facet adds no client data source, no binding-expression language, and no
agent-authored sort/filter engine. The one built-in local view operation is table
sort (opt-in per column via `sortable`; see "Local table sort" below); local
*filter* is still a deliberate follow-up.
`data` is sanitized inside `validateTree`, so the one pure `applyPatch`/fold keeps
it identical on server and client; the single `resolveNodeData` helper does the
name→dataset projection for BOTH the "shows content?" gate and the renderer, so
the two never diverge. Deliberately unlike A2UI (which converged on the same
structure↔data split), Facet keeps the schema closed, travels only RFC-6902
deltas rather than whole-model snapshots, stays server-sole-writer (no two-way
binding), and ships no repeater/template/`${…}` expression layer.

**Local table sort.** A `table` column marked `sortable: true` lets the visitor
click its header to reorder the rows locally — ascending → descending → unsorted
on repeat clicks — with **no agent turn and no transport**, the same
two-writers-safe discipline as `navigate`/`toggle`. The sort is pure browser
**view-state** (a per-table `{ column, direction }` spec keyed by node id, held
in `StageRenderer` beside `screen`/`toggled`); the renderer applies a closed,
renderer-owned, TOTAL, STABLE comparator (`applySort`: numeric < string <
boolean < empty, ties by original index) to the freshly-resolved+capped rows at
render time. The browser never writes `data`/`rows`, so the server stays the sole
content writer and a later `data` patch simply re-applies the current spec to the
new rows (no drift, no cached sorted array). The agent authors no sort logic — only
the `sortable` flag — and the current spec rides the visitor's next event on the
`view` snapshot (below), so the brain can see how they sorted. Filtering is
deliberately deferred: it would open a predicate/expression surface v1 avoids.

**Active-look binding.** A `box`/`text` may carry an `activeVariant`/`activeStyle`
plus a closed `active` **view-state predicate** — `{ screen: "<name>" }` or
`{ toggled: "<nodeId>" }` — so the brick highlights *itself* when that view-state
holds, **with no agent turn**: a tab authored as a `box` + `onPress:{navigate}`
self-highlights while its screen is current; a box `{ toggled }` marks a selected/
open item. This is a **read-only** binding — the renderer evaluates the predicate
(the single `evaluateViewPredicate` in `@facet/core`) against the *already-threaded*
snapshot view-state (`activeScreen` + the raw `visibilityOverrides` map, so the
inert previous-screen clone keeps its OLD highlight through a crossfade) and folds
the active variant/style into the same pure token merge as the base look. It writes
nothing (the browser stays the sole owner of view-state; the server the sole writer
of the tree). The predicate is a **closed, extensible tagged union** (unknown/future
kinds degrade to the default look, never a DSL); `activeStyle` passes the identical
token allowlist as base `style`, so it is token-only by construction. This is the
brick-level primitive that lets `tabs`/`nav`-style active highlighting be authored
from `box`+`text` instead of a renderer-owned component.

**Screens** are named roots INTO the same flat `nodes` map (not separate trees),
so every `/nodes/<id>` patch path, `applyPatch`, and existing consumer keeps
working unchanged: a screenless tree simply renders `root` (the single-screen
form). `navigate` picks which screen the browser shows; the server never needs to
be involved in the switch.

## Patches: RFC 6902 JSON Patch

Change travels as standard **RFC 6902 JSON Patch** operations rather than a
bespoke format — the same standard AG-UI uses for `STATE_DELTA`. Paths are JSON
Pointers into the `FacetTree`:

| Agent intent          | RFC 6902 operation(s)                                            |
| --------------------- | --------------------------------------------------------------- |
| replace the stage     | `replace ""` with the new tree                                  |
| upsert a node         | `add /nodes/<id>` (add replaces an existing member)             |
| append a child        | `add /nodes/<id>` + `add /nodes/<parent>/children/-`            |
| remove a node         | `remove /nodes/<id>` (dangling child refs are skipped on render)|

`applyPatch(tree, operations)` (in `packages/core/core/src/patch.ts`) is a small,
dependency-free implementation of the six standard ops, and it is pure. Pointer
reads require the source to exist for `move`, `copy`, and `test`; object-member
`replace`/`remove` targets must exist too. A stale op therefore throws before it
can create a ghost value or count as a stage mutation. One level up,
`foldPatchIntoStage` (in `packages/core/core/src/stage-fold.ts`) is the shared
fail-safe wrapper both sides actually run per delivered batch: a
batch-atomic apply, per-op salvage on a throwing batch (bounded, capped at
`MAX_PATCH_OPS`, with a failed `test` guard dropping itself and the following
ops in that salvage stream), then `validateTree` on the result. Because the
server (to keep the session's authoritative stage) and the client (to update
the DOM) fold the same delivered batches through the same pure function, the two
can never drift.

## The event loop

```
ClientEvent  →  FacetRuntime  →  FacetAgent  →  ServerMessage[] | AsyncIterable<ServerMessage[]>
                    │                                  │
                    └── applies patches to the session ┘
```

- `ClientEvent` is what a visitor does that the agent answers: `visit`, `message`,
  `tap` (a pressed box's agent action). It is the **forward** subset — a subtype of
  `CollectedEvent`, the log currency (`visit | message | tap`, where a local
  navigate/toggle `tap` carries a resolved `effect` instead of an `action`).
- Every event may also carry an optional **`view`** snapshot — the visitor's
  current browser view-state (`screen`, per-node `toggled` overrides, `viewport`
  size class, color `scheme`). Like `fields`, it is inert data riding the event,
  never part of the tree; it lets the agent target the screen the visitor is
  actually on. See the view-snapshot paragraph below.
- Local `navigate`/`toggle` taps never reach the agent, but they are still recorded
  for an **ordered replay log**: the browser fires them at `POST /record` (log-only,
  no agent turn), which `runtime.record` appends to the `Sink` on the same
  per-visitor order as forwarded turns (append order = the join key).
- `Sink` calls still receive `(agentId, visitorId)` as their lookup key, but the
  `StoredEvent.event` body is log-safe: duplicate `visitorId` values are redacted
  inside visit events, and sensitive collected field names (`password`, `token`,
  `api_key`, provider-key-like names) or key-looking field values store
  `[redacted]`. The browser-safe rule is owned by `@facet/runtime` and reused by
  downstream prompt/history boundaries; those boundaries still redact again so
  legacy or externally supplied Sink entries receive the same defense.
- `FacetRuntime.handle(visitor, event)` opens (or finds) the session for that
  `(agent, visitor)` pair, runs the agent, applies each returned batch to the
  stored stage, and ships that batch over the visitor's connection before
  pulling the next one. A non-streaming agent is just a one-batch agent.
- `ServerMessage` is what the agent answers with: `patch` (RFC 6902 operations)
  and/or `say` (chat text).

Sessions are keyed by `(agentId, visitorId)`, which is exactly why the page is
"different for everyone": each visitor has an isolated stage.

## Package taxonomy

Facet's source packages are grouped by maintainer-facing directory role while
npm package names stay stable:

- **Core** (`packages/core/*`) owns the contract, runtime, reference transport,
  browser transport, React renderer, and default asset data.
- **Agent Stack** (`packages/agent-stack/*`) owns the reusable stage-tool
  mechanism, the reference LLM brain, deterministic test fixture, and
  one-command quickstart.
- **Extensions** (`packages/extensions/*`) owns optional agent authoring and
  integration surfaces: in-process agents, dial-in agents, AG-UI adapters, CLI,
  bridge, and Postgres stores.
- **Labs** (`packages/labs`) is reserved for experiments and carries no
  supported package contract.

The product-facing support tiers are different from the physical directories.
The physical layout does not need to mirror these tiers; it is an ownership and
maintenance layout, while the tiers describe what users should treat as stable
contracts, reference implementations, or local tools.

- **Foundation:** `@facet/core`, `@facet/runtime`, `@facet/react`, and
  `@facet/assets`.
- **Agent Authoring:** `@facet/agent-tools` and `@facet/agent`.
- **Integration Adapters:** `@facet/ag-ui`.
- **Reference Implementations:** `@facet/server`, `@facet/client`,
  `@facet/agent-client`, `@facet/store-postgres`, and
  `@facet/reference-agent`.
- **Local Tools:** `@facet/quickstart`, `@facet/bridge`, and `@facet/cli`.

This distinction matters most for `@facet/server`: it is intentionally a
reference transport for local/self-hosted single-operator deployments. A public
multi-tenant platform should put its own edge/API layer in front of Facet for
tenant/project lookup, authentication, authorization, rate limits, usage
metering, abuse controls, audit logging, secrets management, and custom-domain
routing. Those concerns are not part of `@facet/server` or `@facet/runtime`.
`@facet/ag-ui` is the public adapter path for AG-UI event interop. Likewise,
native `@facet/client` and `@facet/agent-client` speak the reference transport;
hosted platforms usually implement their own `FacetTransport` and agent
connection client while preserving the core Facet contracts. `Self-host` is a
way to run the reference implementation, not a separate package tier.

## Agent authoring surfaces

Agents don't hand-assemble patch arrays. There are two authoring surfaces:

- `@facet/agent-tools` is the LLM/tool-loop mechanism: provider-neutral tool
  specs, execution, local stage-shadow folding, observations, and reusable
  Facet prompt-kit sections. Use it when you are building your own
  OpenAI/Anthropic/LangGraph/etc. loop.
- `@facet/agent` is the in-process TypeScript authoring SDK. It keeps existing
  because rules engines, tests, demos, and code-authored agents still need a
  convenient `Stage` API. It is not the LLM tool schema package.

`@facet/agent` gives a fluent control surface that records standard RFC 6902 ops
underneath:

```ts
defineAgent(({ event, session, stage }) => {
  stage
    .append("root", card)   // → add /nodes/<id> + add /nodes/root/children/-
    .say("Added it below.");
});
```

`Stage` coalesces consecutive stage edits into one `patch` message and preserves
ordering relative to `say(...)`. `defineAgent` flushes once at the end of the
turn; `defineStreamingAgent` lets generator logic yield producer-chosen
boundaries, flushing the commands recorded since the previous yield as the next
batch. Each batch is closed over its child references before it is delivered, so
the shared fail-safe fold never permanently prunes content that arrives in a
later batch. Replace the hand-written branches with an LLM call that emits the
same operations and nothing else in the stack changes. The shared prompt kit
covers Facet-specific guidance such as compact page UX, edit-before-append
behavior, bounded `render_page` use, visible-completion rules, and
theme/composition metadata privacy; the consuming agent still owns the page brief, provider
context, history, budgets, retries, stop policy, and any business/domain tools.

## Reference brain: `@facet/reference-agent`

The brain is out of scope for Facet — the user brings the LLM/rules — but a
*reference* brain ships anyway, exactly as a reference transport does:
`@facet/reference-agent` is to brains what `@facet/server` is to transports. Its
agent is an ordinary `FacetAgent` handed to the existing `createFacetServer({
agent })` seam, its LLM calls sit behind a small `ReferenceProvider` interface
(with `QuickstartProvider` retained as a compatibility type alias for existing
consumers; OpenAI/Anthropic adapters implement the canonical interface), and core/runtime/
server gain zero LLM awareness — any user brain drops into the same slot, so the
boundary stays intact while `npx facet-quickstart` gives a one-command first run
by composing it. The package also keeps a deterministic stub agent as a test
fixture for live-link gates; it is not the public quickstart path.

The reference agent is a **streaming tool-calling loop** (not a single completion):
each provider step yields the stage/chat batch produced so far, so the browser
can watch the page build while the model continues deciding the next tool. The
provider-agnostic tool vocabulary, executor, inspection helpers, local stage
shadow, structured observation contract, and shared Facet prompt kit live in
`@facet/agent-tools`; `@facet/reference-agent` supplies only the reference brain
around that mechanism.

Inside `@facet/reference-agent`, `provider/` holds the OpenAI/Anthropic adapters
and provider turn types, `prompt/` holds the system prompt plus event/history and
stage-summary text, and `harness/` owns the bounded turn machinery: transcript
assembly, token-calibrated context sizing, LLM + deterministic compaction,
budget presets, retry/stop classification, fallback policy, and sanitized trace
events. Context is sized in **tokens**: the adapters report provider usage
(Anthropic's count includes the cache-creation/read tokens of the
`cache_control` prefix caching the adapter enables on the stable system+tools
prefix), and a clamped chars-per-token estimator calibrates against it. When a
`SummaryStore` is configured, the harness **compacts with the same LLM** on two
surfaces. Cross-turn: after a turn, a background task on a per-visitor serial
lane folds older sink history (chunked under an input cap) into a rolling,
redacted, schema-validated conversation summary, persisted with a monotonic
covered-through marker plus a conversation-identity anchor so a wiped sink
rebuilds from scratch instead of resurrecting a foreign summary; the next
assembly injects it as a pinned user-role data block ahead of the verbatim
tail. In-turn: when the transcript passes the trigger ratio, the oldest whole
tool step-groups fold into one summary message — pair-safe for both provider
wire formats, with the stage block refreshed from the tool-buffer shadow under
a never-inflate guard — so the turn continues instead of hard-stopping. Every
summarizer failure degrades to the deterministic char-budget truncation, which
remains the final guard; without a store the behavior is exactly the
deterministic pipeline. The harness reads sink history, keeps the current
visitor event, includes full stage JSON only after a bounded length check says
it can fit, otherwise sends a deterministic bounded stage summary, and stops
before a provider call if compaction still cannot fit the configured context
budget. Corrupt sink history rows and
malformed stage metadata degrade to placeholders/summaries instead of aborting
prompt assembly. Tool observations are appended to the transcript before the
next provider step as bounded JSON emitted by `@facet/agent-tools`. The model
reads `status`, `outcome`, `visible_to_visitor`, `warnings`, and `next_action`
instead of matching prose. Observation fields are bounded before they enter the
transcript; the harness's observation cap remains a final guard. Trace callbacks
are sanitized and bounded; saturated async trace queues preserve terminal
`stop`/`turn_error` events over ordinary trace events.

The stage tools map 1:1 onto the `Stage` control API — `append_node` /
`set_node` / `remove_node` (incremental edits), `render_page` (a full redraw),
and `say` (chat) — via the provider's native function-calling (OpenAI) /
tool-use (Anthropic). It is fail-safe throughout: a bad tool argument becomes a
structured `status: "error"` / `outcome: "rejected"` observation the model
recovers from (never a throw), buffered forward references become
`outcome: "pending"`, and non-visible writes are reported as
`outcome: "applied_not_visible"` so the model cannot treat them as completed
visible work. Retry happens only before tools from that provider step execute,
provider failure mid-loop keeps whatever the stage already has, and a turn that
accomplishes nothing degrades to one fallback chat line. External agent authors
can use `@facet/agent-tools` without importing the reference provider loop.

Quickstart's flagship interaction is the **field snapshot**: a pressable box's
agent action may declare `collect: "<box id>"`, and at press time the renderer
takes a synchronous snapshot of the visible `field` controls under that box and
ships them as `fields` on the tap event — the values ride the event, **never the
tree**. Text-like fields and selects contribute their current string value, a
radio group contributes only its checked member's string value, checked
checkbox/switch controls contribute boolean `true`, unchecked checkbox/switch
controls are omitted, password fields are excluded, and all keys/string values
stay capped (`MAX_FIELDS_KEYS`, `MAX_FIELD_VALUE_CHARS`). Field state is browser
view-state like screen/toggle state (inputs are uncontrolled; there is no value
property on a field node to write), and the server re-validates `fields` at the
boundary, so the two-writers rule holds: the server stays the only writer of
stage content. The reference-agent prompt redacts sensitive field names and
key-looking field values again when rendering current events or Sink history,
using the runtime-owned redaction rule rather than a duplicated pattern set.
The `facet-quickstart` bin stays in `@facet/quickstart`: it loads guides/assets,
serves the page itself (HTML shell + prebuilt client bundle), composes
`@facet/reference-agent` with a provider-backed reference agent, and proxies the
protocol routes to an internal loopback `createFacetServer` with a random
per-boot agent token, never exposing `/agent/*`.

The **view snapshot** is the read-side counterpart of the field snapshot: the
same browser view-state Facet already resolves locally (which `screen` is
showing, which nodes are `toggled`, and each sorted table's `sort` spec) plus a
`viewport` size class and color `scheme`, sampled at send time and attached as an
optional `view` on the forwarded event — no extra round-trip
(`navigate`/`toggle`/sort/resize/scheme-change never send on their own). The
single pure `sanitizeView` in `@facet/core` is the one bounds source: it drops
unknown enum values (including a `sort` direction outside the closed
`SORT_DIRECTIONS`), length-caps `screen`/keys, and caps `toggled` at
`MAX_VIEW_TOGGLED_KEYS` and `sort` at `MAX_VIEW_SORT_KEYS` (drop-oldest); every untrusted boundary that accepts
`view` — `@facet/server`'s `/event` and `/record`, and the `@facet/ag-ui`
normalizers — clamps through it, so a hostile `view` is bounded (never rejecting
the event) before it reaches the Sink or the agent. `view` is UI-IN inert data:
it rides browser→agent events only, is provably unable to reach any
patch/fold/executor path, and the renderer never writes stage view-state from it
(the server stays the sole stage writer — no auto-restore). `@facet/react`'s
`StageRenderer` publishes the live snapshot read-only via an optional
`onViewSnapshot` callback; `@facet/client` persists it per agent link in
`localStorage`, exposes `withView` to attach it without mutating an event, and
replays it on the next `visit` as report-only revisit context;
`@facet/reference-agent` renders it as one inert, escaped prompt line so the
model can target the visitor's current screen.

`@facet/core` also owns the closed untrusted-input normalizers
(`normalizeVisitorContext`, `normalizeClientEvent`, and
`normalizeLocalCollectedEvent`). The native server and AG-UI adapter reuse
those functions, so visitor, action, field, sequence, local-effect, and view
rules cannot drift between transport edges.

## What we adopt vs build (and why)

A deep prior-art review (2026) found **no single open standard** offers Facet's
low-level + token + flow declarative model under a permissive license — the
closest (A2UI, Adaptive Cards) are semantic widget catalogs. So:

- **Stage spec / renderer / CLI = built here**, but aligned to A2UI conventions
  (flat map, `root` id, progressive streaming) for future interop.
- **Patch format = adopted RFC 6902** instead of inventing ops.
- **Token names = aligned to the W3C DTCG format.**
- **AG-UI = adopted optional/public edge adapter** via `@facet/ag-ui` for event
  transport, while Facet owns the stage spec, renderer, and patch safety. The
  adapter maps Facet stage frames only as `STATE_DELTA`/`STATE_SNAPSHOT` events
  under the reserved `/facet/stage` path; `RunAgentInput.state` is not stage
  authority and cannot replace `StageStore`/runtime state. External NAT-safe
  AG-UI dial-out is deferred to future `@facet/ag-ui/agent`; native
  `@facet/agent-client` remains unchanged.
- Adaptive Cards independently validates the flow-only + semantic-token choices.

### What belongs in `@facet/core`

`@facet/core` is the contract everything else depends on and depends on nothing
itself, so its surface is guarded. Beyond the protocol types, it may carry
**zero-dependency, browser-safe primitives** (`createSerialQueue`,
`createSemaphore`, `createLruMap`) — but only when **≥2 packages that share no
other common home** need them. A helper used by a single package, or one that
would pull in a dependency or Node built-in, lives in that package instead.

## Boundaries and what's still out of scope

The current repo implements the **core model** (closed primitive/component
vocabulary, catalog policy, tokens/recipes, RFC 6902 patches), sessions
and the event loop, a React renderer, reference SSE+POST transports,
browser-side transports, the optional AG-UI adapter/event layer, local agent
surfaces (CLI/bridge), default asset data, file/in-memory asset references, a
Postgres store adapter, the playground, and the quickstart reference brain.

Deliberately still out of scope:

- **Hosted scale infrastructure** — Redis fan-out, multi-region delivery, queues,
  and durable orchestration beyond pluggable `StageStore`/`Sink`/`AssetsStore`
  adapters.
- **Hosted control planes** — tenant/project auth, API keys, billing, usage
  metering, rate limits, abuse operations, admin dashboards, audit logs, secrets
  management, and custom-domain routing.
- **Domain/backend work** — fetching data, taking payments, placing orders, or
  calling business APIs; those stay in the agent/operator's own tools.
- **Safety operations** — content moderation and abuse workflows for public,
  agent-authored pages.
- **SEO/crawlers** — production crawler rendering and indexing strategy.
- **Product UI** — dashboards, asset editors, tenant management, analytics,
  replay, evals, and deployment operations.

These are tracked in the README roadmap.
