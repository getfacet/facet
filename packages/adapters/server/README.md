# @facet/server

The native reference transport for Facet: a small Node SSE + POST server that
carries browser events to a runtime and streams stage patches and chat back.

Role: **Adapters**. Use this package for local/self-hosted reference deployments
or to study Facet's native transport. It is not a complete hosted edge or
security perimeter.

The server exposes two channels:

- browser: `GET /stream` + `POST /event` and best-effort `POST /record`;
- external agent: `GET /agent/stream` + `POST /agent/control`.

Both directions let browsers and agents dial out without requiring an inbound
endpoint on the agent. `createFacetServer` composes `@facet/runtime`; supply an
in-process `FacetAgent` as a fallback brain or connect one through
`@facet/agent-client`.

For an in-process code-authored agent:

```bash
npm install @facet/server @facet/agent
```

```ts check-docs
import { defineAgent } from "@facet/agent";
import { createFacetServer } from "@facet/server";

const agent = defineAgent(({ event, stage }) => {
  if (event.kind === "visit") stage.say("Welcome!");
});

const server = createFacetServer({
  port: 5291,
  host: "127.0.0.1",
  agentId: "demo",
  agent,
});
await server.listen();
```

See the canonical
[reference transport walkthrough](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md#run-the-reference-transport)
for the matching browser and renderer wiring.

## Runtime and storage

The server defaults to in-memory stage and conversation stores. Pass
`stageStore` and `sink` when the surrounding application needs durable
implementations. Persistence does not add tenant, auth, backup, migration, or
fan-out policy; those remain deployment responsibilities.

The package's route assembly, validation, replay, and turn-tracking modules are
private implementation seams. The supported public entrypoint is the package
root with `createFacetServer` and its option/result types.

## Delivery behavior

Browser SSE frames carry a per-session sequence. `EventSource` reconnects can
resume missed frames; a full rehydrate starts with an explicit `reset` before
the snapshot and chat history.

An agent turn that crosses `agentTimeoutMs` receives an interim note rather than
being discarded. Its result may still be delivered later, but a stale result
cannot overwrite a newer stage. Per-visitor delivery stays serialized. These
mechanics are reference behavior, not a hosted availability guarantee.

## Accepted-frame observation

`createFacetServer` accepts an optional `observer`. Omitting it preserves the
existing transport behavior and does no observation work. When present, it
receives two detached, deeply frozen evidence shapes:

- `ui-in` records a validated, normalized browser input on its per-visitor
  lane. `source: "forwarded"` identifies `/event`; `source: "record"`
  identifies the local-only `/record` channel. A forwarded record has a stable
  `turnId`; a local-only record has `turnId: null` because no agent turn exists.
- `accepted-frame` records messages after the authoritative fold accepted them,
  with the matching `turnId`, originating event, `source: "live" | "late"`,
  per-frame `agentMutated`, and the post-fold stage when it can be read.
  `disposition: "applied"` is a normal accepted frame. `"say-only-stale"`
  means a late result's stale patches were discarded while its accepted chat
  messages and the newer authoritative stage were retained.

```ts
import {
  createFacetServer,
  type FacetServerObservation,
} from "@facet/server";

const observations: FacetServerObservation[] = [];
const server = createFacetServer({
  port: 5291,
  host: "127.0.0.1",
  agentId: "demo",
  agent,
  observer: (observation) => {
    observations.push(observation);
  },
});
```

The observer is best-effort diagnostics, not a writer or durable audit log. It
cannot replace messages, mutate the persisted stage, change stale-frame
disposition, or reject an input. Callback throws, rejected returned promises,
hostile thenables, clone failures, and attempted mutation are swallowed;
returned promises are not awaited. Because evidence lookup is non-controlling,
an `accepted-frame` can carry `stage: undefined` when that evidence is
unavailable, including when a diagnostic stage read fails; authoritative
processing still continues.

## Trust model

This server is intended for local/self-hosted, single-operator, public/anonymous
reference use:

- browser `visitorId` is trusted verbatim as the session key;
- the browser channel has no authentication;
- the agent channel is unauthenticated unless `agentToken` is configured; and
- CORS on the browser channel is permissive for the reference setup.

Do not expose it by itself as a public multi-tenant SaaS edge. It does not
provide tenant/project lookup, scoped browser credentials, authorization, rate
limits, usage metering, billing/quota enforcement, abuse controls, admin auth,
audit logs, secrets management, or custom-domain routing. Put those controls in
the platform around Facet, and use a hardened transport where sensitive data is
involved.

Read next:

- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md)
- [Security](https://github.com/getfacet/facet/blob/main/SECURITY.md)
- [Package Boundaries](https://github.com/getfacet/facet/blob/main/docs/PACKAGE-BOUNDARIES.md)
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md)
