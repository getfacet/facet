# Facet vs Google A2UI

A competitive/architecture comparison between Facet and Google's **A2UI**
(Agent-to-UI) protocol — the closest existing neighbor to Facet found in a survey
of declarative / LLM-rendered UI systems.

> **Status:** analysis snapshot, re-verified 12 July 2026 against A2UI **v0.9.1
> (stable) / v1.0 (release candidate)**. A2UI is very new and fast-moving
> (v0.8 → v0.9 renamed message types and changed the data-model shape), so
> version-specific details below may drift. Every A2UI claim here traces to a
> primary source (a2ui.org spec/reference, the `google/A2UI` repo, the Google
> Developers blog); claims were adversarially cross-checked before inclusion.

## TL;DR

Facet's core idea — **a language model authoring a live UI from safe declarative
primitives, over a framework-agnostic core** — is not unique: Google's A2UI
converged on nearly the same shape, independently and around the same time
(A2UI launched ~Nov–Dec 2025). This is a *validation signal*, not a threat: a
large player reaching the same conclusion says the problem's answer really does
look like this.

Facet and A2UI **agree on the fundamentals** and **diverge on three deep axes**,
where Facet is deliberately **stricter and simpler**:

1. **One update channel vs two.** Facet sends **only RFC-6902 JSON Patches**, and
   the *same pure `applyPatch`* runs on server and client, so they cannot drift.
   A2UI has two update grammars (ID-based `updateComponents` + JSON-Pointer
   `updateDataModel`) with no stated shared-reducer guarantee.
2. **A centrally governed vocabulary vs negotiated catalogs.** Facet's
   dependency-free core owns one closed 11-brick vocabulary, with node kinds
   added deliberately and checked by the same validator. A2UI negotiates
   versioned developer catalogs. Both
   recommend graceful degradation for renderer gaps; Facet makes skip-on-unknown
   and skip-on-dangling behavior a library invariant.
3. **One integrated default vs transport-neutral payload.** Facet ships its
   own patch/runtime/reference-transport loop and also provides an official
   `@facet/ag-ui` adapter. A2UI defines the UI payload and catalog handshake,
   while A2A, AG-UI, WebSocket, or another carrier supplies delivery.

One-liner positioning: **Facet is the patch-only, closed-vocabulary take on the
same idea A2UI implements with negotiated, versioned catalogs.**

## What A2UI is

A2UI (Google, Apache-2.0) is a declarative, LLM-authored generative-UI protocol.
The agent emits UI as a **stream of JSON Lines** (`application/a2ui+json`) with
four server-to-client message types — `createSurface`, `updateComponents`,
`updateDataModel`, `deleteSurface` — plus a client-to-server `action`. UI is a
**flat, ID-referenced adjacency list** of catalog-typed components (chosen so an
LLM can stream it incrementally), bound to a **separate JSON-Pointer data model**.
Rendering is done by **per-platform renderers** (React / Lit / Angular / Flutter)
sharing a framework-agnostic core (`@a2ui/web_core`). A2UI defines no transport of
its own; it rides A2A / AG-UI / MCP / SSE / WS / REST.

Primary sources: <https://a2ui.org/>, <https://github.com/google/A2UI>,
<https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/>.

## The four pillars, side by side

| Pillar | Facet | A2UI |
| --- | --- | --- |
| **Declarative, not code** | ✅ flat node map with a closed 11-brick vocabulary, token styling, flow-only | ✅ flat ID-list of catalog components, JSON "intent" |
| **LLM-authored** | ✅ agent emits the brick spec | ✅ designed for token-by-token generation |
| **Live updates via diff** | ✅ **RFC-6902 patch only**, shared `applyPatch` both sides | 🔸 two grammars: `updateComponents` (ID ops) + `updateDataModel` (JSON-Pointer upsert), **not** RFC-6902 |
| **Safe by construction** | ✅ core-governed vocabulary + **fail-safe skip** renderer | ✅ versioned client catalog + validation and graceful-degradation guidance |

