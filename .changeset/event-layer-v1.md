---
"@facet/core": minor
"@facet/runtime": minor
"@facet/server": minor
"@facet/client": minor
"@facet/react": minor
"@facet/quickstart": minor
"@facet/store-postgres": minor
"@facet/agent": minor
---

Event layer v1 — a 3-layer event model (trigger ⊇ collected-event ⊇ forward) plus
an ordered replay log. Local interactions that never reach the agent are now
captured too, so a visitor's whole journey can be replayed — without growing the
agent-facing surface.

**BREAKING (pre-1.0):** the `ClientEvent` wire/agent-facing envelope kind
`"action"` is renamed to `"tap"`. Consumers that switch on `event.kind === "action"`
or construct `{ kind: "action", action }` must update to `"tap"`. The
`AgentAction`/`NavigateAction`/`ToggleAction` union, the `onPress`/`onHold`/`onAction`
names, and `validateTree`'s action normalization are UNCHANGED (only the outer
`ClientEvent` envelope discriminant moved). A stored legacy `{kind:"action"}` row
still replays (the quickstart reader normalizes it to a `tap`).

- `@facet/core`: new `CollectedEvent` (`visit | message | tap`) — the log currency;
  `ClientEvent` becomes the **forward** subset structurally assignable to it (a
  local navigate/toggle `tap` carries a resolved `TapEffect` instead of an `action`).
  New `TapEffect`, an optional per-session monotonic `seq?`, and an additive
  `FacetTransport.record?(event)`.
- `@facet/server`: new **`POST /record`** endpoint (`isRecordBody`) that logs a
  local tap to the `Sink` WITHOUT invoking the agent — routed through the SAME
  per-visitor lane as `/event` so append order == send order. `/event`'s validator
  keeps rejecting any `tap` whose `action.kind !== "agent"` (a spoofed local-effect
  tap can never reach the agent), and rejects smuggled `effect`/`target`; both
  validators validate `seq` and cap effect/target strings.
- `@facet/runtime`: `runtime.record(visitor, event)` persists a `CollectedEvent`
  (`messages: []`, no agent turn, no stage patch); `StoredEvent.event` widens to
  `CollectedEvent`; both `handle` and `record` reserve their Sink-write slot
  synchronously so the in-process transports get the same append==send-order
  guarantee the server lane provides (append id is the replay join key).
- `@facet/client`: `SseTransport.record()` → `POST /record` and
  `LocalTransport.record()`, both riding the shared serialized send channel; a
  per-session monotonic `seq` is stamped once at the single serialization point
  (so a dropped record is a detectable gap). Record sends are best-effort
  (log + drop, no throw, no retry).
- `@facet/react`: new optional `onRecord(tap)` prop on `StageRenderer` fired AFTER
  the optimistic navigate/toggle `setState` (fire-and-forget — a record failure
  never unwinds view-state); `useFacet` exposes `record`. Handler-less output stays
  byte-identical.
- `@facet/store-postgres`: reader casts re-typed `ClientEvent` → `CollectedEvent`
  so durable rows round-trip as the log currency (column shape unchanged).

Verified: `/verify` green, `/code-review` P0-P2 = 0 (4 rounds), live-test Tier
1/2 PASS + a real-server endpoint smoke (every trigger transmits; `/record`
logs; isolation/validation guards reject as designed). The record/forward policy
being centralized into a single declarative descriptor, and a vocabulary-neutral
event core for reuse across renderers, are tracked as follow-ups.

(`@facet/*` are versioned together as a fixed group.)
