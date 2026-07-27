# @facet/quickstart

## 0.1.0

### Minor Changes

- d3cd13c: Clarify agent-stack ownership ahead of the first release. Reference-agent now
  uses only canonical `Reference*` implementation names; the `Quickstart*`
  factory and option names move to `@facet/quickstart`, with no aliases left in
  `@facet/reference-agent`. Test-only compaction controls are no longer part of
  the public options. Quickstart also drops unpublished compatibility modules and
  duplicated suites, agent-tools shares deterministic structural comparison and
  splits its executor by responsibility, and bridge runners share one internal
  event-prompt builder. Oversized agent-stack production modules are split into
  cohesive internal modules.
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

- 736c795: Add the first closed design-system contract across Facet.

  `@facet/core` exposes the closed 11-Brick vocabulary, one complete Theme,
  Brick-owned Presets, and concrete Pattern reference data. Every Brick remains
  available; per-agent assets are exactly one Theme plus one Pattern list and an
  optional initial tree. Raw HTML/JS/CSS and raw scalar styles remain disallowed.

  `@facet/react`, `@facet/assets`, `@facet/runtime`, and
  `@facet/store-postgres` understand the exact Theme/Pattern asset boundary.
  `@facet/agent-tools`, `@facet/reference-agent`, and `@facet/quickstart` pass
  compact Pattern, Preset, and Brick indexes to LLMs and expose exact read-only
  discovery tools. The agent always authors ordinary Bricks after discovery.
  `@facet/agent` accepts the closed native-brick vocabulary when code-authored agents
  render, set, or append native nodes.

- e7b7a48: Pattern canonicalization — the legacy reusable-fragment API is fully replaced
  by optional, read-only Pattern references, intentionally with no compatibility
  aliases. `@facet/core` exposes `FacetPattern` and `validatePattern`;
  `@facet/assets` ships `DEFAULT_PATTERNS`; `@facet/runtime` loads one exact
  `patterns.json` list into `AssetDocuments.patterns`; agent packages advertise a
  validated name/description/useWhen index and the read-only `get_pattern` tool;
  and `@facet/store-postgres` persists the per-agent list in a `patterns` JSONB
  column. Consumers inspect a Pattern when useful and author ordinary stage nodes
  separately.
