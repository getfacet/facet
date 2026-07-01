---
name: refactor-audit
description: Structural audit of the Facet codebase — duplication, module boundaries, dead code, package hygiene, naming — producing a ranked, evidence-backed cleanup list. Use for consolidation passes, not per-change.
---

# /refactor-audit

A whole-codebase structural review. Read `docs/REVIEW-RULES.md` first (invariants,
severity, evidence, and the audit dimensions). Unlike `/code-review` (correctness
of a change), this looks at the *shape* of the code and what should be
consolidated.

## Scope

The whole repo: `packages/**/src`, `apps/**/src`, and package manifests. Not the
branch diff.

## Process

1. **Audit (parallel).** Spawn `audit-structure` reviewers, one per dimension
   (duplication, boundaries, dead-code, hygiene, naming), each over the whole
   tree. Each returns findings as `{title, files, severity, evidence, fix}`.
   Concrete evidence required: for duplication, the ≥2 locations; for dead code,
   proof it's unreferenced (a grep); for boundaries, the wrong import direction.

2. **Verify.** Spawn `review-verifier` to challenge each finding — is it truly
   unused / truly duplicated / truly misplaced? Drop refuted findings.

3. **Synthesize + plan.** Rank by (impact ÷ effort). Present:
   - a ranked table (severity · files · issue · suggested fix · effort),
   - a recommended execution order,
   - explicitly what NOT to touch and why (avoid churn for its own sake).

## Output

A cleanup plan, not applied changes. The maintainer approves scope; then execute
item by item, running `/verify` after each, and `/code-review` if a change is
non-trivial.

Bias toward a few high-value consolidations (real duplication, a misplaced module,
a dead file) over cosmetic churn. Every proposed move must reduce drift or clarify
a boundary — not just reshuffle.
