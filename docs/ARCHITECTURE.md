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

## Why low-level bricks (the central bet)

Every existing way to let an agent build UI sits at one of two extremes:

- **Semantic widgets** (A2UI, Adaptive Cards, DivKit, Thesys C1): the agent picks
  from a catalog of finished components (Card, Button, Chart). Safe and easy to
  get right in one shot, but *not free* — anything not in the catalog is
  impossible.
- **Raw HTML/iframe** (MCP-UI, MCP Apps, "generate a website" tools): the agent
  writes actual page code. Total freedom, but unsafe (injection) and prone to
  visual breakage.

Facet takes the empty middle: **low-level bricks** the agent composes freely.
The trick that makes this safe *and* one-shot-reliable is that freedom and
fragility are separated onto different axes:

- Freedom comes from **composition** — four bricks (`box`, `text`, `image`,
  `field`) stack into anything.
- Safety comes from **constraining the bricks, not the composition**: bricks are
  typed data (no raw HTML/JS), style values are **tokens** not scalars, layout is
  **flow-only** (no absolute positioning), every prop has a **default**, and the
  renderer is **fail-safe**.

So "broken" splits into two kinds, and both are designed out: *crashes /
injection / overlap* are made structurally impossible; *ugliness* is prevented
because tokens force every choice onto a coherent scale. One-shot leverage (the
thing semantic catalogs were good at) is restored later by an optional preset
package whose helpers are themselves just box compositions.

## The brick palette

`FacetNode` is a closed union of four bricks (see `core/src/nodes.ts`):

- `box` — the only container. Flow layout (`direction: row|col`), token styles,
  an optional `onPress` action (a pressable box is the button primitive), and an
  optional `hidden` flag (a content-declared initial-collapsed default).
- `text` — a string with token text styles.
- `image` — `src` + `alt` + token styles.
- `field` — an input (`name`, `input` kind, token styles).

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
needs new reasoning.

Style values are **tokens** defined in `core/src/tokens.ts` (`Space`, `FontSize`,
`Color`, `Radius`, …). Token names are the agent-facing vocabulary; the concrete
CSS lives only in the renderer's theme (`react/src/theme.ts`), so reskinning
every page is a one-file change and the agent never deals in pixels. The token
names are kept compatible-in-spirit with the W3C Design Tokens (DTCG) format.

## Themes, stamps, and seeds: reskin as data

The renderer-owns-the-CSS rule above makes a reskin a one-file change; the theme
layer makes it a **data** change — without moving the pixel boundary into the
spec. Raw CSS values enter Facet in exactly one place — `validateTheme` in
`@facet/core` — and only as **operator data**, never as tree content or model
output. A `FacetTheme` is a partial override document (token name → CSS value),
and the validator is the single gate it passes: an allowlist per token group, a
deny-list (`url()`, `var()`, `expression()`, `javascript:` and injection
characters are refused), dimension clamps so a theme can't push content
off-screen, and a WCAG contrast check that is *measured as a warning, never a
rejection* (Facet measures; the caller sets policy). Output maps are built on
`Object.create(null)` so a hostile key can never resolve. The validator is pure
and dependency-free, so it runs identically on the server and in the browser.

The stage tree carries only a **name**: `FacetTree.theme?: string`,
kept-if-string by `validateTree`. `STAGE_SPEC` teaches the agent to set it to a
theme name it has been given and nothing else — **the LLM never authors theme
values**; the style functions still index by token name. Resolution is a
boot-shipped map plus a local lookup: the validated theme documents ship to the
browser **once**, inline in the quickstart HTML shell as an escaped
`window.__FACET_THEMES__` global, and `resolveTheme` (`@facet/react`) maps the
tree's theme name to a resolved token map, falling back to the default for an
unknown or missing name. This is a pure lookup — the browser writes no stage
state — and it introduces **no new protocol message**: `@facet/server` and
`@facet/client` are untouched, and a live theme switch is just a normal `/theme`
patch re-resolved locally.

