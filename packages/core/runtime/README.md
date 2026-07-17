# @facet/runtime

The Facet event loop plus four persistence seams:

- `StageStore` for per-visitor page state;
- `Sink` for conversation records;
- `AssetsStore` for one per-agent Theme, an exact Pattern list, and an optional
  initial tree; and
- `SummaryStore` for an opaque per-visitor rolling-summary record owned by the
  consuming brain.

Browser-safe in-memory references are exported from `@facet/runtime`:
`MemoryStageStore`, `MemorySink`, `MemoryAssets`, and `MemorySummaryStore`.
Node-only file references are exported from `@facet/runtime/node`.

```bash
npm install @facet/runtime @facet/agent @facet/core
```

## Event loop

`FacetRuntime.handle` processes one inbound event per visitor and accepts either
one result batch or an async stream of batches from the agent. Every batch is
folded into the stored session, saved, and delivered before the next batch is
pulled. Sessions are isolated and serialized per `(agent, visitor)`.

The runtime applies the same patch fold used by the client and salvages safe
operations when stale or bypassed data appears. `FacetRuntime.applyMessages`
uses that same queue for an already-produced result.

```ts
import { defineAgent } from "@facet/agent";
import { FacetRuntime } from "@facet/runtime";

const agent = defineAgent(({ event, stage }) => {
  if (event.kind === "visit") stage.say("Welcome!");
});

const runtime = new FacetRuntime({ agentId: "live", agent });
const messages = await runtime.handle({ visitorId: "alice" }, { kind: "visit" });
```

The `Sink` record is written once for the whole turn. Sensitive collected field
names and key-looking values are redacted before storage. The shared
`shouldRedactSensitiveField` and `redactSensitiveText` helpers let downstream
prompt/history boundaries apply the same rule. An optional
`RuntimeRecordSettlementObserver` observes the fire-and-forget record promise;
it is not a `Sink`.

## Assets

`AssetsStore.load(agentId)` returns raw `AssetDocuments`:

```ts
interface AssetDocuments {
  readonly theme?: unknown;
  readonly patterns?: unknown;
  readonly initialTree?: unknown;
  readonly issues?: readonly string[];
}
```

`loadAssets(store, agentId)` is the single validation gate. It returns one
deeply detached and frozen `LoadedAssets` snapshot:

- `theme`: the complete supplied Theme, or `DEFAULT_THEME` when absent or
  invalid. A custom Theme is never partially merged with the default.
- `patterns`: the supplied exact compatible Pattern list. Absence selects
  `DEFAULT_PATTERNS`; an explicit `[]` exposes none. A malformed entry is
  hidden whole, and a list over the 64-Pattern cap exposes none.
- `initialTree`: present only when strict Theme-aware validation succeeds and
  the tree contains renderable content.
- `issues`: bounded, sanitized diagnostics for adapter, validation, and fallback
  events.

Pattern validation uses the effective Theme, so a Pattern may safely refer to
its Presets and style names. Loading a Pattern never applies it to the stage.
The agent may inspect a Pattern and author ordinary Bricks later.

```ts
import { loadAssets, MemoryAssets, withInitialStage } from "@facet/runtime";

declare const operatorTheme: unknown;
declare const operatorPatterns: unknown;
declare const baseStageStore: Parameters<typeof withInitialStage>[0];

const loaded = await loadAssets(
  new MemoryAssets({ theme: operatorTheme, patterns: operatorPatterns }),
  "live",
);

const stageStore = withInitialStage(baseStageStore, loaded.initialTree);
// Send loaded.theme to the renderer and agent; keep loaded.patterns agent-side.
```

`FileAssets`, imported from `@facet/runtime/node`, reads only these exact files
from one directory:

| File | Raw document |
| --- | --- |
| `theme.json` | One complete Theme object. |
| `patterns.json` | One array of exact Pattern objects. |
| `initial.tree.json` | One optional strict initial Facet tree. |

The directory is read once by the host; there is no hot reload. Discovery is
capped at 4096 entries, each current file is capped at 1 MiB, and filesystem or
JSON failures become issues instead of throws. The main package remains free of
`node:fs`.

Raw storage, validation, and initial-stage seeding stay separate. An
`AssetsStore` backend should preserve raw documents; `loadAssets` owns all
Theme/Pattern semantics and fallback behavior.

## Summary storage

`SummaryStore` payloads are opaque to the runtime. The consuming brain owns the
schema and validation. `put` advances only on a strictly newer covered-through
marker, and `delete` lets the brain rebuild after a conversation mismatch.
File-backed summaries use `<key>.summary.json`; pair a durable summary store
with an equally durable `Sink`.

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
