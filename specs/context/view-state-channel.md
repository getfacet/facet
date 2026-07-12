# Context: view-state-channel

Evidence gathered by the context pass for the `view-state-channel` feature. This
is the input to the spec writer. Every claim below is anchored to a `file:line`
in the current tree — do not invent new facts on top of it.

## Feature in one line

Ride a bounded, browser-owned **view snapshot** (`screen`, `toggled`,
`viewport`, `scheme`) on already-forwarded `ClientEvent`s (visit/message/tap) so
the agent's brain can see what the visitor is currently looking at — without any
new round-trip, without a second stage writer, and fail-safe at the boundary.

## Affected packages

- `@facet/core`
- `@facet/client`
- `@facet/react`
- `@facet/server`
- `@facet/agent-tools`
- `@facet/reference-agent`
- `@facet/ag-ui` — **added by the context pass** (see RISK-API-1); the brief's
  own Public API table omitted it. In scope for the type change and the
  normalizer boundary, or explicitly declared a known v1 coverage gap.

## Code entrypoints

### @facet/core

- `packages/core/core/src/protocol.ts:79` — `CollectedEvent` union. Add optional
  `view?: ViewSnapshot` to each variant, exactly like the existing
  `fields?: FieldValues` (`fields` declared at `protocol.ts:95`).
- `packages/core/core/src/protocol.ts:105` — `ClientEvent` union (the forward
  subset). Mirror the same additive `view?` on visit/message/tap (`fields`
  precedent at `protocol.ts:116`). Keeping both unions in sync is the
  forward⊆collected invariant (`protocol.test.ts:67`).
- `packages/core/core/src/protocol.ts:39-54` —
  `MAX_FIELD_VALUE_CHARS` / `MAX_FIELDS_KEYS` / `MAX_FIELD_OPTIONS`. This is the
  exact "one shared cap enforced by renderer AND server so the two can't drift"
  precedent the brief's Decision-Lock demands. Add `MAX_VIEW_*` caps + closed
  `Viewport` (`narrow|medium|wide`) / `Scheme` (`light|dark`) enums +
  `ViewSnapshot` type here.
- `packages/core/core/src/protocol.ts:56-57` — `FieldValue` / `FieldValues` type
  shape. Model `ViewSnapshot` (`screen?`,
  `toggled: Record<NodeId, 'shown'|'hidden'>`, `viewport`, `scheme`) as the
  analogous readonly value type. The brief also asks for a boundary sanitizer to
  live in core (shared) — no such pure sanitizer exists in core today;
  `server-validation.ts` owns the current shape-checks (see @facet/server
  below).

### @facet/server

- `packages/core/server/src/server-validation.ts:92` `isEventBody` + `:218`
  `isFieldsRecord` — the untrusted `/event` boundary. **CRITICAL PATTERN
  MISMATCH the spec must resolve:** `isFieldsRecord` REJECTS the whole event on a
  bad field (returns `false` → 400), but DC-003 requires `view` to be
  DROPPED/CLAMPED while the event still processes. So `view` needs a *clamping*
  sanitizer (returns a cleaned view, or omits it), not a boolean reject like
  fields/effect. `isFieldsRecord` (cap-check) and `isTapEffect:150`
  (string-length clamp precedent) are the closest anchors.
- `packages/core/server/src/server-post.ts` — the `/event` route handler that
  calls `isEventBody`; the drop/clamp of `view` must be woven in here (or in
  `isEventBody`) without failing the event. Confirm the exact call site during
  the spec (the `isEventBody` consumer).

### @facet/client

- `packages/core/client/src/visitor.ts:28` `browserVisitorId` — the
  `localStorage` degrade precedent: `typeof localStorage === 'undefined'` guard
  + `try/catch` → in-memory fallback, no crash / console spam (DC-004). The new
  per-agent-link persisted view snapshot (`facet:view:<agentId>`) follows this
  pattern exactly; the value must be schema-validated on read (garbage →
  ignore).
- `packages/core/client/src/sse-transport.ts:54` `send` + `:81` the single
  serialization point where `seq` is stamped — the attach-on-send seam. `view`
  rides already-forwarded events here (no new request). Note the client
  currently has **no reference to the renderer's live view-state**, so the
  snapshot source must be plumbed in (see the react gap in the note below).

### @facet/react

