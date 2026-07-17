# Architecture

Facet is a TypeScript framework for UI a language model authors as safe data.
The agent has real freedom to arrange a small native vocabulary, but it never
gets an open HTML, script, CSS, or arbitrary-style surface.

## The central contract

Facet has two layers:

1. **Brain.** An LLM or deterministic agent decides what to show and calls
   tools. Applications may replace the reference brain.
2. **Stage.** Facet validates a document, stores it, applies RFC 6902 patches,
   and renders it. This layer is the stable framework contract.

Two invariants hold across every package:

1. The agent emits only declarative native Bricks, fields, actions, and style
   choices intentionally defined by `@facet/core`.
2. Only patches travel after initial state, and server and client use the same
   pure `applyPatch` implementation.

The stage is permissive about arrangement and strict about vocabulary. That is
the main design trade: an agent can build an interface Facet's authors did not
preassemble, while every individual part stays bounded and inspectable.

## Native Bricks

Core defines exactly 11 Bricks:

| Brick | Purpose |
| --- | --- |
| `box` | The sole container; normal-flow layout, actions, bounded backdrop and modal/drawer behavior. |
| `text` | One plain text value, optionally bound to one data cell. |
| `media` | A gated image or video source. |
| `input` | A renderer-owned named control. |
| `richtext` | Closed blocks, runs, marks, and gated links. |
| `table` | Bounded tabular data with renderer-owned optional local sort. |
| `chart` | Bounded display-only chart data. |
| `list` | Ordered compact data rows. |
| `keyValue` | Label/value data rows. |
| `progress` | A bounded progress value. |
| `loading` | A renderer-owned loading indicator. |

Only `box` owns `children`. A new content kind becomes a Brick only when it needs
renderer computation that existing Bricks cannot express. A new way for `box`
to arrange or present its own content is added as a deliberate closed `box`
field instead. This keeps the roster small without turning `box` or `text` into
open-ended escape hatches.

Actions are also closed:

- `agent` sends a named event to the brain and may collect visible named inputs;
- `navigate` switches among pre-authored screens locally;
- `toggle` changes local visibility.

Local navigation, toggles, and table sort never write document content. They are
browser view-state, so the server remains the sole document writer.

## Facet Document

A document is a flat tree:

```ts
interface FacetTree {
  root: NodeId;
  nodes: Record<NodeId, FacetNode>;
  screens?: Record<string, NodeId>;
  entry?: string;
  data?: Record<string, Dataset>;
}
```

The root and every screen root are `box` Bricks. Nodes are stored by stable id;
containers refer to child ids. This shape lets an agent add a leaf, assemble a
subtree bottom-up, and patch only the changed paths.

The optional `data` map stores named arrays of flat row records. Data-bearing
Bricks may use inline data or a disclosed `from` name. A name is not a URL,
query, expression, or resolver. Missing data renders empty and can be supplied by
a later patch. Facet has no agent-authored client fetch or browser business
logic.

Theme selection and display mode are deliberately absent from the document.
They are host configuration and browser view-state, not content.

## The style system

The style system has four concepts:

1. **Style property** — an authored key such as `gap`, `fontSize`, or
   `background`.
2. **Style target** — a Brick-owned part such as `input.style.control` or
   `progress.style.track`.
3. **Token name or fixed choice** — the closed value accepted by one property.
4. **Theme** — the operator-owned data that supplies concrete token values,
   Brick defaults, and optional Presets.

There is no global target table. Identical target names on two Bricks remain two
separate contracts. Core's `BRICK_CONTRACT` is the single source for each
Brick's fields, targets, properties, allowed states, input-kind applicability,
and whether it supports `activeWhen`.

### Tokens and fixed choices

Token names are Theme-sensitive meanings. Examples include spacing names such
as `sm`/`md`/`lg`, semantic paint names such as `accent`/`success`, and named
font, radius, thickness, and size scales. The Theme decides their CSS values.

Fixed choices are closed renderer semantics that do not change by brand. Examples
include `row`/`column`, `auto`/`full`, and boolean choices.

Both sources are defined in Core with bounded descriptions and `useWhen`
guidance. A Brick property points to exactly one allowed value set. The agent
cannot supply a raw scalar where a token or fixed choice is expected.

### One complete Theme

Each agent asset snapshot has exactly one complete `FacetTheme`. Absence selects
`DEFAULT_THEME`. A Theme contains:

```ts
interface FacetTheme {
  name: string;
  description?: string;
  tokens: FacetThemeTokens;
  defaults: BrickStyleDefinitionMap;
  presets?: FacetPresets;
}
```

`tokens` is complete, including `paint.light` and `paint.dark`. `defaults`
provides one valid base style for every Brick. A Preset is scoped to one Brick
and contains bounded discovery prose plus one style definition for that Brick.
Concrete CSS values exist only inside Theme data.

