# @facet/agent-client

The reference agent-side dial-in SDK. `connectAgent` connects an **external**
`FacetAgent` to the agent channel exposed by `@facet/server`. It dials out over
SSE, sends heartbeats, reconnects after transient failures, and returns each
visitor event to the already-assembled agent.

Role: **Adapters**.

## When to use it

Use this package when the agent runs in a different process or behind NAT and
the other side is Facet's reference `@facet/server` transport.

Do not use it to define LLM tools or provider behavior. `@facet/agent-tools`
supplies the provider-neutral authoring tools; `@facet/agent` supplies the
code-authored `Stage` API. A host can use either path to build the `FacetAgent`
passed here. If the agent runs in the same process as `FacetRuntime`, register
it directly and skip this network client. If the public envelope is AG-UI, use
`@facet/ag-ui` instead of treating this native reference channel as AG-UI.

## Install

```bash
npm install @facet/agent-client @facet/agent
```

`@facet/agent` is included here because the example below imports
`defineAgent`; it is not required when your host supplies another compatible
`FacetAgent`.

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

Transient network failures and `5xx` responses reconnect. A `403` stops
immediately; a `409` is retried for a bounded window so a half-open previous
connection can be reaped before genuine second-owner contention is reported.

## Trust model

`@facet/agent-client` speaks only the reference agent channel used by
`@facet/server`. It can send a shared `token` when the server requires one,
but it does not model tenants, projects, scoped API keys, billing quotas, or
agent permissions. Production hosted platforms should wrap this package or
provide a platform-specific client that validates project-scoped credentials
before routing events to Facet runtime primitives.

## Learn next

- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md)
  for supported integration paths.
- [Agent Integration](https://github.com/getfacet/facet/blob/main/docs/AGENT-INTEGRATION.md)
  for the LLM tool loop that is deliberately outside this transport.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md)
  and [Package Boundaries](https://github.com/getfacet/facet/blob/main/docs/PACKAGE-BOUNDARIES.md)
  for the trust and hosted-platform boundaries.
