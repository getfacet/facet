---
name: code-review
description: Multi-dimension code review of Facet changes (bugs, types, edge, security, concurrency, consistency) with file:line evidence, P0–P3 severity, and adversarial verification. Use before shipping a change.
---

# /code-review

A rigorous, evidence-based review. Read `docs/REVIEW-RULES.md` first — it defines
the invariants, severity, evidence requirement, and dimensions. Findings without
`path:line` evidence do not count.

## Scope

Default to the branch diff:

```bash
git diff --name-only main...HEAD
git diff main...HEAD
```

Review the changed files and everything they touch. If asked to review the whole
repo, review all of `packages/**/src` and `apps/**/src`.

## Process

1. **Find (parallel).** Spawn one reviewer per dimension, in a single message, each
   scoped to the diff. Use these agents (fall back to `general-purpose` if a type
   is unavailable): `review-bugs`, `review-types`, `review-edge`,
   `review-security`, `review-concurrency`, `review-consistency`,
   `review-test-gaps`. Each returns findings as
   `{title, file, line, severity, evidence, why}`.

2. **Verify (adversarial).** For every candidate finding, spawn `review-verifier`
   to try to REFUTE it — is it real, is the severity right, does the triggering
   condition actually occur? Drop findings the verifier refutes. Default to
   dropping when uncertain (no false alarms).

3. **Synthesize.** Deduplicate, rank by severity, and present:
   - a table of confirmed findings (severity · `path:line` · one-line issue),
   - the fix for each,
   - the PASS/FAIL verdict.

## Verdict

- **PASS** — P0–P1 = 0, every P2 fixed or explicitly deferred with a reason.
- **FAIL** — fix the findings, then run `/verify`, then **re-run `/code-review`**
  (don't declare PASS on the strength of the fixes alone — re-review).

Scale the fan-out to the change: a one-file fix needs a couple of dimensions; a
cross-package change needs all six. Prefer fewer, real, high-severity findings
over a long list of nits.