`validateTheme` is an all-or-nothing operator boundary. It requires complete
token maps, validates every default and Preset against the owning Brick
vocabulary, bounds strings and collections, rejects unsafe CSS constructs, and
reports contrast findings as warnings. An invalid custom Theme is not partially
merged; asset loading and rendering fall back to the complete bundled Theme.

### Four authoring forms

Every Brick has one optional `style` entry point. The supported forms are:

1. no `style` — Theme default only;
2. `{ "preset": "name" }` — Theme default plus a same-Brick Preset;
3. direct properties — Theme default plus local style;
4. a same-Brick Preset plus a small direct adjustment.

Resolution is one deterministic merge:

```text
Theme default → same-Brick Preset → direct style
```

Each layer copies only properties, targets, and states owned by the Brick
contract. Unknown data is never spread into a renderer style object. Later
layers override only exact allowed properties.

`box` and `text` may declare `activeWhen` with `style.active`. When the predicate
matches browser-local screen or toggle state, the active Preset/direct layer is
applied after the base look. Other renderer states — hover, pressed, focus,
checked, sorted, or alternating rows — are available only on the targets and
properties that declare them.

### `colorMode` belongs to the client

`StageRenderer` accepts `colorMode: "light" | "dark" | "system"`. The default
is `system`; the browser resolves it and selects one of the Theme's two paint
maps. Server rendering falls back deterministically to light.

The effective mode is included in the renderer's read-only view snapshot so a
host may attach it to the visitor's next event. Changing it does not alter the
Facet Document, emit a patch, or give the agent a second styling mechanism.

## Patterns

A Pattern is an ordinary valid Facet tree plus bounded discovery metadata:

```ts
interface FacetPattern extends FacetTree {
  name: string;
  description: string;
  useWhen: string;
  avoidWhen?: string;
}
```

Patterns are read-only examples for the brain. They add no node kind, runtime
reference, parameter substitution, provenance field, or automatic insertion.
`validatePatternList` validates each complete tree against the effective Theme,
bounds the list and node count, keeps valid entries, and reports invalid entries.

The agent sees Pattern metadata in its prompt. If one fits, `get_pattern`
returns the exact validated tree; the agent then adapts and re-authors ordinary
native Bricks through mutation tools. Pattern trees stay on the agent side until
the agent authors a document change.

## Progressive discovery

Putting every Brick and style rule inside every mutation schema would make the
tool surface too large. Core's `STAGE_SPEC` therefore states the portable
document, style, action, and validation contract without naming one runner's
tools or result codes. `@facet/agent-tools` adds its concrete discovery/editing
workflow and creates one immutable turn snapshot containing:

- the complete validated Theme for internal validation;
- the exact validated Pattern list;
- bounded Pattern, Preset, and Brick indexes for the prompt.

The prompt teaches a simple order:

1. Pattern metadata first; call `get_pattern` when a worked structure fits.
2. Preset metadata next; call `get_preset` when a same-Brick visual role fits.
3. Brick metadata next; call `get_brick_spec({ type })` for one unfamiliar Brick.
4. When directly choosing one unfamiliar value, call
   `get_style_choices({ brick, target, property })`.

`get_brick_spec` returns exact fields and a compact map of Brick-owned style
paths. It identifies each property as token-backed or fixed without repeating
all choice metadata. `get_style_choices` resolves one exact local path through
Core and returns its property guidance and allowed values with meanings. It is
not a global token browser.

Pattern and Preset styles already present in the validated snapshot are known
valid and may be re-authored without redundant choice lookups. All four asset
reads are no-stage-change operations with zero messages and patches.

The reference brain preserves the newest exact asset-read group through its
first provider handoff. If the complete next request cannot fit the context
budget, the loop stops with `context_limit` instead of truncating authoritative
style or Pattern data.

## Strict authoring and fail-soft rendering

Facet intentionally uses two validation policies.

### Agent mutation boundary: strict and atomic

`validateAuthorNode` and `validateAuthorTree` reject a mutation when any authored
field, target, property, state, Preset name, token name, fixed choice, reference,
or bound is invalid. The executor returns:

- `status: "error"` and `outcome: "rejected"`;
- bounded structured errors with exact paths and repair guidance;
- zero patches and unchanged local shadow state.

This is the normal feedback loop. The agent reads the result, repairs the whole
call, and retries. A renderer fallback never turns invalid authoring into
success.

### Persisted/render boundary: fail-soft

`validateTree`, the style resolver, and `StageRenderer` are the last defense for
stale, partially patched, persisted, or bypassed data. They ignore invalid style
fragments, prune unusable references, break cycles, cap traversal, and skip
unknown or dangling nodes. Valid Bricks and siblings continue to render.

