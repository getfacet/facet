# @facet/assets

## 0.1.0

### Minor Changes

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

- 852e070: Add font family tokens to the Facet style system. Agents can now set
  `TextStyle.family` to `sans`, `serif`, or `mono`; theme documents may provide a
  validated `fontFamily` token map; the default assets include the built-in font
  stacks; and the React renderer resolves the token to CSS with `sans` as the
  default fallback.
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

- e4765ca: Add polished built-in Brick rendering contracts. `@facet/core` validates each
  Brick-owned style target and value; `@facet/assets` ships complete defaults and
  same-Brick Presets; and `@facet/react` renders native Bricks through those
  contracts, including active navigation looks and display-only table/chart
  affordances. Agent prompt guidance prefers matching Presets and Patterns while
  strict mutation validation rejects unavailable local style paths or values
  before patch emission. Optional Patterns remain read-only examples. Quickstart
  starts from a compact polished default stage for the built-in guide.
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

- 0753cf7: Split oversized contract, asset, runtime, and React renderer implementations
  into focused private modules while preserving their public APIs and behavior.
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
