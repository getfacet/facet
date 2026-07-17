---
name: refactor-audit
description: >
  Codex structural audit of the whole Facet codebase for duplication, module
  boundaries, dead code, package hygiene, naming, public API/export drift,
  reference reachability, oversized-file pressure, project scaffold shape, and
  pure-logic test gaps. Produces a ranked, evidence-backed cleanup plan without
  applying changes. Use for owner-run consolidation passes, not per-change
  review. Do not invoke Claude Workflow().
---

# /refactor-audit

Run the structural audit directly in Codex. The output is a plan, not applied
changes. Do not call `Workflow(...)`. Because Codex has no Claude workflow
runner, the main agent must explicitly emulate the workflow: independent audit
passes → adversarial verification → completeness re-sweep → dedup/ranking.

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

- `packages/{core,renderers,agents,adapters,tools}/*/src`
- `packages/{core,renderers,agents,adapters,tools}/*/package.json`
- root package/config files
- `apps/playground/**`
- `docs/**`, `AGENTS.md`, `.agents/**`, and `.codex/**` when process drift is
  relevant

## Required Audit Passes

Run each pass independently. Keep raw notes separate by pass until verification
so one conclusion does not bias another. Missing a required pass is a failed
audit, not a shallow PASS.

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

If Codex subagents are available, delegate one dimension at a time using
`.codex/agents/audit-structure.toml`. If they are unavailable, run separate
inline passes. In either mode, pass only the dimension, scope, and required
evidence; keep conclusions independent until verification. The main agent must
still verify and rank all findings.

### 2. Public API/export audit

For every grouped package manifest under
`packages/{core,renderers,agents,adapters,tools}/*/package.json`:

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

List production files under `packages/{core,renderers,agents,adapters,tools}/*/src` that
are not tests, barrels, or declared CLI/bin entrypoints. For each pure-logic
candidate:

1. Locate adjacent tests (`<file>.test.ts` / `.test.tsx`) and broader package
   tests that exercise it.
2. Prioritize invariant-bearing pure logic: `validateTree`, `applyPatch`,
   `foldPatchIntoStage`, `Stage`, stores, queues/semaphores/LRU, CLI command
   builders, provider/prompt builders, and asset validators.
3. Do not demand unit tests for glue, thin barrels, React view composition, or
   Node process wrappers unless there is testable branching/contract logic.
4. A test gap finding must name the untested behavior and show the grep/test
   evidence that coverage is absent.

### 5. Oversized-file and growth-pressure audit

Audit large and fast-growing files as module-pressure signals, not as cosmetic
line-count violations.

1. Count tracked text files by line count against `origin/main` (or the owner
   requested baseline). Record the command used and exclude binary files.
2. Flag production files over 500 lines, test files over 800 lines, and any file
   over 1000 lines. Also flag files that grew by 250+ lines or 30%+ relative to
   the merge-base/baseline.
3. For each flagged file, classify the pressure:
   - `cohesive-large`: one clear responsibility, large because the contract or
     integration surface is large.
   - `mixed-responsibility`: multiple roles, protocols, render paths, policies,
     or fixture families living together.
   - `growth-watch`: currently tolerable, but recent growth predicts drift.
   - `ignore`: lockfile, generated artifact, spec manifest, or deliberately
     broad integration test where splitting would reduce clarity.
4. Confirm a finding only when size correlates with structural evidence such as
   mixed responsibilities, duplicated fixtures/helpers, package-boundary
   pressure, hard-to-test branches, unstable ownership, or repeated review
   confusion.
5. Do not recommend splitting a file solely because it crosses a line-count
   threshold. Line count is a triage trigger; the finding must explain the
   structural risk and the improvement expected from the split.
6. Produce a large-file inventory, a watchlist, and ranked extraction candidates.

### 6. Scaffold and module-shape audit

Audit whether the current directory/file structure still matches the
responsibilities that have emerged in the codebase.

1. Review package-local scaffolds under `packages/{core,renderers,agents,adapters,tools}`
   and `apps/playground` against the package roles in `AGENTS.md`.
2. For every extraction candidate from the oversized-file, duplication,
   boundary, or test-gap passes, decide whether the right shape is:
   - a small sibling helper file,
   - a role-named directory with private internal modules,
   - a package-level shared helper,
   - a public package surface, or
   - no split.