Both are declarative-only, safe-vocabulary, LLM-authored UI specs with a
framework-agnostic core — strong agreement on philosophy. The divergence is in the
*strictness* of the update channel, the *governance* of the palette, and whether
the default stack is integrated or assembled from transport-neutral layers.

## Architecture: A2UI layers ↔ Facet packages

| A2UI layer | What it does | Facet counterpart |
| --- | --- | --- |
| Protocol / message layer (JSONL, 4 message types) | Wire format between agent and client | `@facet/core` `protocol.ts` (`ServerMessage`: `patch`/`say`/`reset`) |
| Component model (flat ID adjacency list + catalog) | The declarative UI representation | `@facet/core` `tree.ts` + `nodes.ts` (flat node map with a closed 11-brick vocabulary) |
| Data model + JSON-Pointer binding | App state decoupled from UI structure | `FacetTree.data` + closed `from` projections, updated through ordinary RFC-6902 paths |
| Rendering runtime (`@a2ui/web_core`) + per-platform renderers | Turn wire format into native UI | `@facet/runtime` (framework-agnostic) + `@facet/react` (single renderer) |
| Safety / validation (catalog typing, Zod) | Constrain what the agent can render | `@facet/core` `validateTree` + fail-safe renderer |
| Transport / layering (A2A, AG-UI, …) | Delivery + interaction round-trip | `@facet/server` (SSE + POST) + `@facet/client` + `@facet/agent-client` |

Key structural notes:

- **Both separate reusable data from structure, at different power levels.**
  Facet supports inline display values (`text.value`, `media.src`) plus an
  optional top-level `FacetTree.data` warehouse of bounded row records. A
  `table`, `chart`, `list`, `keyValue`, or single-cell `text` binds by dataset
  name through a closed, type-owned `from` projection. A2UI exposes a more
  general separate model addressed by JSON Pointer. Facet deliberately keeps
  the data schema and projection grammar smaller, and every granular data update
  still travels through the same RFC-6902 patch channel as structure.
- **The event pipeline.** Both send *structured user interactions* back to the
  agent, not just text. Facet's `ClientEvent` is `visit | message | tap`, where
  an agent-directed tap carries the `FacetAction` plus press-time-snapshotted field values
  (`fields`) — and Facet **owns this whole loop** in `@facet/core` + `@facet/server`.
  A2UI defines a client-to-server `action` message too, but A2UI is *only the UI
  layer*: a chosen transport such as AG-UI or A2A carries it. A2UI alone is not a
  full interaction runtime, while Facet ships a native reference loop and an
  official AG-UI adapter.
- **Transport is the same class of mechanism.** Facet uses SSE + POST; AG-UI is
  also canonically SSE (≈17 event types). Facet is **not behind** on live
  streaming — the two are peers on mechanism. AG-UI's value over Facet's own
  transport is **ecosystem interop** (a standard event vocabulary that LangChain /
  CrewAI / Google ADK / etc. already speak), not raw capability.

## Where they fundamentally differ

1. **Coherence guarantee.** Facet's "only patches travel + shared pure
   `applyPatch`" *structurally* prevents server/client drift. A2UI's client-side
   `web_core` reconstructs state; whether an identical reducer is guaranteed on
   both sides is unclear (open question). This is Facet's narrowest but realest
   architectural edge.
2. **Palette governance.** Facet evolves one auditable core vocabulary and makes
   fail-safe skipping normative. A2UI lets applications publish and negotiate
   versioned catalogs, with validation, error reporting, and graceful-degradation
   guidance. Facet centralizes compatibility; A2UI distributes it to catalog and
   renderer authors.
3. **Integrated default vs transport-neutral payload.** Facet is coherent out of
   the box and can translate through `@facet/ag-ui`. A2UI is designed to compose
   with A2A, AG-UI, WebSocket, or custom transports. That improves ecosystem fit,
   while hosts own more cross-layer compatibility decisions.

## Borrow backlog (ideas from A2UI, ranked)

Each must respect Facet's invariants — anything that would violate declarative-only,
patch-only + shared `applyPatch`, fail-safe, closed-vocabulary governance, or one-way deps
is flagged. These are candidates, not commitments.

