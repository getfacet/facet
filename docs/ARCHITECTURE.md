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

- `ClientEvent` is everything a viewer can do: `visit`, `message`, `action`.
- `FacetRuntime.handle(visitor, event)` opens (or finds) the session for that
  `(agent, visitor)` pair, runs the agent, applies any returned patches to the
  stored stage, and returns the messages to ship back over that viewer's
  connection.
- `ServerMessage` is what the agent answers with: `patch` (RFC 6902 operations)
  and/or `say` (chat text).

Sessions are keyed by `(agentId, visitorId)`, which is exactly why the page is
"different for everyone": each viewer has an isolated stage.

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
