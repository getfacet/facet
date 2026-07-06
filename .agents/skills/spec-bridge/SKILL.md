---
name: spec-bridge
description: >
  Translate an approved Facet feature-intake brief into an executable development
  spec and execution manifest using Codex steps: context pass, risk probes, spec
  writing, gate review, and bounded fix loop. Stops at an approvable plan before
  implementation. Use before coding, after /feature-intake approval, or when the
  user asks for /spec-bridge. Do not invoke Claude Workflow().
---

# Spec Bridge (Facet)

Convert an approved product brief into two files:

- `specs/dev-specs/<slug>.md`
- `specs/dev-specs/<slug>.execution.yaml`

Codex runs this directly. Do not call `Workflow(...)`; do not use
`.claude/workflows/**`; do not start implementation.

## Required Context

Read these before writing:

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/REVIEW-RULES.md`
4. `specs/feature-intake/<slug>.md`
5. `.agents/skills/spec-bridge/templates/dev-spec.md`
6. `.agents/skills/spec-bridge/references/execution-manifest-template.yaml`
7. `.agents/skills/spec-bridge/references/spec-qa-gates.md`

## Pick The Slug

Determine `<slug>` from the approved intake brief in
`specs/feature-intake/<slug>.md`. If multiple briefs match and the user did not
name one, ask a concise question before proceeding.

Stop if the brief is missing or not approved; run `/feature-intake` first.

## Stage 0 — Context And Risk Evidence

Create or update `specs/context/<slug>.md` with evidence, not guesses.

Gather:

- affected packages and entrypoints
- package READMEs when present
- existing tests near the planned behavior
- current public API exports if a published surface may change
- consumers via `rg`/`git grep` for changed symbols or strings

Record risks with stable IDs:

- `RISK-INV-*` — Facet invariant risks
- `RISK-API-*` — public API or consumer migration risks
- `RISK-PKG-*` — package boundary, dependency, build, or publish risks

If Codex subagents are available, you may run separate risk-probe passes for INV,
API, and PKG. If unavailable, do the probes inline. The main agent owns the final
context file.

## Stage 1 — Write Spec And Manifest Together

Use the templates. Keep the spec and manifest synchronized.

The spec must include:

- overview and affected packages
- Done Criteria mapping from every `DC-*`
- Invariant Fit Audit for every touched invariant
- fail-safe and boundary checklist
- Risk Register resolving every `RISK-*`
- Public API Impact
- Shared Preflight
- Work Units
- Execution Order
- Final Gate Chain with `final_gate_owner: main-agent`

The execution manifest must mirror the Work Units exactly:

- same WU IDs and titles
- same files
- same dependencies and parallel groups
- same `red_check`, quick checks, no-regression checks, and test plan

Work Unit rules:

- each WU touches at most 5 files
- each file belongs to exactly one WU
- production-code WUs need a real `red_check` that fails before implementation
  and passes after implementation
- `red_check: N/A` is allowed only for docs, deletion-only, or move-only WUs with
  a concrete justification
- parallel WUs must have disjoint writable files

## Stage 2 — Gate Review

Review the draft against
`.agents/skills/spec-bridge/references/spec-qa-gates.md`.

Produce a gate table:

`gate | status | evidence | blocking`

Any blocking FAIL means the spec is not approvable.

Review specifically for:

- all `DC-*` traced to implementation and tests
- spec/manifest consistency
- concrete invariant mitigations
- fail-safe and boundary test coverage
- public API consumer migration evidence
- WU decomposition quality
- TDD-first enforcement
- all `RISK-*` resolved or explicitly waived

## Stage 3 — Bounded Fix Loop

If the gate review finds P0/P1 or blocking failures:

1. Fix the spec and manifest together.
2. Re-run the full gate review.
3. Repeat at most 3 rounds.

If blocking failures remain after 3 rounds, stop and escalate to the user with
the remaining gate failures. Do not approve and do not implement.

P2/P3 issues may be shown as informational only if no gate marks them blocking.

## Stage 4 — Approval

When the gate review passes:

1. Show the spec path and manifest path.
2. Summarize affected packages, WUs, risks resolved, and any residual P2/P3 notes.
3. Ask the user:

   `Approve this dev spec + manifest? After approval I'll hand off to /implement.`

Only after explicit approval should `/implement` run.

## Hard Rules

- No implementation in `/spec-bridge`.
- No approval on a blocking gate failure.
- No silent placeholder content in the spec or manifest.
- No spec/manifest divergence.
- No unresolved invariant conflict.

## Output Contract

Report:

1. `Context Path`
2. `Spec Path`
3. `Manifest Path`
4. `Affected Packages`
5. `Risk Register Summary`
6. `Work Units`
7. `Gate Review` PASS/FAIL table
8. `Fix Rounds`
9. `Ready For Approval` YES/NO
