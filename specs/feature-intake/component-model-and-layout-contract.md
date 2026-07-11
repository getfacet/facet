# Feature Intake Brief: Component Model + Renderer Layout Contract (Canonical Summary)

> Canonical composition-only summary of the owner-approved 2026-07-10 brief.
> The feature shipped on this branch. The original brief also specified a
> compatibility/migration design (legacy aliases, dual catalog fields, a legacy
> expansion API kept alongside the new one); that design was superseded before
> release by `specs/dev-specs/composition-canonicalization.md`, which removed
> the legacy family entirely and made `composition` the one canonical
> operator-extension surface. The product decisions below remain authoritative.

## Approved Product Decisions

- The agent-facing model is **Primitive Brick -> Component -> Catalog**. Agents
  choose meaningful UI nouns from a catalog instead of reasoning about internal
  vocabulary categories.
- Primitive bricks stay exactly `box`, `text`, `media`, and `field` — the
  universal fallback and lowest-level safe composition layer. They are never
  removed.
- Component implementation splits internally into:
  - **intrinsic components** — Facet/platform-managed capabilities the
    renderer and validator directly understand; part of the closed vocabulary;
  - **compositions** — operator/tenant-defined components built only from
    allowed primitives and components, loaded as declarative data assets.
- Hosted tenants can define compositions only, never intrinsics or renderer
  code. Intrinsics grow only deliberately in `@facet/core`.
- A renderer layout contract applies one containment rule to every primitive
  and component root: parent owns immediate-child placement, child owns its
  internal layout, and the renderer owns clipping/bounds.
- Theme `recipes` remain style recipes; structural operator definitions are
  `compositions`, a distinct surface.

## Intrinsic Component Criteria (all required)

A component becomes intrinsic only when it passes all five criteria. The test
is not "could primitives build this?" — it is whether the noun should be
standardized so every agent can use it safely and consistently.

1. **Generic UI noun:** appears across many apps/domains; not a
   business-specific, brand-specific, or page-template concept.
2. **Closed schema:** describable with bounded declarative props, token styles,
   and existing action semantics; no raw code, arbitrary CSS, backend binding,
   or expression language.
3. **Renderer-owned value:** the renderer/validator adds real value by owning
   semantics/accessibility, structured data rendering, interaction rules,
   containment/responsive behavior, or consistent fail-safe behavior.
4. **Invariant-safe:** preserves declarative/token-only output, flow-only
   layout, fail-safe rendering, and agent-owned backend work.
5. **Stable vocabulary:** the name is likely to remain a durable UI word in the
   spec, prompt, catalog, docs, and tests.

Compositions cover everything else: domain-specific patterns, brand-specific
patterns, app/page templates, and repeated operator-local assemblies.

| Intrinsic noun | Composition example         |
| -------------- | --------------------------- |
| `form`         | `signupForm`, `billingForm` |
| `table`        | `invoiceTable`              |
| `card`         | `pricingCard`               |
| `emptyState`   | `noInvoicesYetState`        |
| `keyValue`     | `customerDetailsPanel`      |

## Locked v1 Intrinsic Set

`button`, `section`, `card`, `divider`, `tabs`, `nav`, `form`, `search`,
`filterBar`, `table`, `chart`, `list`, `keyValue`, `metric`, `progress`,
`badge`, `alert`, `emptyState`, and `loading`.

`metric` is the canonical KPI/stat noun; `stat` remains a legacy node alias.

Deferred from v1: `modal`, `drawer`, `menu` (need a separate constrained
overlay design), `timeline`, `steps` (validate through composition first),
`calendar`, `kanban` (complex domain surfaces), and `appShell` (a template,
better expressed as a composition over `nav`/`section`/`card`/primitives).

## Composition Boundary

- Compositions reference only allowed primitives/components; no raw HTML, JS,
  CSS, pixel values, arbitrary colors, arbitrary positioning, arbitrary
  z-index, or client-side fetch/data binding.
- Invalid, disallowed, or too-large definitions are rejected/skipped with
  bounded issues; the page keeps rendering (fail-safe).
- Expansion happens server/runtime-side into ordinary validated nodes; the
  browser never executes or receives composition definitions.
- `@facet/assets` may ship example/demo compositions for quickstart guidance,
  but the default supported UI nouns are intrinsic components — no hidden
  default structural library.

## Renderer Layout Contract Decisions

- Containment is renderer-owned and applied to every primitive/component root:
  `box-sizing`, bounded width (`max-width: 100%`), `min-width: 0` where
  needed, wrapping, and no general absolute/fixed positioning.
- Long text, media, charts, tables, progress bars, and nested components never
  widen the page or escape parent bounds except inside explicit renderer-owned
  scroll regions.
- Override discipline: parent layout settings affect placement of immediate
  children; child-selected layout/variant/style affects only the child's own
  root/internal layout within the parent's bounds.
- Malformed components, unknown names, and hostile nested definitions never
  throw and never inject; they reject, skip, or degrade to plain UI.

## Invariant Fit (summary)

All seven Facet invariants were audited and hold: components are UI-only
(data supplied by the agent; backend work stays in agent tools), Facet
provides mechanism while operators choose catalog policy, validation and the
renderer stay fail-safe, output stays declarative and token-only, layout stays
flow-only (overlays deferred), interactions reuse existing `agent`/`navigate`/
`toggle`/field-collect semantics, and no client-side domain fetch exists.

## Superseded Compatibility Decisions

The original brief assumed an additive migration: legacy vocabulary aliases,
dual-read catalog fields, and the pre-existing expansion-macro API preserved
next to the new composition surface. Because nothing had been released, the
follow-up `composition-canonicalization` spec removed that entire legacy
family: one composition validator in core, one `compositions` field across
catalog/assets/runtime/Postgres, the `use_composition` tool, and
`Stage.useComposition` in the SDK. For the current API, see
`specs/dev-specs/composition-canonicalization.md` and its execution manifest.