The document library itself is a **pluggable adapter, exactly like `StageStore`**:
`AssetsStore` is an interface with a browser-safe `MemoryAssets` reference in
`@facet/runtime`'s main barrel and a file-backed `FileAssets` behind
`@facet/runtime/node` (so a browser bundle never drags in `node:fs`); a database
adapter would live outside, the `@facet/store-postgres` precedent. `loadAssets`
runs the core validators once at boot (no hot reload) and skips any invalid
document with a logged issue — the same skip-and-log posture the file stage store
already uses. **Stamps** — validated `{ root, nodes }` brick fragments — reach the
LLM as prompt data only; the model copies their nodes into ordinary patches.
There is **no client-side stamp expansion** anywhere: `validateTree` and the
fail-safe renderer see only the copied nodes, exactly as they do today.

Seeding a page before the first model call is a `StageStore` **decorator**,
`withInitialStage`, that opens a fresh session on a validated initial tree
instead of `EMPTY_TREE`. Because every `open()` runs under the runtime's
per-`(agent, visitor)` serial queue and *before* the agent's first turn, the seed
is inside the same serialized stage-write path (the server stays the only writer)
and is visible to that first turn, which then refines it. The seed also
**travels the patch channel**: the browser's first connection rehydrated before
the session existed, so the store reports the fresh seed once (`takeSeeded`) and
the runtime prepends a root `replace` as that turn's first frame — stamped,
replayable, and applied by the same `applyPatch` on both sides. The frame is
consumed only when the turn persists; a failed first turn re-emits it, and a
reconnect gets the seed the normal way, via the rehydrate snapshot. For the
very first paint the quickstart shell also ships the seed (and the resolved
theme's canvas colors) with the page itself — `useFacet` can start from a
boot-shipped tree, so nothing waits on the model; the seed frame then applies
idempotently. One
trap is closed deliberately: `validateTree` returns `EMPTY_TREE` on garbage,
which would silently seed a blank page and flip the server's offline face, so a
tree that isn't *seedable* (a render root with at least one child, or a non-empty
`screens`) is refused as a seed and boot falls back to today's model-first paint.

## The stage tree

A Stage is a `FacetTree`: a flat map of nodes keyed by id, with one node whose id
is `root`.

```ts
interface FacetTree {
  root: NodeId;
  nodes: Record<NodeId, FacetNode>;
  screens?: Record<string, NodeId>; // named screens → their root node id
  entry?: string; // which screen shows first
}
```

The flat-list-with-id-references shape (the same idea as Google A2UI) lets an
agent stream and patch a tree incrementally — adding one node at a time — instead
of re-emitting a whole page on every change.

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

