# @facet/core

## 0.1.0

### Minor Changes

- e3a1ff5: Raise the `chart` and `table` Bricks to a product-grade analytics surface
  without adding a Brick or opening the style vocabulary. Core gains four closed,
  extensible additions: a per-series `axis` choice (`primary`/`secondary`), a
  per-column `width` choice (`auto`/`narrow`/`medium`/`wide`), table-root
  `dividers` (`none`/`rows`/`grid`) and `stickyHeader` style properties, and a
  bounded `emptyLabel` field — each wired at both the strict author boundary and
  the fail-soft render boundary.

  The React renderer rebuilds chart geometry around a larger plot area,
  step-aligned tick values, compact tick labels, grid-behind-marks and
  comparison-under-current line layering, and independent primary/secondary value
  scales when series select them; with no secondary assignment a chart renders
  exactly as before. The table renderer owns its bounded horizontal scroll region
  so a wide grid never pushes its parent, pins a header inside that same
  renderer-owned region at a framework-owned offset and height, allocates closed
  column widths, draws row/column dividers, and renders an authored empty-state
  label. Discovery prose and `STAGE_SPEC` enumerate the new choices.

  Two adjacent corrections ride along: `textWrap: "nowrap"` now clips flowing text
  with an ellipsis at its container edge instead of letting the line paint past it
  (a table keeps its own bounded scroll instead), and Core's renderability
  predicate finally counts a valid `kind: "icon"` media node as content, so an
  icon-only change is no longer reported to the agent as invisible.

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

- 4bf72e3: Binding enablers: two closed, read-only capabilities so agents can author
  store-bound values and self-highlighting UI from native bricks.

  - **Store binding on `text`** — a `text` brick gains `from`/`column`/`row` and
    reads ONE scalar cell of the `data` warehouse, projected
    by the one shared `resolveNodeData`; `from` wins over inline `value`,
    dangling/absent → empty (never throws). Both the renderer and the agent-tools
    shadow use the same projection, so the brain's view can't drift from the
    visitor's. This lets a data-bound summary value be authored as a
    `box`+`text` Pattern.

  - **View-state (active-look) binding** — `box`/`text` gain `activeWhen` plus a
    same-Brick `style.active` override and a closed view predicate
    (`{ screen }` | `{ toggled }`),
    so a brick highlights itself when that browser view-state holds, with no agent
    turn. `@facet/core` adds the closed `ViewPredicate` union +
    `sanitizeViewPredicate`/`evaluateViewPredicate`. The renderer evaluates it against
    the already-threaded snapshot view-state (the inert previous-screen clone keeps
    its old highlight through a crossfade) and folds the active look into the same
    pure token merge — read-only (writes no view-state/data), `style.active` passes
    the identical Brick-owned allowlist as base `style`, and an unknown predicate kind degrades
    to the default look (no DSL). The predicate union is extensible (`viewport`/`sort`
    kinds can be added additively). This is the brick-level capability that lets
    segmented/navigation-style active highlighting be authored from `box`+`text`.

  All fields are additive optionals; existing trees are byte-identical.

- 67e2cd4: Grow the closed `box` layout vocabulary so an agent can express product-grade
  page structures — split panes, responsive grids, horizontal shelves, and
  bounded viewports — without a new container Brick, a layout-mode enum, or any
  raw CSS. `box` stays Facet's only container.

  Core adds four orthogonal, additive properties plus one member on the existing
  `columns` domain: `basis` and `itemWidth` (a new `layoutWidth` token domain —
  `basis` holds a split-pane / shelf item at a pane width, `itemWidth` is the item
  floor for an auto grid), `maxHeight` (a new `maxHeight` token domain that bounds
  a box to its own scrolling viewport), a row-only `collapse` (`none`/`stack`),
  and `columns:"auto"`. Each is wired at both the strict author boundary and the
  fail-soft render boundary. `FacetThemeTokens` gains two required token groups
  (`layoutWidth`, `maxHeight`): a Theme that spreads `...DEFAULT_THEME.tokens`
  inherits them, but a **standalone** custom-theme literal must add both — a
  pre-1.0 breaking change (an incomplete Theme falls back whole to `DEFAULT_THEME`).

  The React renderer translates the new properties to flow-only CSS: `basis` →
  `flex-basis` with no-shrink, `columns:"auto"` → a container-clamped
  `repeat(auto-fit,minmax(min(itemWidth,100%),1fr))` grid, an authored `maxHeight`
  that wins over the renderer's default scroll cap and brings its own overflow
  containment, and `collapse:"stack"` as a framework-owned `@media` rule in the
  per-stage stylesheet (no absolute positioning, no JS resize listener, nothing new
  in the view snapshot) keyed to one renderer-owned narrow breakpoint that the
  reported `view.viewport` classification shares. `@facet/assets` adds a looks-only
  `rail` Preset and four validation Patterns (`app-shell`, `split-pane`,
  `product-grid`, `media-shelf`); discovery prose and `STAGE_SPEC` enumerate the
  new choices and the narrow-adaptation authority rule.

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