- `packages/core/react/src/StageRenderer.tsx:93` `currentScreen` state + `:99`
  `visibilityOverrides` (`Map<NodeId, boolean>`) — the browser-owned view-state
  (invariant #6) that must be exposed to the send path. Renderer-internal today.
- `packages/core/react/src/StageRenderer.tsx:48` `onAction(action, fields?)` —
  the existing seam for surfacing browser-owned state (`fields`) up to the
  host's `send()`. `view` can ride the same callback for taps, but
  message/visit sends bypass `StageRenderer`, so a shared snapshot source
  (ref/context) is needed.
- `packages/core/react/src/renderer-press.ts:43` `collectFieldValues` — the
  press-time synchronous-snapshot precedent for browser view-state.
  viewport/scheme detection (`matchMedia` / `prefers-color-scheme`) is NEW
  renderer code — no existing usage in `src` (confirmed via grep); the renderer
  owns the breakpoint thresholds (Decision-Lock assumption).

### @facet/agent-tools

- `packages/agent-stack/agent-tools/src/observation.ts:39`
  `formatAgentToolObservation` + `:82` `isVisitorVisibleStageChange` — the
  structured observation contract the agent reads. `view` folds into the
  observation/event rendering here, bounded like other observation fields
  (missing view → omit the line, DC-007).

### @facet/reference-agent

- `packages/agent-stack/reference-agent/src/prompt/messages.ts:36`
  `describeEvent` — the exact per-kind event render site (the tap line builds
  `payload=… fields=…` at `:77-78`). Add the short view line here, e.g.
  `visitor is viewing screen "pricing"; expanded: faq-3; device: narrow, dark`;
  the visit branch (`:41-48`) renders the revisit view. `safeFieldsJson` /
  `safeJson` bounding precedent applies.

### Host wiring (relevant, not a published-surface change)

- `packages/agent-stack/quickstart/src/page/main.tsx:88`
  `send({kind:'visit',visitor})` + `:62` `makeVisitor` — where the visit event
  fires (attach the persisted last-known view for the revisit story, DC-002) and
  where `SseTransport` is constructed (`:76`).
- `apps/playground/src/App.tsx:126` + `live.tsx:61` —
  `onAction = (action, fields) => send({kind:'tap', action, fields})`; the same
  conditional-spread attach pattern is where `view` gets stitched onto forwarded
  taps.

## Risk register

### RISK-INV-1 (INV) — Invariant #6, two-writers coherence: state crossing must not create a second stage writer

The browser-owned view-state and the forwarded-event send path live in DIFFERENT
components, so attaching `view` forces a state crossing that must not become a
second stage writer. `currentScreen` + `visibilityOverrides` are private React
state inside `StageRenderer` (`packages/core/react/src/StageRenderer.tsx:93,99`),
set ONLY by `handlePress` on navigate/toggle
(`StageRenderer.tsx:148-176`). But two of the three forwarded events originate
OUTSIDE `StageRenderer` at the host: the `visit` send at
`packages/agent-stack/quickstart/src/page/main.tsx:88`
(`send({kind:'visit',visitor})`) and the `message` send at `main.tsx:127`
(`onSend`), both wired to `send` from `useFacet` (`useFacet.ts:119` /
`main.tsx:79`). Only the `tap` path (`onAction`, `StageRenderer.tsx:185`) is
inside the renderer.

**Resolution the spec must implement:** expose renderer view-state read-ONLY (a
ref/getter sampled at send time) that the host reads when calling `send` for
message/visit — do NOT lift `currentScreen` / `visibilityOverrides` into a
host/parent that a `ServerMessage` could write. Add a test/assertion that no
`ServerMessage` or patch path ever calls `setCurrentScreen` /
`setVisibilityOverrides` (they stay set solely in `handlePress`), so the server
remains the only stage writer and the renderer never auto-restores server-pushed
view state (DC-005, no v1 auto-restore).

### RISK-INV-2 (INV) — Invariant #6 / DC-005: `view` must be provably unable to reach any stage patch/fold path

Structurally the direction is safe: `view` rides `ClientEvent` (browser→agent,
`packages/core/core/src/protocol.ts:105-118`) while the client fold consumes
`ServerMessage.patches` (agent→browser,
`packages/core/react/src/useFacet.ts:86` `foldPatchIntoStage`) — opposite
directions, cannot cross. The live risk is on the AGENT surface: `describeEvent`
(`packages/agent-stack/reference-agent/src/prompt/messages.ts:36-85`) and the
agent-tools observation render event fields into the LLM prompt. `view` must be
emitted as an inert prompt LINE only (e.g.
`visitor viewing screen "pricing"; expanded: faq-3; device: narrow, dark`) and
must NEVER be routed into the shadow-tree executor
(`packages/agent-stack/agent-tools/src/executor-node.ts` `set_node` /
`remove_node` / `screenPath`) or any Stage op.

**Resolution:** spec adds the view line in `describeEvent`/observation with zero
executor path, plus the DC-005 grep/type test proving `view` never appears in a
patch-producing or `validateTree` / `foldPatchIntoStage` call site.

### RISK-INV-3 (INV) — Invariant #3, fail-safe: the `/event` boundary is ACCEPT/REJECT but `view` needs DROP/CLAMP-and-still-process

The existing `/event` boundary is an ACCEPT/REJECT boolean type-guard, which
conflicts with the brief's required DROP/CLAMP-and-still-process semantics for
`view`. `isEventBody`
(`packages/core/server/src/server-validation.ts:92-136`) returns `false` on ANY
malformed sub-field, and `handleEvent` 400-rejects the WHOLE body on `false`
(`packages/core/server/src/server-post.ts:25-28`). If `view` were validated the
same way (like `isFieldsRecord` / `isTapEffect`, which all REJECT —
`server-validation.ts:150-227`), a malformed/oversized `view` would reject the
entire event — violating DC-003 / Policy step 4 ("never reject the event for
`view` reasons").

**Resolution the spec must implement:** a pure `view` SANITIZER (drop unknown
viewport/scheme enum values, cap the `toggled` map dropping oldest, length-cap
`screen` / node-id strings, returns a cleaned-or-absent value) that runs
SEPARATELY from `isEventBody`'s accept path — either `isEventBody` ignores
`view` and a clamp step strips it before `runtime.handle`
(`server-post.ts:52`), or the sanitizer replaces `event.view` in place.
Caps/enums MUST live in `@facet/core` shared by client+server
(`MAX_FIELD_VALUE_CHARS = 2000`, `MAX_FIELDS_KEYS = 256` precedent,
`packages/core/core/src/protocol.ts:39,47`) so the two sides can't drift.

### RISK-INV-4 (INV) — Invariant #1, UI-out/UI-in only: the snapshot must ride existing events, never fire a new send

The snapshot must ride ONLY already-forwarded events; no send may fire on
navigate/toggle/resize/scheme-change. Today navigate/toggle fire ONLY
best-effort `POST /record` (`packages/core/client/src/sse-transport.ts:64`) and
message/visit ride `POST /event` (`sse-transport.ts:54`); there is no other
client→server call. The new viewport/scheme detection (`matchMedia`) + resize
listeners the brief adds to `@facet/react` MUST update in-memory snapshot state
only and NEVER call `send` / `record` (DC-006). Additionally the per-agent-link
`localStorage` persistence (Decision Lock `facet:view:<agentId>`) must reuse the
`visitor.ts` degrade precedent — `typeof localStorage` undefined /
`getItem`/`setItem` throw all caught, fall back to the live in-memory snapshot,
no crash / console spam (`packages/core/client/src/visitor.ts:29-45`; DC-004).

Note a keying seam: `visitor.ts` keys globally on `facet:visitor`
(`visitor.ts:1`) — the view key must be per-agent to avoid cross-agent
view-state leakage on a shared origin, and the persisted payload must be
schema-validated on READ (garbage ignored) before it becomes the `visit`
snapshot.

### RISK-INV-5 (INV) — Invariant #5, flow-only safety: viewport class is report-only, must not drive client-side layout

The brief marks this OK, but the viewport class introduces a scope-creep seam
the spec must fence. `narrow|medium|wide` (renderer-owned breakpoints) is a
REPORT-ONLY signal for the agent's brain; if the renderer consumes its OWN
viewport class to branch layout, it introduces client-side responsive behavior
outside the declarative token/flow model and outside the single stage-writer
discipline. Layout today resolves from tokens only
(`packages/core/react/src/brick-renderer-layout.tsx`, `boxStyle`) with no
viewport-conditional branch.

**Resolution:** the spec must constrain viewport/scheme to a value that flows
ONLY into the event send path (the snapshot) and NEVER into `boxStyle` /
`brick-renderer-layout` resolution; layout adaptation to device stays the
agent's job via patches (its normal stage-write channel), preserving flow-only +
server-as-sole-stage-writer.

### RISK-API-1 (API) — MISSING AFFECTED PACKAGE + silent-drop through @facet/ag-ui

`@facet/ag-ui` is a published surface that re-normalizes the shared
`@facet/core` `ClientEvent` / `CollectedEvent` types via allowlist
reconstruction, but the brief's Public API table
(`view-state-channel.md:157-166`) OMITS it entirely (lists only
core/client/react/server/agent-tools/reference-agent + runtime=none).
`packages/extensions/ag-ui/src/server-input.ts:195-228` (`normalizeClientEvent`)
rebuilds each event from a FIXED key allowlist
(`kind/visitor/seq/text/action/fields`) and never copies an incoming `view`
field; `normalizeCollectedEvent` (same file `:230-252`) does the same for local
taps.

Proven consumer chain: browser attaches `view` → `AgUiTransport.send`
(`transport.ts:177`) + `withSeq` spread (`transport.ts:140-145`) carry it on the
wire → the AG-UI Node server adapter's `normalizeClientEvent` STRIPS it before
the agent sees it. Net: agents behind the AG-UI adapter stay blind to `view`
while SSE-path agents get it → inconsistent/partial feature. The parallel
event-text renderers `packages/extensions/ag-ui/src/events.ts` and
`events-text.ts` also omit any `view` line. The type change itself is ADDITIVE
(no compile break; `Extract<CollectedEvent, {kind:'tap'}>` at `transport.ts:32`
still narrows).

**Resolution the spec must implement:** either (a) add a bounded `view`
normalizer to `server-input.ts` mirroring the `@facet/server` boundary (shared
caps from `@facet/core`), and render the line in ag-ui events text, OR (b)
explicitly declare `@facet/ag-ui` out-of-scope for v1 and record the known
coverage gap. Add `@facet/ag-ui` to the affected-package list either way.

### RISK-API-2 (API) — BOUNDARY PATTERN MISMATCH (fail-safe) on the changed @facet/server surface

`isEventBody` (`packages/core/server/src/server-validation.ts:92-136`) is a PURE
boolean type-guard returning `body is {visitor; event: ClientEvent}`; on ANY
malformed sub-field it returns `false` and the caller answers 400 (reject the
WHOLE event). It currently does not inspect `view` at all, so today an
oversized/malformed `view` rides straight through the guard (passthrough
predicate, no reconstruction) into the runtime, the Sink, and the LLM prompt,
bounded only by the 5 MiB `MAX_BODY_BYTES` cap (`server-validation.ts:20`) —
violating the fail-safe bound the brief requires. Critically, DC-003 ("drop/clamp
`view` but STILL process the event") CANNOT be met by adding a `view` branch into
this predicate: a bad `view` would then make the predicate return `false` and
reject the whole event.

**Resolution the spec must implement:** introduce a SEPARATE pure `view`
sanitizer that strips/clamps `view` and returns a NEW event object (a type guard
cannot mutate + keep purity), invoked around/after `isEventBody`, with caps +
closed enums (viewport `narrow|medium|wide`, scheme `light|dark`) sourced from
shared `@facet/core` constants next to `MAX_FIELD_VALUE_CHARS` /
`MAX_FIELDS_KEYS` (`protocol.ts:39-54`) so client (react capture) and server
can't drift. Note the brief's own Decision-Lock rows
(`view-state-channel.md:174`) flag "caps in @facet/core shared by client+server"
as still `needs follow-up`.

### RISK-API-3 (API) — MISSING ATTACH SEAM (additive but load-bearing coupling) across @facet/react + @facet/core send path

The renderer's live view-state — current screen and toggle overrides — is held
inside `StageRenderer` internal state: presses are classified in
`packages/core/react/src/renderer-press.ts:26-27` (`navigate`/`toggle` kinds) and
screen roots resolved in `packages/core/react/src/renderer-motion.ts:283-342`;
none of it is reachable from the public send API. `useFacet`'s
`send(event: ClientEvent)` (`packages/core/react/src/useFacet.ts:21,119`)
receives an ALREADY-FINISHED event from the caller and just forwards it to
`transport.send`; `SseTransport.commit`
(`packages/core/client/src/sse-transport.ts:85-87`) only spreads
`{...event, seq}` and has no view source. So there is currently NO wire by which
the browser's screen/toggle/viewport/scheme snapshot enters an outgoing event —
the type field would exist with nothing populating it.

**Resolution the spec must implement:** define a new (optional, back-compat) seam
that lifts the renderer's `{screen, toggled, viewport, scheme}` snapshot into the
send path (e.g. a snapshot provider threaded through `useFacet`), keeping
`send(event)` callable without it so existing direct `send` / `FacetTransport`
consumers stay valid — proven consumers that must NOT break: `bridge.ts:260`,
`define-agent.ts`, `offline.ts:40`, and `apps/playground`. The type change to
`ClientEvent` / `CollectedEvent` is additive (verified: no consumer does
reject-unknown-keys validation, so nothing fails to compile), but without this
seam the feature is inert on the reference path.

### RISK-PKG-1 (PKG) — LATENT NEW CROSS-PACKAGE IMPORT (cycle-adjacent layering inversion)

The brief's Public API table assigns "attach-on-send" of the view snapshot to
`@facet/client`
(`specs/feature-intake/view-state-channel.md:160`), but the LIVE part of that
snapshot (current screen, toggle overrides) is React state OWNED by
`@facet/react`'s `StageRenderer` (`packages/core/react/src/StageRenderer.tsx:93`
`const [currentScreen,setCurrentScreen]` and `:99`
`const [visibilityOverrides]`), and the new viewport/scheme detection also lives
in react (brief line 161). Proof of the trap: `@facet/client` imports ONLY
`@facet/core` (`packages/core/client/src/sse-transport.ts:7`,
`local-transport.ts:7`, `index.ts:6`) and is deliberately framework-neutral —
`grep -rn '@facet/client' packages/core/react/src` and
`grep react packages/core/client/src` both return NONE. For a `@facet/client`
transport to "attach-on-send" a snapshot containing react-owned live
screen/toggles it must READ react state at send time, forcing either a
`@facet/client` → `@facet/react` import (pulls React + the renderer into the
framework-neutral transport; cycle-adjacent since the host already wires
client→react) or an undocumented mutable snapshot-provider handle threaded into
`SseTransport` / `LocalTransport`.

**Resolution the spec MUST implement:** follow the existing `fields` / `collect`
precedent exactly — react surfaces its live view-snapshot UP through the
press/send callback the way `collectFieldValues` surfaces `fields` via
`onAction` (`packages/core/react/src/StageRenderer.tsx:185-190`), the HOST page
composes `view` onto the `ClientEvent` (the current attach-point that builds
`{kind:'tap',action,fields}` / `{kind:'message',text}` at
`packages/agent-stack/quickstart/src/page/main.tsx:121-129`), and
`@facet/client` contributes ONLY a framework-neutral persistence helper (a
`browserVisitorId`-style pure function, precedent
`packages/core/client/src/visitor.ts:28`) for the revisit `visit` snapshot. The
spec must state as a hard constraint: **`@facet/client` MUST NOT import
`@facet/react`**; correct the package-table wording from "attach-on-send in
@facet/client" to "persistence helper in @facet/client; attach at the host; live
part sourced from @facet/react".

### RISK-PKG-2 (PKG) — CAPS-DRIFT / SPLIT-BRAIN VALIDATION across packages

The brief places view caps + the boundary sanitizer in `@facet/core`
(`specs/feature-intake/view-state-channel.md:159`, Decision Lock line 174 "Caps
live in @facet/core shared by client+server, MAX_FIELD* precedent"). But the
existing untrusted `/event` field validator does NOT live in core — it lives in
`@facet/server`: `isFieldsRecord` / `isValidEventBody` at
`packages/core/server/src/server-validation.ts:218` (and `:120`, `:197`) enforce
`MAX_FIELD_VALUE_CHARS` / `MAX_FIELDS_KEYS` imported from core. A naive
implementation adds a SECOND, independent view-bounds check inside
`server-validation.ts`, which will drift from the core caps over time — exactly
the drift the "shared caps in core" decision exists to prevent (the caps are
defined once in `packages/core/core/src/protocol.ts:37-54` precisely so renderer
and server can't diverge).

**Resolution the spec MUST implement:** define ONE pure, node-free
`sanitizeView(unknown): ViewSnapshot | undefined` in `@facet/core` alongside the
caps/enums (precedent: `sanitizeActionPayload` at
`packages/core/core/src/primitive-node-validation.ts:52`, a core-hosted pure
sanitizer consumed cross-package by react at `renderer-press.ts:223`), export it
through the `export * from './protocol.js'` barrel
(`packages/core/core/src/index.ts:7` — if it goes in a new core file instead of
`protocol.ts`, that file must be added to `index.ts` or the surface won't be
public), and have the `@facet/server` `/event` boundary CALL that core sanitizer
rather than re-implement bounds in `server-validation.ts` — mirroring how react
calls `sanitizeActionPayload`. The sanitizer must stay dependency-free: no
`localStorage` / `window` / Node APIs, so `@facet/core` stays node-free.
