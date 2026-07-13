# Refactor Spec — PR-0: Per-Brick Registry Consolidation

> Slug: `brick-registry` · Flow: **refactor** (branch `refactor/brick-registry`) ·
> Gate: `/update-tests` → `/verify` → `/code-review` → `/update-docs` (+ `/live-test`
> — touches `@facet/core` vocabulary + `@facet/react` renderer).
> Part of the node-model restructure (see memory `facet-node-model-restructure`).
> This is **PR-0**: the de-risk prerequisite BEFORE any cutover PR.

## Goal

Replace the ~13 parallel per-node-type `switch`/`Set` dispatchers scattered across
4 packages with **one registry per package**, so that adding or removing a brick
becomes a **one-entry edit per package** instead of hunting 13 files. This makes
the later cutover PRs (add `richtext`/`input`/`overlay`, remove the component
tier) a bounded, compiler-checked change instead of an error-prone sweep.

## Non-goals / HARD CONSTRAINT

- **NO behavior change.** Identical validation output, identical render output,
  identical prompt/inspect text. This is pure structural relocation of existing
  switch bodies into registry entries.
- **Do NOT** add, remove, rename, or reshape any node type or token. The
  vocabulary is untouched here — `richtext`/`input`/`overlay`/component-removal
  are PR-2…PR-6.
- **Do NOT** rewrite tests beyond mechanical import-path moves. Every existing
  test stays green unchanged. If a test would need a logic change, the refactor
  changed behavior → STOP, it is out of scope.
- Keep `@facet/core` node-free (no React/Node imports leaking in).

## The problem (evidence from `/context-scout`)

A node type's shape is asserted independently in ~13 places, each a `case` in a
different switch, with no shared source. Adding/removing one type = edit all of
them, and only two (`executor-inspect.ts` `never` guard, the React union) fail at
compile time — the rest degrade silently.

| Package | Scattered per-type surfaces |
|---|---|
| `@facet/core` | `primitive-node-validation.ts` (entry `sanitizeNode` switch) · `component-validation.ts` (4 role `Set`s + `ESTABLISHED` set + dispatch) · `component-validation-{control,data,feedback,layout}.ts` (4 role switches) · `data-binding.ts` (`resolveNodeData` switch) · `tree.ts` (`nodeRendersItself`/`hasNodeContent`) · `expand-composition-fill.ts` (`fillNode` + `nodeStringLeaves`, 2 switches) |
| `@facet/react` | `brick-renderers.tsx` (`renderBrickNode` switch) · `renderer-render.tsx` (`node.type` switch) · `renderer-motion.ts` (type fallthrough list) |
| `@facet/agent-tools` | `executor-input.ts` (`asNode` switch) · `executor-inspect.ts` (`describeNode` switch + `never` guard) · `executor-policy.ts` (component-vs-brick split) |
| `@facet/reference-agent` | `prompt/stage-summary.ts` (`summarizeNode` switch — soft, defaults to `unknown`) |

Plus: the warehouse/table types (`TableColumn`/`TableCell`/`TableRow` +
`DataCell`/`DataRow`/`Dataset`/`DataWarehouse`) are declared in
`component-nodes.ts` — the file the cutover later guts — but are consumed
tree-wide (`tree.ts`, `data-binding.ts`). They must move to a surviving module.

## Design — the registry is PER-PACKAGE (layered), not global

Dependency direction forbids one global registry: `@facet/core` depends on
nothing, so it cannot hold a React render fn or an executor handler. Therefore
**each package owns a registry keyed by the same core node-type identifiers**:

1. **Core registry** (`@facet/core`) — the type-level source of truth. One entry
   per node type declaring the *core* concerns: `validate` (or a role tag routing
   to the existing role sanitizer), `dataBearing`/`projection` (for `from`),
   `rendersItself`/`hasContent`, `fill` + `stringLeaves` (composition expansion),
   `container` flag, `established` flag. The ~6 core switches become generic
   dispatchers that look up this registry. `RECIPE_COMPONENTS`/type-union arrays
   derive from the registry keys.
2. **React registry** (`@facet/react`) — one entry per type → its renderer (+
   motion-snapshot participation). `renderBrickNode`/`renderer-render`/
   `renderer-motion` read it.
