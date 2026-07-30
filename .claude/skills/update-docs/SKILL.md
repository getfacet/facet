---
name: update-docs
description: >
  Keep Facet's docs and agent-facing markup/catalog/tool contracts from drifting
  when code changes. Detects changed files, maps them to triggered docs, updates
  each, and requires evidence for anything left unchanged. Use after code
  changes, before commit, or when the user says "update docs".
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git ls-files:*), Read, Edit, Glob, Grep, Agent
---

# Update Docs (Facet)

> Don't let docs drift from code. Every triggered doc is either **updated** or
> marked **intentionally unchanged** with concrete `file:line` evidence — a claim
> without evidence is a FAIL.

## The Facet-specific surfaces that are easy to forget
The agent sees a compact component boundary index, lazy component specs, current
screen snapshots, data summaries, and exactly nine tool schemas. Any markup
grammar, catalog metadata, action/data reference, observation, or tool change
must update every generated/prompt surface that exposes it. The retired monolithic
stage prompt must not be recreated.

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

## Canonical homes (choose one owner)

Route a subject to its owning document. Link to that document from other
surfaces instead of copying the same explanation:

| Subject | Canonical home |
|---|---|
| First evaluation, mental model, use-case choice, headline safety | `README.md` |
| Prerequisites, installation, supported adoption paths, React/reference wiring | `docs/GETTING-STARTED.md` |
| Semantic tokens, default component catalog, trusted custom registry, and asset workflow | `docs/DESIGN-SYSTEM.md` |
| Provider-neutral custom LLM loop, component discovery, progressive reads, executor handoff, retries, and host-owned policy | `docs/AGENT-INTEGRATION.md` |
| Invariants, ownership, data flow, validation boundaries, renderer behavior | `docs/ARCHITECTURE.md` |
| Exact stage-tool result shape, outcomes, false-success, and recovery rules | `docs/AGENT-TOOL-RESULT-CONTRACT.md` |
| Package roles, collaborators, public/private boundaries, and deployment claims | `docs/PACKAGE-BOUNDARIES.md` |
| One package's purpose, when/not to use it, install/API minimum | that package's `README.md` |

Do not add hand-maintained exhaustive component/property/token tables to a
guide. The active validated catalog and generated lazy component specifications
own exhaustive vocabulary.

## Doc map (changed file → triggered doc)
| Changed code | Triggered doc(s) |
|---|---|
| Markup grammar/parser, catalog/prop schemas, action/data references | `docs/ARCHITECTURE.md` + `docs/AGENT-INTEGRATION.md` + affected Core/agent-tools package `README.md`; add `docs/DESIGN-SYSTEM.md` when tokens/default components change |
| Semantic-token/default-catalog/registry contracts or default assets | `docs/DESIGN-SYSTEM.md` + affected Core/assets/renderer package `README.md`; `docs/ARCHITECTURE.md` when ownership, bootstrap, or failure boundaries change |
| Core document/data/authorized-patch fail-safe behavior | `docs/ARCHITECTURE.md`; root `README.md` only if a headline guarantee changed |
| Stage-tool schema, progressive reads, executor handoff, or reusable prompt flow | `docs/AGENT-INTEGRATION.md` + affected agent package `README.md`; `docs/AGENT-TOOL-RESULT-CONTRACT.md` only if exact result/outcome behavior changed |
| Stage-tool result fields, outcomes, false-success, or recovery behavior | `docs/AGENT-TOOL-RESULT-CONTRACT.md` + `docs/AGENT-INTEGRATION.md` when the onboarding control flow changes |
| React/reference transport installation or wiring | `docs/GETTING-STARTED.md` + affected renderer/adapter package `README.md` |
| A published `@facet/*` public API (exports/signatures) | that package's `README.md` + the owning canonical guide; root `README.md` only if path selection or a headline capability changed |
| New / renamed / removed `@facet/*` package | `docs/PACKAGE-BOUNDARIES.md` + root `README.md` decision/role summary + `AGENTS.md` package map + a Changeset |
| Package role, collaborator, public subpath, or deployment positioning | `docs/PACKAGE-BOUNDARIES.md` + that package's `README.md` |
| `packages/adapters/server` auth / CORS / trust behavior | `SECURITY.md` (trust model) + the server package `README.md`; `docs/GETTING-STARTED.md` only when adopter wiring or production guidance changes |
| `.agents/skills/**`, `.claude/**`, `.codex/**`, review rubric | `docs/REVIEW-RULES.md`, `AGENTS.md` (Definition of Done) |
| Release/versioning setup | `CONTRIBUTING.md`, `CHANGELOG.md` |

## Workflow
1. Merge the changed-files list; map each to triggered docs via the table.
2. For each triggered doc: read it, edit to reflect the change (keep the existing
   structure/format), OR declare it **Intentionally Unchanged** with all three:
   `reason`, `impact_boundary`, `evidence_ref` (`file:line` proving it's still accurate).
3. Agent-surface check: if grammar/catalog/tool/observation files changed,
   confirm the compact index, lazy spec reads, prompt, tool schemas, and examples
   all describe the same contract.
4. Report. Every triggered doc must appear as Updated or Intentionally-Unchanged.

## Hard gate — triggered-doc accountability
- Triggered doc in neither list → FAIL.
- Intentionally Unchanged without `reason + impact_boundary + evidence_ref` → FAIL.
- Grammar/catalog/tool/observation changed but an agent-facing consumer was
  neither updated nor evidenced as unaffected → FAIL.
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
Agent-facing contract: updated / unaffected (evidence) / N/A
OVERALL: PASS / FAIL
```

## Next step
On PASS → commit/PR on the user's explicit go.
