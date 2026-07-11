# Context Evidence: Component Model + Renderer Layout Contract (Canonical Summary)

> Canonical summary of the `/spec-bridge` context pass for
> `specs/feature-intake/component-model-and-layout-contract.md`. The
> compatibility evidence gathered here informed a dual legacy/new API design
> that `specs/dev-specs/composition-canonicalization.md` later superseded — the
> legacy expansion/alias family was removed entirely before release. The
> intrinsic-criteria and renderer-layout evidence below remains the record of
> why those decisions were made.

## Baseline

- Branch: `main`, equal to `origin/main` before this spec work; the full
  mechanical gate (typecheck, test, lint, format:check, build) passed.
- `PATH=/opt/homebrew/bin:$PATH` is required in this workspace because the
  repo expects pnpm 9.12.0 while the default PATH resolves pnpm 11.7.0.

## Intrinsic Vocabulary Evidence

- `packages/core/core/src/nodes.ts` owned the closed node vocabulary: the
  primitives `box`, `text`, `media`, `field`, plus existing higher-level nodes
  (`button`, `section`, `card`, `tabs`, `table`, `chart`, `stat`, `badge`,
  `progress`, `alert`, `list`, `divider`). The vocabulary grows only through
  typed node shapes plus matching validation and renderer support — evidence
  that new intrinsics must be added explicitly across types, validation,
  catalog, renderer, and tests, and that catalog/assets must never register
  tenant intrinsics.
- `packages/core/core/src/theme.ts` exposed style-only `recipes`; structural
  operator definitions therefore needed a distinct name (`compositions`), and
  validators must reject structural data placed under recipes.
- `packages/core/core/src/validate.ts` was already ~1500 lines of centralized
  sanitizer switches, so component-node validation was planned as
  role-specific sibling modules rather than more giant-switch growth.
- `packages/core/runtime/src/assets.ts` was the single boot-time gate that
  loads raw operator documents and validates through core without throwing —
  the right immutable-asset boundary for composition definitions.
- `stat` was a persisted stage node and default-asset value; a hard rename
  would have silently dropped existing stages. Decision: add `metric` as the
  canonical noun and keep `stat` as a legacy node alias.

## Renderer Layout Evidence

- `packages/core/react/src/StageRenderer.tsx` (~2000 lines) applied live
  patches through a raw local coercion path before render — every intrinsic
  must validate, render, and survive this live path fail-safely, so renderer
  tests need both validated and live-patch cases.
- `packages/core/react/src/brick-renderers.tsx` centralized renderers and
  defaulted unknown nodes to `null` (fail-safe skip, never throw).
- `packages/core/react/src/theme.ts` owned token→CSS conversion with partial
  scroll containment, but **no shared child-root containment contract applied
  to every primitive/component root** — the direct evidence for a centralized
  layout contract: renderer-owned `box-sizing`, `min-width: 0`,
  `max-width: 100%`, wrapping, bounded media, and explicit scroll ownership,
  implemented as private helpers (`layout-contract.ts`) plus hostile-content
  tests, not documentation alone.
- Containment rule confirmed: parent owns immediate-child placement; child
  owns internal layout within parent bounds; renderer owns clipping/bounds; no
  general absolute/fixed positioning (overlays deferred to a dedicated
  constrained intrinsic).

## Consumer Sweep (summary)

Sweeps across `packages`, `apps`, `docs`, and the intake brief showed the
public vocabulary and catalog terms spread across core, assets, runtime,
react, agent-tools, reference-agent, quickstart, bridge, docs, and tests —
so vocabulary, validation, catalog, renderer, prompt, and docs had to migrate
together, serially, with core as the single source of truth.

## Risk Themes That Shaped the Design

- Every intrinsic added explicitly and exhaustively: core types, validation,
  catalog/spec, renderer dispatch (including the live path), theme recipes,
  prompt summaries, and tests (RISK-INV-001/002, RISK-PKG-004).
- Composition definitions validated as data assets in core, loaded via runtime
  as immutable snapshots, expanded server/runtime-side into ordinary validated
  nodes — never executed in the browser (RISK-INV-003, RISK-PKG-005).
- `form`/`search`/`filterBar` schemas reuse `FacetAction` and field collection
  only; no fetch/data-binding/expression props (RISK-INV-007).
- Theme `recipes` stay style-only; structural data under recipes is rejected
  (RISK-INV-005, RISK-API-5).
- Module shape: role-specific core validation siblings, a private React
  `layout-contract.ts`, focused new test files instead of growing oversized
  ones (RISK-SHAPE-001/002/006).

## Superseded Compatibility Evidence

The sweep also catalogued the pre-existing expansion-macro API family (its
validator/expander exports, catalog dual fields, `.json` asset suffix, SDK
method, and agent tool name) as public compatibility surfaces, and the context
pass chose an additive migration that preserved them as legacy aliases
(RISK-API-1..4, RISK-PKG-002). That evidence was accurate but is now
historical: since nothing had shipped, `composition-canonicalization` deleted
the legacy family and made the canonical composition contract the only
surface — one validator, `expandComposition`, required `catalog.compositions`,
`*.composition.json` files, the `use_composition` tool, `Stage.useComposition`,
and a Postgres `compositions` JSONB column. See
`specs/dev-specs/composition-canonicalization.md` and
`specs/context/composition-canonicalization.md` for the authoritative current
evidence.
