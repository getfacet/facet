# @facet/agent-client

The agent-side dial-in SDK for Facet. `connectAgent` connects an **external**
agent to a Facet server and keeps it there: it dials OUT over SSE (so it works
behind NAT with no public endpoint), holds the event stream, sends heartbeats,
reconnects on drop, and routes each visitor event to your agent — the same
`FacetAgent` function you'd register in-process. Transient failures (network
errors, 5xx) reconnect forever; a `403` (bad token) stops immediately, and a
`409` (link already owned) is retried for a bounded window — long enough for
the server to reap a half-open previous connection — before giving up loudly.

Role: **Adapters**. This reference client speaks the `@facet/server`
reference agent channel. Hosted platforms should usually provide a
platform-specific agent client with project/page-scoped tokens, permissions, and
connection policy.

```bash
npm install @facet/agent-client @facet/core @facet/agent
```

```ts
import { connectAgent } from "@facet/agent-client";
import { defineAgent } from "@facet/agent";

const agent = defineAgent(({ event, stage }) => {
  if (event.kind === "visit") stage.say("Connected from an external agent.");
});

const connection = connectAgent({
  serverUrl: "http://localhost:5291",
  agentId: "live",
  agent,
});

// later…
connection.close();
```

## Trust model

`@facet/agent-client` speaks the reference agent channel used by
`@facet/server`. It can send a shared `agentToken` when the server requires one,
but it does not model tenants, projects, scoped API keys, billing quotas, or
agent permissions. Production hosted platforms should wrap this package or
provide a platform-specific client that validates project-scoped credentials
before routing events to Facet runtime primitives.

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
