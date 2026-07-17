# @facet/ag-ui

Official AG-UI adapter/event layer for Facet.

Role: **Adapters**.

## When to use it

Use `@facet/ag-ui` when AG-UI is the app's client/server event envelope but
Facet should remain the only stage model. The adapter translates lifecycle,
message, error, and state events at the edge; Facet still owns the closed Brick
tree, RFC 6902 patch folding, validation, persistence, and rendering.

Do not use it to create a second stage, execute AG-UI tool calls, or add backend
business policy. Use the native `@facet/client`/`@facet/server` reference path
when AG-UI interoperability is not needed.

## Install and entrypoints

```bash
npm install @facet/ag-ui
```

| Import | Environment | Contents |
| --- | --- | --- |
| `@facet/ag-ui` | Browser or shared code | AG-UI event conversion, `AgUiTransport`, and `createHttpAgUiTransport`. |
| `@facet/ag-ui/server` | Node server only | `handleAgUiRequest`, `runFacetAsAgUi`, and server types/helpers. |

Only these two entrypoints are public. Do not import package `src/*` modules.
Install `@facet/runtime` too when your server code constructs a
`FacetRuntime` directly.

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

The server adapter wraps the host's existing `FacetRuntime`; it does not run a
parallel Facet stage. It validates AG-UI `RunAgentInput`, authorizes or rewrites
the visitor, ignores `RunAgentInput.state` as stage authority, and streams AG-UI
`RUN_STARTED`, text, state, and terminal events.
Same visitor work stays serialized through the runtime lane; different resolved
visitors can run concurrently after authorization.

Browser event conversion and transport internals remain separate from the Node
adapter implementation. Only the documented root entry point and
`@facet/ag-ui/server` subpath are public; the responsibility-focused source
modules behind them are private implementation details.

## Safety Boundary

Only Facet state under `/facet/stage` is accepted from AG-UI
`STATE_DELTA`/`STATE_SNAPSHOT`. Unknown AG-UI events are ignored by the stage
path. State payloads are cloned only after operation, node, entry, and aggregate
string caps pass; malformed values fail closed to no-op output.

This package does not execute AG-UI tool calls, add backend policy, or replace
Facet's native persistence schema. External NAT-safe AG-UI dial-out for agents
is deferred to a future `@facet/ag-ui/agent`; the native `@facet/agent-client`
reference path remains unchanged.

## Learn next

- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md)
  for choosing a transport and renderer path.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md)
  for the patches-only stage contract.
- [Package Boundaries](https://github.com/getfacet/facet/blob/main/docs/PACKAGE-BOUNDARIES.md)
  for the official-adapter and hosted-platform boundaries.
