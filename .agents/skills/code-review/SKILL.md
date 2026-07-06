---
name: code-review
description: Multi-dimension Codex code review of Facet changes (bugs, types, edge cases, security, concurrency, consistency, test gaps) with file:line evidence, P0-P3 severity, and adversarial verification. Use before shipping a change, after fixes, or when the user asks for /code-review. Do not invoke Claude Workflow().
---

# /code-review

Run the Facet review directly in Codex. There is no `Workflow(...)` call in
Codex. If subagents are available, use them as optional helpers; the main Codex
agent still owns scoping, verification, verdict math, and the final report.

## Read First

1. `AGENTS.md` — Facet invariants and Definition of Done.
2. `docs/REVIEW-RULES.md` — severity and review dimensions.
3. The diff under review:
   - default: `git diff --name-only main...HEAD` and `git diff main...HEAD`
   - if that base is unavailable or the change is uncommitted: `git diff HEAD`
     plus `git status --short`
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

Classify changed files by package and select dimensions. Always include
`test-gaps` for behavior changes. Prefer all seven dimensions for broad or risky
changes:

- `bugs`
- `types`
- `edge`
- `security`
- `concurrency`
- `consistency`
- `test-gaps`

For docs-only changes, focus on `consistency` and `test-gaps` only if the docs
alter process or gates.

## Find

Review the diff dimension by dimension. For each candidate finding, require:

- `file:line`
- short evidence quote
- the concrete failing condition or input
- severity `P0`, `P1`, `P2`, or `P3` from `docs/REVIEW-RULES.md`
- suggested fix

No evidence means no finding.

If Codex subagents are available, you may run one focused pass per dimension
using the matching `.codex/agents/review-*.toml` instructions. Pass only the
scoped files, diff, and dimension. If subagents are unavailable, do the passes
inline.

## Verify

Try to refute every candidate finding before reporting it:

1. Read the surrounding code and real callers.
2. Check whether validation, tests, guards, or fail-safe behavior already handle
   the case.
3. Reproduce with a command or tight reasoning where possible.
4. Drop the finding if the failure cannot actually happen or the evidence is
   weak.

Use `.codex/agents/review-verifier.toml` as the verifier checklist when present.
For P0/P1 candidates, do a second independent inline pass even if a subagent was
used.

## Spec-Fidelity Check

If the branch has `specs/dev-specs/<slug>.md`, read it and verify that any risk
resolutions and Done Criteria touched by the diff are implemented. A missing
risk mitigation is a review finding at the severity implied by the risk.

## Verdict

- **PASS** — P0-P2 confirmed findings = 0. P3 nits are non-blocking.
- **FAIL** — any P0/P1/P2 confirmed finding remains.

After a FAIL is fixed, run `/verify` and then run `/code-review` again. Never
declare PASS from the fix alone.

## Output Contract

Report:

1. Scope: base ref, files, packages, dimensions reviewed.
2. Confirmed findings table: severity, `file:line`, issue, failure scenario, fix.
3. Refuted/merged candidate count, briefly.
4. Spec-fidelity result, or `N/A`.
5. Verdict: `PASS` or `FAIL`.
