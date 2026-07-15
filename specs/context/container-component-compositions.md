# Context Evidence: PR-5b — Container Components as Composition References

> Stage 0 evidence for `/spec-bridge`. Read-only investigation performed on
> `main` at `6327291` on 2026-07-15. Product code was not modified.

## Approved Input

- Intake brief: `specs/feature-intake/container-component-compositions.md`
- Decision: remove `card`, `section`, and `emptyState` as node types in one hard
  cutover; retain/add `card`, `section`, and `empty-state` as concrete native
  composition references.
- Styling decision: explicit `box`/`text` token fields; no cross-component recipe
  inheritance and no new box capability.
- Interaction decision: the empty-state reference owns its action only on a child
  `button.onPress` authored by the model.
- Scope guard: `stat` is untouched (PR-6).

## Baseline

The source baseline is green:

```text
pnpm typecheck  # PASS, 16 workspace projects
pnpm test       # PASS, 125 files; 2100 passed, 1 skipped
pnpm lint       # PASS
```

The worktree also contains pre-existing untracked PR-5a spec artifacts. They
were read as precedent but are not owned by this feature and must not be edited.

## Affected Packages And Entrypoints

| Surface | Entrypoint / evidence | PR-5b impact |
|---|---|---|
| `@facet/core` | `packages/core/core/src/index.ts:1-17` exports `nodes`, theme, catalog, validation, and `STAGE_SPEC`; `nodes.ts:417-429` re-exports component interfaces and defines public containers | Breaking removal of three public node interfaces/discriminants; container, validation, recipe, catalog, composition metadata, and prompt contracts narrow |
| `@facet/assets` | `packages/core/assets/src/index.ts:1-3` exports default theme/catalog/compositions | Rewrite 16 retired nodes and 15 parent hints, add generic `section`, remove three theme recipes |
| `@facet/react` | `packages/core/react/src/index.ts:1-5`; renderer registry at `brick-render-registry.ts:70-103` | Remove three renderers/entries; preserve unknown-type `null` fail-safe |
| `@facet/agent-tools` | `packages/agent-stack/agent-tools/src/index.ts:1-65` exports tool schema, executor, buffer, prompt kit | Remove executor entries/advertising; cleanly refuse retired `set_node` types |
| `@facet/reference-agent` | `packages/agent-stack/reference-agent/src/index.ts:4-22` exports stage prompt/summary APIs | Remove specialized stage-summary handlers and migrate fixtures |
| `@facet/quickstart` | `packages/agent-stack/quickstart/src/index.ts:1-7`; seed assembled in `guide.ts:64-82` | Rewrite 18 seed containers into boxes plus 40 explicit texts; regenerate deterministic golden |
| `@facet/runtime` | `packages/core/runtime/src/assets.ts:1-12,309-424` consumes core validators and default assets | Production unchanged; composition/catalog fixtures must migrate so fail-soft loading is not mistaken for success |
| `@facet/store-postgres` | `packages/extensions/store-postgres/src/postgres-assets.test.ts:111-123` | Test fixture migration only; package behavior unchanged |
| Playground | `apps/playground/src/print-tree.ts:30-115` | Remove exhaustive display/action branches; migrate generator tests |

No package move, dependency, manifest, protocol, transport, runtime event-loop,
or client-fetch change is justified.

## Consumer Inventory

### Public type and registry chain

- `packages/core/core/src/component-nodes.ts:6-32` is the canonical component
  roster; `:48-68` owns `SectionNode`/`CardNode`; `:214-246` owns
  `EmptyStateNode` and the union arms.
- `packages/core/core/src/nodes.ts:417-429` publicly re-exports those types and
  defines `ContainerNode`/`isContainer`.
- `packages/core/core/src/brick-registry.ts:136-282` is exhaustive over the core
  node union and currently routes all three.
- `packages/core/core/src/component-validation-layout.ts:1-57` exists only for
  `section`/`card`; the file has no surviving responsibility after PR-5b.
