# Facet

**Living pages for agents — one link, a different face for every visitor.**

Facet is a TypeScript framework for giving an AI agent a single public address
that it re-renders, live and per visitor, as it talks to whoever shows up.

Today an "agent link" is a static page or a chat box. Facet makes it a surface
the agent *owns and rewrites*: two people opening the same link at the same time
see two different pages, because the agent builds each one for the person in
front of it and keeps changing it as the conversation goes.

> Status: **early scaffold.** The core spec, patch protocol, runtime, renderer,
> and an in-process demo are in place; the network transport and a browser
> playground are next. APIs will change.

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
 [ @facet/runtime ]   one isolated session per (agent, visitor)
        │  calls the agent, applies the resulting patches to the session
        ▼
 [ your agent ]   (@facet/agent + your LLM)  drives the Stage via a small CLI
        │  ServerMessage: stage patches (RFC 6902) + chat replies
        ▼
 [ @facet/react ]   renders the brick spec to safe DOM; applies patches live
```

Two engineering choices keep "constantly re-rendering" cheap and correct:

- **Stage changes travel as [RFC 6902 JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902)**
  (the IETF standard, also used by AG-UI). Only diffs move, and the *same* pure
  `applyPatch` runs on server and client so they never drift.
- **The tree is a flat map of nodes with a `root` id** (the A2UI shape), so the
  agent can stream and patch one node at a time.

## Packages

| Package          | Role                                                              |
| ---------------- | ---------------------------------------------------------------- |
| `@facet/core`    | The contract: bricks, style tokens, RFC 6902 patch, session/event types. |
| `@facet/runtime` | Per-(agent, visitor) session store and the event loop.           |
| `@facet/agent`   | The agent's "CLI" — the `Stage` control API + `defineAgent`.     |
| `@facet/react`   | Brick renderer (`StageRenderer`), default `theme`, `useFacet` hook. |

## Quickstart

```bash
pnpm install
pnpm demo
```

The demo runs entirely in-process (no browser, no LLM): two visitors hit one
agent link and you watch their stages diverge, then one of them mutate live
after a chat message. See [`apps/playground/src/demo.ts`](apps/playground/src/demo.ts).

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
- [ ] WebSocket/SSE transport + a real `apps/playground` web page
- [ ] Caching & static skeleton for fast first paint
- [ ] `@facet/kit` preset package (card/hero/grid as box compositions)
- [ ] Content-safety / moderation hooks
- [ ] Adapters (e.g. agent-messaging identity providers)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the longer write-up.

## License

[MIT](LICENSE)
