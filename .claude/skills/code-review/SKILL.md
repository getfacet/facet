---
name: code-review
description: Multi-dimension code review of Facet changes (bugs, types, edge, security, concurrency, consistency, test-gaps) with file:line evidence, P0–P3 severity, and adversarial verification. Runs as a Workflow. Use before shipping a change.
---

# /code-review

A rigorous, evidence-based review, run as a **Workflow** (deterministic fan-out →
per-finding adversarial verify → verdict math). The review logic lives in the
`review-*` subagents and `docs/REVIEW-RULES.md`; this skill just launches the
workflow and presents its result.

## Run it

Call the workflow (this skill is your opt-in to `Workflow`):

```
Workflow({ name: 'code-review', args: { scope: 'diff', base: 'main' } })
```

`args` (all optional):
- `scope`: `'diff'` (default — branch diff `main...HEAD`) or `'repo'` (all of
  `packages/**/src` + `apps/**/src`).
- `base`: base ref for the diff (default `'main'`).
- `dimensions`: force a subset of `bugs, types, edge, security, concurrency,
  consistency, test-gaps`. Omit to let the workflow's Scope phase scale the
  fan-out to the change.
- `hint`: free text to narrow/redirect scope (e.g. a PR number or "focus on the
  bridge queue").

The workflow itself: **Scope** (git diff → which files, which dimensions) →
**Find** (one `review-*` agent per dimension) → **Verify** (`review-verifier`
tries to refute every finding; refuted/uncertain findings are dropped — no false
alarms) → **Synthesize** (dedup, rank by severity, propose a fix per finding).
Watch live progress with `/workflows`.

## Present the result

The workflow returns `{ verdict, counts, findings: [{severity, title, file, line,
dimension, evidence, why, fix}], summary, scope }`. Render:

- a table of confirmed findings (severity · `file:line` · one-line issue · fix),
- the `summary`,
- the **PASS/FAIL** verdict.

## Verdict (unchanged rubric — see `docs/REVIEW-RULES.md`)

- **PASS** — P0–P2 = 0 (`counts`). P3 are non-blocking nits — track them. A P2 may
  only ship unfixed with an explicit maintainer waiver recorded in the PR.
- **FAIL** — fix the findings, run `/verify`, then **re-run `/code-review`** (don't
  declare PASS on the strength of the fixes alone — re-review).

## Notes

- The verdict is computed deterministically in the workflow from verified-finding
  severities; don't override it — fix or waive.
- Scale is automatic (Scope picks dimensions), but you can pin `dimensions` for a
  focused re-review after a fix.
