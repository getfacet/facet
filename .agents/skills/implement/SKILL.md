---
name: implement
description: >
  Execute an approved Facet dev spec in Codex inside a /worktree-prep prepared
  worktree: run the Work Units TDD-first from the execution manifest, then run
  the feature hard gate (/update-tests → /verify → /code-review → /live-test →
  /update-docs). Use after /spec-bridge approval and /worktree-prep, or when the
  user says "implement the spec / build it" from a prepared worktree.
---

# Implement (Facet)

> Turn an approved spec + execution manifest into code inside a prepared
> worktree. Execute Work Units TDD-first and hold the feature hard gate with the
> main agent. This is the execution half after `/spec-bridge` planning and
> `/worktree-prep` isolation.

Pipeline: `/feature-intake` → `/spec-bridge` → `/worktree-prep` → **`/implement`** → (commit/PR on your go).

## Required context
1. `AGENTS.md` (Facet contract + Definition of Done).
2. Spec: `.agents/work/<slug>/dev-spec.md` and manifest
   `.agents/work/<slug>/execution.yaml`.
3. `docs/REVIEW-RULES.md` (the P0–P2 model the /code-review gate uses).
4. `/worktree-prep` output: branch, worktree path, artifact carry report, baseline result.
The manifest is the delegation source of truth — delegate from it, not from memory.

## Preconditions (STOP if unmet)
- The spec was reviewed and the user approved it. Never start without approval.
- `/worktree-prep` already created the isolated worktree and branch.
- The current directory is the prepared worktree on `feat/<slug>`.
- The spec and manifest exist in this worktree. If not, stop and run
  `/worktree-prep`; do not create another branch/worktree here.
- The working tree is clean except this feature's files. The approved plan
  directory is ignored and must remain under `.agents/work/<slug>/`; never stage
  it. Never touch other agents' uncommitted work; never git stash/switch without
  being asked.

## Stage 0 — Prepared workspace check
Confirm before any WU:

- branch is `feat/<slug>`
- `.agents/work/<slug>/dev-spec.md` exists
- `.agents/work/<slug>/execution.yaml` exists
- `/worktree-prep` baseline passed, or rerun `pnpm typecheck && pnpm test && pnpm lint`

## Stage 1 — Work Unit execution (TDD-first)
Read the manifest. Reuse `shared_preflight` once. Execute WUs in the spec's
`Execution Order` — parallel ONLY where a `parallel_group` marks disjoint file
sets. For each WU, spawn a Codex subagent with the same role as Claude Code's
`general-purpose` subagent and this work order. If no subagent tool is available,
stop and ask whether to run WUs inline; do not silently downgrade. Deviation from
this work order means the WU is rejected:

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
- On pass: `git commit -m "wu-N: <title>"` on the feature branch.

### Retry policy (max 3): re-delegate with error context → main agent fixes directly → escalate to the user.

## Stage 2 — Feature hard gate
Run in order; on any FAIL, fix and restart the inner loop from the top:
1. **`/update-tests`** — every changed production file is covered; required suites run.
2. **`/verify`** — typecheck + test + lint + format:check + build + source NUL
   scan all pass.
3. **`/code-review`** — PASS = P0–P2 = 0 (P3 nits non-blocking). Fix findings,
   re-run `/verify`, then re-run `/code-review` (never declare PASS on the strength
   of the fixes alone).
4. **`/live-test`** — Tier 1 always blocks; Tier 2 blocks when quickstart or the
   reference-agent provider loop changed; Tier 3/journey per `/live-test`
   policy.
5. **`/update-docs`** — reflect every triggered doc (esp.
   `packages/core/core/src/spec.ts` STAGE_SPEC when the brick/token/action vocabulary
   changed), or mark intentionally unchanged with `file:line` evidence.

## Stage 3 — Land it
Only after Stage 2 PASS:
- Remove the exact ignored `.agents/work/<slug>/` directory. Planning artifacts
  must not enter the feature commit.
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
- `/worktree-prep` owns branch/worktree creation; `/implement` owns WUs and gates.
- `/refactor-audit` is the refactor-flow entrypoint — not part of this feature
  hard gate.
- Facet has no `/qa`, `/visual-check`, or `/commit-push-pr` (those are AMA2).
- Never merge or push without an explicit user go. Branch first; never commit on `main`.

## Output contract
1. `Branch / Worktree`
2. `WU Results` (per WU: pass/fail + RED→GREEN evidence + files)
3. `Feature Hard Gate` (/update-tests, /verify, /code-review, /live-test, /update-docs verdicts)
4. `Feature commit` (or "awaiting user go")
