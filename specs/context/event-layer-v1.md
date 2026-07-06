# Context: event-layer-v1

Assembled context-pass evidence for the **event-layer-v1** feature. This doc is
the input to `/spec-bridge` — it captures code entrypoints and the invariant/API
risk register gathered from the codebase. Do not invent facts beyond what is
recorded here.

## Affected packages

- `@facet/core`
- `@facet/runtime`
- `@facet/server`
- `@facet/client`
- `@facet/react`
- `@facet/quickstart`
- `@facet/agent`

## Code entrypoints (file:line)

### @facet/core
- `packages/core/src/protocol.ts:49` — `ClientEvent` union; the `kind:"action"`
  variant at `:53` is renamed `action`→`tap`. Add `CollectedEvent`
  (`visit|message|tap`) and derive `ClientEvent` from it.
- `packages/core/src/protocol.ts:38,:46` — field caps `MAX_FIELD_VALUE_CHARS` /
  `MAX_FIELDS_KEYS`.
- `packages/core/src/nodes.ts:38` — `AgentAction`; `FacetAction` union at `:79`
  (the agent-routed action semantics the `tap` rename touches).

### @facet/runtime
- `packages/runtime/src/sink.ts:5` — `StoredEvent.event` widens to
  `CollectedEvent`; `Sink.record` / `history` interface at `:25` (add a
  record-only `messages:[]` path).
- `packages/runtime/src/runtime.ts:222` — `persist()` fire-and-forget record via
  `serializeRecord` (`:228`), per-visitor serialized; `handle()` at `:105` (the
  record-only path mirrors this WITHOUT invoking the agent).

### @facet/server
- `packages/server/src/server.ts:134` — `isEventBody` untrusted-body shape-check;
  the `kind==="action"` branch at `:150` is the template for a `/record` body
  validator. `isFieldsRecord` at `:185`.
- `packages/server/src/server.ts:611` — `POST /event` route; handler at `:356`
  (202-ack then `runtime.handle`). The new `POST /record` beside it MUST NOT call
  `runtime.handle` (DC-005).
- `packages/server/src/server.ts:496` — per-visitor delivery lane (serial-lane
  record-only ordering / append id rides).

### @facet/client
- `packages/client/src/sse-transport.ts:26` — `sendChain` shared serialized POST
  channel; `send()` at `:33` POSTs `/event` (add a record-only send + a
  per-session monotonic `seq` stamp).

### @facet/react
- `packages/react/src/StageRenderer.tsx:668` — `handlePress` navigate/toggle
  local effect (fire the record-only send AFTER the optimistic effect);
  `ClassifiedPress` at `:113`, `classifyPress` at `:224` (effect already
  resolved).
- `packages/react/src/useFacet.ts:71` — the send channel the renderer uses.

### @facet/quickstart
- `packages/quickstart/src/prompt.ts:211` (`case "action"`) and
  `packages/quickstart/src/stub.ts:82,:124` (`describeAction`, `case "action"`) —
  switch `action`→`tap`.

## Risk register

### Invariant risks

#### RISK-INV-1 (INV) — INVARIANT #6 (two-writers coherence): PRIMARY SEAM
The renderer today PINS the guarantee that local view commands never reach any
transport: `packages/react/src/StageRenderer.tsx:633-636` docstring says
navigate/toggle presses "mutate only this state and NEVER reach onAction (the
only channel to any transport)", and `handlePress`
(`StageRenderer.tsx:668-694`) proves it — the `navigate` case only
`setCurrentScreen`, the `toggle` case only `setVisibilityOverrides`, and only the
`agent` case calls `onAction?.()`. This feature DELIBERATELY breaks that
guarantee (navigate/toggle must now also fire a record-only send).

RESOLUTION the spec MUST implement:
- (a) keep the local view-state mutation as the authoritative, SYNCHRONOUS,
  optimistic effect that runs FIRST and unconditionally;
