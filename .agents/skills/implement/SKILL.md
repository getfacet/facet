---
name: implement
description: >
  Execute an approved Facet dev spec: set up a branch/worktree, run the Work
  Units TDD-first from the execution manifest, then run the hard-gate chain
  (/update-tests → /verify → /code-review → /update-docs). Use after /spec-bridge
  is approved, or when the user says "implement the spec / build it".
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent, AskUserQuestion, Skill
---

# Implement (Facet)

> Turn an approved spec + execution manifest into merged code. Isolate on a
> branch/worktree, execute Work Units TDD-first, and hold the final gates with
> the main agent. This is the execution half of `/spec-bridge` (which is planning).

Pipeline: `/feature-intake` → `/spec-bridge` → **`/implement`** → (commit/PR on your go).

## Required context
1. `AGENTS.md` (Facet contract + Definition of Done).
2. Spec: `specs/dev-specs/<slug>.md` and manifest `specs/dev-specs/<slug>.execution.yaml`.
3. `docs/REVIEW-RULES.md` (the P0–P2 model the /code-review gate uses).
The manifest is the delegation source of truth — delegate from it, not from memory.

## Preconditions (STOP if unmet)
- The spec was reviewed and the user approved it. Never start without approval.
- The working tree is clean (or only holds this feature's files). Never touch
  other agents' uncommitted work; never git stash/switch without being asked.

## Stage 0 — Branch / worktree
Default (simple, sequential): a feature branch off an up-to-date `main`:
```
git checkout main && git pull --rebase
git checkout -b feat/<slug>
```
Optional (parallel isolation / long-running work): a git worktree so this feature
lives in its own directory without disturbing the current checkout:
```
git worktree add ../facet-wt/<slug> -b feat/<slug>
cd ../facet-wt/<slug> && pnpm install
```
Ask the user which they want if it's ambiguous; default to a branch for a single
focused feature. Then confirm a green baseline before any WU:
```
pnpm typecheck && pnpm test && pnpm lint
```

## Stage 1 — Work Unit execution (TDD-first)
Read the manifest. Reuse `shared_preflight` once. Execute WUs in the spec's
`Execution Order` — parallel ONLY where a `parallel_group` marks disjoint file
sets. For each WU, spawn a `general-purpose` subagent with this work order
(deviation = WU rejected):

- **STEP 1 RED** — run the WU's `red_check` BEFORE touching production code (only
  test files may change). It must FAIL → capture `red_check_output_before`.
  (`red_check: N/A` only for deletion/docs/move-only WUs, with justification.)
- **STEP 2 GREEN** — minimal production change within the WU's ≤5 files to flip
  RED→GREEN. Re-run; capture `red_check_output_after` (must PASS).
- **STEP 3 REFACTOR** — WU files + STEP-2 code only. Apply the minimal refactor if
  a trigger fires (function too long, duplicated ≥5-line block ×2, dead code,
  cross-package import, `@facet/core` gaining a Node-only import, non-barrel
  import); else skip with per-trigger evidence. Larger cleanup → record for
  `/refactor-audit`.
- **STEP 4 Report** (`handoff_format`): `changed_files`, `executed_commands`,
  `red_check_output_before` (FAIL), `red_check_output_after` (PASS),
  `green_diff_summary`, `refactor_decision`, `pass_fail`, `next_action`.
- Subagents do NOT run the final gate chain and do NOT modify files outside the WU.

### DoD verification (main agent, per WU)
- Only the WU's listed files changed.
- `red_check_output_before` shows FAIL, `_after` shows PASS (or `N/A` justified).
- `refactor_decision` present + concrete; `green_diff_summary` not disproportionate.
- On pass: `git commit -m "wu-N: <title>"` (on the feature branch).

### Retry policy (max 3): re-delegate with error context → main agent fixes directly → escalate to the user.

## Stage 2 — Inner loop (HARD GATE)
Run in order; on any FAIL, fix and restart the inner loop from the top:
1. **`/update-tests`** — every changed production file is covered; required suites run.
2. **`/verify`** — typecheck + test + lint + format:check + build all pass.
3. **`/code-review`** — PASS = P0–P2 = 0 (P3 nits non-blocking). Fix findings,
   re-run `/verify`, then re-run `/code-review` (never declare PASS on the strength
   of the fixes alone).

## Stage 3 — Docs
Run **`/update-docs`** — reflect the change in every triggered doc (esp.
`packages/core/src/spec.ts` STAGE_SPEC when the brick/token/action vocabulary
changed), or mark intentionally-unchanged with `file:line` evidence.

## Stage 4 — Land it
Only after Stages 2–3 PASS:
- Squash the `wu-N` commits into one feature commit:
  ```
  feat: <feature title>

  Work Units:
  - wu-1: <title>
  - wu-2: <title>
  ```
- Add a Changeset if a published `@facet/*` surface changed (`pnpm changeset`).
- Commit/push/PR only on the user's explicit go. If a worktree was used, offer to
  remove it (`git worktree remove ../facet-wt/<slug>`) once merged.

## Notes / safety
- `/refactor-audit` is periodic, owner-run — not part of this per-feature chain.
- Facet has no `/qa`, `/visual-check`, or `/commit-push-pr` (those are AMA2).
- Never merge or push without an explicit user go. Branch first; never commit on `main`.

## Output contract
1. `Branch / Worktree`
2. `WU Results` (per WU: pass/fail + RED→GREEN evidence + files)
3. `Inner Loop` (/update-tests, /verify, /code-review verdicts)
4. `/update-docs` verdict
5. `Feature commit` (or "awaiting user go")
