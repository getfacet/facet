# Getting Started

This guide helps a coding agent or developer choose and wire a supported Facet
adoption path. Start at the [Facet README](../README.md) if you first need the
system model or package decision table.

## Prerequisites

- Node.js 20 or newer.
- React 18 or newer when using `@facet/react`.
- An OpenAI or Anthropic API key only when running the reference LLM brain.
- Your own authentication and tenant boundary before using Facet with sensitive
  or multi-tenant data. The native server/client packages are reference
  transports, not a hosted security perimeter.

Facet packages have not been published to npm yet. Package-install examples
below describe the first-release contract; current evaluation runs from this
repository with pnpm.

## Try it first

The quickest evaluation runs the reference brain, in-memory runtime, reference
SSE + POST transport, and React page together:

```bash
git clone https://github.com/getfacet/facet.git
cd facet
corepack enable
pnpm install
pnpm --filter @facet/quickstart build
OPENAI_API_KEY=sk-… pnpm exec tsx packages/tools/quickstart/src/cli.ts
```

Open `http://localhost:5292`. `ANTHROPIC_API_KEY` also works. Put a page brief in
`./facet.md` or let the bundled tour brief drive the first page. The
[`@facet/quickstart` README](../packages/tools/quickstart/README.md) documents
ports, providers, asset directories, and flags.

Quickstart is a local/reference path. It is useful for evaluation and as working
integration evidence; it is not a tenant, identity, billing, or operations
platform.

## Run the reference transport

Use the native reference transport when you want a small Node server with a
browser SSE + POST channel. This example uses an in-process TypeScript agent:

```bash
npm install @facet/server @facet/agent
```

```ts check-docs
import { defineAgent } from "@facet/agent";
import { createFacetServer } from "@facet/server";

const agent = defineAgent(({ event, stage }) => {
  if (event.kind !== "visit") return;
  stage.render({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["welcome"] },
      welcome: { id: "welcome", type: "text", value: "Welcome to Facet" },
    },
  });
  stage.say("The page is ready.");
});

const server = createFacetServer({ port: 5291, agentId: "demo", agent });
await server.listen();
```

`@facet/server` supplies transport and turn delivery. It composes
`@facet/runtime`; it does not supply the brain. An in-process `FacetAgent` is one
option, while `@facet/agent-client` can hold the external-agent channel.

The reference browser channel trusts `visitorId` as a bearer session key and
has no browser authentication. The agent channel is unauthenticated unless you
set `agentToken`. Keep the server loopback/private for local use, or place a real
authentication and authorization layer in front of it. Read
[Security](../SECURITY.md) before hosting it.

## Embed the React renderer

For the native reference browser path, install the renderer, transport, shared
types, and React peers:

```bash
npm install @facet/react @facet/client @facet/core react react-dom
```

The complete live boundary has more than `useFacet` plus `StageRenderer`:

- create the transport once for a stable visitor;
- send the initial `visit` exactly once—`useFacet` does not send it
  automatically, and development Strict Mode may run effects twice;
- preserve optional collected `fields` on agent-routed actions;
- sample `onViewSnapshot` and attach it to the next outgoing event with
  `withView`; and
- send local navigate/toggle records through `onRecord`, not through the agent
  action channel.

```tsx check-docs
import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  ClientEvent,
  CollectedEvent,
  FacetAction,
  FieldValues,
  ViewSnapshot,
  VisitorContext,
} from "@facet/core";
import { browserVisitorId, SseTransport, withView } from "@facet/client";
import { StageRenderer, useFacet } from "@facet/react";

export function FacetPage() {
  const visitor = useMemo<VisitorContext>(
    () => ({ visitorId: browserVisitorId(), locale: navigator.language }),
    [],
  );
  const transport = useMemo(
    () => new SseTransport("http://localhost:5291", visitor),
    [visitor],
  );
  const { tree, send, record, transition } = useFacet(transport);
  const viewRef = useRef<ViewSnapshot | undefined>(undefined);
  const visitSentRef = useRef(false);

  const onViewSnapshot = useCallback((snapshot: ViewSnapshot): void => {
    viewRef.current = snapshot;
  }, []);

  useEffect(() => {
    if (visitSentRef.current) return;
    visitSentRef.current = true;
    send(withView({ kind: "visit", visitor }, viewRef.current));
  }, [send, visitor]);

  const onAction = useCallback(
    (action: FacetAction, fields?: FieldValues): void => {
      const event: ClientEvent =
        fields === undefined
          ? { kind: "tap", action }
          : { kind: "tap", action, fields };
      send(withView(event, viewRef.current));
    },
    [send],
  );

  const onRecord = useCallback(
    (event: CollectedEvent): void => {
      record(withView(event, viewRef.current));
    },
    [record],
  );

  return (
    <StageRenderer
      tree={tree}
      transition={transition}
      onAction={onAction}
      onRecord={onRecord}
      onViewSnapshot={onViewSnapshot}
      colorMode="system"
    />
  );
}
```