- (b) add a SEPARATE renderer callback (e.g. `onLocalTap`/`onRecord`, distinct
  from `onAction`) fired AFTER the view-state `setState` inside the
  navigate/toggle branches, carrying the already-resolved `ClassifiedPress`
  effect (`StageRenderer.tsx:224` `classifyPress` already yields
  `{kind:'navigate',to}` / `{kind:'toggle',target}`) — the effect must be
  captured here, NEVER re-derived server-side (the server holds no view-state);
- (c) the record path must be fire-and-forget so a record failure can NEVER
  unwind `currentScreen` / `visibilityOverrides` (DC-003).
- Update the docstring at `633-636`, which currently asserts the very invariant
  being changed.

#### RISK-INV-2 (INV) — INVARIANT #6 (ordering / append-id join key): DEEPEST SEAM
The brief's mitigation ("shared serial lane; order = Sink append id") collides
with TWO independent per-visitor serial queues that the record must thread
correctly.
1. Server lane: `const lane = createSerialQueue<void>()` at
   `packages/server/src/server.ts:499`; `handleEvent` acks 202 at
   `server.ts:369-370` BEFORE enqueuing the turn via
   `void lane(visitor.visitorId, …)` at `server.ts:379`.
2. Runtime records: `serializeRecord` at `packages/runtime/src/runtime.ts:67` is
   a SEPARATE fire-and-forget queue from the turn queue `serialize`
   (`runtime.ts:62`); `persist` enqueues the Sink write on it at
   `runtime.ts:227-229` AFTER `save`.

FAILURE SCENARIO: client sends `/event` then (per `sendChain`) `/record`; the
`/event` agent turn is slow, so if `/record` does NOT ride the SAME server `lane`
(e.g. handled out-of-lane like the rehydrate path at `server.ts:259-261`) its
Sink write enqueues on `serializeRecord` BEFORE the still-thinking `/event` turn
reaches `persist` → append id order REVERSES vs send order → DC-002 fails and
replay scrambles.

RESOLUTION the spec MUST implement: route `/record` through the SAME
per-(agent,visitor) server `lane` AND the SAME runtime `serializeRecord` queue as
`/event`'s record, via a new `runtime.record()` that persists to the Sink WITHOUT
calling `this.agent` / `handleOne` (DC-005) and WITHOUT any stage patch. Ordering
key = Sink append order, NOT `StoredEvent.at` (`sink.ts:7`).

#### RISK-INV-3 (INV) — INVARIANT #6 (detectable-not-silent loss): MISSING JOIN KEY + MISSING CLIENT SEQ
`StoredEvent` (`packages/runtime/src/sink.ts:5-11`) carries only
`{at, event, messages}` — there is NO explicit append id and NO client `seq`
field; `MemorySink.record` just `push`es to an array (`sink.ts:47-49`) and
history returns it (`sink.ts:52-54`), so append order is only an IMPLICIT array
index. A grep confirms NO `seq` exists anywhere on the client/wire
(`packages/client/src/*.ts`, `packages/core/src/protocol.ts`) — the only
server-side `seq` is the ephemeral frame-log resume cursor, which the brief
explicitly leaves untouched. DC-004 (gap detectable) and DC-002 (order by append
id) therefore have no field to key on.

RESOLUTION the spec MUST implement:
- (a) widen `StoredEvent.event` to the new `CollectedEvent`
  (`visit|message|tap`) and add a per-session monotonic client `seq`;
