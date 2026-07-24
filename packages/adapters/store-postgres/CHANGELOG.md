# @facet/store-postgres

## 0.1.0

### Minor Changes

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

- 6b3da69: Add `PostgresAssets`, a durable Postgres-backed `AssetsStore` adapter for one
  per-agent Theme, exact Patterns (a `patterns` JSONB column), and an optional
  initial tree. `initSchema` now provisions the matching `facet_assets` table
  alongside `facet_stage` and `facet_event`.
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

### Patch Changes

- f20f5db: Consolidate contract logic identified by the repository structural audit.

  - Core now owns property-specific style choices and screen-root resolution, so
    validators, discovery tools, and the React renderer use one closed decision.
    The tree validation result type is now the subject-qualified
    `TreeValidationResult`.
  - Agent style discovery no longer advertises `inherit` where the corresponding
    property rejects it, and React reuses one defensive raw-value helper set.
  - Postgres `initSchema` provisions all four persistence tables, including the
    rolling-summary table.
  - Resource-boundary tests exercise small injected limits instead of repeatedly
    materializing production-sized hostile inputs.

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
