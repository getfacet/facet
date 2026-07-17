# @facet/client

Reference browser-side transports for Facet—the visitor counterpart of an agent
connection. Both implementations satisfy the `FacetTransport` contract from
`@facet/core`, so `useFacet(transport)` accepts either.

Role: **Adapters**. Use this package for the native reference browser path or as
an implementation example. Hosted applications may replace it with a transport
that applies their own credentials, routes, and tenant policy.

- `SseTransport` talks to `@facet/server`: SSE from server to browser and
  ordered `fetch` POSTs from browser to server. Pre-connect events are queued so
  the initial `visit` does not race stream registration.
- `LocalTransport` talks to a `FacetRuntime` in the same process for embeds,
  demos, and tests.
- `withView` immutably attaches a browser-owned `ViewSnapshot` to an outgoing
  or locally recorded event.

```bash
npm install @facet/client @facet/core
```

Add `@facet/react react react-dom` when using the React renderer.
`LocalTransport` also needs a runtime-like object; install `@facet/runtime` and
the agent package your in-process loop uses.

## Event boundary

This framework-agnostic example shows the events a renderer host must preserve.
In React, `useFacet` owns `subscribe`; memoize the transport and connect the
three callback functions below to `onViewSnapshot`, `onAction`, and `onRecord`.
The full React component lives in
[Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md#embed-the-react-renderer).

```ts check-docs
import type {
  ClientEvent,
  CollectedEvent,
  FacetAction,
  FieldValues,
  ViewSnapshot,
  VisitorContext,
} from "@facet/core";
import { browserVisitorId, SseTransport, withView } from "@facet/client";

const visitor: VisitorContext = { visitorId: browserVisitorId() };
const transport = new SseTransport("http://localhost:5291", visitor);
let currentView: ViewSnapshot | undefined;

const unsubscribe = transport.subscribe((message) => {
  // A non-React host folds/handles each validated ServerMessage here.
  console.log(message);
});

transport.send(withView({ kind: "visit", visitor }, currentView));

export function rememberView(snapshot: ViewSnapshot): void {
  currentView = snapshot;
}

export function forwardAction(action: FacetAction, fields?: FieldValues): void {
  const event: ClientEvent =
    fields === undefined
      ? { kind: "tap", action }
      : { kind: "tap", action, fields };
  transport.send(withView(event, currentView));
}

export function recordLocalAction(event: CollectedEvent): void {
  transport.record(withView(event, currentView));
}

export function disconnect(): void {
  unsubscribe();
}
```

Attach the same latest snapshot to message events. An absent or empty snapshot
leaves the event unchanged. `withView` never mutates its input, and the server
still normalizes and bounds untrusted snapshots.

`fields` and `view` are inert event context. They do not become stage data and
do not give the browser authority to patch document content. Local
navigate/toggle events go through `record`; agent-routed actions go through
`send`.

## Replacement boundary

A custom browser transport implements the small `FacetTransport` interface:

- `send(ClientEvent)` forwards visitor events;
- `subscribe(handler)` delivers ordered `ServerMessage` values and returns
  cleanup; and
- optional `record(CollectedEvent)` best-effort logs locally resolved actions.

Keep authentication, session routing, reconnect policy, and tenant isolation in
that transport or its surrounding platform. Keep RFC 6902 folding and Facet
validation in the shared Facet path.

## Trust model

The native `SseTransport` deliberately carries no credential seam. The
reference `@facet/server` trusts `visitorId` as a bearer session key; two clients
presenting the same id intentionally attach to the same session. The default
browser id is a random UUID, suitable for local/public anonymous pages but not
proof of identity.

For sensitive or multi-tenant pages, authenticate before routing to Facet and
replace or wrap this transport. Read
[Security](https://github.com/getfacet/facet/blob/main/SECURITY.md) and
[Package Boundaries](https://github.com/getfacet/facet/blob/main/docs/PACKAGE-BOUNDARIES.md).

Read next:

- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md)
- [`@facet/react`](https://github.com/getfacet/facet/blob/main/packages/renderers/react/README.md)
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md)
