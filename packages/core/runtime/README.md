# @facet/runtime

Facet's in-process session event loop. It serializes one visitor session at a
time, calls a host-supplied in-process agent, folds validated stage operations,
persists the updated state, and emits transport-neutral frames for a browser or
other client to deliver.

Role: **Core**.

```bash
npm install @facet/runtime @facet/agent @facet/assets
```

Use this package when your process owns session execution. Do not use it as a
renderer, network server, hosted control plane, or LLM provider loop.

## Responsibilities

`FacetRuntime` owns the framework parts of a turn:

- load or seed the stage for an `(agent, visitor)` pair;
- serialize events through a per-session queue;
- call the provided `run({ event, session })` agent;
- apply authorized RFC 6902 patches with revision checks;
- persist the resulting stage through `StageStore`;
- record conversation output through `Sink`; and
- expose optional per-frame observation hooks.

The host still owns identity, authorization, billing, metering, quotas, provider
selection, API keys, and product-domain work.

## Storage seams

The root entrypoint exposes async interfaces and browser-safe in-memory
implementations:

- `StageStore` stores the current page document and revision.
- `Sink` records conversation turns.
- `SummaryStore` stores an opaque rolling-summary payload owned by the agent
  brain.

These interfaces are Promise-based so hosts can back them with databases or
other durable systems. Their payloads remain Facet protocol data; runtime does
not know a domain schema and does not perform browser-side domain fetches.

## Event loop

`FacetRuntime.handle` accepts one inbound event and returns the frames that
should be delivered for that turn. The agent may return a single batch or an
async stream of batches. Runtime folds, persists, and emits each batch before
pulling the next one, preserving revision order.

`bootstrapSession` validates the catalog, theme, and optional `themeExtensions`
together. Persisted sessions keep those extension declarations so restore checks
theme data against the same active contract.

```ts
import { defineAgent } from "@facet/agent";
import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { bootstrapSession, FacetRuntime, MemorySink, MemoryStageStore } from "@facet/runtime";

const agent = defineAgent(({ event, stage }) => {
  if (event.eventName === "visit") {
    void stage.render(
      `<Facet entry="home"><Screen name="home"><Text value="Welcome." /></Screen></Facet>`,
    );
  }
});

const store = new MemoryStageStore();
const boot = bootstrapSession({ catalog: DEFAULT_CATALOG, theme: DEFAULT_THEME });
if (!boot.ok) {
  throw new Error(`Session bootstrap failed: ${boot.detail}`);
}
await store.save("demo:alice", boot.session, 0);

const runtime = new FacetRuntime({
  agent,
  sink: new MemorySink(),
  store,
  turnTimeoutMs: 30_000,
});

const turn = await runtime.handle({
  sessionKey: "demo:alice",
  event: {
    eventId: "visit-1",
    eventName: "visit",
    sourceNodeId: "root",
    screen: "home",
    stageRevision: 0,
    collect: {},
  },
});
console.log(turn.outcome);
```

The example uses the code-authored `@facet/agent` helper for brevity. A custom
LLM loop can provide the same `run({ event, session })` contract directly.
`turnTimeoutMs` is optional and defaults to 30 seconds; local tools can raise it
when an in-process provider regularly needs more time.

## Fail-safe boundaries

Runtime does not trust stored or agent-produced stage data. It applies the Core
patch fold, revision/CAS checks, redaction helpers, and bounded serialization
contracts before persistence and delivery. Invalid author mutations reject as a
turn outcome; corrupt persisted input is reduced to a bounded safe state rather
than thrown into the transport layer.

The optional `deliver` callback receives committed outbox entries for
observability or transport delivery. It is read-only: it can inspect what
happened, but it is not a second writer for stage content.

## Documentation

- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md) —
  runtime invariants and event flow.
- [Agent Integration](https://github.com/getfacet/facet/blob/main/docs/AGENT-INTEGRATION.md) —
  provider-neutral agent loop wiring.
- [Package Boundaries](https://github.com/getfacet/facet/blob/main/docs/PACKAGE-BOUNDARIES.md) —
  deployment and package ownership.
