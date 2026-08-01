# Facet Review Rules

The shared rubric for `/verify`, `/code-review`, `/live-test`, and
`/refactor-audit`. Right-sized for a small TypeScript monorepo — rigorous, not
bureaucratic.

## Invariants (a violation is at least P1)

1. **Declarative registered markup.** Agents emit only the bounded author
   grammar validated by `@facet/core`: registered component tags, declared
   props, quoted scalar values, and explicit closed references. Raw HTML escape
   hatches, JavaScript/JSX expressions, handlers, imports, spreads, inline
   structured JSON, raw CSS, arbitrary token names, and unregistered tags are
   invariant violations.
2. **Catalog/registry trust boundary.** The immutable validated catalog and
   trusted React registry must contain exactly the same tags. The agent can
   select and compose registered components but cannot register code, mutate the
   catalog mid-session, or bypass prop schemas.
3. **Patches-only + fail-safe.** Stage changes travel as RFC 6902 patches; the
   same authorized fold runs on server and client. Author mutations reject
   atomically. Persisted corruption and component throws are bounded and
   isolated; they never crash the full renderer or expose internal details.
4. **UI boundary.** Facet owns UI-OUT and UI-IN. Backend fetches, domain
   computation, authorization, and business effects belong to host/agent tools.
   Browser-side domain fetches and arbitrary-URL data bindings are forbidden.
5. **Constrained layout and local behavior.** Authored layout is flow-contained.
   Overlap is owned only by the dedicated trusted modal contract. Intrinsic
   component behavior may stay local, but there is no general local-action,
   arbitrary-positioning, or z-index authoring escape hatch.
6. **Scope boundary.** In scope: spec, patch protocol, runtime, renderer,
   transports, agent SDKs, and Quickstart. Out of scope (must stay pluggable behind
   interfaces): the agent *brain* (LLM/rules) and distributed/scale infra
   (`StageStore`/`Sink` adapters, fan-out).
7. **Package hygiene.** `@facet/core` depends on nothing. Dependencies flow one
   way through published package barrels; private workbenches and unpublished
   experiments never become dependencies of public packages. Browser-safe entry
   points must not import Node built-ins (`node:*`).

## Severity

| | Meaning | Gate |
| --- | --- | --- |
| **P0** | Broken build, data loss, security hole, or a claimed invariant is false | must fix |
| **P1** | Incorrect under realistic conditions (a real bug, race, or wrong result) | must fix |
| **P2** | Edge case / robustness / missing test for changed behavior / should-fix | must fix |
| **P3** | Nit, style, naming, doc polish | optional (track, non-blocking) |

**`/code-review` PASS = P0–P2 = 0.** P3 are non-blocking nits — track them, don't
gate on them. (A P2 may only ship unfixed with an explicit maintainer waiver
recorded in the PR.)

Treat any path that accepts unvalidated author syntax, mismatched
catalog/registry tags, executable props, arbitrary styles/tokens, browser-side
business logic, or unconstrained positioning as at least P1.

Renderer layout containment is part of the contract. Parent owns placement,
child owns internal layout, and renderer owns containment. A registered
component that lets its subtree push horizontal width, overlap siblings, or
escape its parent without an explicit bounded scroll region is at least P1.

## Gate Profiles

- **Feature hard gate:** `/update-tests` → `/verify` → `/code-review` →
  `/live-test` → `/update-docs`.
- **Refactor hard gate:** `/update-tests` → `/verify` → `/code-review` →
  `/update-docs`; add `/live-test` if a live-link surface is touched or the owner
  requests a pre-merge/release live run.

## Evidence (required for every finding)

- `path:line` + a short quote of the offending code.
- **Why** it's wrong (the concrete failure, not "could be cleaner").
- For bugs: the input/condition that triggers it.
- No finding without evidence. A hunch is not a finding.

## `/code-review` dimensions

- **bugs** — logic errors, wrong results, null/undefined, off-by-one, incorrect state.
- **types** — `any`, unsafe `as`, missing narrowing, public API typed loosely,
  strict-mode holes (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- **edge** — parser/catalog/document/data error handling, renderer subtree
  isolation, empty/malformed input, lifecycle/cleanup.
- **security** — the "safe by construction" claims, untrusted input (LLM output,
  client-supplied `sessionKey`, `--dangerously-skip-permissions`), injection,
  CORS.
- **concurrency** — races (same-visitor events, runtime stage), TurnGate
  single-flight/dedupe/fencing/deadline release, CAS/outbox ordering, timeouts,
  resource leaks.
- **consistency** — duplication, cross-package drift, dev-vs-published
  resolution (`publishConfig`/`exports`), barrel usage, naming, catalog/registry
  mismatch, tool-count drift, or docs/prompts that retain retired authoring,
  styling, asset, event, or data surfaces.
- **test-gaps** — changed behavior without a test; critical pure logic (markup
  parser, catalog validation, document/data bounds, authorized patch/fold,
  stores, turn gates/outbox, and agent tools) losing coverage; untested public
  surfaces; tautological tests.

## `/refactor-audit` dimensions

- **duplication** — same logic/spec/string in >1 place (for example duplicated
  catalog metadata, grammar rules, or tool-result shapes).
- **boundaries** — dependency direction, misplaced code (protocol types outside
  core, reusable code stranded in a private workbench), leaky abstractions.
- **dead code** — unused exports/files/branches; orphans after a refactor.
- **hygiene** — package.json uniformity (`publishConfig`/`exports`/`sideEffects`),
  test-coverage gaps on pure logic, doc drift vs every published package and
  private/unpublished workbench boundaries.
- **naming** — misleading names, inconsistent conventions.

## Commands

The `/live-test` policy is Quickstart-centered for the public hard gate. Missing
a provider key is a failure whenever that tier is required by the changed
surface. Optional owner-run visual journeys may report a deliberate skip when
their optional capability is unavailable.

Run the canonical mechanical gate with `pnpm verify`. It runs these commands in
order:

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`
4. `pnpm format:check`
5. `pnpm build`
6. `node --test scripts/check-docs.test.mjs`
7. `node scripts/check-docs.mjs`
8. `node --test scripts/check-package-layout.test.mjs`
9. `node scripts/check-package-layout.mjs`
10. `node --test scripts/check-component-hard-cut.test.mjs`
11. `node scripts/check-component-hard-cut.mjs`
12. `node --test scripts/package-smoke.test.mjs`
13. `node --test scripts/gate-profiles.test.mjs`
14. `node scripts/check-source-nuls.mjs`

The first documentation command pins the checker; the second validates
current-document links and anchors plus explicitly marked concrete
TypeScript/TSX snippets. Review evidence must show that both commands ran in
that order and report the full check's PASS/FAIL result. A scoped documentation
check helps diagnosis but does not replace the full check. The package-layout
test/check pair, package-smoke inventory regression, gate-profile regression,
and source NUL scan are likewise part of `pnpm verify`, not optional follow-ups.

The component-markup hard-cut regression suite runs immediately before the
scanner. Shipping source, docs, package READMEs, fixtures, and current
changesets must contain no retired symbol, data, or functional-tier claim.
Ephemeral plans live only under the gitignored `.agents/work/<slug>/` path and
are outside repository documentation. A committed root `specs/`, `docs/specs/`,
or `docs/comparisons/` path is a layout failure. Only an intentional negative in
a test or fixture may use the scanner's exact annotation; annotations cannot
waive production code or documentation.