3. **Agent-tools registry** (`@facet/agent-tools`) — one entry per type →
   `{ asNode, describe, policy }`. Preserve exhaustiveness: type the registry as
   an exhaustive `Record<NodeType, Handler>` so a missing key is a **compile
   error** — this KEEPS the `executor-inspect.ts` `never`-guard safety, just
   moves it to the registry's type.
4. **Reference-agent registry** (`@facet/reference-agent`) — one entry per type →
   `summarizeNode` handler. (Soft: keep the `unknown` default.)

Net: adding/removing a brick = edit **~4 registry entries** (one per package
layer), each in an obvious single location, most compiler-enforced — down from
~13 scattered switches.

**Registries key off core's node-type identifier list**, so the core union stays
the single vocabulary source; the per-package registries must be
compile-time-exhaustive over it wherever the original switch was exhaustive.

## Work Units (one per package — each independently behavior-identical + green)

- **WU-1 `@facet/core` (largest):**
  a) Relocate the warehouse/table types out of `component-nodes.ts` into a
     surviving module (e.g. `data-types.ts`); fix all imports (mechanical).
  b) Introduce the core brick registry; convert `primitive-node-validation.ts`,
     `component-validation.ts` (+ 4 role files' dispatch), `data-binding.ts`,
     `tree.ts`, and `expand-composition-fill.ts` (both switches) to registry
     lookups. Role sanitizers keep their bodies — the registry only replaces the
     *dispatch*. `red_check: N/A` (refactor; the existing core suites are the
     safety net — they must stay green unchanged).
- **WU-2 `@facet/react`:** react renderer registry; convert `renderBrickNode`,
  the `renderer-render.tsx` dispatch, and `renderer-motion.ts` to registry
  lookups. Renderer bodies unchanged.
- **WU-3 `@facet/agent-tools`:** executor registry (`asNode`/`describe`/`policy`);
  convert `executor-input.ts`, `executor-inspect.ts`, `executor-policy.ts`.
  Registry typed exhaustively to keep the compile-time completeness guard.
- **WU-4 `@facet/reference-agent`:** `stage-summary.ts` registry; convert
  `summarizeNode`. Keep the soft `unknown` default.

WUs are independent and each keeps the whole suite green, so PR-0 MAY ship as one
PR or split into 4 per-package PRs (WU-1 first — the others key off core). Owner's
call at `/worktree-prep`.

## Do-NOT-touch

- `patch.ts` `isContainerValue` (structural `children` check, not type-based) —
  independent, leave it.
- `theme-recipes.ts` `RECIPE_PARTS` (part-name vocabulary, node-type-independent).
- Any role sanitizer BODY (control/data/feedback/layout) — only their dispatch
  moves; the validation logic is untouched.
- The edge packages (`server`/`client`/`ag-ui`/`store-postgres`/`agent`/
  `agent-client`/`cli`/`bridge`) — confirmed vocabulary-agnostic by scout; no
  registry needed.

## Test plan

- Existing suites are the oracle: `@facet/core` validate/patch/tree/data-binding/
  composition tests, `@facet/react` StageRenderer + brick-renderer tests,
  `@facet/agent-tools` executor tests, `@facet/reference-agent` stage-summary
  tests — **all must pass unchanged.**
- Add one small test per registry asserting **exhaustiveness**: every core
  node-type identifier has a registry entry in that package (guards the future
  "added a type but forgot the entry" — the whole point of PR-0).
- `pnpm verify` (typecheck/test/lint/format/build/NUL) green.

## Risks

- **Over-abstraction:** the registry entry interface must stay thin — a struct of
  the existing handlers, not a new framework. If an entry needs bespoke logic,
  keep it a function reference, don't invent a DSL.
- **Hidden behavior drift:** the risk in any dispatch move is a dropped/reordered
  case. Mitigation: exhaustive registry typing + the unchanged suites + a
  per-registry exhaustiveness test.
- **Effort:** WU-1 is large (6 core switches + a type move). Splitting per-package
  keeps each PR reviewable.

## Definition of done

Refactor hard gate: `/update-tests` → `/verify` → `/code-review` (P0–P2 = 0) →
`/update-docs`. Run `/live-test` too (touches `@facet/core` vocabulary +
`@facet/react` renderer). No behavior change ⇒ STAGE_SPEC and docs should be
`Intentionally Unchanged` with evidence (unless a type moved module changes an
import example).
