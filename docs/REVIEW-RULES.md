# Facet Review Rules

The shared rubric for `/verify`, `/code-review`, and `/refactor-audit`. Right-sized
for a small TypeScript monorepo — rigorous, not bureaucratic.

## Invariants (a violation is at least P1)

1. **Declarative bricks only.** Agents/consumers emit `box`/`text`/`image`/`field`
   nodes with **token** style values — never raw HTML/JS, never raw scalars, never
   absolute positioning. New capability = a new node type or token added *on
   purpose*, in `@facet/core`.
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
  (`publishConfig`/`exports`), barrel usage, naming.
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

`pnpm typecheck` · `pnpm test` · `pnpm lint` · `pnpm format:check` · `pnpm build`