3. A split recommendation must include:
   - the current responsibility map of the file,
   - the proposed directory/file scaffold,
   - what remains public vs private,
   - import direction after the split,
   - test placement after the split,
   - why the change reduces future drift, and
   - why a smaller local helper extraction is insufficient, if proposing a new
     directory.
4. Preserve package boundaries from `AGENTS.md`. Do not move protocol contracts
   out of `@facet/core`, do not make browser-safe entries import Node-only code,
   and do not expose private helpers through package barrels unless the public
   API/export audit justifies it.
5. Prefer role names over generic buckets. Avoid recommending `utils.ts`,
   `helpers.ts`, or `shared.ts` unless the name reflects a real package-local
   concept and the exported surface is tightly bounded.
6. Include a `Do not split` rationale for cohesive large files, broad integration
   tests, generated files, lockfiles, and cases where a directory would add
   navigation cost without reducing drift.

## Verify Findings

For every candidate finding:

1. Try to refute it by reading callers and running `rg`/`git grep`.
2. Confirm the issue is structural, not just taste.
3. Confirm the suggested fix reduces drift, clarifies a boundary, or removes real
   dead code.
4. Confirm severity against `docs/REVIEW-RULES.md`.
5. Drop cosmetic churn unless it prevents recurring confusion.
6. For large-file and scaffold findings, verify that the proposed structure
   follows existing package patterns, improves ownership/testability, and does
   not create generic helper sprawl.

Use `.codex/agents/review-verifier.toml` as the verifier checklist when present.
Verifier policy:

- P0/P1 candidates require three independent skeptical verifier passes. Use
  subagents if available; otherwise do three separate inline passes with fresh
  rereads and fresh `rg`/`git grep` checks. Strict majority confirms.
- P2/P3 candidates require at least one skeptical verifier pass.
- If a candidate depends on absence of references or tests, rerun the absence
  check after reading the relevant package barrel and package README.
- Refuted, unverifiable, or taste-only candidates are dropped before ranking.

## Completeness Re-Sweep

After the first verified finding set, run a critic pass before ranking:

1. Compare audited scope against `AGENTS.md`'s package map and the actual
   grouped package manifest list.
2. Name up to six under-audited `(dimension, area)` slices, such as a browser
   entry, package manifest family, CLI bin, prompt/spec text, pure-logic file
   cluster, oversized-file cluster, or package scaffold boundary.
3. Re-audit those slices with the relevant dimension checklist.
4. Verify any new candidates with the same verifier policy.

Skipping this sweep is allowed only with an explicit reason for a tiny, targeted
owner request. Otherwise the audit is incomplete.

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
5. Verification ledger: candidate counts, verifier passes, refuted/merged count.
6. Completeness re-sweep slices and outcome.
7. Public API/export audit summary.
8. Pure-logic test-gap audit summary.
9. Large-file and growth-pressure summary: inventory, watchlist, extraction
   candidates, and explicit `ignore`/`do not split` rationales.
10. Scaffold/module-shape summary: proposed structures, public/private surfaces,
    import direction, and test placement for each structural split candidate.
11. Recommended execution order.
12. `Do not touch` list with reasons.
13. Residual risks or areas intentionally left unaudited.
14. `Execution Handoff` using the refactor flow below.

End the audit verdict with: `Plan only — no changes applied`.

## Execution Handoff

When the owner approves one or more findings, execute them through the refactor
flow, not the feature flow:

1. `/worktree-prep` in refactor mode using branch `refactor/<slug>`.
2. Apply only the approved cleanup scope. Avoid behavior changes unless the owner
   explicitly approves them.
3. Run the refactor hard gate:
   `/update-tests` → `/verify` → `/code-review` → `/update-docs`.
4. Also run `/live-test` if the cleanup touches a live-link surface
   (`packages/tools/quickstart`, `packages/adapters/server`,
   `packages/adapters/client`, `packages/adapters/agent-client`,
   `packages/core/runtime`, `packages/tools/bridge`, `packages/renderers/react`
   renderer/useFacet/ChatDock paths, or `packages/core/core`
   patch/protocol/stage vocabulary) or the owner requests it.
