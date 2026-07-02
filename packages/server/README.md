# @facet/server

The reference Facet transport: a tiny Node SSE + POST server that carries events
to the runtime and streams patches back. Two channels, both SSE + POST so an
agent behind NAT only ever dials OUT — a browser side (`GET /stream` + `POST
/event`) and an agent side (`GET /agent/stream` + `POST /agent/control`).

```bash
npm install @facet/server @facet/runtime @facet/core
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
