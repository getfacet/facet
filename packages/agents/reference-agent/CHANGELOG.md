# @facet/reference-agent

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

- d2cf7b3: Consolidate the input-capturing vocabulary (hard cutover — pre-1.0, breaking).

  - **`field` → `input`.** The native input brick is renamed: node type
    `"field"` → `"input"`, and the exported types `FieldNode`/`FieldInput`/
    `FieldStyle`/`FIELD_INPUTS` → `InputNode`/`InputKind`/`InputStyle`/
    `INPUT_KINDS`. Behavior is byte-identical — same `name`/`input` kind/`options`/
    `label`/`placeholder`, same fail-safe on an unknown kind (→ default text).
  - **`search` node type removed.** A search box is now `input:"search"` (that
    input kind already existed); a search box _with submit_ is an `input` plus a
    pressable label box whose `onPress` carries `collect`. The
    standalone `search` node — and its `submitLabel`/`onSubmit`/`value` submit
    affordance — is gone. STAGE_SPEC + the prompt kit teach the new model.
  - **Theme style follows the rename.** The top-level `field` Brick default and
    Presets in `DEFAULT_THEME` are renamed → `input`, so the input Brick keeps its
    default chrome through the current Brick-owned style vocabulary.

  Migration: emit `type:"input"` instead of `type:"field"`; replace a `search`
  node with `input:"search"` plus a pressable label box for submit. Password input values
  remain excluded from collected event data. Pre-deploy hard cutover — stale
  `field`/`search` trees fail-safe degrade (skipped), never throw.

- e4765ca: Add polished built-in Brick rendering contracts. `@facet/core` validates each
  Brick-owned style target and value; `@facet/assets` ships complete defaults and
  same-Brick Presets; and `@facet/react` renders native Bricks through those
  contracts, including active navigation looks and display-only table/chart
  affordances. Agent prompt guidance prefers matching Presets and Patterns while
  strict mutation validation rejects unavailable local style paths or values
  before patch emission. Optional Patterns remain read-only examples. Quickstart
  starts from a compact polished default stage for the built-in guide.
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

- 65f10a0: Consolidate node validation and sensitive-data redaction ahead of the first
  release. All native nodes pass through canonical validators while the stale
  partial `HIGH_LEVEL_NODE_TYPES` surface is removed. Runtime owns the shared
  redaction helpers used at both Sink and prompt/history boundaries, and the record
  settlement callback type is renamed to `RuntimeRecordSettlementObserver` to
  distinguish it from the conversation `Sink`.
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

- 1b02986: Add a reusable Facet agent prompt kit to `@facet/agent-tools`. Custom LLM/tool
  loops can now import shared Facet guidance for `STAGE_SPEC`, compact page UX,
  edit-before-append behavior, tool-result recovery, and Theme/Pattern metadata
  privacy without depending on the reference agent.

  `@facet/reference-agent` now delegates its fixed Facet system-prompt sections to
  that shared kit while keeping its existing `buildSystem(guide, assets?)`,
  `PromptAssets`, and `TOOLS` compatibility surface.

- 09347fa: Make the quickstart first-run path provider-backed and sample-service oriented:
  the default brief now renders a neutral agent service page instead of a Facet
  demo, the documented workspace command uses the source CLI path that works in
  the monorepo, and the wrapper returns clean HEAD `/app.js` and favicon
  responses.
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
  - @facet/agent-tools@0.1.0
  - @facet/core@0.1.0
  - @facet/agent@0.1.0
  - @facet/runtime@0.1.0