- `packages/core/core/src/component-validation-feedback.ts:12-55` routes
  `emptyState` beside surviving `progress`/`loading`.
- `packages/core/core/src/catalog-defaults.ts:13-61` advertises all three.
- `packages/core/core/src/theme-types.ts:107-115` derives public recipe keys from
  the node roster, so the recipe union narrows automatically.

### Concrete data inventory

Literal probes:

```bash
rg -o 'type: "(section|card|emptyState)"' \
  packages/core/assets/src/compositions.ts \
  packages/core/assets/src/composition-chart-table.ts | sort | uniq -c

rg -o 'type: "(section|card|emptyState)"' \
  packages/agent-stack/quickstart/src/guide-*.ts | sort | uniq -c

rg -o 'preferredParent: "(section|card)"' \
  packages/core/assets/src/*.ts | sort | uniq -c
```

Results:

- Default compositions: 16 retired nodes — `card` ×10, `section` ×6,
  `emptyState` ×0 — across 10 references.
- Quickstart seed: 18 retired nodes — `card` ×8, `section` ×10,
  `emptyState` ×0.
- Default composition metadata: 15 retired parent hints — `card` ×6,
  `section` ×9.
- The current 21 reference datasets already include names `card` and
  `empty-state`; adding the agreed generic `section` makes 22.
- `packages/core/assets/src/theme.ts:142-165,309-326` contains the three retired
  recipe blocks.

Across `packages/**` and `apps/**`, the API probe classified 127 retired node
literal matches on 126 lines in 33 files: 49 production lines in 14 files and
77 test lines in 19 files. Broad word bans are invalid because `card` and
`section` remain legal composition names and ordinary prose.

### Renderer, tools, and summary consumers

- Specialized DOM behavior: `brick-renderer-layout.tsx:34-135` renders section
  and card; `brick-renderer-data.tsx:246-307` renders empty state.
- React dispatch: `brick-render-registry.ts:70-103`; unknown values already
  return `undefined`, and `renderer-render.tsx:609-642` returns `null` before
  traversing children.
- Tool dispatch: `executor-registry.ts:101-478`, with handlers at `:229-262` and
  `:435-440`. `executor-input.ts:108-119` already uses `Object.hasOwn` and emits
  the clean allowed-type error.
- Buffered forward-reference recognition: `buffer.ts:269-288` currently special
  cases box/section/card, but not form.
- Reference summary dispatch: `prompt/stage-summary.ts:70-210`, with handlers at
  `:112-113,182-189`; unknown types summarize as `type=unknown`.
- Playground exhaustive branches: `apps/playground/src/print-tree.ts:30-97`.

## Existing Tests Near The Behavior

| Behavior | Existing test location |
|---|---|
| Exact public node union and container type | `packages/core/core/src/nodes.test.ts:168-192` |
| Core component routes | `packages/core/core/src/component-validation.test.ts:12-100` |
| Validation/drop and composition metadata | `packages/core/core/src/validate.test.ts:439-734,809-1052` |
| Core registry exhaustiveness | `packages/core/core/src/brick-registry.test.ts:8-41` |
| Catalog exact defaults | `packages/core/core/src/catalog.test.ts:494-527` and `packages/core/assets/src/catalog.test.ts:46-57` |
| Theme recipes | `packages/core/assets/src/theme.test.ts:221-250` and `packages/core/react/src/theme.test.ts:320-335,700-735` |
| Reference validation | `packages/core/assets/src/compositions.test.ts:20-101,300-345` |
| Renderer registry and fail-safe | `packages/core/react/src/brick-render-registry.test.ts:9-49`; `StageRenderer.test.ts:102-185` |
| Component DOM/interactions | `packages/core/react/src/component-layout.test.tsx:18-270`; `StageRenderer.interaction.test.tsx` |
| Tool rejection and buffering | `packages/agent-stack/agent-tools/src/executor.test.ts:387-420,960-1020`; `buffer.test.ts:74-145` |
| Prompt/schema | `packages/agent-stack/agent-tools/src/specs.test.ts:90-120`; `prompt-kit.test.ts:225-330` |
| Stage-summary exhaustiveness | `packages/agent-stack/reference-agent/src/prompt/stage-summary.test.ts:1-25`; `prompt.test.ts:780-980` |
| Seed validity/order/hash | `packages/agent-stack/quickstart/src/guide.test.ts:97-133` |
| Playground outline | `apps/playground/src/print-tree.test.ts:111-241` |
| Downstream asset loading | `packages/core/runtime/src/assets.test.ts:64-84,247-325,650-840`; `packages/extensions/store-postgres/src/postgres-assets.test.ts:111-123` |

