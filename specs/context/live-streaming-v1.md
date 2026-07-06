# Context Evidence: live-streaming-v1

> Stage 0 output of `/spec-bridge`. Evidence gathered against `main`
> (`a285569`, 2026-07-06). Brief: `specs/feature-intake/live-streaming-v1.md`.
> All claims carry file:line anchors verified by the context pass. This doc
> records evidence only — it invents no new facts. The writer MUST consume every
> RISK entry below.

## Feature in one line

Let a `FacetAgent` stream a turn as multiple ordered batches of `ServerMessage[]`
(a page that visibly builds live) instead of returning one array at turn end —
without breaking the two invariants, the per-turn Sink/log contract, or the
existing array/Promise agent producers and remote boundaries.

## Affected packages

Brief-scoped:

- `@facet/core` — the `FacetAgent` protocol type (return surface changes).
- `@facet/agent` — `defineAgent` producer (must stay back-compatible).
- `@facet/runtime` — the turn driver: apply / persist / seed-frame / deliver.
- `@facet/server` — the reference transport: per-visitor lane + delivery + frame-log.
- `@facet/quickstart` — the built-in LLM brain that would emit per-step batches.

**Added by the context pass (RISK-API-1 — otherwise `pnpm typecheck` fails in
unscoped packages):**

- `@facet/agent-client` — awaits the agent and treats the result as an array
  (`packages/agent-client/src/connect.ts:143`).
- `@facet/bridge` — awaits `driver.agent(...)` then reads `.length`
  (`packages/bridge/src/bridge.ts:123`).

## Code entrypoints (verified anchors)

| Anchor | What lives there |
| --- | --- |
| `packages/core/src/protocol.ts:133` | `FacetAgent` type — currently `(event, session) => Promise<readonly ServerMessage[]> \| readonly ServerMessage[]`. The changed surface. |
| `packages/agent/src/define-agent.ts:18` | `defineAgent` producer returns `stage.flush()` (an array) — back-compat target (DC-004). |
| `packages/agent/src/stage.ts:92` | Stage op-generation / flush point. |
| `packages/runtime/src/runtime.ts:106` | Runtime turn handling (open/agent-call region). |
| `packages/runtime/src/runtime.ts:207` | Region around the agent invocation. |
| `packages/runtime/src/runtime.ts:213` | `const messages = await this.agent(...)` — the single iteration driver to normalize+iterate (per-batch delivery seam). |
| `packages/runtime/src/runtime.ts:234-280` | `persistWithSeed`: seed-frame prepend (`:261-263`), `agentMutated` derive (`:271`), `pendingSeeds` consume (`:278`). |
| `packages/runtime/src/runtime.ts:237` | Persist-with-seed entry. |
| `packages/runtime/src/runtime.ts:300-332` | `persist`: couples `save` + Sink record; `resolveRecord({at,event,messages})` at `:313`. |
| `packages/runtime/src/runtime.ts:342-352` | `applyToSession`: CONCATENATES a turn's patch messages and folds ONCE (per-turn coalescing — INV#6/#3 seam). |
| `packages/runtime/src/runtime.ts:353` | End of the apply/fold region. |
| `packages/runtime/src/runtime.ts:167-177` | `reserveRecordSlot` — one-shot Promise resolve (the single reserved record slot). |
| `packages/server/src/server.ts:442` | `/event` POST handler entry. |
| `packages/server/src/server.ts:458-489` | Per-visitor lane task: `runtime.handle` (`:467`), single `deliver` (`:468`), `frameLog.recordApplied` gated on `agentMutated` (`:485`). |
| `packages/server/src/server.ts:646` | (Second server seam in scope — transport wiring.) |
| `packages/quickstart/src/agent.ts:252` | Quickstart per-step agent loop (would yield per provider step, DC-007). |

Supporting anchors surfaced by the risk probes:

- `packages/core/src/validate.ts:476-503` — `pruneDanglingChildren` removes a
  child id from `parent.children` when the target node is absent
  (`:499-500` rewrites `node.children` to the kept list).
- `packages/core/src/validate.ts:596/656` — `validateTree` returns the FULL
  sanitized node map; orphan/unreachable nodes are KEPT, never dropped.
- `packages/quickstart/src/agent.ts:190-198` — `append_node` gates `parentId`
  via `knownIds` AND creates node+ref in one `stage.append` (parent-first-safe).
- `packages/quickstart/src/agent.ts:205-210` / `:164-182` — `set_node` /
  `render_page` let the model set a box with `children` ids not-yet-created.
- `packages/server/src/frame-log.ts:134-138` — `arrival.index` per-visitor
  arrival ordinal; `:140-143` `recordApplied` advances `lastApplied`.
