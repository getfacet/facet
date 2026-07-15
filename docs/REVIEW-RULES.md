# Facet Review Rules

The shared rubric for `/verify`, `/code-review`, `/live-test`, and
`/refactor-audit`. Right-sized for a small TypeScript monorepo — rigorous, not
bureaucratic.

## Invariants (a violation is at least P1)

1. **Declarative closed vocabulary.** Agents/consumers emit only
   `@facet/core`-validated bricks with **token** style values — never raw
   HTML/JS/CSS, never raw scalars, never absolute positioning. The complete
   roster is `box`, `text`, `media`, `input`, `richtext`, `table`, `chart`,
   `list`, `keyValue`, `progress`, and `loading`; only `box` is a container.
   Theme recipes may only select validated tokens. Composition references are
   concrete native-node datasets an agent may
   read, not stage syntax or an authoring tier. Bypassing core validation or
   admitting arbitrary markup is an invariant violation.
2. **Patches-only + fail-safe.** Stage changes travel as RFC 6902 patches; the
   *same* pure `applyPatch` runs on server and client. The renderer/validator is
   fail-safe — unknown/dangling/invalid input is dropped or skipped, **never
   thrown on**, never rendered broken.
3. **Scope boundary.** In scope: spec, patch protocol, runtime, renderer,
   transports, agent SDKs/CLI/bridge. Out of scope (must stay pluggable behind
   interfaces): the agent *brain* (LLM/rules) and distributed/scale infra
   (`StageStore`/`Sink` adapters, fan-out).
4. **Package hygiene.** `@facet/core` depends on nothing. Dependencies flow one
   way (everything → core; nothing → `apps/playground`). Barrel exports only.
   Browser-safe entry points must not import Node built-ins (`node:*`).

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

A theme recipe may style a validated brick but cannot add behavior or fields. A
composition-reference read may return only a validated concrete native dataset
and must not itself emit stage messages or patches. Treat any path that accepts
unvalidated nodes, raw markup, raw scalar styles, client-side business logic on
display bricks, or absolute positioning as at least P1.

Renderer layout containment is part of the contract. Parent owns placement,
child owns internal layout, and renderer owns containment. A brick renderer
that lets a child push horizontal width, overlap siblings, or escape its parent
without an explicit bounded scroll region is at least P1.

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
- **edge** — error handling, the fail-safe boundaries (`validateTree`,
  `StageRenderer`), empty/malformed input, lifecycle/cleanup.
- **security** — the "safe by construction" claims, untrusted input (LLM output,
  client-supplied `visitorId`, `--dangerously-skip-permissions`), injection, CORS.
- **concurrency** — races (same-visitor events, runtime stage), the bridge queue
  + persistent generator handshake (deadlock/ordering), timeouts, resource leaks.
- **consistency** — duplication, cross-package drift, dev-vs-published resolution
  (`publishConfig`/`exports`), barrel usage, naming, docs/prompts that omit the
  exact 11-brick roster, describe composition references as a functional node
  tier, or retain retired component-tier APIs/data shapes. Reference lookup is
  optional and separate from node authoring.
- **test-gaps** — changed behavior without a test; critical pure logic
  (`validateTree`, `applyPatch`, `Stage`, stores, `createSerialQueue`) losing
  coverage; untested testable surface (`@facet/cli`); tautological
  tests.

## `/refactor-audit` dimensions

- **duplication** — same logic/spec/string in >1 place (e.g. the LLM stage spec).
- **boundaries** — dependency direction, misplaced code (protocol types outside
  core, reusable code stuck in `apps/playground`), leaky abstractions.
- **dead code** — unused exports/files/branches; orphans after a refactor.
- **hygiene** — package.json uniformity (`publishConfig`/`exports`/`sideEffects`),
  test-coverage gaps on pure logic, doc drift vs every published package (+
  the unpublished playground app).
- **naming** — misleading names, inconsistent conventions.

## Commands

Run the canonical mechanical gate with `pnpm verify`: typecheck, tests, lint,
format-check, build, and a source NUL-byte scan. Use the individual commands only
for scoped diagnosis. Composition hard cuts also run
`node scripts/check-composition-hard-cut.mjs`: shipping source, docs, package
READMEs, fixtures, and current changesets must contain no retired symbol, data,
or functional-tier claim. Historical `specs/**` are archival. Only an intentional
negative in a test or fixture may use the scanner's exact annotation; annotations
cannot waive production code or documentation.
