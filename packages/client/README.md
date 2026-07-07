# @facet/client

Browser-side transports for Facet — the visitor's counterpart of
`@facet/agent-client`. Both implement the `FacetTransport` contract from
`@facet/core`, so `useFacet(transport)` accepts either.

- **`SseTransport`** — talks to a `@facet/server` over the reference protocol:
  Server-Sent Events for server→client, `fetch` POST for client→server. Events
  sent before the stream opens are queued and flushed on connect.
- **`LocalTransport`** — no network: the client talks to a `FacetRuntime` in the
  same process. For embedding, demos, and tests.

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

## Trust model (read before hosting)

This is the reference client for a **reference** server: `@facet/server` trusts
`visitorId` verbatim as the session key and does not authenticate the browser
channel. That is correct for local/self-hosted, public/anonymous pages — the
default browser id is an unguessable random UUID.

`SseTransport` deliberately carries **no credentials**: no auth token seam, no
`fetch` `credentials`, no `EventSource` `withCredentials`. If your pages hold
per-visitor sensitive data, or ids are guessable, you must put your own
authentication in front of the server (see [SECURITY.md] in the repository) —
and at that point wrap or replace this transport with one that presents your
credential. `FacetTransport` is a small interface (`send`, `subscribe`, plus
optional `record` for local tap replay), so a hardened transport is a small,
local piece of code.

[SECURITY.md]: https://github.com/getfacet/facet/blob/main/SECURITY.md