- 6327291: Pattern reference datasets — complete the pre-1.0 hard cut from reusable
  stage fragments to optional, concrete native-node examples. There are no
  compatibility aliases: consumers read a selected Pattern and author ordinary
  native nodes with the existing stage tools.

  - `@facet/core` requires top-level `description` and `useWhen` on `FacetPattern`,
    accepts only self-contained native nodes, and removes the former parameter,
    nested-reference, dependency-graph, and reference-specific stage mutation
    surfaces. All 11 Bricks remain authorable; a Pattern is reference data only.
  - `@facet/runtime` keeps validated Patterns as concrete documents and skips
    invalid legacy shapes individually; `@facet/assets` ships concrete,
    self-contained `DEFAULT_PATTERNS` examples.
  - `@facet/agent-tools` adds the public
    `selectPatternReference(patterns, name)` snapshot boundary and the exact-name,
    read-only `get_pattern` tool. The system prompt receives
    only each exposed name, description, and useWhen; exact exposure is capped at
    64 Patterns so prompt and lookup stay aligned within the smallest
    context profile. A successful lookup returns the complete selected JSON
    without changing the stage, after which the model authors native nodes
    separately.
  - `@facet/reference-agent` preserves an exact Pattern read through its next
    provider handoff and stops before a provider call if the complete context does
    not fit. `@facet/quickstart` follows the same index/read/author flow without
    sending Pattern JSON through browser or reconnect protocols.
  - `@facet/agent` removes its Pattern-specific mutation method; use `render`,
    `set`, or `append` for native nodes. `@facet/store-postgres` keeps the same raw
    persistence contract while legacy documents are rejected by runtime asset
    validation.

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
- e4765ca: Add polished built-in Brick rendering contracts. `@facet/core` validates each
  Brick-owned style target and value; `@facet/assets` ships complete defaults and
  same-Brick Presets; and `@facet/react` renders native Bricks through those
  contracts, including active navigation looks and display-only table/chart
  affordances. Agent prompt guidance prefers matching Presets and Patterns while
  strict mutation validation rejects unavailable local style paths or values
  before patch emission. Optional Patterns remain read-only examples. Quickstart
  starts from a compact polished default stage for the built-in guide.
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
- d5be1b9: LLM context compaction for the reference agent.

  - `@facet/runtime` gains a fourth persistence seam: `SummaryStore` — an opaque
    per-visitor rolling-summary record (monotonic `coveredThrough` guard,
    `delete` for rebuilds) with `MemorySummaryStore` in the main barrel and
    `FileSummaryStore` (distinct `.summary.json` extension) in
    `@facet/runtime/node`.
  - `@facet/store-postgres` adds `PostgresSummaryStore` + `initSummarySchema`
    (`facet_summary` table, SQL-enforced monotonic upsert, NULL-safe corrupt-row
    repair).
  - `@facet/reference-agent` compacts context with the same provider/model it
    acts with, sized in tokens calibrated from provider-reported usage: a
    background per-visitor cross-turn rolling summary (redacted, schema-validated,
    conversation-anchored, chunked under `maxSummarizerInputChars`, injected as a
    pinned user-role data block) and pair-safe in-turn tool-transcript folding
    with a shadow-refreshed stage block. Every summarizer failure degrades to the
    existing deterministic truncation. Budgets gain a token/compaction model
    (`maxContextTokens`, trigger/target ratios, verbatim windows, summary caps,
    cooldowns); provider adapters report `ProviderStep.usage` and declare
    `contextWindowTokens`; the Anthropic adapter enables `cache_control` prefix
    caching; new `compaction_triggered`/`compaction_done`/`compaction_failed`
    trace events.
  - `@facet/quickstart` wires `MemorySummaryStore` by default (compaction ON out
    of the box) via `composeQuickstartAgent`; opt out with `summaryStore: null`
    or bring a durable store.

- e1c78a3: Add `@facet/reference-agent` as the single source for the reference provider
  adapters, prompt/tools, streaming tool-loop agent, and deterministic stub.
  `@facet/quickstart` now composes that package for provider and `--stub` boot
  while keeping the CLI/server/page wrapper and compatibility re-exports.
- 5f19ced: Unified asset pipeline — one `AssetsStore` for an exact per-agent Theme, Pattern
  list, and optional initial tree. Missing assets use Facet defaults; a supplied
  Theme replaces the default whole after validation, and supplied Patterns are an
  exact list rather than a merge. A renderer maps the Theme to output, while an
  agent may inspect Patterns as read-only authoring references.

  PRE-1.0 BREAKING (in-repo consumers updated): the `@facet/kit` code-factory
  package is REMOVED — its only consumer (`apps/playground`) migrated to a local,
  byte-identical `page`/`text` brick helper. The default Theme/Pattern data
  moved out of `@facet/react` (`DEFAULT_THEME`) and the retired `@facet/kit` (its
  bundled reference trees) into a new node-free package, so a second renderer
  can consume the same defaults.

  - `@facet/assets` (new): node-free default-asset DATA (deps = `@facet/core` only)
    — the token value maps, `COLOR`, `DEFAULT_THEME`, and `DEFAULT_PATTERNS`
    (hero/card/cta-button as validated concrete native-node reference trees). The
    single, renderer-agnostic source of default-asset truth.
  - `@facet/react`: derives its default-theme floor + `DEFAULT_RESOLVED` from
    `@facet/assets` (no duplicated values, no drift); re-exports `DEFAULT_THEME` +
    `COLOR` for back-compat; zero-arg style output byte-identical; `resolveTheme`
    stays the single (render-time) merge site.
  - `@facet/runtime`: `loadAssets` seeds the `@facet/assets` defaults through the
    same validation gate. One valid custom Theme replaces the default whole;
    missing or invalid Theme data falls back whole. A present Pattern list is
    exact, while an absent list uses the bundled Patterns. An empty/absent store
    still resolves the defaults, and the
    "never throws" contract now covers the primary store I/O + malformed shapes
    too.
  - `@facet/quickstart`: resolves assets through `loadAssets` on EVERY boot (a
    `MemoryAssets` fallback when no `--assets`), so the default theme reaches the
    shell and the Pattern index plus exact on-demand reads reach the agent even
    with no operator assets. Exact reference JSON remains in
    the provider conversation and is not sent to the browser.

  (`@facet/*` are versioned together as a fixed group.)