- `packages/server/src/late.ts:80` — uses `lastApplied` to reject a superseded
  late/resume result.
- `packages/server/src/server.ts:558-584` — late-apply `applyMessages` path.
- `packages/server/src/agent-channel.ts:120` — `const remoteAgent: FacetAgent`
  returning a single `new Promise<readonly ServerMessage[]>`; `:154` composes it;
  `:123/:159` offlineFor / INTERIM_TIMEOUT fallbacks + fallbackAgent branch.
- `packages/agent-client/src/connect.ts:143` — `messages = await agent(...)`
  then `sendControl(requestId, messages)`; `AgentControlFrame.messages` is
  `readonly ServerMessage[]`.
- `packages/bridge/src/bridge.ts:123` — `const messages = await driver.agent(...)`
  then reads `messages.length`; producers at `packages/bridge/src/persistent.ts:209`
  and `packages/bridge/src/bridge.ts:302` return `Promise<readonly ServerMessage[]>`.
- `packages/core/src/protocol.ts:161/:180` — `AgentEventFrame` /
  `AgentControlFrame { requestId; messages: readonly ServerMessage[] }` (one
  batch per requestId on the wire).
- Array-returning test doubles: `packages/server/src/server.test.ts:25`,
  `packages/runtime/src/runtime.test.ts:34`,
  `packages/client/src/local-transport.test.ts:8`,
  `packages/runtime/src/assets.test.ts:464`.
- `packages/quickstart/src/stub.ts:91` — stub agent via `defineAgent`.

## Risk register (writer MUST consume each)

### RISK-INV-1 (INV) — two-writers coherence (#6) + fail-safe (#3). MOST CRITICAL.

Per-batch folding DROPS the per-turn coalescing guarantee that today prevents
forward child-references from being permanently pruned.

- Seam: `runtime.ts:342-352` (`applyToSession`) CONCATENATES all of a turn's
  patch messages and folds them ONCE precisely because "a later message may
  reference a node an earlier one only appended a child ref for. Folding each
  message separately would run `validateTree`'s dangling-ref pruning on that
  intermediate state and orphan the forward reference." Streaming folds each
  yielded batch SEPARATELY, resurrecting exactly that hazard across batch
  boundaries.
- Backing seam: `validate.ts:476-503` `pruneDanglingChildren` REMOVES a child id
  from `parent.children` when the target node is absent (`:499-500` rewrites
  `node.children` to the kept list). Because `validateTree` returns the FULL
  sanitized node map (`:596/:656` — orphan/unreachable nodes are KEPT, never
  dropped), the two orderings are ASYMMETRIC:
  - **child-first** (add node X to map in batch 1, add parent ref to X in batch
    2) is SAFE — X survives as an orphan and reconnects. This is the ONLY case
    the brief's Example 2 / DC-005 cover.
  - **parent-ref-first** (batch 1 sets/creates a box whose `children:["X"]` with
    X not yet in the map) permanently prunes the `"X"` ref; when batch 2 adds
    node X the parent no longer references it → X is orphaned forever =
    irrecoverable content loss and a stored==client-but-wrong tree. UNMITIGATED
    by the brief.
- Resolution the spec MUST implement:
  (a) fold each yielded batch ONCE (identical to today's per-turn coalescing,
      just at batch granularity) so within-batch forward refs stay safe;
  (b) DEFINE the yield boundary as referentially-closed in the
      parent→child-ref direction — a child-ref op and its target-node op must
      land in the SAME batch;
  (c) prove the quickstart per-step yield (DC-007) only emits closed batches:
      `append_node` is parent-first-safe (`agent.ts:190-198` gates `parentId`
      via `knownIds` AND creates node+ref in one `stage.append`), but
      `set_node`/`render_page` (`agent.ts:205-210`, `:164-182`) let the model set
      a box with `children` ids not-yet-created — a spec test MUST cover
      "set_node with forward child refs split across provider steps" and either
      forbid the split (buffer such ops until closure) or document the fail-safe
      deferred-loss + model-recovery-via-observation contract.

### RISK-INV-2 (INV) — log/replay granularity (#6, DC-006).

Per-batch persist would break the ONE-StoredEvent-per-turn Sink contract.

- Seam: `runtime.ts:300-332` (`persist`) COUPLES `save` AND the Sink record — it
  calls `resolveRecord({ at, event, messages })` at `:313` for the turn's whole
  message list. That resolve callback is the single reserved slot from
  `reserveRecordSlot` (`:167-177`), a one-shot Promise resolve: calling it once
  per batch means only the FIRST batch's messages are recorded and batches 2..N
  are silently dropped from the log, drifting event-layer-v1's turn-granular
  replay (a rehydrate would replay a partial turn).
