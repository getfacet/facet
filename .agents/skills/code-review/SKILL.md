---
name: code-review
description: Multi-dimension Codex code review of Facet changes (bugs, types, edge cases, security, concurrency, consistency, test gaps) with file:line evidence, P0-P3 severity, and adversarial verification. Use before shipping a change, after fixes, or when the user asks for /code-review. Do not invoke Claude Workflow().
---

# /code-review

Run the Facet review directly in Codex. There is no `Workflow(...)` call in
Codex, so the main agent must emulate the Claude workflow rigor explicitly:
scope → independent dimension passes → adversarial verification → synthesis →
verdict. Subagents are helpers only; the main Codex agent owns completeness,
verification, verdict math, and the final report.

## Read First

1. `AGENTS.md` — Facet invariants and Definition of Done.
2. `docs/REVIEW-RULES.md` — severity and review dimensions.
3. The candidate diff under review:
   - uncommitted: `git status --porcelain`, `git diff --name-only HEAD`,
     `git diff HEAD`
   - committed: first successful base among `origin/main`, `main`, then `HEAD~1`;
     run `git diff --name-only <base>..HEAD` and `git diff <base>..HEAD`
   - if no base is available, review the uncommitted diff plus `git show --stat`
     for the current commit; fail closed on unclear scope by broadening review
4. Optional Codex reviewer guides, if present:
   - `.codex/agents/review-bugs.toml`
   - `.codex/agents/review-types.toml`
   - `.codex/agents/review-edge.toml`
   - `.codex/agents/review-security.toml`
   - `.codex/agents/review-concurrency.toml`
   - `.codex/agents/review-consistency.toml`
   - `.codex/agents/review-test-gaps.toml`
   - `.codex/agents/review-verifier.toml`

Do not read or invoke `.claude/workflows/**`. Those are Claude Code
orchestration files, not Codex procedures.

## Scope

Classify changed files by package and select dimensions before looking for
findings. Build a review packet containing: base ref, changed files, diff, touched
packages, touched Facet invariants, test commands already run, and any relevant
`.agents/work/<slug>/dev-spec.md`.

Dimension selection is fail-closed:

- Run all seven dimensions for broad, multi-package, runtime, renderer,
  protocol, bridge, quickstart, security, concurrency, or public API changes.
- Always include `test-gaps` for behavior changes.
- For docs/process-only changes, run at least `consistency` and `test-gaps`.
- If you skip a dimension, record the concrete reason. A missing reason is a
  review failure, not a PASS.

- `bugs`
- `types`
- `edge`
- `security`
- `concurrency`
- `consistency`
- `test-gaps`

## Find

Run each selected dimension as an independent pass. Do not blend dimensions into
one general skim. If Codex subagents are available, run one focused pass per
dimension using the matching `.codex/agents/review-*.toml` instructions. If
subagents are unavailable, do separate inline passes and reset the checklist for
each pass.

For each candidate finding, require:

- `file:line`
- short evidence quote
- the concrete failing condition or input
- severity `P0`, `P1`, `P2`, or `P3` from `docs/REVIEW-RULES.md`
- suggested fix

No evidence means no finding.
Keep raw findings separated by dimension until verification is complete.

## Verify

Every candidate finding must survive adversarial verification before it can be
reported:

1. Read the surrounding code and real callers.
2. Check whether validation, tests, guards, or fail-safe behavior already handle
   the case.
3. Reproduce with a command or tight reasoning where possible.
4. Verify severity against `docs/REVIEW-RULES.md`.
5. Drop the finding if the failure cannot actually happen or the evidence is
   weak.

Use `.codex/agents/review-verifier.toml` as the verifier checklist when present.
Verifier policy:

- P0/P1 candidates require three independent skeptical verifier passes. Use
  subagents if available; otherwise do three separate inline passes with fresh
  rereads of the cited code and callers. Strict majority confirms.
- P2/P3 candidates require at least one skeptical verifier pass.
- Refuted or uncertain candidates are dropped or downgraded before synthesis.
- If a candidate cannot be verified because required context is missing, report
  the review as FAIL with a blocker instead of declaring PASS.

After verification, run one completeness re-sweep over the final diff: reread
the changed file list, selected dimensions, and confirmed/refuted counts; name
any obviously under-reviewed area and review it before verdict.

## Spec-Fidelity Check

If the worktree has `.agents/work/<slug>/dev-spec.md`, read it and verify that any risk
resolutions and Done Criteria touched by the diff are implemented. A missing
risk mitigation is a review finding at the severity implied by the risk.

## Verdict

- **PASS** — P0-P2 confirmed findings = 0. P3 nits are non-blocking.
- **FAIL** — any P0/P1/P2 confirmed finding remains.
- **FAIL** — any selected dimension was not run, any candidate was not verified,
  the scope/base is unclear and not broadened, or spec-fidelity was applicable
  but not checked.

After a FAIL is fixed, run `/verify` and then run `/code-review` again. Never
declare PASS from the fix alone.

## Output Contract

Report:

1. Scope: base ref, files, packages, dimensions reviewed.
2. Confirmed findings table: severity, `file:line`, issue, failure scenario, fix.
3. Verification ledger: candidate counts, verifier passes, refuted/merged count.
4. Completeness re-sweep result.
5. Spec-fidelity result, or `N/A`.
6. Verdict: `PASS` or `FAIL`.
