# Spec QA Gates (Facet)

The reviewer evaluates every gate independently and returns a table:
`gate | status (PASS/FAIL) | evidence | blocking (YES/NO)`.
Any blocking FAIL → overall spec status FAIL.

## Gate 1 — Section Completeness
PASS: all required spec sections exist with concrete (non-placeholder) content —
including `Shared Preflight`, `Invariant Fit Audit`, `Risk Register`, the WU list,
`Execution Order`, and the feature final gate chain
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
- #3 fail-safe: the renderer/validator behavior on malformed/empty/deep/cyclic
  input is specified and never throws or injects.
- #4 declarative: no raw HTML/JS/CSS/pixel escape hatch is introduced.
- #5 overlay: any floating UI is a dedicated, constrained brick — not a general
  z-index/overlap capability.
- #6 two-writers: if the browser executes interactions locally, the spec defines
  how the server-authoritative stage stays coherent (ordering / version / echo).
FAIL: any `TOUCHES` invariant is hand-waved, or any invariant is silently broken.

## Gate 4 — Fail-safe & Boundary Coverage
PASS: the spec's boundary checklist covers malformed/empty/deep/cyclic input,
offline agent, and rapid/racing events, and each has a test in some WU `test_plan`.
FAIL: a fail-safe boundary is claimed but untested, or a boundary is missing.

## Gate 5 — Public API Compatibility
Apply when a published `@facet/*` surface changes.
PASS: additive vs breaking is stated; every existing consumer (other packages,
`apps/playground`, `examples/`) has a migration or is confirmed unaffected (grep
evidence). `@facet/core` stays browser-safe/node-free; barrel exports preserved.
FAIL: a breaking change with no consumer migration, or a core/barrel/boundary
violation.

## Gate 6 — Test Traceability
PASS: every `DC-*` maps to ≥1 test; ≥1 boundary/error test exists; each WU has a
non-empty `test_plan` (type/target/covers_dc/action); the union of
`test_plan.covers_dc` covers every `DC-*`.
FAIL: a `DC-*` is uncovered, or any WU has an empty/missing `test_plan`.

## Gate 7 — Work Unit Decomposition Quality
PASS: each WU ≤ 5 files; every file assigned to exactly one WU (no orphans);
paths match context evidence; dependencies acyclic; each WU has an independently
verifiable DoD with commands and a no-regression check; parallel groups share no
writable files; the manifest matches the spec, including `final_gate_chain`; an
implementer could delegate without further design decisions.
FAIL: any of the above is violated.

## Gate 8 — TDD-First Enforcement
PASS: every WU touching non-test/non-docs production files declares a concrete
`red_check` (a real test target, expected FAIL→PASS, distinct from
no-regression checks) and a `RED→GREEN evidence` DoD item; deletion/docs/move-only
WUs carry `red_check: N/A` with a valid one-line justification; every WU's
`handoff_format` includes `refactor_decision` + `green_diff_summary`; spec and
manifest agree on each `red_check`.
FAIL: a prod-code WU lacks a real `red_check`, or `N/A` is used on a file that
isn't pure deletion/docs/move (enumerate the offending files), or spec/manifest
disagree.

## Gate 9 — Risk Resolution
Apply when Stage 0 produced any `RISK-*`.
PASS: every `RISK-INV-*` / `RISK-API-*` / `RISK-PKG-*` has an addressed
resolution row (or an explicit owner-acknowledged waiver) in the spec's Risk
Register.
FAIL: any `RISK-*` silently dropped.

## Output rule
Return the gate table plus explicit call-outs for: spec/manifest mismatches, any
`TOUCHES` invariant lacking a concrete design (Gate 3), and any WU lacking a real
`red_check` (Gate 8). If any blocking gate is FAIL, the spec is FAIL.