- Resolution the spec MUST implement: decouple the two halves of `persist` for
  the streaming path — each batch runs `apply(foldPatchIntoStage)` +
  `save(stageStore.save)` + deliver but does NOT record; ACCUMULATE every batch's
  `ServerMessage[]` across the turn and call `resolveRecord` ONCE at turn end
  with the concatenation (DC-006). Mid-stream throw (DC-005): record the batches
  accumulated-so-far so the durable log matches the persisted partial stage —
  the reserved slot must resolve to the accumulated entry, not null, on a
  throw-after-N-batches. Add a runtime test asserting a 3-batch turn produces
  exactly ONE StoredEvent whose `messages` == fold-order concatenation.

### RISK-INV-3 (INV) — server-authoritative coherence (#6): seed frame + agentMutated aggregation.

Two per-turn scalars in `persistWithSeed` become wrong if computed per batch.

- Seam A (seed frame): `runtime.ts:234-280` prepends the pre-seed as a root
  `replace-''` snapshot (`:261-263`) as the turn's FIRST frame and consumes
  `pendingSeeds` (`:278`) only AFTER persist resolves. Under streaming the seed
  must be prepended to the FIRST delivered batch ONLY, with value =
  `session.stage` at first-batch time; prepending it to every batch re-ships a
  full root-replace mid-turn that WIPES the incrementally-built partial the
  client just folded (the exact opposite of the "live building" goal), and
  consuming `pendingSeeds` per batch instead of once-after-the-whole-turn-persists
  races the blank-page recovery (a later-batch save-reject after an early
  seed-consume would strand a client that connected before the session existed —
  `runtime.ts:227-233`). If the first batch is empty (policy: empty batch => no
  frame), the seed must ride the first NON-empty batch (or its own frame), never
  be dropped.
