# @facet/runtime

The Facet runtime: the event loop that drives stage patches, plus the three
persistence seams — a `StageStore` for the page (always Facet's), a `Sink` for
the conversation (store, forward, or drop), and an `AssetsStore` for per-agent
themes, stamps, and an optional initial tree. The default references are
in-memory (`MemoryStageStore`, `MemorySink`, `MemoryAssets`); file-backed Node
references live in `@facet/runtime/node`. Load asset documents through
`loadAssets`, then use `withInitialStage` when a validated initial tree should
seed fresh sessions. Asset loading is fail-soft: adapter failures, malformed
store shapes, hostile accessors/arrays, oversized asset arrays, and invalid
initial trees are returned as bounded/sanitized issues while the bundled
defaults still resolve.

```bash
npm install @facet/runtime @facet/agent @facet/core
```

`FacetRuntime.handle` processes one inbound event per visitor, calls your agent,
and accepts either one result array or an async stream of result batches. Each
batch is folded into the stored session, saved, and delivered before the next
batch is pulled; the `Sink` record is still written once for the whole turn.
When a transport supplies an `onFrame` callback, each delivered batch also gets
a lazy `RuntimeFrameContext.stage` snapshot of the saved stage for that frame,
so adapters can emit full repair snapshots without rereading future state.
Sessions are isolated and serialized per `(agent, visitor)`. The `Sink` is keyed
by visitor id, but the stored event body redacts duplicate `visitorId` values and
sensitive collected field names such as `password`, `token`, and `api_key`, plus
key-looking field values.
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
