# Spec QA Gates (Facet)

The reviewer evaluates every gate independently and returns a table:
`gate | status (PASS/FAIL) | evidence | blocking (YES/NO)`.
Any blocking FAIL → overall spec status FAIL.

## Gate 1 — Section Completeness
PASS: all required spec sections exist with concrete (non-placeholder) content —
including `Shared Preflight`, `Invariant Fit Audit`, `Risk Register`, the WU list,
`Module Shape & Scaffold Plan`, `Execution Order`, and the feature final gate chain
(`/worktree-prep` → `/update-tests` → `/verify` → `/code-review` → `/live-test`
→ `/update-docs`) with `final_gate_owner: main-agent`.
FAIL: a required section is missing or has no actionable detail.

## Gate 2 — Cross-Section Consistency
PASS: scenarios don't contradict constraints; done criteria don't require
out-of-scope behavior; the Invariant Fit Audit doesn't contradict the WU designs;
spec and manifest agree.
FAIL: any unresolved contradiction, or spec/manifest divergence.

## Gate 3 — Invariant Fit (Facet — the load-bearing gate)
PASS: for every invariant the brief marked `TOUCHES`, the spec gives a CONCRETE
safe design, specifically —
- #1 backend/domain: nothing in `@facet/core`/renderer/protocol reaches toward
  fetch/compute/store of domain data; backend work is the agent's own tool.
- #3 fail-safe: parser/catalog/document/runtime/renderer behavior on
  malformed/empty/deep/cyclic input and trusted-component throws is specified,
  bounded, and never exposes executable input or crashes the full page.
- #4 declarative: only registered tags, declared props, quoted scalar values,
  and closed references are authored; no executable or open style/token escape
  hatch is introduced.
- #5 overlap: floating UI is owned only by the dedicated trusted modal contract,
  not a general positioning/z-index capability.
- #6 two-writers: if the browser executes interactions locally, the spec defines
  how the server-authoritative stage stays coherent (ordering / version / echo).
FAIL: any `TOUCHES` invariant is hand-waved, or any invariant is silently broken.

## Gate 4 — Fail-safe & Boundary Coverage
PASS: the spec's boundary checklist covers malformed/empty/deep/cyclic input,
offline agent, and rapid/racing events, and each has a test in some WU `test_plan`.
FAIL: a fail-safe boundary is claimed but untested, or a boundary is missing.

## Gate 5 — Public API Cutover
Apply when a published `@facet/*` surface changes.
PASS: additive vs breaking is stated; every existing consumer (other packages,
apps, examples, docs, tests, package smoke) moves or is deleted in the same
atomic cutover with grep evidence. No compatibility alias, adapter, dual
read/write, saved-document migration, or deprecated export remains.
`@facet/core` stays browser-safe/node-free and public barrels expose only the
new contract.
FAIL: an old consumer or compatibility surface remains, or a
core/barrel/boundary violation is unresolved.

## Gate 6 — Module Shape & Scaffold Fit
Apply when the spec grows a large file, touches an already-large file, creates a
new directory/scaffold, extracts helpers, or changes public/private module
boundaries.
PASS: the spec records current shape evidence, planned shape, public/private
surface, import direction, and test placement; any split uses role-specific
ownership instead of generic `utils.ts`/`helpers.ts`; any do-not-split choice has
a concrete rationale; package boundaries from `AGENTS.md` are preserved.
FAIL: line-count growth, extraction, or new scaffold is planned without
rationale; a split creates generic helper sprawl; private helpers are exposed
through barrels without Public API Impact coverage; tests do not follow the new
structure.

## Gate 7 — Test Traceability
PASS: every `DC-*` maps to ≥1 test; ≥1 boundary/error test exists; each WU has a
non-empty `test_plan` (type/target/covers_dc/action); `action` is `new` or
`update` for behavioral RED coverage and may be `verify` only for a
docs/deletion/move-only N/A WU with an executable read-only target; the union of
`test_plan.covers_dc` covers every `DC-*`.
FAIL: a `DC-*` is uncovered, or any WU has an empty/missing `test_plan`.

## Gate 8 — Work Unit Decomposition Quality
PASS: each WU ≤ 5 files; every file assigned to exactly one WU (no orphans);
paths match context evidence; dependencies acyclic; each WU has an independently
verifiable DoD with commands and a no-regression check; parallel groups share no
writable files; each relevant WU records a module-shape decision; the manifest
matches the spec, including `final_gate_chain`; an implementer could delegate
without further design decisions. If execution packets/progress resume are
used, executable commands bind the ledger to the manifest hash, enforce legal
packet/WU transitions and complete PASS evidence, reject pending dependencies,
and materialize only validated handoffs; reviewers exercise both rejection and
success paths.
FAIL: any of the above is violated.

## Gate 9 — TDD-First Enforcement
PASS: every WU touching non-test/non-docs production files declares a concrete
`red_check` (a real test target, expected FAIL→PASS, distinct from
no-regression checks) and a `RED→GREEN evidence` DoD item; deletion/docs/move-only
WUs carry `red_check: N/A` with a valid one-line justification plus an
executable read-only verification target and `test_plan.action: verify`; every WU's
`handoff_format` includes `refactor_decision` + `green_diff_summary`; spec and
manifest agree on each `red_check`.
FAIL: a prod-code WU lacks a real `red_check`, or `N/A` is used on a file that
isn't pure deletion/docs/move (enumerate the offending files), or spec/manifest
disagree.

## Gate 10 — Risk Resolution
Apply when Stage 0 produced any `RISK-*`.
PASS: every `RISK-INV-*` / `RISK-API-*` / `RISK-PKG-*` / `RISK-SHAPE-*` has an
addressed resolution row (or an explicit owner-acknowledged waiver) in the
spec's Risk Register.
FAIL: any `RISK-*` silently dropped.

## Output rule
Return the gate table plus explicit call-outs for: spec/manifest mismatches, any
`TOUCHES` invariant lacking a concrete design (Gate 3), any module-shape/scaffold
failure (Gate 6), and any WU lacking a real `red_check` (Gate 9). If any blocking
gate is FAIL, the spec is FAIL.