## Package README And Documentation Inventory

Shipping contract text that treats the names as node/recipe types must be
updated in the final `/update-docs` gate:

- `README.md:114-126`
- `docs/ARCHITECTURE.md:107-130`
- `packages/core/core/README.md:56-89`
- `packages/core/react/README.md:18-28`
- `packages/core/assets/README.md:11-20`
- `packages/agent-stack/agent-tools/README.md:74-82`
- `packages/agent-stack/quickstart/README.md:13,153-229`
- `packages/extensions/store-postgres/README.md:76-92`

Composition names such as `card`, `empty-state`, and `pricing-section` remain
correct when clearly described as reference datasets rather than node types.

## Module Shape Evidence

| Area | Current evidence | Planned shape |
|---|---|---|
| Default compositions | `compositions.ts` is 737 lines; a role-specific sibling `composition-chart-table.ts` already exists (46 lines) | Add private `composition-containers.ts` for the canonical `section`/`card`/`empty-state` native examples; keep other concrete datasets in `compositions.ts` and rewrite them in place |
| Core layout validator | `component-validation-layout.ts` is 57 lines and owns only the two removed types | Delete it; do not retain an empty role module or generic helper |
| Quickstart seed | Role files already exist: home 159, structure 57, system 376, usecases 181 lines | Preserve the role split and explicit node literals; do not introduce a factory that hides insertion order or the 40 explicit text nodes |
| Renderer/executor/summary | Existing role modules are 346–478 lines but PR-5b only removes branches | Preserve and shrink in place; no extraction is justified |
| Large tests | `validate.test.ts` 2392 lines, `StageRenderer.interaction.test.tsx` 2408, `executor.test.ts` 1446, `prompt.test.ts` 1227 | Migrate in the established behavior suites; no generic `utils.ts`/test-helper extraction during the hard cut |

## Independent Risk Probes

### INV — invariant and fail-safe risks

#### RISK-INV-001 — Core and tool retirement can diverge

- Evidence: core admission is derived from `component-nodes.ts:6-32`; tool
  admission is independent at `executor-registry.ts:101-478`; clean rejection
  is implemented at `executor-input.ts:108-119`.
- Required resolution: remove both registries/routes in the same atomic change,
  preserve `Object.hasOwn`, and add a looped three-type defeat test proving zero
  patches, unchanged shadow, and no “removed by validation” fallback.

#### RISK-INV-002 — Stale containers could accidentally unwrap children

- Evidence: the correct unknown path is `brick-render-registry.ts:93-103` then
  `renderer-render.tsx:616-619`, before child traversal at `:620-640`.
- Required resolution: stale raw section/card/emptyState nodes render `null` as
  whole subtrees; valid siblings remain. Test no throw, no retired child text,
  and no retired DOM semantics.

#### RISK-INV-003 — Type-only box rewrites lose styling

- Evidence: retired renderers merge component defaults/recipes at
  `brick-renderer-layout.tsx:40-45,91-98` and
  `brick-renderer-data.tsx:256-265`; a box resolves only box recipes at
  `renderer-render.tsx:485-510`.
- Required resolution: bake only closed token names into explicit box/text
  styles, delete retired recipes, add no alias or cross-recipe lookup, and test
  exact native structure/tokens plus zero raw scalar styles.

#### RISK-INV-004 — Empty-state action could double-dispatch

