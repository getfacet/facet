# @facet/runtime

The Facet runtime: the event loop that drives stage patches, plus the four
persistence seams — a `StageStore` for the page (always Facet's), a `Sink` for
the conversation (store, forward, or drop), an `AssetsStore` for per-agent
themes, stamps, catalog policy, and an optional initial tree, and a
`SummaryStore` for a per-visitor rolling-summary record used by brain-side
context compaction (the payload is opaque to the runtime — the consuming brain
owns its schema; `put` advances only on a strictly newer covered-through
marker, and `delete` lets the brain rebuild after a mismatch). The default references are
in-memory (`MemoryStageStore`, `MemorySink`, `MemoryAssets`,
`MemorySummaryStore`); file-backed Node references live in
`@facet/runtime/node` (`FileSummaryStore` writes `<key>.summary.json`, safe to
share a state directory with `FileStageStore`/`FileSink` — pair a durable
summary store with an equally durable sink). Load asset documents through
`loadAssets`, then use `withInitialStage` when a validated initial tree should
seed fresh sessions. Asset loading is fail-soft: adapter failures, malformed
store shapes, hostile accessors/arrays, oversized asset arrays, and invalid
catalog or initial tree documents are returned as bounded/sanitized issues while
the bundled defaults still resolve.

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

## Assets

`AssetsStore` returns raw operator documents. `loadAssets(store, agentId)` is the
single validation gate that turns those documents into:

- `themes`: `DEFAULT_THEME` plus valid custom `*.theme.json` documents.
- `stamps`: `DEFAULT_STAMPS` plus valid custom `*.stamp.json` documents.
- `catalog`: a validated catalog document, or `DEFAULT_CATALOG`.
- `initialTree`: an optional seed tree only when it validates and renders content.
- `issues`: bounded warnings for skipped, shadowed, or sanitized documents.

The Node-only `FileAssets` reference, imported from `@facet/runtime/node`, reads
`*.theme.json`, `*.stamp.json`, optional `catalog.json`, and optional
`initial.tree.json` from a directory. Missing `catalog.json`, malformed catalog
shape, invalid catalog names, unreadable stores, or validator throws all fall
back to `DEFAULT_CATALOG`; boot continues and the issue list records the
fallback. `MemoryAssets({ themes: [], stamps: [] })` goes through the same path,
so an empty registry still resolves the default theme, default stamps, and the
locked theme default catalog.

Catalog policy is UI authoring policy for the agent stack: active theme,
theme-switch allowance, allowed brick types/variants, stamp allow-list, primitive
fallback, and the `stamp -> high-level brick -> primitive fallback` authoring
order. The runtime only loads and validates that policy. Hosted platform policy
such as auth, tenant isolation, billing, usage metering, rate limits, and spend
caps belongs to the platform around Facet, not to `AssetsStore`.

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
