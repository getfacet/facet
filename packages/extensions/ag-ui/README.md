# @facet/ag-ui

Official AG-UI adapter/event layer for Facet.

Tier: **Integration Adapter**.

```bash
npm install @facet/ag-ui @facet/core @facet/runtime
```

Use this package when an app wants AG-UI as the public client/server event
envelope while keeping Facet's stage model unchanged. AG-UI carries lifecycle,
message, error, and state events; Facet still owns the safe UI tree, RFC 6902
patch folding, validation, and rendering.

## Browser Transport

```ts
import { AgUiTransport, createHttpAgUiTransport } from "@facet/ag-ui";

const transport = createHttpAgUiTransport("/ag-ui", {
  visitor: { visitorId: "visitor-1" },
  headers: { Authorization: "Bearer ..." },
});
```

`AgUiTransport` implements Facet's `FacetTransport`, so it can be passed to
`useFacet`. It serializes `send` and local `record` calls, stamps a monotonic
Facet `seq`, and converts AG-UI output back into native Facet `ServerMessage`
values before the renderer sees anything.

`createHttpAgUiTransport` uses the official `@ag-ui/client` `HttpAgent`. It
creates a fresh HTTP agent per run so timeout aborts do not poison later sends,
forwards `headers` and a custom `fetch`, and preserves AG-UI `RUN_ERROR` SSE
bodies even when the HTTP status is non-2xx.

## Node Server Adapter

```ts
import { handleAgUiRequest } from "@facet/ag-ui/server";

await handleAgUiRequest(req, res, runtime, {
  resolveVisitor: async (_req, input) => authorize(input),
  includeSnapshot: true,
});
```

The server adapter wraps a `FacetRuntime`. It validates AG-UI `RunAgentInput`,
authorizes or rewrites the visitor, ignores `RunAgentInput.state` as stage
authority, and streams AG-UI `RUN_STARTED`, text, state, and terminal events.
Same visitor work stays serialized through the runtime lane; different resolved
visitors can run concurrently after authorization.

## Safety Boundary

Only Facet state under `/facet/stage` is accepted from AG-UI
`STATE_DELTA`/`STATE_SNAPSHOT`. Unknown AG-UI events are ignored by the stage
path. State payloads are cloned only after operation, node, entry, and aggregate
string caps pass; malformed values fail closed to no-op output.

This package does not execute AG-UI tool calls, add backend policy, or replace
Facet's native persistence schema. External NAT-safe AG-UI dial-out for agents
is deferred to a future `@facet/ag-ui/agent`; the native `@facet/agent-client`
reference path remains unchanged.
