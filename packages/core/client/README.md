# @facet/client

Browser-side transports for Facet — the visitor's counterpart of
`@facet/agent-client`. Both implement the `FacetTransport` contract from
`@facet/core`, so `useFacet(transport)` accepts either.

Tier: **Reference Implementation**. This package is useful for local/self-hosted
reference deployments and for seeing how a `FacetTransport` works. Hosted
platforms normally implement their own transport with their own page/session
routes, credentials, and tenant policy.

- **`SseTransport`** — talks to a `@facet/server` over the reference protocol:
  Server-Sent Events for server→client, `fetch` POST for client→server. Events
  sent before the stream opens are queued and flushed on connect.
- **`LocalTransport`** — no network: the client talks to a `FacetRuntime` in the
  same process. For embedding, demos, and tests.
- **`withView`** — immutably attaches a browser-owned `ViewSnapshot` to a
  forwarded or locally recorded event, while preserving the event's inferred
  discriminant and exact optional-property shape.

```bash
npm install @facet/client @facet/react @facet/core
```

```tsx
import { SseTransport } from "@facet/client";
import { StageRenderer, useFacet } from "@facet/react";
import { browserVisitorId } from "@facet/client";

const transport = new SseTransport("http://localhost:5291", {
  visitorId: browserVisitorId(),
});
const { tree, send, record, transition } = useFacet(transport);

<StageRenderer
  tree={tree}
  transition={transition}
  onRecord={record}
  onAction={(action) => send({ kind: "tap", action })}
/>;
```

## Attaching current view context

Sample the browser view through `StageRenderer`'s `onViewSnapshot` callback,
then use the same helper for forwarded and record-only events:

```tsx
import { withView } from "@facet/client";
import type { ViewSnapshot } from "@facet/core";

let snapshot: ViewSnapshot | undefined;

send(withView({ kind: "message", text: "Show annual revenue" }, snapshot));
record(
  withView(
    { kind: "tap", target: "pricing", effect: { navigate: "pricing" } },
    snapshot,
  ),
);
```

`withView` does not mutate the event. An absent or empty snapshot leaves the
original event unchanged; untrusted transports still normalize and bound the
snapshot at their core event boundary.

## Trust model (read before hosting)

This is the reference client for a **reference** server: `@facet/server` trusts
`visitorId` verbatim as the session key and does not authenticate the browser
channel. That is correct for local/self-hosted, public/anonymous pages — the
default browser id is an unguessable random UUID.

Two tabs, browsers, or devices that present the same `visitorId` intentionally
attach to the same Facet session. Treat that id as a bearer session key, not as
proof of user identity.

`SseTransport` deliberately carries **no credentials**: no auth token seam, no
`fetch` `credentials`, no `EventSource` `withCredentials`. If your pages hold
per-visitor sensitive data, or ids are guessable, you must put your own
authentication in front of the server (see [SECURITY.md] in the repository) —
and at that point wrap or replace this transport with one that presents your
credential. `FacetTransport` is a small interface (`send`, `subscribe`, plus
optional `record` for local tap replay), so a hardened transport is a small,
local piece of code.

Hosted platforms should treat `@facet/client` as the renderer-side transport
contract plus a reference implementation. Project-scoped visitor credentials,
custom-domain policy, and tenant isolation belong in the platform transport that
implements `FacetTransport`.

[SECURITY.md]: https://github.com/getfacet/facet/blob/main/SECURITY.md