- 852e070: Add font family tokens to the Facet style system. Agents can now set
  `TextStyle.family` to `sans`, `serif`, or `mono`; theme documents may provide a
  validated `fontFamily` token map; the default assets include the built-in font
  stacks; and the React renderer resolves the token to CSS with `sans` as the
  default fallback.
- 831a740: Initial public release of Facet — a TypeScript framework for living pages an
  agent owns: one public link the agent re-renders live, per visitor, driven by
  conversation. Ships the core spec (declarative bricks + tokens + RFC 6902
  patches + fail-safe validation), the runtime (StageStore + Sink), the agent SDKs
  and `facet` CLI, the reference SSE/POST server, the React renderer, presets, and
  a Postgres store adapter. (`@facet/*` are versioned together as a fixed group.)
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

- a1a57ca: Landing-grade vocabulary: the closed token/brick set now reaches beyond
  dashboard scale so an agent can compose a landing/marketing page — an
  Apple/Browserbase-style full-height hero with large display type over a
  background image, plus dark bands, gradients, and sticky sections — using only
  tokens (no pixels, no raw CSS, no absolute positioning). Purely additive.

  - `@facet/core`: `FONT_SIZES` extends with `4xl/5xl/6xl`; new closed token groups
    `MIN_HEIGHTS`, `MAX_WIDTHS`, `TRACKINGS`, `LEADINGS`, `GRADIENTS`, `SCRIMS`,
    paint tokens for dark Theme values, plus `HIGHLIGHTS`,
    wired into `BoxStyle`/`TextStyle`; `BoxNode` gains `backdrop?: NodeId` (paint a
    referenced media node as a bounded background layer) and `sticky`. `validateTree`
    validates them fail-safe; every group is operator-theme overridable; `STAGE_SPEC`
    teaches them (names only — no fetch/URL/raw CSS).
  - `@facet/react`: `boxStyle`/`textStyle` map the new tokens to CSS; the renderer
    paints the `backdrop` as exactly two renderer-synthesized layers (media cover +
    readability scrim) at negative z-index inside a stacking-context host, so flow
    children always paint above them and no absolute positioning is ever emitted
    onto authored content. The client-owned `colorMode` selects the Theme's light
    or dark paint values for the whole rendered document. The
    backdrop resolves read-only to a media node only, through the existing
    safe-`src` gate, and counts against the render budget.
  - `@facet/assets`: `DEFAULT_THEME` gains concrete default values for every new
    group plus a dark palette.

  Note: `ResolvedTheme` (`@facet/react`) gains required fields — a minor-breaking
  type widening only for an out-of-repo consumer that hand-builds a `ResolvedTheme`
  literal (none in-repo; consumers normally obtain it from `resolveTheme`).
  Deferred to later bundles: declarative motion, an icon vocabulary + `copy`
  action, and pointer-reactive effect tokens (the last via the renderer extension
  API).

- 559e170: Live streaming v1: agents can return async iterable batches of server messages,
  letting the runtime apply, persist, and deliver a turn incrementally while
  recording one accumulated sink event. `defineStreamingAgent` streams Stage
  deltas per step, quickstart now yields provider steps as live page updates, and
  non-streaming remote/bridge boundaries explicitly collapse async results into a
  single control batch.
- d9d2308: Local table sort: a visitor can click a `sortable` table column header to reorder
  the rows in the browser — ascending → descending → unsorted — with no agent turn
  and no transport, the same two-writers-safe discipline as `navigate`/`toggle`.

  `@facet/core` gains an additive `TableColumn.sortable?: boolean` (bounded-boolean
  validated, drop-with-issue on non-boolean), a closed `SortDirection` /
  `SORT_DIRECTIONS` enum, an optional `ViewSnapshot.sort` map (per-table
  `{ column, direction }`) sanitized in `sanitizeView` (bounded by
  `MAX_VIEW_SORT_KEYS`, drop-oldest, never throws), and teaches the flag in
  `STAGE_SPEC`. `@facet/react` holds the sort as pure browser view-state beside
  `screen`/`toggled`, applies a renderer-owned TOTAL, STABLE comparator
  (`applySort`: numeric < string < boolean < empty, ties by original index; reads
  cells through the same `safeOwnValue` guard as the cell renderer so a hostile
  throwing getter can never unwind the render) to the freshly-resolved rows at
  render time, and rides the current spec on the `view` snapshot. The browser never
  writes `data`/`rows`; the server stays the sole content writer and a later data
  patch re-applies the current spec. The agent authors no sort logic — only the
  opt-in flag. Local filtering is deliberately deferred.