`applyPatch(tree, operations)` (in `core/src/patch.ts`) is a small, dependency-free
implementation of the six standard ops, and it is pure. The exact same function
runs on the server (to keep the session's authoritative stage) and on the client
(to update the DOM), so the two can never drift.

## The event loop

```
ClientEvent  →  FacetRuntime  →  FacetAgent  →  ServerMessage[]
                    │                                  │
                    └── applies patches to the session ┘
```

- `ClientEvent` is everything a visitor can do: `visit`, `message`, `action`.
- `FacetRuntime.handle(visitor, event)` opens (or finds) the session for that
  `(agent, visitor)` pair, runs the agent, applies any returned patches to the
  stored stage, and returns the messages to ship back over that visitor's
  connection.
- `ServerMessage` is what the agent answers with: `patch` (RFC 6902 operations)
  and/or `say` (chat text).

Sessions are keyed by `(agentId, visitorId)`, which is exactly why the page is
"different for everyone": each visitor has an isolated stage.

## The agent's "CLI"

Agents don't hand-assemble patch arrays. `@facet/agent` gives a fluent control
surface that records standard RFC 6902 ops underneath:

```ts
defineAgent(({ event, session, stage }) => {
  stage
    .append("root", card)   // → add /nodes/<id> + add /nodes/root/children/-
    .say("Added it below.");
});
```

`Stage` coalesces consecutive stage edits into one `patch` message and preserves
ordering relative to `say(...)`. Replace the hand-written branches with an LLM
call that emits the same operations and nothing else in the stack changes.

## Reference brain: `@facet/quickstart`

The brain is out of scope for Facet — the user brings the LLM/rules — but a
*reference* brain ships anyway, exactly as a reference transport does:
`@facet/quickstart` is to brains what `@facet/server` is to transports. Its
built-in agent is an ordinary `FacetAgent` handed to the existing
`createFacetServer({ agent })` seam, its LLM calls sit behind a small
`QuickstartProvider` interface (OpenAI/Anthropic adapters, or a deterministic
stub), and core/runtime/server gain zero LLM awareness — any user brain drops
into the same slot, so the boundary stays intact while `npx facet-quickstart`
gives a one-command first run.

The built-in agent is a **tool-calling loop** (not a single completion): each
turn the model calls tools across a bounded number of steps, observing each
result before deciding the next. Five tools map 1:1 onto the `Stage` control
API — `append_node` / `set_node` / `remove_node` (incremental edits),
`render_page` (a full redraw), and `say` (chat) — via the provider's native
function-calling (OpenAI) / tool-use (Anthropic). It is fail-safe throughout: a
bad tool argument becomes an `error:` observation the model recovers from
(never a throw), a provider failure mid-loop keeps whatever the stage already
has, and a turn that accomplishes nothing degrades to one apologetic chat line.

Quickstart's flagship interaction is the **field snapshot**: a pressable box's
agent action may declare `collect: "<box id>"`, and at press time the renderer
takes a synchronous snapshot of the visible `field` values under that box
(string-coerced, capped at `MAX_FIELD_VALUE_CHARS`) and ships them as `fields`
on the action event — the values ride the event, **never the tree**. Field text
is browser view-state like screen/toggle state (inputs are uncontrolled; there
is no value property on a field node to write), and the server re-validates
`fields` at the boundary, so the two-writers rule holds: the server stays the
only writer of stage content. The `facet-quickstart` bin serves the page itself
(HTML shell + prebuilt client bundle) and proxies the protocol routes to an
internal loopback `createFacetServer` with a random per-boot agent token,
never exposing `/agent/*`.

## What we adopt vs build (and why)

A deep prior-art review (2026) found **no single open standard** offers Facet's
low-level + token + flow declarative model under a permissive license — the
closest (A2UI, Adaptive Cards) are semantic widget catalogs. So:

- **Stage spec / renderer / CLI = built here**, but aligned to A2UI conventions
  (flat map, `root` id, progressive streaming) for future interop.
- **Patch format = adopted RFC 6902** instead of inventing ops.
- **Token names = aligned to the W3C DTCG format.**
- Adaptive Cards independently validates the flow-only + semantic-token choices;
  AG-UI (transport-only) remains a candidate event channel but is not a v0
  dependency (a native SSE/WebSocket channel emitting RFC 6902 patches is simpler).

### What belongs in `@facet/core`

`@facet/core` is the contract everything else depends on and depends on nothing
itself, so its surface is guarded. Beyond the protocol types, it may carry
**zero-dependency, browser-safe primitives** (`createSerialQueue`,
`createSemaphore`, `createLruMap`) — but only when **≥2 packages that share no
other common home** need them. A helper used by a single package, or one that
would pull in a dependency or Node built-in, lives in that package instead.

## Boundaries and what's deferred

The current scaffold implements the **core model**: bricks, tokens, RFC 6902
patches, sessions, the event loop, a React renderer, and an in-process demo.
Deliberately deferred:

- **Transport** — a WebSocket/SSE server and a browser playground.
- **Presets** — the `@facet/kit` preset package.
- **Cost & latency** — caching and a static skeleton so the first paint isn't
  gated on a model call.
- **Durability & scale** — a database `StageStore`/`Sink` backend beyond the
  in-memory and file references (e.g. Postgres for a hosted SaaS).
- **Safety** — content moderation for public, agent-authored pages.
- **SEO/crawlers** — a stable default face for non-interactive clients.

These are tracked in the README roadmap.
