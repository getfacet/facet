# Facet vs Google A2UI

A competitive/architecture comparison between Facet and Google's **A2UI**
(Agent-to-UI) protocol — the closest existing neighbor to Facet found in a survey
of declarative / LLM-rendered UI systems.

> **Status:** analysis snapshot, verified July 2026 against A2UI **v0.9.x
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
2. **A fixed 4-brick palette vs an extensible catalog.** Facet fixes
   `box/text/media/field` in a dependency-free core and its renderer is
   **fail-safe (skips unknown/dangling nodes, never throws)**. A2UI uses a
   developer-extensible client catalog and **rejects** unknown types.
3. **One integrated contract vs a three-spec stack.** Facet bundles the UI spec,
   the event pipeline, and the transport into its own packages. A2UI is *only*
   the UI-payload layer and layers on **AG-UI** (interaction transport) + **A2A**
   (agent-to-agent execution).

One-liner positioning: **Facet is the patch-only, minimal, self-contained take on
the same idea A2UI implements as a composable, ecosystem-oriented stack.**

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
| **Declarative, not code** | ✅ nested tree of 4 bricks, token styling, flow-only | ✅ flat ID-list of catalog components, JSON "intent" |
| **LLM-authored** | ✅ agent emits the brick spec | ✅ designed for token-by-token generation |
| **Live updates via diff** | ✅ **RFC-6902 patch only**, shared `applyPatch` both sides | 🔸 two grammars: `updateComponents` (ID ops) + `updateDataModel` (JSON-Pointer upsert), **not** RFC-6902 |
| **Safe by construction** | ✅ fixed 4-brick core + **fail-safe skip** renderer | ✅ client catalog (developer-extensible) + **reject** unknown |

Both are declarative-only, safe-primitive, LLM-authored UI specs with a
framework-agnostic core — strong agreement on philosophy. The divergence is in the
*strictness* of the update channel, the *size/governance* of the palette, and
whether the stack is *integrated or layered*.

## Architecture: A2UI layers ↔ Facet packages

| A2UI layer | What it does | Facet counterpart |
| --- | --- | --- |
| Protocol / message layer (JSONL, 4 message types) | Wire format between agent and client | `@facet/core` `protocol.ts` (`ServerMessage`: `patch`/`say`/`reset`) |
| Component model (flat ID adjacency list + catalog) | The declarative UI representation | `@facet/core` `nodes.ts` (nested 4-brick tree) |
| Data model + JSON-Pointer binding | App state decoupled from UI structure | *(no direct analogue — Facet embeds display data in the brick: `text.value`, `image.src`, `field`)* |
| Rendering runtime (`@a2ui/web_core`) + per-platform renderers | Turn wire format into native UI | `@facet/runtime` (framework-agnostic) + `@facet/react` (single renderer) |
| Safety / validation (catalog typing, Zod) | Constrain what the agent can render | `@facet/core` `validateTree` + fail-safe renderer |
| Transport / layering (A2A, AG-UI, …) | Delivery + interaction round-trip | `@facet/server` (SSE + POST) + `@facet/client` + `@facet/agent-client` |

Key structural notes:

- **Data lives in different places.** Facet puts display data *inside* the brick
  (`text.value`, `image.src`, `field`). A2UI keeps a *separate* data model that
  components bind to by JSON-Pointer path. A2UI's separation is genuinely nicer
  for data-heavy / reactive UIs (update one value without touching structure; one
  value feeds many components). Facet's in-tree model is simpler and pairs with
  the single patch channel — a granular value change is just a `replace` patch on
  a deep path, so Facet also does **not** resend the whole tree. This is a
  **tradeoff**, not a Facet win: Facet trades data-binding ergonomics for a single
  addressing grammar and provable coherence.
- **The event pipeline.** Both send *structured user interactions* back to the
  agent, not just text. Facet's `ClientEvent` is `visit | message | action`, where
  `action` carries the `FacetAction` plus press-time-snapshotted field values
  (`fields`) — and Facet **owns this whole loop** in `@facet/core` + `@facet/server`.
  A2UI defines a client-to-server `action` message too, but A2UI is *only the UI
  layer*: the actual interaction transport is **AG-UI's** job (Google's three-layer
  stack: A2UI = rendering contract, AG-UI = interaction, A2A = execution). So A2UI
  alone is not a full pipeline; AG-UI completes it.
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
2. **Palette governance.** Facet fixes the palette in a dependency-free,
   auditable core and degrades gracefully (skip unknown). A2UI trusts developers
   to extend the catalog per app (larger surface, per-app risk) and rejects
   unknown. Facet's minimalism + fail-safe is the stricter safety posture.
3. **Integrated vs layered.** Facet is self-contained (one contract, ships its own
   transport). A2UI is composable across the emerging Google/CopilotKit agent
   stack. Self-contained = simpler and coherent by construction; layered =
   interoperable but you assemble three specs and own the cross-layer consistency.

## Borrow backlog (ideas from A2UI, ranked)

Each must respect Facet's invariants — anything that would violate declarative-only,
patch-only + shared `applyPatch`, fail-safe, 4-brick minimalism, or one-way deps
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
3. **Pluggable A2A / AG-UI transport adapter** (`@facet/transport-agui` /
   `-a2a`). `[effort M · risk MODERATE]` Interop with the agent-protocol ecosystem
   without abandoning the self-contained default. *Must translate RFC-6902 patches
   onto the channel's events and NOT introduce A2UI-style JSON-Pointer data upserts
   as a second update grammar; drop two-way data-model sync rather than bolt it on.*
4. **Versioned registry for default-asset data (`@facet/assets`).** `[effort M · risk MODERATE — care]`
   Capture the ergonomics of an extensible catalog at the *asset-data* layer —
   themes and stamps as versioned value maps, not code.
   *VIOLATES 4-brick minimalism the moment an entry introduces a new node type or
   admits raw markup. Safe only while every stamp provably reduces to
   `box/text/media/field` before it hits the wire.*
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

## Should Facet adopt AG-UI / A2A now?

Not yet, most likely. AG-UI, A2A, and A2UI are all pre-1.0 and the ecosystem is
still settling. With a first npm release ahead, the sensible sequence is: ship
Facet's self-contained SSE + POST transport as the reference, keep the core pure,
and add ecosystem adapters (borrow #3) later — when the standards stabilize and
there's real demand. Facet's architecture (mechanism-vs-policy, pluggable
transport, one-way deps) is designed to allow this without compromising the core.

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

- A2UI spec & docs — <https://a2ui.org/> (reference/messages, concepts/data-flow,
  concepts/data-binding, renderers, v0.9 evolution guide)
- A2UI repo — <https://github.com/google/A2UI>
- Google Developers blog, "Introducing A2UI" —
  <https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/>
- AG-UI (CopilotKit) — <https://docs.ag-ui.com>, <https://github.com/CopilotKit/copilotkit>
- Facet internals — `packages/core/src/nodes.ts`, `packages/core/src/protocol.ts`,
  `packages/server/src/server.ts`, `CLAUDE.md`