- d183aed: Add `overlay` — the one sanctioned way a `box` floats ABOVE flow content, as a
  bounded modal or drawer. This is flow-only's single deliberate exception, done as
  a constrained renderer-owned descriptor (never a z-index/absolute escape hatch).

  - **Shape (closed, extensible):** a new `overlay?: { kind: "modal" | "drawer" }`
    field on `box` (part of the `Layered` concern pack, alongside `backdrop`). The
    author supplies ONLY the closed `kind` name — never coordinates, size, or
    z-index. `@facet/core` exports `OVERLAY_KINDS` / `OverlayKind` / `Overlay`.
    (`popover` and an anchored form are deferred, addable additively.)

  - **Renderer-owned (`@facet/react`):** a visible overlay box floats in a
    renderer-fixed positive-z band — `modal` centered, `drawer` at the end edge —
    over a full-viewport scrim, with a bounded internal scroll region so tall
    content is never clipped under the body scroll-lock. The renderer owns
    placement, scrim, z, focus, Esc, and scrim-click; a stack of overlays closes
    one-at-a-time (topmost first).

  - **Open/close reuses the existing local `toggle`:** start the box `hidden`, wire
    a trigger `onPress: { kind: "toggle", target: <box id> }`. Esc / scrim / a
    close button all hide the box via the same `view.toggled` entry (idempotent —
    double-close never reopens), so the agent's view snapshot stays coherent and no
    close is an agent turn.

  - **Fail-safe:** an unknown/malformed `overlay` (`{kind:"lightbox"}`, `{}`,
    non-object, extra keys) is dropped in validation and renders as a normal inline
    box; the renderer never throws.

  STAGE_SPEC teaches `overlay` so agents can author it. Additive — existing trees
  are byte-identical.

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

- 1a2a517: Apply the repository-wide P2/P3 refactor audit cleanup: centralize tree-field,
  JSON Pointer, runtime asset-issue, Quickstart navigation, and React style
  projection logic; make Theme validation report contrast warnings; separate the
  tool-neutral stage contract from agent-runner instructions; remove dead aliases
  and helpers; and split the renderer interaction regression suite by concern.

  `@facet/core` additionally exports `escapeJsonPointerToken` so patch-producing
  packages share the same RFC 6901 token escaping implementation.

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

- bbec237: Add the `richtext` native brick — a closed, fail-safe leaf for a flowing block
  of prose with MIXED inline formatting the single-string `text` node cannot express.

  - **Shape (closed):** `richtext` holds `blocks[]`, each a
    `{ type: paragraph|heading|listItem|quote, runs[] }`; a `run` is
    `{ text, marks? }` and a `mark` is a closed tagged union
    `{ kind: bold|italic|underline|strike|code }` or
    `{ kind: "link", target }`. Heading `level` (1–3) and list `depth` (0–5) are
    renderer-owned flow indent, clamped — never author pixels or positioning.
    It is a LEAF: no child ids, no `from` binding; its blocks/runs are its own data.

  - **Marks are semantic names, not markup.** The theme owns the concrete look; an
    unknown mark drops and the run text is kept. No HTML/markdown/CSS DSL ever
    enters the tree (invariants #2/#4).

  - **Links.** A `link` mark's `target` is either an INTERNAL `FacetAction`
    (navigate/agent/toggle — the same union as `onPress`, dispatched through the
    single press writer) or a gated EXTERNAL `{ href }`. The external href passes a
    strict `isSafeHref` allowlist (http(s)/protocol-relative/local paths only;
    `javascript:`, all `data:`, and every other scheme are rejected) at BOTH
    validate and render time, and renders as a plain `<a rel="noopener noreferrer">`
    — navigated, never fetched (invariants #1/#7). `isSafeHref` is exported from
    `@facet/core`.

  - **Fail-safe.** Malformed blocks/runs/marks degrade (unknown block → paragraph,
    text-less run skipped, unknown mark dropped, all-invalid → empty); the validator
    and renderer never throw. On the inert previous-screen clone every link renders
    inert (no anchor/href/dispatch).

  All fields are additive; existing trees are byte-identical.

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
- 0753cf7: Split oversized contract, asset, runtime, and React renderer implementations
  into focused private modules while preserving their public APIs and behavior.
- d111724: Close the core/runtime hardening pass. `@facet/core` now rejects JSON Patch
  source reads and missing `replace`/`remove` targets before mutating, keeps patch
  batch salvage non-throwing for hostile operation accessors, and aligns theme
  color admission with contrast parsing for opaque hex, rgb/rgba, hsl/hsla, and a
  conservative named-color table. `@facet/runtime` now keeps `loadAssets` fail-soft
  across adapter rejects, malformed store shapes, hostile accessors/arrays,
  oversized asset arrays, and initial-tree validation failures; returned asset
  issues are bounded/sanitized; and `withInitialStage` preserves seed re-emission
  across failed first saves, including committed seeds whose pending report was
  evicted before the runtime could consume it.
- 65f10a0: Consolidate node validation and sensitive-data redaction ahead of the first
  release. All native nodes pass through canonical validators while the stale
  partial `HIGH_LEVEL_NODE_TYPES` surface is removed. Runtime owns the shared
  redaction helpers used at both Sink and prompt/history boundaries, and the record
  settlement callback type is renamed to `RuntimeRecordSettlementObserver` to
  distinguish it from the conversation `Sink`.
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
- cddf444: Consolidate shared event, action, node, and browser-view validation paths,
  align authoring guidance with Facet's closed brick hierarchy, and clean up
  package and test boundaries without changing protocol behavior. Core now exports
  canonical event normalizers, and client exports a shared `withView` helper.
