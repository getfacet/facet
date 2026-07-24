# @facet/server

## 0.1.0

### Minor Changes

- 0a0ad44: Interaction phase 2 — `appear` animation tokens, `onHold` long-press, and bounded
  `scroll` regions. Three additive, token-shaped words that grow the agent's
  interaction vocabulary with **zero new protocol messages** and the two-writers
  split untouched. (Overlay and drag were deferred from this bundle.)

  The invariants hold: every new capability is a **token or a declared action**,
  never a raw value — animation timing/curves and the scroll region's max height
  live only in the renderer (framework constants, not theme documents, so
  `validateTheme` stays closed to animation CSS); the fail-safe boundary strips
  unknown `appear`/`scroll` tokens and malformed `onHold` on both the stored
  (`validateTree`/`foldPatchIntoStage`/`validatePattern`) and raw render paths.

  - `@facet/core`: `APPEARS` token group (`none`/`fade`/`slide`) + `Appear` type;
    `BoxStyle.appear?` and `BoxStyle.scroll?`; `BoxNode.onHold?: FacetAction`
    (the same action union as `onPress`, so a hold-emitted event is byte-identical
    in shape to a press — no gesture discriminator); `asAction` parameterized by
    field so `onHold` diagnostics name `onHold`; the `STAGE_SPEC` lines teaching
    all three (with the "hold is a secondary gesture — never gate critical content
    hold-only" advice). Trees without the new fields validate byte-identically.
  - `@facet/react`: `onHold` long-press detection (`HOLD_MS`/`HOLD_SLOP_PX`,
    gesture-scoped to the arming pointer) routed through the ONE existing
    `classifyPress`/`handlePress` seam; the browser-synthesized post-hold click is
    swallowed by a window-capture one-shot interceptor so press and hold never both
    fire. Every box renders through ONE always-mounted internal element with
    nullable press/hold, so a live patch adding/removing `onHold` never remounts
    the subtree (uncontrolled field text and scroll offsets survive). `scroll:true`
    maps to a bounded `overflow-y:auto` region (theme-owned max-height,
    `min-height:0` so it clips inside a flex column). Framework-owned `APPEAR_CSS`
    (`fade`/`slide` keyframes + a `prefers-reduced-motion` gate) rides once per
    stage, gated on the budget-bounded render walk. Token-free trees stay
    byte-identical.

  Real-browser verified (DC-009): animate-in, bounded inner scroll, and the
  press-vs-hold split. One exotic multi-pointer edge (two simultaneous holds on two
  boxes sharing one click interceptor) is a recorded maintainer-waived residual,
  deferred to the drag bundle's pointer rework.

  (`@facet/*` are versioned together as a fixed group.)

- 0d27d03: Hard-cut Facet's style and design-system contract to one agent-friendly model.

  - Every native Brick owns a closed `style` vocabulary: shared-looking target or
    property names on different Bricks are still separate Brick-owned contracts.
    Styles may be omitted, select a same-Brick Preset, use direct semantic token
    names, or combine a Preset with direct overrides. Raw CSS remains Theme-only.
  - One complete per-agent Theme contains concrete token values, Brick defaults,
    and Presets. It cannot be selected from a Facet document. The host-owned
    `colorMode` switches the whole document between Theme light and dark paint.
  - Patterns replace reusable reference trees. They are exact, read-only examples
    with discovery metadata; agents inspect them and then author ordinary Bricks.
  - Agent discovery is progressive and bounded through `get_pattern`,
    `get_preset`, single-Brick `get_brick_spec`, and exact-path
    `get_style_choices`. Authoring errors are structured and atomic so an agent can
    retry, while the renderer still skips only invalid fragments.
  - Assets are exactly `theme.json`, `patterns.json`, and optional
    `initial.tree.json` (or equivalent store fields). The former asset-policy,
    reference-tree, style-selector, subtree-palette, and document-Theme surfaces
    have no compatibility aliases or runtime conversion.

  All in-repo consumers, storage adapters, prompts, tests, and documentation move
  atomically to the new contract.

- 7f247b0: Brick/token vocabulary v1: `image` becomes `media` (`kind:"image"|"video"`) with
  legacy image-tree normalization, native field controls gain
  `checkbox`/`radio`/`select`/`switch` plus capped `options`, and box layout gains
  `scroll:"x"|"y"` plus `columns(2|3|4)`.

  The new vocabulary is validated through the stored tree/fold/Pattern path and the
  raw React render path. Unsafe media URLs are skipped, unknown media kinds and
  missing sources degrade fail-safe, checked boolean controls collect `true` while
  unchecked boolean controls and unselected radio groups omit their collected field
  key, and horizontal scroll is bounded so the page does not widen.

- a285569: Event layer v1 — a 3-layer event model (trigger ⊇ collected-event ⊇ forward) plus
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

- f7239af: Add opt-in observability and replay initialization seams without changing
  existing defaults.

  - `@facet/reference-agent` adds per-provider model selection, caller-driven
    provider-attempt and retry-backoff cancellation, and bounded synchronous
    lifecycle/tool diagnostics. Custom two-argument providers remain compatible,
    and omitted model, signal, and observer options preserve prior behavior.
  - `@facet/server` adds a best-effort observer for normalized UI input and
    accepted live/late frames. Observations are detached and frozen; observers
    cannot affect authoritative folding, persistence, delivery, or stale-frame
    policy.
  - `@facet/react` adds one-shot, Core-sanitized `StageRenderer.initialView`
    hydration for replay screen, toggle, and table-sort state. Later prop changes
    do not control renderer-local interaction state; remount to hydrate another
    checkpoint.

- 75f7206: Themes and Patterns as data — reskin and pre-seed a Facet page without touching
  code. Per-agent assets contain one complete Theme, one exact Pattern list, and
  an optional initial tree. The LLM sees semantic token/Preset names but never raw
  Theme CSS values. Pattern bodies stay out of the system prompt: the prompt holds
  only a validated name/description/useWhen index and the provider may fetch one
  complete Pattern with the read-only `get_pattern` tool. No new protocol message
  is introduced; Theme paint and the initial stage ship inline in the quickstart
  shell while Pattern reads remain provider-side.

  PRE-1.0 BREAKING (in-repo consumers all updated): `FacetRuntime.handle` and
  `applyMessages` now return `TurnResult` (`{ messages, agentMutated }`) instead
  of a bare message array, so transports can tell a real agent edit from the
  prepended seed frame (`@facet/server` gates its late-result staleness bookkeeping
  on `agentMutated`; `@facet/client`'s `LocalTransport` updated).

  Convergence by construction: the new `@facet/core` `foldPatchIntoStage`
  (batch-atomic apply → bounded per-op salvage honoring RFC 6902 `test` guards →
  `validateTree`) runs identically in `FacetRuntime` and `useFacet`, so the stored
  and live trees cannot drift; a turn's patch messages coalesce into one folded
  frame, and patch batches are capped at `MAX_PATCH_OPS` at the wire, the fold,
  and the salvage clone.

  - `@facet/core`: `FacetTheme` + `validateTheme` — the one safety gate where raw
    CSS enters, as OPERATOR data only (per-group token-name allowlist,
    `url()`/`var()`/`expression()`/`javascript:` denied, dimensions clamped, hostile
    keys never resolve, WCAG contrast measured as a warning never a rejection);
    `FacetPattern` + `validatePattern`; the `STAGE_SPEC` closed authoring rules.
  - `@facet/agent`: native stage authoring remains RFC 6902-only; Theme is host
    asset data and cannot be selected from the document.
  - `@facet/react`: `DEFAULT_THEME`, `ResolvedTheme`, `resolveTheme`; the style fns
    gain a defaulted trailing theme parameter (zero-arg output byte-identical);
    `StageRenderer` gains one optional `theme` prop. ChatDock keeps the default
    palette.
  - `@facet/runtime`: the `AssetsStore` registry adapter (`MemoryAssets`, plus
    `FileAssets` behind `@facet/runtime/node`), `loadAssets` (runs the core
    validators once at boot, skips invalid documents with logged issues), and
    `withInitialStage` — a `StageStore` decorator that seeds fresh sessions from a
    validated initial tree inside the runtime's serialized write path; the seed
    travels the patch channel as the first versioned frame of the seeding turn (and
    the quickstart shell also ships it for an instant first paint).
  - `@facet/assets`: node-free default-asset DATA (deps = `@facet/core` only) —
    `DEFAULT_THEME` and `DEFAULT_PATTERNS` (hero, card, cta-button, and more as
    validated Patterns), the single source of default-Theme truth
    (`@facet/react` derives its floor from it; `loadAssets` seeds it as the base
    layer).
  - `@facet/quickstart`: `--assets <dir>` reads only `theme.json`,
    `patterns.json`, and `initial.tree.json`; injects compact Pattern, Preset, and
    Brick indexes; exposes exact `get_pattern`, `get_preset`, `get_brick_spec`, and
    `get_style_choices` reads; and inlines the escaped Theme into the shell. After
    discovery the model authors ordinary native stage nodes through existing
    mutation tools. With no `--assets`, bundled defaults apply.

  (`@facet/*` are versioned together as a fixed group.)

- 559e170: Live streaming v1: agents can return async iterable batches of server messages,
  letting the runtime apply, persist, and deliver a turn incrementally while
  recording one accumulated sink event. `defineStreamingAgent` streams Stage
  deltas per step, quickstart now yields provider steps as live page updates, and
  non-streaming remote/bridge boundaries explicitly collapse async results into a
  single control batch.
- c1e812f: One-command quickstart with a built-in reference brain, and forms that reach the
  agent. Agent actions gain a declarative `collect: "<box id>"`: at press time the
  renderer snapshots the visible field values under that box and delivers them as
  `fields` on the action event (string-coerced, capped at `MAX_FIELD_VALUE_CHARS`,
  never written into the tree); `onAction` is widened to `(action, fields?)`. The
  server validates `fields` at the boundary (400 on non-string or over-cap values)
  and gains an additive `host` bind option. New `@facet/quickstart`: the
  `facet-quickstart` bin boots a live page owned by a built-in LLM agent — a
  tool-calling loop whose five tools (`append_node`/`set_node`/`remove_node`,
  `render_page`, `say`) map onto the `Stage` API via OpenAI function-calling /
  Anthropic tool-use behind a `QuickstartProvider` interface (or a deterministic
  `--stub`), serving the page shell + bundled client and proxying the protocol to
  an internal loopback server. The public wrapper binds `127.0.0.1`
  by default (its `/event` is unauthenticated and drives paid provider calls), the
  renderer never collects `password` fields, request handlers reject malformed
  request-targets instead of crashing, and the visitor's session-bearer id is kept
  out of provider prompts. The repo gate chain gains `/live-test`, a 3-tier
  stub/bundle/provider-smoke E2E. (`@facet/*` are versioned together as a fixed
  group.)
- 330e9d9: View-state channel: forwarded events can now carry an optional `view` snapshot
  of the visitor's current browser view-state, so the live agent knows which
  screen they are on. Purely additive and UI-IN inert — the stage document schema
  is unchanged, no new round-trip is added, and `view` provably never reaches a
  stage patch/fold/executor path.

  - `@facet/core`: new `ViewSnapshot`/`Viewport`/`ColorMode` types,
    `VIEWPORTS`/`COLOR_MODES`/`MAX_VIEW_TOGGLED_KEYS`, and the single pure `sanitizeView` bounds
    source; optional `view?` added to every `ClientEvent`/`CollectedEvent`
    variant (forward⊆collected preserved).
  - `@facet/server`: `/event` and `/record` clamp `view` via `sanitizeEventView`
    (calling core `sanitizeView`) without ever rejecting the event for `view`
    reasons.
  - `@facet/react`: `StageRenderer` gains an optional read-only `onViewSnapshot`
    callback plus `captureViewSnapshot`/`useViewportColorMode`/`DeviceClasses`;
    viewport and effective `colorMode` are report-only; only colorMode selects the
    Theme paint branch and neither changes document layout.
  - `@facet/client`: `persistView`/`loadPersistedView` persist the snapshot per
    agent link in `localStorage`, re-validated on read, degrading silently.
  - `@facet/agent-tools`: prompt-kit guidance priming the agent to target the
    visitor's current screen.
  - `@facet/reference-agent`: `describeEvent` renders one inert, escaped `view`
    prompt line (current + revisit).
  - `@facet/ag-ui`: input normalizers pass a clamped `view` through via core
    `sanitizeView` instead of stripping it.
  - `@facet/quickstart`: the built page attaches `view` on send, persists it, and
    seeds the revisit `visit` from storage (report-only, no auto-restore).

### Patch Changes

- a9a15ca: Async delivery & scale round 1 — an agent turn's result is never silently lost
  and the reference deployment survives load. The server no longer discards a
  result that outlives the per-event timeout: the visitor gets an interim note and
  the finished result is applied and delivered when it arrives, guarded by an
  era/index staleness check so a late result can never overwrite a newer stage.
  Browser SSE frames carry a per-session sequence (`id: era:seq`); reconnects
  resume via standard `Last-Event-ID` (join-first + gap replay — the documented
  reconnect say-loss window is closed), with full rehydrates preceded by an
  explicit `reset` message (the client no longer synthesizes one on reopen — pair
  the reference client and server together). New: `createSemaphore` in
  `@facet/core`; `FacetRuntime.applyMessages`; `FacetServerOptions.agentStaleMs`;
  spawn-mode concurrency cap `BridgeOptions.maxConcurrent` / `FACET_MAX_CONCURRENT`
  (default 4, FIFO, per-visitor order preserved); a fixed 10s abort on the
  client's event POSTs. (`@facet/*` are versioned together as a fixed group.)
- 3726db7: Hardening campaign 1 — robustness fixes across the protocol, renderer,
  transports, and stores (21 verified review findings). Highlights: RFC 6902
  `test` op now uses structural deep-equal and array index tokens are strictly
  validated (invalid ops throw; the runtime's per-op salvage still absorbs them);
  `validateTree` and the renderer dedupe duplicate sibling ids; `MAX_DEPTH` and
  the theme `COLOR` palette are exported single sources; theme token maps are
  null-prototype (prototype-key tokens resolve to nothing); session files are
  written atomically and shape-checked on read; visitor-event POSTs and sink
  records are ordered; the server sends the reconnect rehydrate before joining
  the live fan-out, validates action payloads, and caps request bodies at 5 MiB;
  `connectAgent` stops immediately on 403 and retries 409 for a bounded window
  instead of silently forever; all publishable packages now ship a README.
  (`@facet/*` are versioned together as a fixed group.)
- 9af8d4b: Structural cleanup ahead of the first release (refactor-audit 1). Renames and
  moves — all pre-first-publish, no shims: `BridgeOptions.mode`/`method` are now
  `runner` ("spawn" | "persistent") and `continuity` ("oneshot" | "resume"), with
  env vars `FACET_RUNNER`/`FACET_CONTINUITY`; unrecognized values now fail fast
  instead of silently defaulting. `browserVisitorId` moved from `@facet/react` to
  `@facet/client` (next to the transport that needs it). New in `@facet/core`: `createLruMap` (the shared bounded-LRU used by the
  runtime session cache, the bridge resume ids, and the server frame log),
  `AgentControlFrame`, `sanitizeActionPayload`/`isPrimitiveRecord`, and a base
  `isTreeShaped`. The server's `createFacetServer` was decomposed into unit-tested
  internal modules (frame log, late window, agent channel, offline) with no
  behavior change; the late-result staleness guard now carries its arrival
  `{index, era}` pair atomically. `@facet/client` no longer depends on
  `@facet/runtime` at runtime. All packages now declare `engines`, `repository`,
  and ship a LICENSE. (`@facet/*` are versioned together as a fixed group.)
- 6d19350: Refactor the reference server and AG-UI adapter into focused private modules
  without changing their public APIs or transport behavior.
- cddf444: Consolidate shared event, action, node, and browser-view validation paths,
  align authoring guidance with Facet's closed brick hierarchy, and clean up
  package and test boundaries without changing protocol behavior. Core now exports
  canonical event normalizers, and client exports a shared `withView` helper.
- Updated dependencies [e3a1ff5]
- Updated dependencies [0a0ad44]
- Updated dependencies [a9a15ca]
- Updated dependencies [4bf72e3]
- Updated dependencies [67e2cd4]
- Updated dependencies [0d27d03]
- Updated dependencies [7f247b0]
- Updated dependencies [736c795]
- Updated dependencies [4c89b56]
- Updated dependencies [e7b7a48]
- Updated dependencies [6327291]
- Updated dependencies [b6c1cf9]
- Updated dependencies [0753cf7]
- Updated dependencies [d111724]
- Updated dependencies [65f10a0]
- Updated dependencies [89175af]
- Updated dependencies [a285569]
- Updated dependencies [852e070]
- Updated dependencies [3726db7]
- Updated dependencies [831a740]
- Updated dependencies [d2cf7b3]
- Updated dependencies [75f7206]
- Updated dependencies [a1a57ca]
- Updated dependencies [559e170]
- Updated dependencies [d9d2308]
- Updated dependencies [d183aed]
- Updated dependencies [e4765ca]
- Updated dependencies [c1e812f]
- Updated dependencies [9af8d4b]
- Updated dependencies [f20f5db]
- Updated dependencies [1a2a517]
- Updated dependencies [d5be1b9]
- Updated dependencies [99b1a84]
- Updated dependencies [bbec237]
- Updated dependencies [cddf444]
- Updated dependencies [6ca8fdc]
- Updated dependencies [5f19ced]
- Updated dependencies [330e9d9]
  - @facet/core@0.1.0
  - @facet/runtime@0.1.0
