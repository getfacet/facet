# @facet/server

Native reference transport for Facet: a small Node server that accepts visitor
events over POST, streams ordered server frames over SSE, and can accept an
external agent over a separate dial-in channel.

Role: **Adapters**.

```bash
npm install @facet/server @facet/assets @facet/agent
```

Use this package for local/self-hosted reference deployments or to study
Facet's transport contract. It is not a hosted edge, identity service, rate
limiter, billing layer, or tenant control plane.

## Server setup

`createFacetServer` requires the immutable catalog and theme that bootstrap the
runtime session, plus optional `themeExtensions` when the theme fills
host-declared extension namespaces. An optional in-process agent can handle
visitor events directly; otherwise an external agent may connect through the
agent channel.

```ts check-docs
import { defineAgent } from "@facet/agent";
import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { createFacetServer } from "@facet/server";

const agent = defineAgent(async ({ stage }) => {
  await stage.render(
    `<Facet entry="home">
      <Screen name="home" title="Hello">
        <Text value="Welcome from the reference server" />
      </Screen>
    </Facet>`,
  );
  stage.message("Welcome.");
});

const server = createFacetServer({
  port: 5291,
  host: "127.0.0.1",
  catalog: DEFAULT_CATALOG,
  theme: DEFAULT_THEME,
  agent,
  turnTimeoutMs: 30_000,
});

await server.listen();
```

`turnTimeoutMs` is optional and defaults to the runtime's 30 second turn
authority window. Raise it only for local or self-hosted agents that need longer
provider calls. External-agent frames derive their pending timeout from the same
turn window and settle before the runtime write authority expires.

## Browser channel

The browser side uses:

- `GET /stream?sessionKey=...` for ordered `ServerFrame` delivery and reconnect
  replay;
- `POST /event` for validated `VisitorEvent` payloads; and
- `POST /message` for visitor conversation text.

Frames carry either a stage-rooted patch batch with a server-authoritative
revision or one conversation message. Replay can resume missed frames by event
sequence. Out-of-window recovery sends a reset followed by the current snapshot
and conversation history.

## Agent channel

The external-agent side uses `GET /agent/stream`, `POST /agent/control`, and
`POST /agent/heartbeat`. The server correlates each `AgentControlFrame` to the
original event id and, when needed, an opaque transport correlation id. It also
sends a bounded turn timeout so an external client can abort provider work before
the server settles the pending turn. The server rejects stale, invalid, or
non-authorized outcomes and emits a safe assistant message if the remote agent
fails.

## Trust model

The reference server trusts the session key and optional shared agent token it
is given. Production hosts should authenticate before routing requests into
Facet, isolate tenants outside this package, and provide their own abuse,
metering, and credential controls.

## Read next

- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md)
- [Package Boundaries](https://github.com/getfacet/facet/blob/main/docs/PACKAGE-BOUNDARIES.md)
- [`@facet/client`](https://github.com/getfacet/facet/blob/main/packages/adapters/client/README.md)
