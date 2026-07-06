---
name: refactor-audit
description: >
  Codex structural audit of the whole Facet codebase for duplication, module
  boundaries, dead code, package hygiene, naming, public API/export drift,
  reference reachability, and pure-logic test gaps. Produces a ranked,
  evidence-backed cleanup plan without applying changes. Use for owner-run
  consolidation passes, not per-change review. Do not invoke Claude Workflow().
---

# /refactor-audit

Run the structural audit directly in Codex. The output is a plan, not applied
changes. Do not call `Workflow(...)`.

This skill is an audit. Do not edit production/docs/test files while auditing.
The only exception is when the user explicitly asks to update this skill itself.

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

## Required Audit Passes

Run each pass independently. Keep raw notes separate by pass until the final
synthesis so one conclusion does not bias another.

### 1. Dimension passes

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

### 2. Public API/export audit

For every `packages/*/package.json`:

1. Record `name`, `exports`, `publishConfig.exports`, `bin`, `files`,
   `sideEffects`, and `build`.
2. Read the package barrel (`src/index.ts`, plus secondary barrels such as
   `@facet/runtime/node`).
3. Compare exported symbols/files with package docs and intended package role in
   `AGENTS.md`.
4. Treat internally-unused exports as **public API candidates**, not dead code,
   unless docs/package role prove they are accidental.
5. Verify CLI bins separately (`@facet/cli`, `@facet/bridge`,
   `@facet/quickstart`).

### 3. Reference tracing

Use `rg`/`git grep` to prove each candidate:

- For public surfaces: search symbol names and package imports across
  `packages`, `apps`, `docs`, `README.md`, `AGENTS.md`, `.agents`, and `.codex`.
- For stale docs/process text: search the stale name/path globally.
- For package boundaries: search direct source imports, cross-package relative
  imports, and Node built-ins in browser-safe entries.
- For dead code: require a no-reference command, then check package exports,
  bin entrypoints, tests, docs, and generated/runtime entry paths before calling
  it dead.

Record the literal command or search pattern used for every confirmed finding.

### 4. Pure-logic test-gap audit

List production files under `packages/*/src` that are not tests, barrels, or
declared CLI/bin entrypoints. For each pure-logic candidate:

1. Locate adjacent tests (`<file>.test.ts` / `.test.tsx`) and broader package
   tests that exercise it.
2. Prioritize invariant-bearing pure logic: `validateTree`, `applyPatch`,
   `foldPatchIntoStage`, `Stage`, stores, queues/semaphores/LRU, CLI command
   builders, provider/prompt builders, and asset validators.
3. Do not demand unit tests for glue, thin barrels, React view composition, or
   Node process wrappers unless there is testable branching/contract logic.
4. A test gap finding must name the untested behavior and show the grep/test
   evidence that coverage is absent.

## Verify Findings

For every candidate finding:

1. Try to refute it by reading callers and running `rg`/`git grep`.
2. Confirm the issue is structural, not just taste.
3. Confirm the suggested fix reduces drift, clarifies a boundary, or removes real
   dead code.
4. Confirm severity against `docs/REVIEW-RULES.md`.
5. Drop cosmetic churn unless it prevents recurring confusion.

Use `.codex/agents/review-verifier.toml` as the verifier checklist when present.
If a candidate depends on absence of references or tests, rerun the absence check
after reading the relevant package barrel and package README.

## Rank

Rank confirmed findings by impact divided by effort:

- Impact: correctness risk, invariant risk, future drift avoided, API clarity.
- Effort: S, M, or L.
- Prefer a few high-value consolidations over broad churn.

## Output Contract

Report:

1. Scope audited.
2. Per-severity counts (`P0` / `P1` / `P2` / `P3`) overall.
3. Package/area summary with counts and finding titles.
4. Ranked findings table: severity, files, dimension, issue, evidence, suggested
   fix, effort, score.
5. Public API/export audit summary.
6. Pure-logic test-gap audit summary.
7. Recommended execution order.
8. `Do not touch` list with reasons.
9. Residual risks or areas intentionally left unaudited.

End with: `Plan only — no changes applied`.
