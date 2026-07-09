---
name: spec-bridge
description: >
  Translate an approved Facet feature-intake brief into an executable development
  spec and execution manifest using Codex steps: context pass, risk probes, spec
  writing, gate review, module-shape/scaffold planning, and bounded fix loop.
  Stops at an approvable plan before implementation. Use before coding, after
  /feature-intake approval, or when the user asks for /spec-bridge. Do not invoke
  Claude Workflow().
---

# Spec Bridge (Facet)

Convert an approved product brief into two files:

- `specs/dev-specs/<slug>.md`
- `specs/dev-specs/<slug>.execution.yaml`

Codex runs this directly. Do not call `Workflow(...)`; do not use
`.claude/workflows/**`; do not start implementation. Because Codex has no Claude
workflow runner, the main agent must explicitly emulate the workflow rigor:
context evidence → independent risk probes → single synchronized writer →
independent gate-review panel → bounded fix loop → human approval.

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
- current file sizes, large-file hot spots, and package-local scaffold patterns
  for likely touched areas

Record risks with stable IDs:

- `RISK-INV-*` — Facet invariant risks
- `RISK-API-*` — public API or consumer migration risks
- `RISK-PKG-*` — package boundary, dependency, build, or publish risks
- `RISK-SHAPE-*` — oversized-file, module-shape, scaffold, or extraction risks

Risk probes are mandatory and independent:

- `INV` — Facet invariant risks and fail-safe boundaries.
- `API` — public API, exported symbols, consumers, migration risk.
- `PKG` — package boundary, dependency direction, build/publish risk.
- `SHAPE` — module shape, oversized-file pressure, scaffold fit, extraction
  boundaries, and public/private split risk.

If Codex subagents are available, run one probe per lens. If unavailable, run
four separate inline passes and keep notes separate until the context file is
written. Each probe must return evidence with `file:line` or literal `rg` /
`git grep` commands. A missing probe is a Stage 0 FAIL. The main agent owns the
final context file and must include every `RISK-*` or explicitly state that the
lens found none.

## Stage 1 — Write Spec And Manifest Together

Use the templates. Keep the spec and manifest synchronized.

The spec must include:

- overview and affected packages
- Done Criteria mapping from every `DC-*`
- Invariant Fit Audit for every touched invariant
- fail-safe and boundary checklist
- Risk Register resolving every `RISK-*`
- Public API Impact
- Module Shape & Scaffold Plan
- Shared Preflight
- Work Units
- Execution Order
- Feature Final Gate Chain with
  `/worktree-prep` → `/update-tests` → `/verify` → `/code-review` →
  `/live-test` → `/update-docs` and `final_gate_owner: main-agent`

The execution manifest must mirror the Work Units exactly:

- same WU IDs and titles
- same files
- same dependencies and parallel groups
- same `red_check`, quick checks, no-regression checks, and test plan

Work Unit rules:

- each WU touches at most 5 files
- each file belongs to exactly one WU
- each WU records a module-shape decision (`preserve`, `sibling-helper`,
  `role-directory`, `package-shared`, `public-surface`, or `no-split`) with
  rationale when it grows a large file, creates a directory, or extracts code
- production-code WUs need a real `red_check` that fails before implementation
  and passes after implementation
- `red_check: N/A` is allowed only for docs, deletion-only, or move-only WUs with
  a concrete justification
- parallel WUs must have disjoint writable files
- do not require splitting by line count alone; require evidence that the planned
  shape reduces drift, clarifies ownership, preserves package boundaries, or
  improves testability

## Stage 2 — Gate Review

Review the draft against
`.agents/skills/spec-bridge/references/spec-qa-gates.md`.

Produce a gate table:

`gate | status | evidence | blocking`

Any blocking FAIL means the spec is not approvable.

Run the gate review as an independent panel. Do not let the writer self-review
with one combined skim. If subagents are available, use one reviewer per panel
lens; otherwise do separate inline passes with the same separation:

- `traceability` — all `DC-*`, tests, and final gates are represented.
- `decomposition` — WU file limits, ownership, dependencies, red checks, and
  manifest/spec identity.
- `invariant-fit` — every touched Facet invariant has a concrete safe design.
- `risk-consistency` — every `RISK-*` from context is resolved or waived with
  evidence; public API consumers are covered.
- `module-shape` — file growth, scaffold fit, extraction quality,
  public/private boundaries, import direction, and test placement.

Review specifically for:

- all `DC-*` traced to implementation and tests
- spec/manifest consistency
- concrete invariant mitigations
- fail-safe and boundary test coverage
- public API consumer migration evidence
- Module Shape & Scaffold Plan quality
- WU decomposition quality
- TDD-first enforcement
- all `RISK-*` resolved or explicitly waived

Fail closed:

- missing panel lens → FAIL
- placeholder or unverifiable evidence → FAIL
- spec/manifest divergence → FAIL
- production WU without a real `red_check` → FAIL unless it is docs,
  deletion-only, or move-only with a concrete justification
- unresolved invariant conflict → FAIL
- missing module-shape plan for large-file growth, new scaffold, or extraction
  work → FAIL
- generic `utils.ts`/`helpers.ts` extraction with no role-specific ownership or
  test-placement rationale → FAIL

## Stage 3 — Bounded Fix Loop

If the gate review finds P0/P1 or blocking failures:

1. Fix the spec and manifest together.
2. Re-run the full gate-review panel, not only the failed gate.
3. Repeat at most 3 rounds.

If blocking failures remain after 3 rounds, stop and escalate to the user with
the remaining gate failures. Do not approve and do not implement.

P2/P3 issues may be shown as informational only if no gate marks them blocking.

## Stage 4 — Approval

When the gate review passes:

1. Show the spec path and manifest path.
2. Summarize affected packages, WUs, risks resolved, and any residual P2/P3 notes.
3. Ask the user:

   `Approve this dev spec + manifest? After approval I'll run /worktree-prep, then /implement.`

Only after explicit approval should `/worktree-prep` run. `/implement` runs only
inside the prepared worktree.

## Hard Rules

- No implementation in `/spec-bridge`.
- No approval on a blocking gate failure.
- No silent placeholder content in the spec or manifest.
- No spec/manifest divergence.
- No unresolved invariant conflict.
- No skipped Stage 0 risk lens or Stage 2 reviewer lens.
- No large-file growth, new directory scaffold, or extraction plan without a
  module-shape rationale.
- No starting `/worktree-prep` or `/implement` until the user explicitly approves
  the final spec and manifest.

## Output Contract

Report:

1. `Context Path`
2. `Spec Path`
3. `Manifest Path`
4. `Affected Packages`
5. `Risk Register Summary`
6. `Module Shape Summary`
7. `Work Units`
8. `Gate Review` PASS/FAIL table
9. `Fix Rounds`
10. `Panel Ledger` (risk probes, reviewer lenses, reruns)
11. `Ready For Approval` YES/NO
