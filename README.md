# Facet

**Living pages for agents — one link, a different face for every visitor.**

Facet is a TypeScript framework for giving an AI agent a single public address
that it re-renders, live and per visitor, as it talks to whoever shows up.

Today an "agent link" is a static page or a chat box. Facet makes it a surface
the agent *owns and rewrites*: two people opening the same link at the same time
see two different pages, because the agent builds each one for the person in
front of it and keeps changing it as the conversation goes.

> Status: **pre-1.0.** The spec, patch protocol, runtime, renderer, the SSE/POST
> transport (browser + external agents), a browser playground, durable stores,
> and a Postgres adapter are all in place and tested. APIs may still change.

## The mental model: two layers

A Facet page is just two layers stacked together:

- **The Stage** — the body of the page. The agent rebuilds this per visitor and
  mutates it as you talk. Everything visible is built here.
- **The Chat dock** — always present (floating or pinned). It is *not* generated;
  it is the control surface the visitor uses to drive the Stage.

```
the visitor speaks in the Chat  →  the agent rebuilds the Stage
```

The Stage also diverges *before* anyone says a word: who showed up (referrer,
locale, prior relationship) is enough to make the first paint different.

## Low-level bricks, not finished widgets

The agent builds the Stage from **four low-level bricks** — not a catalog of
pre-made components:

| Brick    | It is…                                                          |
| -------- | -------------------------------------------------------------- |
| `box`    | the universal container. Flow layout, token styles, optional `onPress`. |
| `text`   | text with token styles (size/weight/color).                    |
| `image`  | an image.                                                      |
| `field`  | an input.                                                      |

A *card* is a `box` with a border. A *button* is a `box` with `onPress`. A
*heading* is a big `text`. The agent composes everything from these four, so the
set of producible pages is unbounded — yet it stays safe and unbreakable because:

1. **Bricks are typed data, never raw HTML/JS** → nothing can be injected.
2. **Style values are tokens, not raw scalars** (`gap: "md"`, not `gap: 23`) →
   any combination lands on a coherent scale; the agent can't produce visual
   chaos, and good output comes out in one shot.
3. **Layout is flow-only** (row/col, no absolute positioning) → children stack or
   wrap; they can't overlap or fall off the page.
4. **The renderer is fail-safe** → unknown or dangling nodes are skipped, so a
   partial stage renders as "plain", never broken.

Higher-level shapes (`card()`, `hero()`, `grid()`) are deferred to an optional
preset package — they're just functions that emit box compositions, giving
one-shot convenience without giving up the low-level foundation.

## How it works

```
 [ Visitor's browser ]
   Stage (dynamic)  +  Chat dock (persistent)
        │  ClientEvent: visit / message / action
        ▼
 [ @facet/server ]    reference SSE/POST transport (browser side + agent side)
        │
 [ @facet/runtime ]   one isolated session per (agent, visitor)
        │  calls the agent, applies the resulting patches, persists the session
        ▼
 [ your agent ]   drives the Stage via @facet/agent + your LLM
        │  ServerMessage: stage patches (RFC 6902) + chat replies
        ▼
 [ @facet/react ]   renders the brick spec to safe DOM; applies patches live
```

**Your agent connects in one of three ways** — all the same `Stage` API:

- **in-process** — a JS function inside the server (`@facet/agent`).
- **local CLI** — a running agent (e.g. Claude Code) calls `facet append/say/…`
  and a local bridge forwards it (`@facet/cli`).
- **dial-in** — an external agent connects out over SSE, NAT-safe, and is served
  events to answer (`@facet/agent-client`). The agent brain (the LLM/rules) is
  always yours; Facet is the surface it drives.

**Persistence is two separate concerns.** The *stage* (the page) is always
Facet's, kept in a `StageStore` (in-memory, file, or Postgres). The
*conversation* is a `Sink` you choose: store it for replay, forward it to your
own system (e.g. a chat platform that already keeps it), or drop it.

Two engineering choices keep "constantly re-rendering" cheap and correct:

- **Stage changes travel as [RFC 6902 JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902)**
  (the IETF standard, also used by AG-UI). Only diffs move, and the *same* pure
  `applyPatch` runs on server and client so they never drift.
- **The tree is a flat map of nodes with a `root` id** (the A2UI shape), so the
  agent can stream and patch one node at a time.

## Packages

| Package                 | Role                                                              |
| ----------------------- | ---------------------------------------------------------------- |
| `@facet/core`           | The contract: bricks, style tokens, RFC 6902 patch, `validateTree`, session/event types. |
| `@facet/runtime`        | Event loop + `StageStore` (page state) + `Sink` (conversation).  |
| `@facet/agent`          | In-process agent SDK — the `Stage` control API + `defineAgent`.  |
| `@facet/agent-client`   | Dial-in SDK for an external agent (SSE + heartbeat + reconnect). |
| `@facet/cli`            | The `facet` command — a running agent's action surface.          |
| `@facet/server`         | Reference SSE/POST transport (browser side + agent side).        |
| `@facet/react`          | Brick renderer (`StageRenderer`), default `theme`, `useFacet`, `ChatDock`. |
| `@facet/kit`            | Optional presets (`card/hero/grid/…`) — sugar over the bricks.   |
| `@facet/store-postgres` | Durable `StageStore`/`Sink` backed by Postgres.                  |

## Quickstart

```bash
pnpm install
pnpm demo
```

The demo runs entirely in-process (no browser, no LLM): two visitors hit one
agent link and you watch their stages diverge, then one of them mutate live
after a chat message. See [`apps/playground/src/demo.ts`](apps/playground/src/demo.ts).

For the browser playground (a real page + chat dock, live-updating):

```bash
pnpm --filter @facet/playground dev      # http://localhost:5290
pnpm --filter @facet/playground serve    # live server on :5291 (uses your local Claude)
```

Authoring an agent looks like this:

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