- Seam B (agentMutated): `runtime.ts:271` derives one `agentMutated` bool from
  the single fold; it gates the transport's staleness machinery — `server.ts:485`
  calls `frameLog.recordApplied` only when `result.agentMutated` is true, and
  `recordApplied` advances `lastApplied` (`frame-log.ts:140-143`) which
  `late.ts:80` uses to reject a superseded late/resume result. Under streaming
  `agentMutated` MUST be the OR across ALL batches (mutated iff ANY batch applied
  a non-test op); reporting only the last/first batch's mutated would leave
  `lastApplied` un-advanced after a real mutation and let a stale parked late
  result overwrite the freshly-streamed page (INV#6 ordering/resume break).
- Resolution: seed prepended to first non-empty batch only, `pendingSeeds`
  consumed once at turn end; `TurnResult` stays one-per-turn with
  `agentMutated = OR of batch mutations`.

### RISK-INV-4 (INV) — per-visitor serial-lane ordering (#6): mid-turn delivery must stay INSIDE the lane task.

- Seam: `server.ts:461-489` — today the POST handler does
  `result = await runtime.handle(visitor, event)` (`:467`) then a SINGLE
  `deliver(result.messages)` (`:468`), and frames stay strictly ordered ONLY
  because `deliver` assigns `era:seq` and fans out synchronously INSIDE the
  `void lane(visitorId, ...)` task (`:458-461` comment: "deliver assigns seqs and
  fans out synchronously, so this visitor's frames can't cross or reorder — a
  late apply for the same visitor enqueues behind this task"). Streaming must
  deliver each yielded batch DURING the turn while keeping EVERY per-batch
  `deliver` inside that same lane task; if the async generator is driven — or any
  batch delivered — outside the lane task (e.g. runtime returns frames the server
  delivers after the await, or a floating microtask pulls the next batch),
  mid-turn frames can interleave/reorder against a concurrent same-visitor
  late-apply (`server.ts:558-584` `applyMessages` path) or resume replay,
  violating "batch order == yield order" and the single-writer guarantee.
  `recordApplied` (`server.ts:485`) must still fire exactly ONCE at turn end on
  the aggregate `agentMutated` (per RISK-INV-3), keyed on `arrival.index` (the
  per-visitor arrival ordinal, `frame-log.ts:134-138`) not per-batch frame seqs.
- Resolution the spec MUST implement: drive the AsyncIterable inside the lane
  task; deliver each batch synchronously (assign `era:seq` via the existing
  `deliver`) before pulling the next; the `/event` POST still acks 202
  immediately and the late/resume path (`applyMessages`) stays single-frame and
  enqueues behind the streaming turn — confirm the `FACET_MAX_CONCURRENT`
  wait/park path composes with a turn that now emits N frames before completing.

### RISK-API-1 (API) — UNLISTED BREAKING CONSUMERS.

The changed surface is the barrel-exported protocol type `FacetAgent` in
`@facet/core` (`protocol.ts:133` — currently
`(event, session) => Promise<readonly ServerMessage[]> | readonly ServerMessage[]`).
The brief's affected-packages list omits two packages that CALL and await the
agent and treat the result as a plain array:

- `@facet/agent-client` at `connect.ts:143` — `messages = await agent(frame.event, session)`
  then passes `messages` into `sendControl(requestId, messages)` where
  `AgentControlFrame.messages` is `readonly ServerMessage[]`.
- `@facet/bridge` at `bridge.ts:123` — `const messages = await driver.agent(event, session)`
  then reads `messages.length`.

Once `FacetAgent`'s return union admits `AsyncIterable<...>`, both become COMPILE
ERRORS (an AsyncIterable has no `.length` and is not assignable to
`readonly ServerMessage[]`) — TypeScript fails `pnpm typecheck` (DC-008) in
packages the brief never scoped.

Resolution the spec MUST implement: add `@facet/agent-client` and `@facet/bridge`
to affected packages, and normalize the agent result at BOTH call sites via one
shared helper (e.g. `collectMessages(result: FacetAgentResult): Promise<readonly ServerMessage[]>`
that awaits / for-await-ofs any of `array | Promise<array> | AsyncIterable<array>`
into a flat array). These two boundaries do NOT stream (they collapse the
iterable to a single batch) — see RISK-API-2.

### RISK-API-2 (API) — REMOTE BOUNDARY CANNOT STREAM (protocol coupling).

`@facet/server` presents an external (agent-client) agent to the runtime as a
`FacetAgent` at `agent-channel.ts:120` (`const remoteAgent: FacetAgent = ...`
returning a single `new Promise<readonly ServerMessage[]>`) and composes it at
`:154`. That Promise resolves from exactly ONE `AgentControlFrame` per
`requestId`, and the wire type carries a single batch: `protocol.ts:180`
`AgentControlFrame { requestId; messages: readonly ServerMessage[] }` answering
one `AgentEventFrame` (`protocol.ts:161`). So if the runtime driver iterates
`FacetAgent` as an AsyncIterable, a remote/dial-in agent can still only ever
produce ONE frame — the `AgentControlFrame` wire is not multi-batch.

Resolution the spec MUST implement:
(1) make `remoteAgent` (and the offlineFor/INTERIM_TIMEOUT fallbacks at
    `agent-channel.ts:123/:159`, and the fallbackAgent branch) conform to the new
    union by yielding/resolving exactly once so the runtime's normalize step
    treats a remote turn as a single-frame turn;
(2) explicitly declare as a v1 NON-GOAL that streaming does not cross the
    agent-client remote boundary (`AgentControlFrame` stays one-batch) — otherwise
    a reader expects agent-client per-step streaming the protocol can't deliver.
No `AgentControlFrame`/`AgentEventFrame` shape change should be made in this
feature.

### RISK-API-3 (API) — UNION-vs-REPLACE decision sets the entire blast radius.

The brief is internally inconsistent (labels `@facet/core` "Breaking" but
`@facet/agent`/runtime/server "Additive").

- A pure `AsyncIterable<ServerMessage[]>` REPLACEMENT of `FacetAgent` breaks
  EVERY producer that returns an array/Promise: `define-agent.ts:18` (returns
  `stage.flush()` array), `quickstart/src/stub.ts:91` (via `defineAgent`),
  `bridge/src/persistent.ts:209` and `bridge/src/bridge.ts:302` (return
  `Promise<readonly ServerMessage[]>`), `agent-channel.ts:120/:154`
  (RISK-API-2), plus every test double returning a literal array
  (`server.test.ts:25` `() => [{kind:"say",...}]`, `runtime.test.ts:34`,
  `client/src/local-transport.test.ts:8`, `runtime/src/assets.test.ts:464`).
- A WIDENING union
  `readonly ServerMessage[] | Promise<readonly ServerMessage[]> | AsyncIterable<readonly ServerMessage[]>`
  keeps all array/Promise producers valid (truly additive, satisfying DC-004
  defineAgent back-compat) and confines the change to (i) the single runtime
  iteration driver at `runtime.ts:213` (`const messages = await this.agent(...)`
  → normalize+iterate, delivering per batch) and (ii) the two non-runtime callers
  in RISK-API-1.

Resolution the spec MUST implement: lock the union form (Decision-lock already
hedges "async-generator … or a compatible union"), define ONE normalize helper
used by all three call sites (runtime, agent-client, bridge), and reclassify
`@facet/core` as additive-widening (not a hard break) so existing array/Promise
producers need no edits.