### Patch Changes

- d977ff0: Make Facet stage tool observations structured and LLM-readable. Tool results now
  carry explicit outcomes such as `applied_visible`, `applied_not_visible`,
  `applied_with_warnings`, `pending`, and `rejected`, with bounded warnings and a
  concrete `next_action` for repair loops.

  The reference-agent prompt now teaches the model to use those outcomes before
  claiming a page change is complete, and quickstart documents the structured
  tool-loop feedback.

- a3d95e9: Add `@facet/agent-tools` as the reusable provider-agnostic Facet stage tool
  package, including canonical tool specs, execution, inspection, result types,
  and local stage-shadow helpers.

  `@facet/reference-agent` now consumes that shared tool layer while preserving
  its public compatibility exports. `@facet/quickstart` continues composing the
  reference agent without changing its public package surface.

- 4c89b56: Complete the pre-1.0 node-model cutover to one closed vocabulary of 11 native
  bricks: `box`, `text`, `media`, `input`, `richtext`, `table`, `chart`, `list`,
  `keyValue`, `progress`, and `loading`. The six display bricks keep their existing
  rendering and data behavior; only their former component-tier classification is
  removed.

  Breaking: remove the `button`, `form`, `filterBar`, `metric`, `tabs`, `nav`, and
  legacy `stat` node types together with all component unions, registries,
  validators, asset fields, renderer dispatch, tool-executor routes, and prompt
  guidance. Core exposes one fixed Brick roster, and only `box` may have children.
  Stale retired raw nodes blank-degrade in React, core validation drops
  them, and stage tools reject them without throwing.

  Persisted/operator assets must migrate atomically to one complete Theme, one
  Pattern list, and an optional initial tree. Remove retired component policy and
  style-selector keys, and rewrite stored trees and Patterns with the final Bricks
  or box/text/input structures. There is no compatibility mapper; retired nodes in
  trees or references are dropped or invalidate the document at their ordinary
  validation boundary.

  Add validated reference Patterns for actions, forms, filters, bound summary
  values, and local navigation. These examples use ordinary box/text/input trees:
  pressable label boxes for actions, `navigate` plus active-look predicates for
  browser-local navigation and fixed filters, and `text.from` for bound values.
  Pattern reads remain optional and never edit the stage.

  Update the default quickstart tour, LLM prompt, tool-call budget, buffer
  coherence, playground fixtures, documentation, and tests for native-brick-only
  authoring.

- b6c1cf9: Remove the card, section, and empty-state container-pattern node types and
  publish native Pattern references in their place (PR-5b of the node-model
  restructure). `@facet/assets` now ships `card`, `section`, and `empty-state`
  references backed entirely by concrete `box` and `text` nodes with closed inline
  tokens; actions are pressable boxes containing label text. Agents may inspect
  these examples as optional guidance and
  then author ordinary native nodes; the read never inserts or mutates a stage.

  Breaking: their public interfaces and discriminants, renderers, executor
  entries, retired asset-policy defaults, style selectors, and STAGE_SPEC lines
  are removed. `ContainerNode` is now `BoxNode`. External Themes, Pattern metadata,
  and stored trees must replace the retired types with native nodes.
  Stale raw nodes blank-degrade as whole subtrees in React, are
  dropped by core validation, and are rejected by stage authoring tools without
  throwing.

- 89175af: Remove the `badge` and `alert` display leaves, publish concrete reference
  examples in their place, and remove `divider` entirely (PR-5a of the node-model
  restructure). Badges and alerts are no longer node types: `@facet/assets` ships
  same-Brick Box/Text Presets for neutral and semantic badge/alert treatments.
  Larger `DEFAULT_PATTERNS` demonstrate these treatments where relevant, but no
  tone-only `badge*` or `alert*` Pattern names are exported. Agents compose the
  corresponding box+text nodes with Presets and semantic tokens. A visual separator
  is now a plain bordered box.

  Breaking: the `badge`/`alert`/`divider` node types, their `BadgeNode`/
  `AlertNode`/`DividerNode` interfaces, renderers, and executor entries, together
  with retired asset policy
  defaults, retired style selectors, and STAGE_SPEC node lines are removed. A stale
  tree still carrying one of these types blank-degrades (the renderer skips it, the
  validator drops it, the executor refuses to author it) — never throws.

