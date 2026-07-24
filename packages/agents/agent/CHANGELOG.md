# @facet/agent

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
- 6ca8fdc: Tree data warehouse + bindings: an agent can declare a dataset once in an
  optional top-level `data` map on the stage tree and bind multiple display nodes
  (`table`, `chart`, `list`, `keyValue`, and single-cell `text`) to it by name via a
  new
  optional `from` field, instead of copying the same rows/series into each node. A
  single `/data/<name>` (or `/data/<name>/<i>/<col>`) patch then updates every
  bound view. Purely additive — inline data stays valid, and `from` is opt-in.

  - `@facet/core`: optional `FacetTree.data` (`Record<string, Dataset>`), `from?`
    on the five data-bearing node types plus `column?`/`row?` on `text`;
    new `Dataset`/`DataRow`/`DataCell`/`DataWarehouse` types, the pure
    `sanitizeDataWarehouse` (closed row-record schema, forbidden-key-safe, capped)
    and the single `resolveNodeData` (precedence + fixed per-node projection).
    `validateTree` sanitizes `data`; `treeHasContent`/`treeRenderableNodeIds`
    resolve `from` so a data-backed node counts as content. `STAGE_SPEC` teaches
    the warehouse + `from` binding (names only — no fetch/resolver/expression).
  - `@facet/react`: the renderer resolves `from` for every data-bearing node
    (read-only; no client-side data writer), projecting the row-records into each
    node's shape; a dangling/absent `from` renders empty and never throws.
  - `@facet/agent`: `Stage.setData(name, rows)` emits a `/data/<name>` patch.
  - `@facet/agent-tools` / `@facet/reference-agent`: `describeNode` reports the
    resolved counts of from-bound nodes, and the prompt kit + system prompt teach
    authoring data once and binding many views.

  Local table sort is a later closed renderer capability. Row-predicate filtering
  over shared data remains deferred; fixed choices can navigate pre-authored
  screens locally without adding a second data writer.

### Patch Changes

- 1a2a517: Apply the repository-wide P2/P3 refactor audit cleanup: centralize tree-field,
  JSON Pointer, runtime asset-issue, Quickstart navigation, and React style
  projection logic; make Theme validation report contrast warnings; separate the
  tool-neutral stage contract from agent-runner instructions; remove dead aliases
  and helpers; and split the renderer interaction regression suite by concern.

  `@facet/core` additionally exports `escapeJsonPointerToken` so patch-producing
  packages share the same RFC 6901 token escaping implementation.

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
- Updated dependencies [99b1a84]
- Updated dependencies [bbec237]
- Updated dependencies [cddf444]
- Updated dependencies [6ca8fdc]
- Updated dependencies [330e9d9]
  - @facet/core@0.1.0
