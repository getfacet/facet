# @facet/runtime

The Facet runtime: the event loop that drives stage patches, plus the three
persistence seams — a `StageStore` for the page (always Facet's), a `Sink` for
the conversation (store, forward, or drop), and an `AssetsStore` for per-agent
themes, stamps, and an optional initial tree. The default references are
in-memory (`MemoryStageStore`, `MemorySink`, `MemoryAssets`); file-backed Node
references live in `@facet/runtime/node`. Load asset documents through
`loadAssets`, then use `withInitialStage` when a validated initial tree should
seed fresh sessions.

```bash
npm install @facet/runtime @facet/agent @facet/core
```

`FacetRuntime.handle` processes one inbound event per visitor, calls your agent,
applies the resulting patches to the stored session, and returns the messages to
ship back. Sessions are isolated and serialized per `(agent, visitor)`.
`FacetRuntime.applyMessages` applies an already-produced result (e.g. one that
arrived after the transport's wait ended) through the same queue and salvage.

```ts
import { FacetRuntime } from "@facet/runtime";
import { defineAgent } from "@facet/agent";

const agent = defineAgent(({ event, stage }) => {
  if (event.kind === "visit") {
    stage.say("Welcome!");
  }
});

const runtime = new FacetRuntime({ agentId: "live", agent });

const messages = await runtime.handle({ visitorId: "alice" }, { kind: "visit" });
```

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