- Evidence: the old action is attached only to a synthesized native button at
  `brick-renderer-data.tsx:266-303`; pressable boxes also bubble clicks.
- Required resolution: the reference root has no action fields; only its child
  Facet button owns `onPress`. Assert structure and exactly one dispatched action.

#### RISK-INV-005 — The semantic downgrade includes native button keyboard behavior

- Evidence: old emptyState emits `<button>` (`brick-renderer-data.tsx:285-303`),
  while surviving Facet button uses the shared pressable root
  (`brick-renderer-layout.tsx:137-180`, `renderer-hold.tsx:322-359`), currently a
  `div role="button"` without Enter/Space handlers.
- Required resolution: do not silently describe the downgrade as headings only.
  The recommended PR-5b scope explicitly accepts/defer this keyboard parity gap;
  repairing the shared button is a separate accessibility change. This waiver
  must be called out in the final spec approval request.

#### RISK-INV-006 — Partial data migration fail-softs into missing UI

- Evidence: composition inspection refuses unknown types at
  `composition-validation.ts:158-175`; runtime skips unusable documents at
  `runtime/src/assets.ts:309-374`; quickstart goldens are pinned at
  `guide.test.ts:97-133`.
- Required resolution: migrate core, all references/hints, seeds, and consumers
  before combined typecheck; assert every default composition and the seed
  validate with zero issues.

### API — public surface and consumer risks

#### RISK-API-001 — Public node union hard deletion

- Evidence: `component-nodes.ts:48-68,214-246`, `nodes.ts:417-429`, and public
  barrel `index.ts:2`.
- Required resolution: remove interfaces/arms/roster with no alias; exact-union
  tests and changeset document the breaking migration.

#### RISK-API-002 — Container narrowing must preserve form

- Evidence: public `ContainerNode`/`isContainer` at `nodes.ts:423-429`; root
  validation uses it at `tree-validation.ts:299-301`; append/root replacement
  uses it at `executor-node.ts:47-55,123-136`.
- Required resolution: final container union is `BoxNode | FormNode`; prompts
  say box/form. Preserve the existing buffer policy (special forward-reference
  candidate becomes box-only; PR-5b does not add form buffering).

#### RISK-API-003 — Catalog and tool-schema rosters can drift

- Evidence: `catalog-types.ts:9-31`, `catalog-defaults.ts:13-61`,
  `agent-tools/src/specs.ts:8-52`, and exhaustive executor registry.
- Required resolution: narrow all rosters together; migrate every custom catalog
  fixture; assert retired types are absent.

#### RISK-API-004 — Public theme recipe key union narrows

- Evidence: `theme-types.ts:107-115`, runtime validation at
  `theme-recipe-validation.ts:298-325`, public React `resolveRecipe` via
  `react/src/index.ts:3`.
- Required resolution: delete default keys, let public union derive narrower,
  and test stale external theme keys warning-drop. `RecipePartName` remains.

#### RISK-API-005 — Composition metadata narrows

- Evidence: public `CompositionMetadata` at `composition-validation.ts:59-75`
  and duplicated sanitizer union at `:299-331`.
- Required resolution: `preferredParent` becomes `"root" | "box"`; migrate all
  15 production hints; keep a deliberate invalid retired-value negative test;
  `composedOf` narrows automatically with `FacetNode`.

#### RISK-API-006 — Exported default composition data changes structure

- Evidence: exported array at `assets/src/index.ts:2` and
  `compositions.ts:10`; current card/empty-state definitions at `:44-65,342-369`.
- Required resolution: preserve names, replace internals with native nodes, add
  generic `section`, assert 22 valid references and zero retired node types.

#### RISK-API-007 — Exhaustive consumers and stale data need distinct outcomes

- Evidence: React/tool/summary/playground registries listed above.
- Required resolution: remove all exact arms; validated authoring rejects,
  renderer skips whole stale subtrees, and stage summary reports unknown.

#### RISK-API-008 — Seed and shipping documentation can drift

