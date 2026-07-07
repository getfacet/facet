# @facet/server

The reference Facet transport: a tiny Node SSE + POST server that carries events
to the runtime and streams patches back. Two channels, both SSE + POST so an
agent behind NAT only ever dials OUT — a browser side (`GET /stream` + `POST
/event`) and an agent side (`GET /agent/stream` + `POST /agent/control`).

```bash
npm install @facet/server @facet/agent @facet/runtime @facet/core
```

`createFacetServer` returns a `FacetServer` with `listen()` / `close()`. Give it
an in-process `agent` as the fallback brain, or let an external agent hold
`/agent/stream`. It defaults to in-memory state; pass `stageStore` / `sink` for
durable backends.

```ts
import { createFacetServer } from "@facet/server";
import { defineAgent } from "@facet/agent";

const agent = defineAgent(({ event, stage }) => {
  if (event.kind === "visit") stage.say("Welcome!");
});

const server = createFacetServer({ port: 5291, agentId: "live", agent });
await server.listen();
```

## Delivery guarantees

Browser SSE frames carry a per-session sequence in the standard `id:` field, so
an `EventSource` reconnect resumes exactly where it left off (`Last-Event-ID`
replays only the missed frames; a full rehydrate is always preceded by an
explicit `reset` message). Streaming `FacetAgent` batches are delivered to
`/stream` as soon as the runtime saves them; the `/event` POST still acknowledges
immediately with `202`.

An agent turn that outlives the per-event timeout is NOT discarded: the visitor
gets an interim note and the finished result is applied and delivered when it
arrives — unless a newer turn has already changed the page, in which case only
the late reply text is shown (a stale result never overwrites a newer stage).
During full rehydrate, if the frame log changes while the server is reading the
snapshot/history, the server falls back to the visitor's serial lane and
re-reads from a stable point instead of replaying over a stale snapshot. Tune
`agentTimeoutMs` (interim-note threshold) and `agentStaleMs` (dead-agent reaper)
via `FacetServerOptions`.

## Trust model (read before hosting)

This is a REFERENCE transport for local/self-hosted single-operator use with
public/anonymous pages — NOT a hardened multi-tenant server. The `/agent/*`
channel is unauthenticated by default (set `agentToken` to require a shared
secret), and `visitorId` is trusted verbatim as the session key. Put your own
authentication in front of it for multi-tenant or sensitive-per-visitor
deployments. See [SECURITY.md] in the repository.

[SECURITY.md]: https://github.com/getfacet/facet/blob/main/SECURITY.md

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
