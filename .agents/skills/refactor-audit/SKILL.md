---
name: refactor-audit
description: Codex structural audit of the Facet codebase for duplication, module boundaries, dead code, package hygiene, and naming. Produces a ranked, evidence-backed cleanup plan without applying changes. Use for owner-run consolidation passes, not per-change review. Do not invoke Claude Workflow().
---

# /refactor-audit

Run the structural audit directly in Codex. The output is a plan, not applied
changes. Do not call `Workflow(...)`, and do not edit code during the audit.

## Read First

1. `AGENTS.md` — package map, invariants, and boundaries.
2. `docs/ARCHITECTURE.md` — architectural intent.
3. `docs/REVIEW-RULES.md` — audit dimensions and severity.
4. Optional Codex audit guides, if present:
   - `.codex/agents/audit-structure.toml`
   - `.codex/agents/review-verifier.toml`

Do not read or invoke `.claude/workflows/**`; those are Claude-only
orchestrators.

## Scope

Audit the whole repo shape, with emphasis on:

- `packages/**/src`
- `packages/*/package.json`
- root package/config files
- `apps/playground/**`
- `docs/**`, `AGENTS.md`, `.agents/**`, and `.codex/**` when process drift is
  relevant

## Audit Passes

Run one pass for each dimension from `docs/REVIEW-RULES.md`:

- `duplication` — same logic, prompt, spec, helper, or process text in multiple
  places.
- `boundaries` — misplaced modules, wrong dependency direction, protocol types
  outside `@facet/core`, browser entries importing Node-only code.
- `dead-code` — unused exports, files, branches, scripts, or stale docs. Prove
  with `rg`/`git grep`.
- `hygiene` — package manifest drift, missing test coverage on pure logic,
  docs/package-map drift.
- `naming` — misleading or inconsistent names that create maintenance risk.

If Codex subagents are available, you may delegate one dimension at a time using
`.codex/agents/audit-structure.toml`. If they are unavailable, run the passes
inline. The main agent must still verify and rank all findings.

## Verify Findings

For every candidate:

1. Try to refute it by reading callers and running `rg`/`git grep`.
2. Confirm the issue is structural, not just taste.
3. Confirm the suggested fix reduces drift, clarifies a boundary, or removes real
   dead code.
4. Drop cosmetic churn unless it prevents recurring confusion.

Use `.codex/agents/review-verifier.toml` as the verifier checklist when present.

## Rank

Rank confirmed findings by impact divided by effort:

- Impact: correctness risk, invariant risk, future drift avoided, API clarity.
- Effort: S, M, or L.
- Prefer a few high-value consolidations over broad churn.

## Output Contract

Report:

1. Scope audited.
2. Ranked findings table: severity, files, dimension, issue, evidence, suggested
   fix, effort, score.
3. Recommended execution order.
4. `Do not touch` list with reasons.
5. Residual risks or areas intentionally left unaudited.

End with: `Plan only — no changes applied`.
