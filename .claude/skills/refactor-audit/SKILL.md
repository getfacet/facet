---
name: refactor-audit
description: Structural audit of the Facet codebase — duplication, module boundaries, dead code, package hygiene, naming — producing a ranked, evidence-backed cleanup plan. Runs as a Workflow. Owner-run consolidation pass, not per-change.
---

# /refactor-audit

A whole-codebase structural review, run as a **Workflow** (parallel audit per
dimension → voted adversarial verify → completeness-critic re-sweep → dedup →
ranked plan). Unlike `/code-review` (correctness of a change), this looks at the
*shape* of the code and what should be consolidated. The audit logic lives in the
`audit-structure` subagent and `docs/REVIEW-RULES.md`.

## Run it

Call the workflow (this skill is your opt-in to `Workflow`):

```
Workflow({ name: 'refactor-audit' })
```

No args — scope is always the whole repo (`packages/**/src`, `apps/**/src`, and
package manifests).

The workflow: **Audit** (one `audit-structure` agent per dimension —
duplication, boundaries, dead-code, hygiene, naming — over the whole tree) →
**Verify** (a `review-verifier` vote panel per finding — 3 independent skeptics
for P0/P1, 1 for P2/P3 — challenging whether it is truly dead / truly duplicated
/ truly misplaced; only a strict majority survives) → **Sweep** (a completeness
critic names up to 6 under-audited `(dimension, area)` slices — since one agent
per dimension over the whole repo is shallow — and each is re-audited + verified)
→ **Plan** (dedup the same issue reached from multiple lenses, rank by
impact ÷ effort, recommend an execution order + an explicit do-not-touch list).
Watch live progress with `/workflows`.

`args` (all optional): `thorough: true` runs the full vote panel on every
finding; `votes` sets the high-severity panel size (default 3); `skipCritic: true`
skips the Sweep phase for a faster, shallower pass.

## Present the result

The workflow returns `{ summary, counts, findings: [{severity, title, files,
dimension, effort, score, votes, evidence, fix, verifierReason}], executionOrder,
doNotTouch }` (`dimension` may be a `+`-joined list when the same issue was found
by multiple lenses). Render:

- a ranked table (severity · files · issue · suggested fix · effort · score),
- the recommended `executionOrder`,
- `doNotTouch` — explicitly what NOT to touch and why (avoid churn for its own
  sake).

## Output is a plan, not applied changes

The maintainer approves scope; then execute item by item, running `/verify` after
each and `/code-review` if a change is non-trivial. Bias toward a few high-value
consolidations (real duplication, a misplaced module, a dead file) over cosmetic
churn — every proposed move must reduce drift or clarify a boundary.

`/refactor-audit` is periodic and owner-run — not part of the per-feature gate
chain.
