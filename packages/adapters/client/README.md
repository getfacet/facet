# @facet/client

Reference browser-side transports for Facet. `SseTransport` connects a visitor
to `@facet/server`, while `LocalTransport` connects directly to a runtime-like
object in the same JavaScript process.

Role: **Adapters**.

```bash
npm install @facet/client @facet/core
```

Use this package for the native reference browser path or as a transport example
for custom hosts. It does not authenticate users, fetch domain data, mount React
components, or authorize stage writes.

## Transports

- `SseTransport(baseUrl, sessionKey)` subscribes to server frames over SSE and
  posts visitor events, plus quickstart visitor messages, to the reference
  server in one ordered queue.
- `LocalTransport(runtime, sessionKey)` calls a runtime-like `handle` method,
  delivers the returned frames to subscribers, and resolves `send` after that
  delivery finishes.
- `browserSessionKey()` creates a random browser session key for local/public
  anonymous pages.
- `persistScreen()` and `loadPersistedScreen()` store only the last screen name
  for one agent link; no view snapshot or browser-local component state is
  persisted.

```ts check-docs
import type { VisitorEvent, ServerFrame } from "@facet/core";
import {
  browserSessionKey,
  loadPersistedScreen,
  persistScreen,
  SseTransport,
} from "@facet/client";

const sessionKey = browserSessionKey();
const transport = new SseTransport("http://localhost:5291", sessionKey, {
  postTimeoutMs: 35_000,
});
const screen = loadPersistedScreen("quickstart")?.screen ?? "home";

const unsubscribe = transport.subscribe((frame: ServerFrame) => {
  console.log(frame.kind);
});

persistScreen("quickstart", { screen });

const event: VisitorEvent = {
  eventId: "visit-1",
  eventName: "visit",
  sourceNodeId: "root",
  screen,
  stageRevision: 0,
  collect: {},
};

void transport.send(event);
void transport.sendMessage({
  messageId: "message-1",
  text: "Hello",
  screen,
  stageRevision: 0,
});
unsubscribe();
```

`postTimeoutMs` is optional and defaults to 35 seconds. Local wrappers can raise
it for slower provider-backed turns; oversized values are clamped before the
transport calls `AbortSignal.timeout`.

## Event boundary

Visitor events are closed `VisitorEvent` objects: stable `eventId`, authored
`eventName`, `sourceNodeId`, `screen`, echoed `stageRevision`, optional `arg`,
and an explicit `collect` map. Collected fields either carry a value or a stated
absence reason. Extra keys and invalid names are rejected by the shared Core
validator before runtime work begins.

## Replacement boundary

A custom browser transport only needs to deliver ordered `ServerFrame` values to
`subscribe`. The send path and credential policy belong to the concrete
transport, while Facet validation, patch folding, and renderer mounting stay in
the shared packages.

## Trust model

The native `SseTransport` deliberately carries no credential seam. The reference
server treats a session key as the session selector. For sensitive or
multi-tenant pages, authenticate before routing to Facet and wrap or replace the
transport with platform-specific credentials and isolation.

## Read next

- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md)
- [`@facet/react`](https://github.com/getfacet/facet/blob/main/packages/renderers/react/README.md)
- [Package Boundaries](https://github.com/getfacet/facet/blob/main/docs/PACKAGE-BOUNDARIES.md)
