---
name: update-docs
description: >
  Keep Facet's docs (and the LLM-facing STAGE_SPEC) from drifting when code
  changes. Detects changed files, maps them to triggered docs, updates each, and
  requires evidence for anything left unchanged. Use after code changes, before
  commit, or when the user says "update docs".
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git ls-files:*), Read, Edit, Glob, Grep, Agent
---

# Update Docs (Facet)

> Don't let docs drift from code. Every triggered doc is either **updated** or
> marked **intentionally unchanged** with concrete `file:line` evidence — a claim
> without evidence is a FAIL.

## The Facet-specific one that's easy to forget
`packages/core/src/spec.ts` exports **`STAGE_SPEC`** — the canonical brick/token/
action vocabulary the LLM reads to draw pages. It is single-sourced (the bridge
spawn prompt, the persistent SYSTEM prompt, and the playground generator all embed
it). **Any change to the brick/token/action vocabulary MUST update `STAGE_SPEC`**,
or agents will keep drawing with the old vocabulary. Treat it as a doc surface.

## Detect changes
```
git diff --name-only HEAD
git diff --name-only --cached
git ls-files --others --exclude-standard
```
Merge the three lists.

## Skip rule
- Only docs changed (`*.md`, `docs/**`) and no code/config change → skip with an
  explicit reason.
- Any code/config/schema change → do NOT skip.

## Doc map (changed file → triggered doc)
| Changed code | Triggered doc(s) |
|---|---|
| `packages/core/src/{nodes,tokens,protocol}.ts` (brick/token/action vocabulary) | **`packages/core/src/spec.ts` (STAGE_SPEC)** + `docs/ARCHITECTURE.md` |
| `packages/core/src/{validate,patch}.ts` (fail-safe behavior) | `docs/ARCHITECTURE.md` (invariants) + `README.md` if a headline guarantee changed |
| A published `@facet/*` public API (exports/signatures) | that package's `README.md` (bridge/client have one; add one if the surface is user-facing) + root `README.md` if it's a headline capability |
| New / renamed / removed `@facet/*` package | root `README.md` (package list) + `AGENTS.md` (package list) + a Changeset |
| `packages/cli` / `packages/bridge` commands or env vars | `README.md` / `CONTRIBUTING.md` usage + the package `README.md` + the CLI `--help` text |
| `packages/server` auth / CORS / trust behavior | `SECURITY.md` (trust model) + `packages/server` docstring |
| `.Codex/skills/**`, review rubric | `docs/REVIEW-RULES.md`, `AGENTS.md` (Definition of Done) |
| Release/versioning setup | `CONTRIBUTING.md`, `CHANGELOG.md` |

## Workflow
1. Merge the changed-files list; map each to triggered docs via the table.
2. For each triggered doc: read it, edit to reflect the change (keep the existing
   structure/format), OR declare it **Intentionally Unchanged** with all three:
   `reason`, `impact_boundary`, `evidence_ref` (`file:line` proving it's still accurate).
3. STAGE_SPEC check: if any vocabulary file changed, confirm `spec.ts` matches the
   new brick/token/action set (this is the most common miss).
4. Report. Every triggered doc must appear as Updated or Intentionally-Unchanged.

## Hard gate — triggered-doc accountability
- Triggered doc in neither list → FAIL.
- Intentionally Unchanged without `reason + impact_boundary + evidence_ref` → FAIL.
- Vocabulary changed but `STAGE_SPEC` not updated (and not evidenced as unaffected) → FAIL.
- Triggered doc path doesn't exist → FAIL.

## Scale (optional)
Solo/default: main agent updates docs inline. For a wide change you MAY spawn a
`general-purpose` subagent per doc cluster; otherwise inline.

## Output contract
```
DOC UPDATE RESULT
Changed files: [...]
Triggered docs:
  - <doc> (trigger: <changed file>)
Docs updated:
  ✅ <doc> — <what changed>
Docs intentionally unchanged:
  ⏭️ <doc> — reason / impact_boundary / evidence_ref=<file:line>
STAGE_SPEC: updated / unaffected (evidence) / N/A
OVERALL: PASS / FAIL
```

## Next step
On PASS → commit/PR on the user's explicit go.