- (b) stamp `seq` at the SINGLE serialization point — `SseTransport.sendChain`
  (`packages/client/src/sse-transport.ts:26,43`) — NOT in the userland consumer
  that builds the event body (`apps/playground/src/App.tsx:129`,
  `live.tsx:64`), so monotonicity holds across every caller and spans BOTH
  `/event` and `/record` (brief's recommended-yes open question);
- (c) make the append-order → `history()` contract explicit so a dropped
  `/record` leaves a detectable `seq` gap.

#### RISK-INV-4 (INV) — INVARIANT #1 + #6 (record-only isolation must not let local taps reach the agent)
`isEventBody` at `packages/server/src/server.ts:150-156` is a load-bearing guard:
it EXPLICITLY rejects any action whose `kind` is not `undefined`/`agent` — the
comment (`server.ts:152-154`) states "Only agent actions travel over the
transport — navigate/toggle are client-local … Reject any other kind so a spoofed
`{kind:"navigate"}` can't reach an agent typed as FacetAction." The
`action`→`tap` rename plus the new `/record` path put navigate/toggle taps on the
wire for the FIRST time.

FAILURE SCENARIO: if the rename relaxes this guard on `/event`, a `tap` carrying a
`navigate`/`toggle` effect reaches `runtime.handle` / the agent (violates DC-005
and invariant #1's no-local-command-to-brain boundary).

RESOLUTION the spec MUST implement: `/event`'s validator KEEPS rejecting
local-effect taps (only agent-routed `tap` forwards); a DISTINCT `isRecordBody`
for `POST /record` accepts the collected `tap` + resolved `effect` but its handler
NEVER calls `runtime.handle` / `deliver` patches; and `/record` reuses the
existing field caps `MAX_FIELDS_KEYS` / `MAX_FIELD_VALUE_CHARS` + `isFieldsRecord`
(`server.ts:164-166,185-195`) and rejects malformed bodies 4xx with no Sink write
(DC-007).

#### RISK-INV-5 (INV) — INVARIANT #7 + #3 (record send stays a Facet UI-IN endpoint, best-effort, no view-state feedback)
`SseTransport.send` hardcodes the `/event` URL and swallows all failures into
`console.error` without wedging the chain
(`packages/client/src/sse-transport.ts:45,52-56`); the `FacetTransport` interface
exposes only `send(event)` (`packages/core/src/protocol.ts:97-100`). Adding a
record-only path must not become a general client fetch escape hatch (invariant
#7) nor a channel whose failure perturbs the two-writers view-state (invariant
#3/#6).

RESOLUTION the spec MUST implement: the record-only send targets ONLY Facet's own
reference `POST /record` endpoint (never an arbitrary/domain URL), rides the SAME
`sendChain` for ordering, and mirrors the existing best-effort `catch`
(`sse-transport.ts:52-56`) — a rejected record logs and drops with NO throw, NO
retry (v1), and NO callback back into the renderer's `currentScreen` /
`visibilityOverrides`. Extend the transport surface with an explicit record
method (not a raw fetch), keeping the wire kinds the only capability added.

### API-surface risks

#### RISK-API-1 (API) — BREAKING published-surface rename: `ClientEvent` discriminant `kind:"action"` → `"tap"`
Defined at `packages/core/src/protocol.ts:53`, exported via
`packages/core/src/index.ts` → `protocol.js`. This is a discriminated union, so
every consumer that pattern-matches the literal string breaks at compile OR
silently mis-routes.

PROVEN consumers of the `"action"` literal:
- `packages/server/src/server.ts:150` `if (kind === "action")` — the untrusted
  `/event` body validator; if not updated to `"tap"`, ALL agent taps get rejected
  as malformed (comment at `server.ts:132` also names `{kind:"action"}`).
- `packages/quickstart/src/stub.ts:82` `Extract<ClientEvent, { kind: "action" }>`
  and `stub.ts:124` `case "action"`.
- `packages/quickstart/src/prompt.ts:211` `case "action"` (history/prompt line
  builder).
- `apps/playground/src/nova.ts:91` `case "action"` and
  `apps/playground/src/live-agent.ts:27` `event.kind === "action"`.

PROVEN client-side CONSTRUCTION sites that emit the wire literal (must also change
or the server rejects them): `packages/quickstart/src/page/main.tsx:117`,
`apps/playground/src/App.tsx:129`, `apps/playground/src/live.tsx:64` — all
`send({ kind: "action", action, ... })`.

RESOLUTION the spec must implement: rename the literal once in `protocol.ts:53`;
update every switch / `case` / `Extract` / `=== "action"` and all three
construction sites to `"tap"`; explicitly update the server validator at
`server.ts:150` (its 4xx reject path is a hard gate). Add a `pnpm typecheck`
red-check per DC-008. Migration is mechanical but must be exhaustive — a missed
construction site is a runtime 4xx, not a type error.

#### RISK-API-2 (API) — BREAKING durable-data gap from the same rename
Persisted history rows keep the OLD `"action"` literal, and the readers are
typed/switched on the new one. `StoredEvent.event: ClientEvent` at
`packages/runtime/src/sink.ts:8` is serialized verbatim to durable stores:
FileSink writes `JSON.stringify(entry)` JSONL at
`packages/runtime/src/file-sink.ts:39`, and Postgres inserts
`JSON.stringify(entry.event)` at
`packages/store-postgres/src/postgres-store.ts:74` and reads it back typed as
`ClientEvent` at `postgres-store.ts:81/90`. After the rename, existing
on-disk/DB rows still contain `{kind:"action"}`; the replay reader `describeEvent`
(`packages/quickstart/src/prompt.ts:202` switch) will fall through to its
`default` branch (`prompt.ts:219-222`) and emit `"(unknown event)"` for EVERY
historical tap fed into `buildInitialMessages` (`prompt.ts:242`). This
contradicts Decision Lock "Log home = server Sink … extend not rebuild" and the
Assumption that existing backend durability suffices for replay.

RESOLUTION the spec must implement: a read-boundary normalizer that maps legacy
`"action"` → `"tap"` when history is loaded (single place, e.g. at `Sink.history`
read or in `describeEvent`), OR have `describeEvent`/stub accept BOTH literals.
Also widen `StoredEvent.event` to `CollectedEvent` (`sink.ts:8`) and confirm
Postgres/File readers' `event: ClientEvent` casts (`postgres-store.ts:81`) are
re-typed to `CollectedEvent`. Add a vitest that a stored `{kind:"action"}` row
still replays as a tap (guards the migration).

#### RISK-API-3 (API) — ADDITIVE @facet/react public-surface addition required
The record-only send needs a NEW callback prop on `StageRendererProps`. Today
`onAction` is the ONLY transport channel and navigate/toggle are documented to
NEVER reach it — `packages/react/src/StageRenderer.tsx:635-636`
("navigate/toggle presses mutate only this state and NEVER reach onAction (the
only channel to any transport)") and the local handlers `handlePress` case
`"navigate"`/`"toggle"` return without emitting at `StageRenderer.tsx:670-694`,
while only the `"agent"` case calls `onAction` (`StageRenderer.tsx:697,702`). To
fire the background `/record` send the renderer must gain a new optional prop
(e.g. `onRecord(tap)`), threaded into `handlePress` at those navigate/toggle
branches and declared in `StageRendererProps` (`StageRenderer.tsx:606-623`). It
is public: the react barrel re-exports `StageRenderer.js`
(`packages/react/src/index.ts:1`) and `useFacet` wires the transport `send`
(`packages/react/src/useFacet.ts:19,71`).

RESOLUTION the spec must implement: name the new prop + its optional signature
carrying the resolved effect; export it through the react barrel; and PRESERVE
the invariant at `StageRenderer.tsx:758-763` that with the prop omitted,
handler-less output stays byte-identical (the static suite pins this). Note the
`FacetAction` naming stays `onAction`; do not rename it.

#### RISK-API-4 (API) — ADDITIVE-but-load-bearing @facet/core type: new exported `CollectedEvent`
`CollectedEvent` (`visit|message|tap`) is the type from which `ClientEvent` (the
forward subset) is DERIVED (brief DC-006 / Decision "don't widen ClientEvent").
`ClientEvent` is currently a standalone union at `packages/core/src/protocol.ts:49`
and underpins the agent-facing + transport contracts:
`FacetAgent(event: ClientEvent, …)` (`protocol.ts:87`),
`FacetTransport.send(event: ClientEvent)` (`protocol.ts:98`),
`AgentEventFrame.event: ClientEvent` (`protocol.ts:111`), and the agent SDK
`FacetContext.event: ClientEvent` at `packages/agent/src/define-agent.ts:5`
(agent barrel export `packages/agent/src/index.ts:2`). It is imported by 8
packages (runtime, server, client, react, agent, quickstart, bridge,
store-postgres — see e.g. `bridge.ts:7`, `runtime.ts:5`,
`client/src/sse-transport.ts:1`).

RESOLUTION the spec must implement: add `CollectedEvent` to `protocol.ts` and
export it via the core barrel; redefine `ClientEvent` as the derived forward
subset such that it stays ASSIGNABLE everywhere it is used today (so the 8
importers compile unchanged); and LOCK which type the agent sees — the agent must
keep receiving `ClientEvent` (forward), never `CollectedEvent`, so
`define-agent.ts:5` and `FacetAgent` stay `ClientEvent`. Verify with a type-level
test at the record boundary (DC-006).

#### RISK-API-5 (API) — ADDITIVE protocol surface: new `POST /record` endpoint + client per-session monotonic `seq`
The server currently shape-checks `/event` via `isEventBody`
(`packages/server/src/server.ts:134-176`); `/record` needs a parallel
`isRecordBody` validator (brief DC-007: malformed body → 4xx, no Sink write) and
must route to `Sink.record` WITHOUT calling `runtime.handle` (DC-005/DC-001). The
open question (brief) of whether `seq` also rides `/event` affects the exported
event type: if `seq` becomes a wire field on `CollectedEvent`/`ClientEvent`, note
`isEventBody` destructures only `{kind,text,action}` (`server.ts:140`) and would
ignore an extra `seq` (safe, forward-compatible), but every history reader and
store round-trip (`postgres-store.ts:74` `JSON.stringify`) will persist it — so
the field must be part of the exported type, not an untyped extra. The client
side (`packages/client/src/sse-transport.ts:22-38`) already serializes
ClientEvents on one queue with visit-coalescing (`sse-transport.ts:38`); the
record-only send + `seq` stamp must reuse that SAME serialized channel (brief
invariant #6 mitigation) so order == Sink append id.

RESOLUTION the spec must implement: define `/record` route + `isRecordBody`
mirroring `isEventBody`'s per-kind checks; decide `seq` placement (recommend a
typed field on `CollectedEvent`, added to `protocol.ts` and honored by both
validators + store round-trip); and require record-only sends to travel the
existing serialized client channel, never a second lane.

#### RISK-API-6 (API) — SPEC-AMBIGUITY that risks an over-broad breaking change
The brief's Public-API table says rename "`ClientEvent`/`FacetAction` kind
`action`→`tap`", but `FacetAction` (`packages/core/src/nodes.ts:79` =
`AgentAction|NavigateAction|ToggleAction`) has NO `"action"` discriminant —
`AgentAction.kind` is `"agent"` (`nodes.ts:38-39`), and
NavigateAction/ToggleAction are `"navigate"`/`"toggle"` (`nodes.ts:57,68`). The
ONLY `"action"` literal is the `ClientEvent` ENVELOPE kind (`protocol.ts:53`). If
an implementer takes the brief literally and touches `FacetAction`/`AgentAction`,
it breaks the whole `onPress` palette: every `onPress`/`onHold: FacetAction`
literal (`nodes.ts:134,139`), the server guard `actionKind !== "agent"`
(`server.ts:156`), the exported `sanitizeActionPayload`, the `onAction` prop
(`StageRenderer.tsx:615`), and `validateTree`'s action normalization
(`packages/core/src/validate.ts:127-139`) all key on `"agent"`.

RESOLUTION the spec must state explicitly: rename ONLY the `ClientEvent` envelope
`kind:"action"` → `"tap"`; `AgentAction.kind:"agent"`, the `onAction` prop name,
`sanitizeActionPayload`, and the server's `"agent"` guard remain UNCHANGED. This
scoping note prevents a cascade of accidental breakage in `nodes.ts`/`validate.ts`.