1. **Formalize a renderer-core boundary + a second reference renderer.** `[effort M · risk LOW]`
   A2UI's biggest payoff is one payload → many native renderers via a shared
   framework-agnostic core. Facet is ~80% there (`@facet/core` + `@facet/runtime`
   are node-free). Extract any renderer-neutral apply/reduce/validate logic out of
   `@facet/react` into `@facet/runtime` (or a new `@facet/render-core`), leaving
   `@facet/react` thin; then ship e.g. `@facet/lit` or `@facet/vue`. *Risk only if
   DOM/React types leak into core — core must stay browser-safe/node-free.*
2. **Versioned envelope + registered MIME type** (an `application/facet+json`
   analogue with a protocol-version field). `[effort S · risk LOW]` Lets old
   clients degrade gracefully across schema evolution. Additive metadata on the
   *envelope*, not on brick nodes; doesn't touch patch-only.
3. ~~**Pluggable AG-UI transport adapter.**~~ **Shipped** as `@facet/ag-ui`.
   The adapter translates Facet's existing patch/state contract onto AG-UI events
   without introducing A2UI's data model as a second authoritative state grammar.
   A2A remains a future demand-driven adapter rather than a core dependency.
4. **Versioned registry for default-asset data (`@facet/assets`).** `[effort M · risk MODERATE — care]`
   Capture useful versioning ergonomics at the *asset-data* layer — complete
   Themes and concrete Patterns as validated data, not code or a policy layer.
   *Violates the closed-vocabulary invariant the moment an entry introduces a node
   type not deliberately defined and validated by core, or admits raw markup.*
5. **First-class execution-boundary annotation on actions** (A2UI's `callableFrom`
   concept). `[effort S · risk LOW-MODERATE]` Facet already seeds this: `FacetAction`
   is `agent | navigate | toggle`, where `navigate`/`toggle` are client-only.
   Promote that to a named, `validateTree`-enforced discriminator. *Keep it an enum
   over Facet's fixed safe behaviors — do NOT let the client execute agent-supplied
   expressions (A2UI has an Expression Parser); that would breach declarative-only.*
6. **Renderer conformance suite.** `[effort S · risk LOW]` A shared vitest suite
   asserting any Facet renderer applies patches via the shared `applyPatch`,
   fail-safe-skips unknown nodes, routes field/press events, and honors
   client-only `navigate`/`toggle`. Makes borrow #1's multiple renderers testable.

## Should Facet adopt A2A now?

AG-UI has already been adopted as an optional integration adapter; the native
SSE + POST packages remain the reference path. A2A should stay demand-driven
while its Facet use case and compatibility surface are less clear. The one-way
dependency rule lets a future adapter remain outside the foundation contracts.

## Open questions

- Does A2UI guarantee an identical reducer on server and client, or is
  coherence the client's responsibility? (Determines whether Facet's patch-only
  invariant is a genuine edge or just a different tradeoff.)
- Is there a Facet use case (forms, live-bound content) compelling enough to
  justify a second addressing scheme (a data model), or should data always fold
  into the tree via patches?
- Do A2UI's `callableFrom` / Expression Parser allow client-evaluated
  agent-supplied logic — and can the useful part be reduced to a safe fixed enum
  for Facet?
- Is the A2A/AG-UI stack adopted enough to justify building an interop adapter
  now versus after the ecosystem settles?

## Sources

- [A2UI overview](https://a2ui.org/) and
  [message reference](https://a2ui.org/reference/messages/)
- [A2UI component/catalog model](https://a2ui.org/concepts/catalogs/) and
  [transport model](https://a2ui.org/concepts/transports/)
- [A2UI repository](https://github.com/google/A2UI)
- [Google Developers: Introducing A2UI](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/)
- [AG-UI docs](https://docs.ag-ui.com) and
  [CopilotKit repository](https://github.com/CopilotKit/copilotkit)
- Facet internals — `packages/core/core/src/nodes.ts`,
  `packages/core/core/src/protocol.ts`, `packages/adapters/server/src/server.ts`,
  `AGENTS.md`
