# Dev Spec: Component Model + Renderer Layout Contract (Canonical Summary)

> Canonical summary of the completed spec. Mirror of
> `specs/dev-specs/component-model-and-layout-contract.execution.yaml`. The
> intrinsic-component and renderer-layout work described here shipped on this
> branch. The spec's compatibility layer (legacy aliases, dual catalog fields,
> the preserved legacy expansion API) was superseded before release by
> **`specs/dev-specs/composition-canonicalization.md`**, which is the
> authoritative spec for the current composition contract.

## Overview

- Feature slug: `component-model-and-layout-contract`
- Intake brief: `specs/feature-intake/component-model-and-layout-contract.md`
- Context evidence: `specs/context/component-model-and-layout-contract.md`
- Affected packages: `@facet/core`, `@facet/runtime`, `@facet/react`,
  `@facet/assets`, `@facet/agent-tools`, `@facet/reference-agent`,
  `@facet/quickstart`, `@facet/bridge`
- Delivered approach: `@facet/core` is the source of truth for primitive
  bricks, intrinsic component names, caps, catalog normalization, and
  composition validation. Compositions are validated as data assets and
  expanded server/runtime-side into ordinary validated nodes. `@facet/react`
  gained private renderer-owned containment helpers so parent placement, child
  internal layout, and bounded overflow rules are enforced consistently.

## What Shipped (completed Work Units)

| WU    | Scope                                                                                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WU-1  | Core intrinsic vocabulary: primitive/intrinsic constants, new intrinsic node interfaces, `MetricNode` with `stat` as a legacy node alias, renderable-content detection, and a private `component-validation.ts` sibling with focused tests. |
| WU-2  | Core validation integration plus a public composition-definition validator distinct from theme recipes, with hostile-input tests (raw HTML/JS/CSS/data-binding rejection, caps, safe normalization). |
| WU-3  | Catalog and theme component surface: component-facing catalog shape, default intrinsic catalog, and theme recipe coverage for the intrinsic set.                                    |
| WU-4  | Runtime composition asset loading: runtime asset stores provide composition definitions as validated immutable assets through the single `loadAssets` gate.                         |
| WU-5  | React intrinsic rendering and layout contract: renderers for `nav`, `form`, `search`, `filterBar`, `keyValue`, `metric`, `emptyState`, `loading`; private `layout-contract.ts` containment helpers; hostile-content layout tests. |
| WU-6  | Default assets: default style recipes for the intrinsic set with `metric` preferred; no hidden default structural component library.                                                |
| WU-7  | Core `STAGE_SPEC` and agent-tools schemas teach Primitive Brick -> Component -> Catalog, the locked intrinsic set, the composition boundary, and the layout contract.               |
| WU-8  | Prompt consumers (agent-tools prompt kit, reference-agent, quickstart, bridge) migrated to component-first, primitive-fallback language.                                            |
| WU-8a | Reference-agent stage summaries cover the new intrinsic components with bounded output.                                                                                             |
| WU-9  | Docs: intrinsic criteria, component/composition boundary, and renderer layout contract in README/ARCHITECTURE/PACKAGE-BOUNDARIES/REVIEW-RULES.                                      |

## Preserved Design Decisions

- **Locked v1 intrinsic set:** `button`, `section`, `card`, `divider`, `tabs`,
  `nav`, `form`, `search`, `filterBar`, `table`, `chart`, `list`, `keyValue`,
  `metric`, `progress`, `badge`, `alert`, `emptyState`, `loading`. Overlays
  (`modal`, `drawer`, `menu`) and `timeline`/`steps`/`calendar`/`kanban`/
  `appShell` stay deferred.
- **Intrinsic criteria:** generic UI noun, closed schema, renderer-owned
  value, invariant-safe, stable vocabulary — all five required.
- **Composition boundary:** operator/tenant definitions reference only allowed
  primitives/components; no raw markup/code/styles/fetch; validated at asset
  load; expanded server/runtime-side; never executed in the browser; theme
  `recipes` stay style-only.
- **Renderer layout contract (DC-007..009):** renderer-owned containment on
  every primitive/component root — `box-sizing`, `min-width: 0`,
  `max-width: 100%`, wrapping, bounded media, no absolute/fixed positioning;
  parent owns immediate-child placement; child owns internal layout within
  parent bounds; overflow only inside explicit renderer-owned scroll regions;
  enforced by private `packages/core/react/src/layout-contract.ts` helpers and
  `component-layout.test.tsx` hostile-content tests.
- **Fail-safe (DC-010):** malformed/unknown/hostile components and
  composition definitions never throw and never inject — they reject, skip, or
  degrade with bounded issues, on both the validated and live-patch render
  paths.
- **No backend leak (DC-012):** `form`/`search`/`filterBar` reuse
  `FacetAction` and field collection only; data-bearing components render
  agent-supplied data.

## Superseded Compatibility Layer

DC-011 (migration/compatibility) was delivered as designed — legacy
vocabulary aliases, dual-read catalog fields, and the preserved legacy
expansion API and tool/SDK names — and then intentionally removed by
`composition-canonicalization` because nothing had been released. The current
canonical surface is: one composition validator in core, `expandComposition`,
required `catalog.compositions`, `DEFAULT_COMPOSITIONS`, `*.composition.json`
file assets, the `use_composition` agent tool, `Stage.useComposition`, and the
Postgres `compositions` JSONB column. `stat` remains only as a legacy node
alias of `metric`. For current work, consult
`specs/dev-specs/composition-canonicalization.md` and
`specs/dev-specs/composition-canonicalization.execution.yaml`.
