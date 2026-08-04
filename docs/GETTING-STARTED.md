# Getting Started

Facet lets an agent render UI by emitting component markup, not executable
React, HTML, or browser code. The host chooses the agent brain and domain tools;
Facet supplies the safe stage contract, runtime loop, renderer, reference
transport, and default component set.

## Try it first

Use Quickstart when you want the complete reference experience in one process.
It composes the reference agent, runtime, reference server, React renderer, and
default assets.

```bash
npm create facet
```

Quickstart is the supported runnable evidence path for the public packages. Use
it to prove a real boot before wiring the individual packages into your own
host.

## Install the core pieces

Most integrations choose a subset of these packages:

```bash
npm install @facet/core @facet/runtime @facet/react @facet/assets
```

Add `@facet/agent` for code-authored in-process agents, `@facet/agent-tools` for
a custom LLM loop, `@facet/reference-agent` for the bundled provider loop,
`@facet/server` for the reference transport server, or `@facet/agent-client`
when an external agent dials into that server.

## Author component markup

Agents write one `<Facet>` envelope with named screens and registered component
tags. Core parses and validates that markup against the active catalog.

```ts check-docs
import { parseMarkup, validateAuthorMarkup } from "@facet/core";
import { DEFAULT_CATALOG } from "@facet/assets";

const parsed = parseMarkup(
  `<Facet entry="home"><Screen name="home"><Text value="Ready" /></Screen></Facet>`,
);

if (!parsed.ok) {
  throw new Error(parsed.error.repair);
}

const result = validateAuthorMarkup(parsed.ast, DEFAULT_CATALOG, {});
if (!result.ok) {
  throw new Error(result.error.repair);
}

console.log(result.document.entry);
```

## Embed the React renderer

React hosts close the catalog/registry trust boundary once, then render the
current stage document.

```tsx
import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { DEFAULT_REGISTRY } from "@facet/assets/react";
import { bootstrapRenderer, StageRenderer } from "@facet/react";

const bootstrap = bootstrapRenderer({
  catalog: DEFAULT_CATALOG,
  registry: DEFAULT_REGISTRY,
  theme: DEFAULT_THEME,
});

if (!bootstrap.ok) throw new Error(bootstrap.detail);

<StageRenderer bootstrap={bootstrap} document={stage.document} data={stage.data} />;
```

When a mounted renderer is backgrounded but must keep local UI state, pass
`suppressModals={true}` to hide open framework modals and suspend their scroll
lock/focus side effects without unmounting the stage.

Use the browser transport package or a custom `FacetTransport` with `useFacet`
when the page is live. The hook folds server frames into local state and stamps
visitor events with the latest known revision.

## Use an in-process agent

Use `@facet/agent` when the agent's behavior is ordinary TypeScript in the same
process as runtime.

```ts check-docs
import { defineAgent } from "@facet/agent";

export const agent = defineAgent(({ event, stage }) => {
  if (event.eventName === "visit") {
    stage.message("Welcome.");
  }
});

console.log(typeof agent.run);
```

The runtime supplies the `FacetToolSession`; the agent helper records one
optional conversation message and any stage operations the code requested.

## Build a provider-neutral LLM loop

Use `@facet/agent-tools` when your host already owns provider calls and wants to
offer Facet tools to the model. The package exports the nine tool specs, a
markup buffer for streaming providers, the executor, and turn observations.

The loop is:

1. Build a provider prompt using `FACET_PROMPT_KIT`.
2. Offer `FACET_TOOL_SPECS`.
3. Execute each model tool call with `executeFacetTool`.
4. Return the structured result and `buildTurnObservation` to the model.
5. Forward accepted runtime frames through your transport.

## Connect an external agent

Use `@facet/agent-client` when the agent process is separate from the reference
server. The external process receives validated visitor events and returns one
turn outcome: a revision-stamped patch batch plus at most one conversation
message.

The external agent still cannot bypass Facet's authoring boundary. It emits the
same component markup or patch-producing tool calls as an in-process loop.

## Run the reference transport

`@facet/server` exposes the reference server-side channel. Browser clients
subscribe to server frames and post visitor events; external agents can dial in
through the agent channel. The protocol is intentionally small and is defined in
`@facet/core`.

Use the reference server when you want a working local transport before replacing
the transport layer with your own infrastructure.

## Package responsibilities

See [Package Boundaries](PACKAGE-BOUNDARIES.md) for the current package map, and
[Architecture](ARCHITECTURE.md) for the invariants each package preserves.
