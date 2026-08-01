# @facet/agent-client

Reference agent-side dial-in SDK. `connectAgent` connects an external
`FacetAgent` to the agent channel exposed by `@facet/server`, keeps a heartbeat
alive, reconnects after transient failures, and posts one validated
`TurnOutcome` for each visitor event.

Role: **Adapters**.

```bash
npm install @facet/agent-client @facet/core
```

Use this package when the agent runs outside the server process or behind NAT
and needs to dial out. Do not use it to define model tools or provider policy:
`@facet/agent-tools` supplies the LLM tool surface. An external dial-in agent
implements the core `FacetAgent` protocol directly; it does not receive the
in-process `Stage` API from `@facet/agent`.

```ts
import { connectAgent } from "@facet/agent-client";
import { deriveMessageId, type FacetAgent } from "@facet/core";

const agent: FacetAgent = {
  async handleEvent(frame) {
    const turnId = frame.event.eventId;
    return {
      stageRevision: frame.event.stageRevision,
      patches: [],
      conversation: {
        kind: "conversation",
        messageId: deriveMessageId(turnId, "assistant"),
        turnId,
        role: "assistant",
        text: "Connected.",
        at: Date.now(),
      },
    };
  },
};

const connection = connectAgent({
  serverUrl: "http://localhost:5291",
  agentId: "external-agent",
  token: process.env.FACET_AGENT_TOKEN,
  agent,
});

connection.close();
```

## Turn correlation

The server streams `VisitorEventFrame` values. The client runs the supplied agent,
validates its `TurnOutcome`, derives a deterministic fallback message on
failure, and posts an `AgentControlFrame` addressed to the original `eventId`.
When the server includes an opaque `correlationId`, the client echoes it without
rewriting `frame.event.eventId`. Invalid outcomes degrade to a safe assistant
message instead of partial stage mutation. A server-provided `timeoutMs` aborts
the local turn before the pending server turn expires, and the client bounds
concurrent provider work plus queued visitor events.

## Reconnect behavior

Transient network failures and `5xx` responses reconnect. `403` stops
immediately because the token is invalid. `409` retries for a bounded window so
a half-open previous connection can expire before genuine second-owner
contention is reported. `onStatus` can observe connected/disconnected changes.

## Trust model

The client speaks only the native reference agent channel used by
`@facet/server`. It can send a shared token when required, but it does not model
tenants, projects, scoped API keys, billing, or agent permissions. Production
platforms should wrap this package or provide their own channel client.

## Read next

- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md)
- [Agent Integration](https://github.com/getfacet/facet/blob/main/docs/AGENT-INTEGRATION.md)
- [Package Boundaries](https://github.com/getfacet/facet/blob/main/docs/PACKAGE-BOUNDARIES.md)
