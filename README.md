<h1 align="center">Facet</h1>

<p align="center">
  <strong>The UI layer for LLMs and agents — interfaces your model draws.</strong>
</p>

Facet is a TypeScript framework for UI a language model renders itself — safe,
live, and different for every user. You give the model a small set of safe visual
primitives; it composes whatever interface the moment calls for, keeps changing
it as the conversation goes, and can build a different one for each person — all
without ever emitting unsafe or broken markup.

> Status: **pre-1.0.** The spec, patch protocol, runtime, renderer, the SSE/POST
> transport (browser + external agents), a browser playground, durable stores,
> and a Postgres adapter are all in place and tested. APIs may still change.

## Why

Today, when an AI wants to *show* you something, there are three options — and
they all hurt:

- **Text / markdown only** — the model can't really build UI; you get a wall of words.
- **Let the model emit HTML/React** — unlimited, but **unsafe** (injection),
  **fragile** (broken layouts), and **unreliable** (hallucinated markup).
- **A fixed catalog of your components** (today's "generative UI") — safe, but the
  model can only assemble what you pre-built. **Rigid.**

Facet is the missing middle: the model composes **anything** from low-level
bricks, it **can't inject or break the layout**, and it updates **live, per user**
— you don't pre-build a component for every case, and you don't hand a model raw
markup.

## The mental model: two layers

A Facet page is two layers stacked together:

- **The Stage** — the body of the page. The model rebuilds this per user and
  mutates it as you talk. Everything visible is built here.
- **The Chat dock** — always present (floating or pinned). It is *not* generated;
  it's the control surface the user drives the Stage with.

```
the user speaks in the Chat  →  the model rebuilds the Stage
```

The Stage can also diverge *before* anyone says a word: who showed up (referrer,
locale, prior context) is enough to make the first paint different.

## Low-level bricks, not finished widgets

The model builds the Stage from **four low-level bricks** — not a catalog of
pre-made components:

| Brick   | It is…                                                                  |
| ------- | ----------------------------------------------------------------------- |
| `box`   | the universal container. Flow layout, token styles, optional `onPress`. |
| `text`  | text with token styles (size/weight/color).                             |
| `image` | an image.                                                               |
| `field` | an input.                                                               |

A *card* is a `box` with a border. A *button* is a `box` with `onPress`. A
*heading* is a big `text`. Everything is composed from these four, so the set of
producible interfaces is unbounded — yet it stays safe and unbreakable because:

1. **Bricks are typed data, never raw HTML/JS** → nothing can be injected.
2. **Style values are tokens, not raw scalars** (`gap: "md"`, not `gap: 23`) →
   any combination lands on a coherent scale; the model can't produce visual
   chaos, and good output comes out in one shot.
3. **Layout is flow-only** (row/col, no absolute positioning) → children stack or
   wrap; they can't overlap or fall off the page.
4. **The renderer is fail-safe** → unknown or dangling nodes are skipped, so a
   partial stage renders as "plain", never broken.

Higher-level shapes (`card()`, `hero()`, `grid()`) live in an optional preset
package — they're just functions that emit box compositions, giving one-shot
convenience without giving up the low-level foundation.

## What you can build

- **An AI that answers with UI, not text** — "compare these three" → a real
  table; "I need your details" → a real form; "show me the plan" → a live
  dashboard, assembled on the spot.
- **Living pages** — a link that assembles itself for each visitor and keeps
  changing as they talk. (An agent that owns its own public page is one case of
  this.)
- **Copilot canvases** — an agent that manipulates a live panel — adds a chart,
  updates a card — as it reasons.

## How it works

```
 [ user's browser ]
   Stage (dynamic)  +  Chat dock (persistent)
        │  ClientEvent: visit / message / action
        ▼
 [ @facet/server ]    reference SSE/POST transport (browser side + model side)
        │
 [ @facet/runtime ]   one isolated session per (agent, visitor)
        │  calls your model, applies the resulting patches, persists the session
        ▼
 [ your model ]   drives the Stage via @facet/agent + your LLM
        │  ServerMessage: stage patches (RFC 6902) + chat replies
        ▼
 [ @facet/react ]   renders the brick spec to safe DOM; applies patches live
```

**Your model connects in one of three ways** — all the same `Stage` API:

- **in-process** — a JS function inside the server (`@facet/agent`).
- **local CLI** — a running agent (e.g. Claude Code) calls `facet append/say/…`
  and a local bridge forwards it (`@facet/cli`).
- **dial-in** — an external agent connects out over SSE, NAT-safe, and is served
  events to answer (`@facet/agent-client`). The model (the LLM/rules) is always
  yours; Facet is the surface it draws on.

**Persistence is two separate concerns.** The *stage* (the page) is always
Facet's, kept in a `StageStore` (in-memory, file, or Postgres). The
*conversation* is a `Sink` you choose: store it for replay, forward it to your
own system (e.g. a chat platform that already keeps it), or drop it.

**Each viewer is a `visitorId`, and you decide where it comes from.** For an
anonymous page, `browserVisitorId()` stores an unguessable id in the browser so a
refresh or return visit re-hydrates the same page. When your app already knows
who the visitor is — a logged-in user, an actor id — pass *that* id instead;
Facet keys sessions by whatever id you give it (bring-your-own-identity, same as
the stores).

Two engineering choices keep "constantly re-rendering" cheap and correct:

- **Stage changes travel as [RFC 6902 JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902)**
  (the IETF standard, also used by AG-UI). Only diffs move, and the *same* pure
  `applyPatch` runs on server and client so they never drift.
- **The tree is a flat map of nodes with a `root` id** (the A2UI shape), so the
  model can stream and patch one node at a time.

## Packages

| Package                 | Role                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `@facet/core`           | The contract: bricks, style tokens, RFC 6902 patch, `validateTree`, session/event types. |
| `@facet/runtime`        | Event loop + `StageStore` (page state) + `Sink` (conversation). File-backed Node references via `@facet/runtime/node`. |
| `@facet/agent`          | In-process agent SDK — the `Stage` control API + `defineAgent`.                           |
| `@facet/agent-client`   | Dial-in SDK for an external agent (SSE + heartbeat + reconnect).                          |
| `@facet/cli`            | The `facet` command — a running agent's action surface.                                  |
| `@facet/server`         | Reference SSE/POST transport (browser side + agent side).                                |
| `@facet/react`          | Brick renderer (`StageRenderer`), the token→CSS theme (`boxStyle`/`textStyle`/…), `useFacet`, `ChatDock`. |
| `@facet/kit`            | Optional presets (`card/hero/grid/…`) — sugar over the bricks.                            |
| `@facet/store-postgres` | Durable `StageStore`/`Sink` backed by Postgres.                                           |
| `@facet/bridge`         | `facet-bridge` — a local coding agent (Claude/Codex) owns a link, driving via the `facet` CLI. |

## Quickstart

```bash
pnpm install
pnpm demo
```

The demo runs entirely in-process (no browser, no LLM): two visitors hit one
session and you watch their stages diverge, then one of them mutate live after a
chat message. See [`apps/playground/src/demo.ts`](apps/playground/src/demo.ts).

For the browser playground (a real page + chat dock, live-updating):

```bash
pnpm --filter @facet/playground dev      # http://localhost:5290
pnpm --filter @facet/playground serve    # live server on :5291 (uses your local Claude)
```

Authoring a model's logic looks like this:

```ts
import { defineAgent } from "@facet/agent";

export const agent = defineAgent(({ event, stage }) => {
  if (event.kind === "visit") {
    stage.render(/* a brick tree tailored to event.visitor */);
  }
  if (event.kind === "message") {
    stage
      .append("root", { id: "price", type: "text", value: "$20/mo" })
      .say("Added it below.");
  }
});
```

## Roadmap

- [x] Core spec (low-level bricks + tokens) + RFC 6902 patches + in-process demo
- [x] SSE/POST transport + a browser playground
- [x] External-agent dial-in (NAT-safe) + local `facet` CLI bridge
- [x] Durable `StageStore`/`Sink` + a Postgres adapter
- [x] `@facet/kit` presets (card/hero/grid as box compositions)
- [ ] Docs site + examples
- [ ] Caching & static skeleton for fast first paint
- [ ] Content-safety / moderation hooks
- [ ] Distributed store + fan-out for horizontal scale

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the longer write-up and
[AGENTS.md](AGENTS.md) if you're contributing.

## License

[MIT](LICENSE)
