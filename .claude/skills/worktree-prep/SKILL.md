---
name: worktree-prep
description: >
  Prepare an isolated Facet git worktree before implementation: choose feature or
  refactor flow, create the branch/worktree, ensure approved spec or refactor
  plan artifacts are present there, install dependencies, run baseline checks,
  and output a ready-to-run prompt or continue into /implement. Use after
  /spec-bridge approval and before /implement, or before executing an approved
  /refactor-audit cleanup item.
allowed-tools: Read, Write, Glob, Grep, Bash, AskUserQuestion, Skill
---

# /worktree-prep

Prepare the workspace where implementation will happen. This skill owns branch
and worktree setup; `/implement` should run inside the prepared worktree.

## Required Context

1. `AGENTS.md` — flow and gate definitions.
2. Feature flow: `.agents/work/<slug>/dev-spec.md` and
   `.agents/work/<slug>/execution.yaml`.
3. Refactor flow: the approved `/refactor-audit` finding or owner-approved
   cleanup scope.
4. Current `git status --short` and `git worktree list`.

## Pick The Flow

- **Feature** — approved `/spec-bridge` output exists. Branch:
  `feat/<slug>`. Next skill: `/implement`.
- **Refactor** — approved `/refactor-audit` cleanup item/scope. Branch:
  `refactor/<slug>`. Next action: execute the approved refactor item with the
  refactor hard gate.

If the user did not name a slug/scope and multiple candidates exist, ask a
concise question before creating anything.

## Preconditions

- Do not stash, reset, or discard another agent's work.
- If the current worktree has unrelated dirty files, stop and ask where to prep
  from. Approved plans are ignored under `.agents/work/<slug>/` and therefore do
  not justify any tracked or untracked dirty path shown by `git status`.
- Do not create a branch or worktree that already exists unless the user asks to
  reuse it.

## Stage 1 — Create Worktree

Default directory: `../facet-wt/<slug>`.

Use an up-to-date `main` when available:

```bash
git fetch origin
git worktree add ../facet-wt/<slug> -b <branch> origin/main
```

If `origin/main` is unavailable, use local `main` only after reporting the
fallback:

```bash
git worktree add ../facet-wt/<slug> -b <branch> main
```

Then enter the worktree and install dependencies:

```bash
cd ../facet-wt/<slug>
pnpm install
```

## Stage 2 — Carry Plan Artifacts

Feature worktrees must contain the approved planning artifacts:

- `.agents/work/<slug>/intake.md`
- `.agents/work/<slug>/context.md`
- `.agents/work/<slug>/dev-spec.md`
- `.agents/work/<slug>/execution.yaml`

`.agents/work/` is gitignored, so these files are never carried by Git. After
creating the target worktree, create only `.agents/work/<slug>/`, copy the four
exact files from the source worktree, and verify each target file is byte-for-byte
identical. Never copy the broad `.agents/work/` directory or unrelated ignored
files. Only after all four target files pass that check, remove the exact source
`.agents/work/<slug>/` directory so local planning state does not accumulate.

If a required feature artifact is missing from both source and target, stop and
return `FAIL — missing plan artifact`; run `/spec-bridge` first.

## Stage 3 — Baseline

Run the shared baseline before implementation:

```bash
pnpm typecheck
pnpm test
pnpm lint
```

Any failure means the prep result is `FAIL`; fix baseline or choose a different
base before running implementation.

## Stage 4 — Handoff

If the user asked to prepare only, output a prompt they can paste into the new
thread or agent session:

```text
Working directory: <absolute worktree path>
Flow: <feature|refactor>
Branch: <branch>
Slug/scope: <slug>

Use the Facet repo instructions in AGENTS.md.
If Flow=feature: run /implement for <slug>. The worktree is already prepared;
do not create another branch/worktree. Execute WUs TDD-first from
.agents/work/<slug>/execution.yaml, then run the feature hard gate:
/update-tests -> /verify -> /code-review -> /live-test -> /update-docs.

If Flow=refactor: execute only the approved refactor scope, avoid behavior
changes unless explicitly approved, then run the refactor hard gate:
/update-tests -> /verify -> /code-review -> /update-docs.
Run /live-test too if live-link surfaces were touched or the owner requests it.
```

If the user asked to continue directly and the flow is feature, switch to the
worktree and run `/implement` with the slug. If the flow is refactor, execute the
approved refactor scope in that worktree and hold the refactor hard gate.

## Output Contract

1. `Flow`
2. `Branch`
3. `Worktree Path`
4. `Plan Artifacts` copied/present/missing
5. `Baseline` PASS/FAIL with commands
6. `Handoff Prompt` or `Next Skill Started`