- Evidence: quickstart has 18 retired seed nodes; goldens at
  `guide.test.ts:108-132`; documentation inventory above.
- Required resolution: native seed rewrite creates exactly 40 explicit text
  nodes and regenerates order/length/hash; final docs describe reference names,
  not retired node kinds.

### PKG — package/build/publish risks

#### RISK-PKG-001 — Ownership/dependency direction drift

- Evidence: package roles in `AGENTS.md:54-64`; core package has no dependencies;
  assets/agent-tools depend only on core; React depends on assets/core.
- Required resolution: no manifest/lockfile/dependency change; contracts stay in
  core, default data in assets, rendering in React, prompts/tools in agent stack.

#### RISK-PKG-002 — Partial cross-package cutover can silently drop defaults

- Evidence: assets are typed against core and runtime loads fail-soft; quickstart
  ships a separate seed.
- Required resolution: WUs may run scoped tests, but all WUs form one indivisible
  typecheck unit; combined typecheck runs only after every WU lands.

#### RISK-PKG-003 — Published artifacts need a complete changeset

- Evidence: six changed packages publish built `dist`; PR-5a changeset precedent
  uses minor for core/assets/react/agent-tools and patch for reference-agent/
  quickstart.
- Required resolution: same six-package bump classes unless final diff proves an
  additional published package changed; run `pnpm package:smoke` at the gate.

#### RISK-PKG-004 — Existing composition hard-cut scanner does not detect PR-5b syntax

- Evidence: scanner roots are `scripts/check-composition-hard-cut.mjs:8-14`, but
  patterns at `:16-100` target the retired composition-expansion API, not these
  node types.
- Required resolution: because `card`/`section` remain legal reference names,
  do not add a broad word ban. The PR-5b gate adds exact syntax/symbol `rg` probes
  and classifies remaining test negatives, while still running the existing
  scanner to preserve the previous hard cut. A scanner extension is optional
  only if it remains syntax-aware and can preserve legal reference names.

#### RISK-PKG-005 — Canonical build omits playground; quickstart makes Tier 2 blocking

- Evidence: root build filters public packages; playground owns a separate Vite
  build. `AGENTS.md` makes Tier 2 mandatory when quickstart changes.
- Required resolution: explicitly typecheck/build playground, build quickstart,
  run package smoke, and run live-test Tier 2 with `OPENAI_API_KEY`.

### SHAPE — module/scaffold risks

#### RISK-SHAPE-001 — `compositions.ts` would grow past its current large literal

- Evidence: 737 lines plus 25 new explicit text nodes; existing private sibling
  `composition-chart-table.ts` demonstrates a role-specific extraction pattern.
- Required resolution: add private `composition-containers.ts` containing the
  three canonical container-pattern references. Import constants into
  `DEFAULT_COMPOSITIONS`; do not export the sibling through the package barrel.

#### RISK-SHAPE-002 — Empty layout validator would become dead scaffold

- Evidence: all 57 lines of `component-validation-layout.ts` serve only section
  and card.
- Required resolution: delete the file and remove the `layout` role route; do not
  leave an empty module.

#### RISK-SHAPE-003 — Seed factories could hide deterministic ordering

- Evidence: role-based guide files and exact order/hash tests already define the
  scaffold.
- Required resolution: preserve explicit records in the four guide modules;
  insert title/body text nodes beside each converted box and regenerate goldens.

#### RISK-SHAPE-004 — Large test suites invite unrelated extraction

- Evidence: several affected suites exceed 1,000 lines, but each already owns the
  relevant public behavior.
- Required resolution: targeted in-place fixture/test migration only; no generic
  helper extraction, public/private boundary change, or directory creation.

## Stage 0 Verdict

`GO` for spec writing, with one owner-visible approval item:

- PR-5b should defer the existing Facet `button` Enter/Space parity issue and
  explicitly accept that the empty-state migration loses the old native-button
  keyboard behavior. Expanding PR-5b to repair the shared button would be a
  materially different feature and is not recommended for this atomic cutover.