Attach the same latest view snapshot to chat messages before sending them:

```ts
// Pseudocode — `viewRef` and `send` are owned by the component above.
send(withView({ kind: "message", text }, viewRef.current));
```

`StageRenderer` owns browser-local screen, toggle, sort, viewport, and effective
color-mode state. `onViewSnapshot` only reports that state; attaching it to an
event does not make it part of the Facet Document. The server/agent remains the
only writer of document content.

`useFacet` accepts the `FacetTransport` interface from `@facet/core`, so a hosted
application may replace `SseTransport` without replacing the renderer. A custom
transport must preserve `send`, `subscribe`, ordered patch delivery, and the
optional best-effort `record` channel. See [`@facet/client`](../packages/adapters/client/README.md)
for the reference implementation.

## Use an in-process agent

Choose `@facet/agent` when TypeScript code, a rules engine, or a test should
author the stage in the same process as `@facet/runtime`:

```bash
npm install @facet/agent @facet/runtime @facet/core
```

`defineAgent` and `defineStreamingAgent` provide a `Stage` API that records RFC
6902 changes. They do not provide LLM tool schemas or choose a model. Combine the
agent with `FacetRuntime` directly for an in-process application, or pass it to
the reference server as shown above. Start with the
[`@facet/agent` README](../packages/agents/agent/README.md).

If your brain is an LLM tool-calling loop, use `@facet/agent-tools` instead. The
[Agent Integration guide](AGENT-INTEGRATION.md) owns that provider-neutral
snapshot, discovery, executor, outcome, and retry flow.

## Connect an external agent

Choose `@facet/agent-client` when a `FacetAgent` runs outside the reference
server process. It dials out to `@facet/server`, receives visitor events, and
returns stage messages over the server's agent channel:

```bash
npm install @facet/agent-client @facet/agent @facet/core
```

This is different from `@facet/agent-tools`: the client is a network adapter,
not an LLM schema or executor. When protecting the reference agent channel, set
the server's `agentToken` and pass the same value as `token` to `connectAgent`.
That shared secret does not create tenant-scoped credentials or authorization
policy. Follow the
[`@facet/agent-client` README](../packages/adapters/agent-client/README.md).

## Add assets, protocols, or persistence

These paths extend the same Document and Runtime contract:

| Need | Start with | Boundary |
| --- | --- | --- |
| Bundled Theme and Patterns | [`@facet/assets`](../packages/core/assets/README.md) | Data only; the renderer and agent use the same validated asset snapshot. |
| Custom Theme, Presets, or Patterns | [Design System](DESIGN-SYSTEM.md) | Operator assets; never model-authored concrete CSS values. |
| AG-UI event envelope | [`@facet/ag-ui`](../packages/adapters/ag-ui/README.md) | Official adapter; Facet still owns stage validation and patch folding. |
| Durable Postgres stores | [`@facet/store-postgres`](../packages/adapters/store-postgres/README.md) | Optional persistence; not a hosted-platform schema or control plane. |

## Production boundary

Facet provides a neutral UI contract, runtime, renderer, and adapters. Before a
production deployment, the surrounding platform must decide and enforce:

- authenticated visitor and agent identities;
- tenant/project isolation and authorization;
- rate limits, quotas, billing, metering, and abuse controls;
- durable-store lifecycle, migrations, backup, and fan-out; and
- model/provider policy, secrets, conversation history, retries, and business
  tools.

Read [Package Boundaries](PACKAGE-BOUNDARIES.md) before treating a reference,
official, or optional package as a complete deployment.

## Next

- [Design System](DESIGN-SYSTEM.md) — styling concepts and operator assets.
- [Agent Integration](AGENT-INTEGRATION.md) — custom LLM authoring loop.
- [Architecture](ARCHITECTURE.md) — complete ownership and data-flow behavior.
- [Agent Tool Result Contract](AGENT-TOOL-RESULT-CONTRACT.md) — exact executor
  outcomes.
- [Package Boundaries](PACKAGE-BOUNDARIES.md) — package and deployment roles.