- 09347fa: Make the quickstart first-run path provider-backed and sample-service oriented:
  the default brief now renders a neutral agent service page instead of a Facet
  demo, the documented workspace command uses the source CLI path that works in
  the monorepo, and the wrapper returns clean HEAD `/app.js` and favicon
  responses.
- 1a2a517: Apply the repository-wide P2/P3 refactor audit cleanup: centralize tree-field,
  JSON Pointer, runtime asset-issue, Quickstart navigation, and React style
  projection logic; make Theme validation report contrast warnings; separate the
  tool-neutral stage contract from agent-runner instructions; remove dead aliases
  and helpers; and split the renderer interaction regression suite by concern.

  `@facet/core` additionally exports `escapeJsonPointerToken` so patch-producing
  packages share the same RFC 6901 token escaping implementation.

- e9be9ba: Split the reference agent public surface around the new provider, prompt, and
  harness modules while preserving compatibility aliases. The package root now
  exports the bounded harness budget presets/normalizer, stop and retry helpers,
  sanitized trace event helpers, and loop summary/fallback types. The reference
  agent and quickstart option types also include additive `budgetPreset`, `budget`,
  and `trace` options. The harness now bounds stage JSON assembly before
  stringifying large stages, degrades corrupt sink/stage input into safe prompt
  placeholders, rejects malformed provider tool calls, preserves ordered tool
  observations, and keeps terminal trace events when async trace sinks are
  saturated.
- 2e9b2c7: Remove the public `--stub` quickstart path so first-run usage requires a real
  provider-backed reference agent. The deterministic stub remains available from
  `@facet/reference-agent` as a test fixture for live-link gates.
- 99b1a84: Renderer transitions v1: `useFacet` now exposes renderer-local transition
  metadata, and `StageRenderer` can use it to smooth live patch updates with
  brick-level enter/exit motion or a stage crossfade for root document writes and
  large edits.

  - `@facet/core`: `StageFoldResult.rootReplaced?: boolean` reports whether an
    actually-applied patch op wrote the root document, so renderers do not guess
    from raw patch shape after salvage.
  - `@facet/react`: new `StageTransitionHint`, `UseFacetState.transition`, and
    optional `StageRendererProps.transition`; same-id updates remain immediate,
    exiting visuals are inert, and reduced-motion users get the final UI without
    animation.
  - `@facet/quickstart`: the built page wires `transition` from `useFacet` into
    `StageRenderer`, enabling root-replace crossfades in the default live surface.

- cddf444: Consolidate shared event, action, node, and browser-view validation paths,
  align authoring guidance with Facet's closed brick hierarchy, and clean up
  package and test boundaries without changing protocol behavior. Core now exports
  canonical event normalizers, and client exports a shared `withView` helper.
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

- Updated dependencies [d3cd13c]
- Updated dependencies [d977ff0]
- Updated dependencies [a3d95e9]
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
- Updated dependencies [1b02986]
- Updated dependencies [f7239af]
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
- Updated dependencies [09347fa]
- Updated dependencies [9af8d4b]
- Updated dependencies [f20f5db]
- Updated dependencies [1a2a517]
- Updated dependencies [e9be9ba]
- Updated dependencies [d5be1b9]
- Updated dependencies [e1c78a3]
- Updated dependencies [99b1a84]
- Updated dependencies [bbec237]
- Updated dependencies [6d19350]
- Updated dependencies [cddf444]
- Updated dependencies [6ca8fdc]
- Updated dependencies [5f19ced]
- Updated dependencies [330e9d9]
  - @facet/reference-agent@0.1.0
  - @facet/core@0.1.0
  - @facet/agent@0.1.0
  - @facet/runtime@0.1.0
  - @facet/server@0.1.0