This asymmetry gives the agent precise correction while keeping a visitor's page
alive under imperfect external state.

## Renderer layout contract

Every native renderer root follows three rules:

- **Parent owns placement.** Direction, gap, alignment, wrapping, and columns
  place immediate children.
- **Child owns internal layout.** A child stays inside the slot its parent gives
  it.
- **Renderer owns containment.** Long text wraps; controls and media stay within
  bounds; tables use renderer-owned bounded overflow.

There is no general authored positioning or z-index. A `box` backdrop and
modal/drawer are bounded renderer-owned mechanisms with fixed layering and
containment, not arbitrary CSS escape hatches.

## Patches and the event loop

The runtime event loop is:

```text
visitor event
  → open the current stage
  → run the agent against one immutable asset snapshot
  → validate tool calls and fold local shadow state
  → emit RFC 6902 patch messages
  → persist the resulting stage
  → record conversation output through Sink
```

`StageStore`, `Sink`, `AssetsStore`, and `SummaryStore` are Promise-based
interfaces so production deployments can provide durable adapters. The runtime
serializes work per `(agent, visitor)` while allowing different visitors to run
independently.

The browser applies patches with the same `applyPatch` as the server. Browser
view-state — current screen, toggles, local table sort, viewport class, and
effective `colorMode` — remains separate. An outgoing event may carry a snapshot
of that state, but it never becomes a second content writer.

Patch producers use Core's `escapeJsonPointerToken` for every dynamic RFC 6901
path token, so node ids, screen names, and dataset names share one escaping
implementation across packages.

## Assets and boot

The per-agent asset store exposes three current documents:

```text
theme.json
patterns.json
initial.tree.json   # optional
```

`loadAssets` validates them once into a deeply frozen snapshot. Missing Theme or
Pattern documents select bundled defaults; an explicit empty Pattern list
selects none. A malformed custom Theme falls back whole. Invalid Patterns are
omitted. An invalid or non-seedable initial tree is ignored so boot can continue
with model-first paint.

`MemoryAssets` is browser-safe. `FileAssets` lives behind `@facet/runtime/node`
and bounds directory enumeration, file bytes, parsing, and issue text before
handing raw documents to `loadAssets`.

`withInitialStage` is a `StageStore` decorator. A valid seed enters through the
same serialized stage path and reaches the browser as ordinary initial state and
patch data; it does not create another writer or protocol.

## Package boundaries

Dependencies point toward `@facet/core`; Core has no dependencies. Nothing
depends on the playground app.

- **Foundation:** `@facet/core`, `@facet/runtime`, `@facet/react`,
  `@facet/assets`.
- **Agent authoring:** `@facet/agent-tools`, `@facet/agent`.
- **Integration adapter:** `@facet/ag-ui`.
- **Reference implementations:** `@facet/server`, `@facet/client`,
  `@facet/agent-client`, `@facet/store-postgres`, `@facet/reference-agent`.
- **Local tools:** `@facet/quickstart`, `@facet/cli`, `@facet/bridge`.

The server/client packages are reference transports, not a hosted edge. See
[Package boundaries](PACKAGE-BOUNDARIES.md) for support and deployment language.

## AG-UI edge adapter

AG-UI is an optional/public edge adapter implemented by `@facet/ag-ui`; it is
not a second Stage implementation. Facet owns the stage spec, renderer, and
patch safety. The adapter translates Facet patch frames and authoritative Stage
snapshots to `STATE_DELTA`/`STATE_SNAPSHOT` events under the reserved
`/facet/stage` path, and converts only that reserved state subtree back to native
Facet messages. `RunAgentInput.state` is not stage authority: visitor events and
local records enter through bounded `forwardedProps.facet` data, while
`StageStore` and the Facet runtime remain authoritative for document state.

External NAT-safe AG-UI dial-out is deferred to a future
`@facet/ag-ui/agent`; native `@facet/agent-client` remains unchanged. The native
`@facet/client`/`@facet/server` path remains the local/reference fallback rather
than depending on this adapter.

## Out of scope

Facet does not own the brain's business policy, external tool selection, tenant
identity, API-key issuance, billing, rate limits, abuse operations, audit logs,
secret management, or custom-domain routing. It also does not prescribe a
distributed stage backend. Those concerns wrap or implement the interfaces
above without changing the Facet Document contract.

## Pre-1.0 hard cut

The current Theme/Preset/Pattern and Brick-owned style contract has no
compatibility bridge for pre-cutover documents or tool calls. Current validators,
asset loaders, file loaders, public exports, and tool schemas reject or ignore
retired shapes rather than guessing at intent. See
[Style system migration](STYLE-SYSTEM-MIGRATION.md) for the supported replacement
workflow.
