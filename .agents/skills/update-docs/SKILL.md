---
name: update-docs
description: >
  Keep Facet's docs (and the LLM-facing STAGE_SPEC) from drifting when code
  changes. Detects changed files, maps them to triggered docs, updates each, and
  requires evidence for anything left unchanged. Use after code changes, before
  commit, or when the user says "update docs".
---

# Update Docs (Facet)

> Don't let docs drift from code. Every triggered doc is either **updated** or
> marked **intentionally unchanged** with concrete `file:line` evidence — a claim
> without evidence is a FAIL.

## The Facet-specific one that's easy to forget
`packages/core/core/src/spec.ts` exports **`STAGE_SPEC`** — the canonical
brick/token/action vocabulary the LLM reads to draw pages. It is single-sourced
(the bridge spawn prompt, the persistent SYSTEM prompt, and the playground
generator all embed it). **Any change to the brick/token/action vocabulary MUST
update `STAGE_SPEC`**, or agents will keep drawing with the old vocabulary.
Treat it as a doc surface.

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
| Current Theme, Preset, Pattern, token, style, and asset-authoring workflow | `docs/DESIGN-SYSTEM.md` |
| Provider-neutral custom LLM loop, progressive reads, executor handoff, retries, and host-owned policy | `docs/AGENT-INTEGRATION.md` |
| Invariants, ownership, data flow, validation boundaries, renderer behavior | `docs/ARCHITECTURE.md` |
| Exact stage-tool result shape, outcomes, false-success, and recovery rules | `docs/AGENT-TOOL-RESULT-CONTRACT.md` |
| Package roles, collaborators, public/private boundaries, and deployment claims | `docs/PACKAGE-BOUNDARIES.md` |
| Pre-1.0 style hard-cut replacement steps only | `docs/STYLE-SYSTEM-MIGRATION.md` |
| One package's purpose, when/not to use it, install/API minimum | that package's `README.md` |

Do not add hand-maintained exhaustive Brick/property/token tables to a guide;
Core's closed contract and generated agent-facing specifications own exhaustive
vocabulary.

## Doc map (changed file → triggered doc)
| Changed code | Triggered doc(s) |
|---|---|
| `packages/core/core/src/{nodes,tokens,protocol}.ts` (Brick/token/action vocabulary) | **`packages/core/core/src/spec.ts` (STAGE_SPEC)** + `docs/ARCHITECTURE.md`; add `docs/DESIGN-SYSTEM.md` when the styling model or author workflow changes |
| Theme/Preset/Pattern/style contracts, validation, resolver, or default assets | `docs/DESIGN-SYSTEM.md` + affected Core/assets/renderer package `README.md`; `docs/ARCHITECTURE.md` only when ownership, resolution order, or failure boundaries change |
| `packages/core/core/src/{validate,patch}.ts` (fail-safe behavior) | `docs/ARCHITECTURE.md`; root `README.md` only if a headline guarantee changed |
| Stage-tool schema, progressive reads, executor handoff, or reusable prompt flow | `docs/AGENT-INTEGRATION.md` + affected agent package `README.md`; `docs/AGENT-TOOL-RESULT-CONTRACT.md` only if exact result/outcome behavior changed |
| Stage-tool result fields, outcomes, false-success, or recovery behavior | `docs/AGENT-TOOL-RESULT-CONTRACT.md` + `docs/AGENT-INTEGRATION.md` when the onboarding control flow changes |
| React/reference transport installation or wiring | `docs/GETTING-STARTED.md` + affected renderer/adapter package `README.md` |
| A published `@facet/*` public API (exports/signatures) | that package's `README.md` + the owning canonical guide; root `README.md` only if path selection or a headline capability changed |
| New / renamed / removed `@facet/*` package | `docs/PACKAGE-BOUNDARIES.md` + root `README.md` decision/role summary + `AGENTS.md` package map + a Changeset |
| Package role, collaborator, public subpath, or deployment positioning | `docs/PACKAGE-BOUNDARIES.md` + that package's `README.md` |
| `packages/tools/cli` / `packages/tools/bridge` commands or env vars | the package `README.md` + `docs/GETTING-STARTED.md` only when an adoption path changes + `CONTRIBUTING.md` for contributor-only usage + the CLI `--help` text |
| `packages/adapters/server` auth / CORS / trust behavior | `SECURITY.md` (trust model) + the server package `README.md`; `docs/GETTING-STARTED.md` only when adopter wiring or production guidance changes |
| Pre-1.0 style cutover/removal instructions | `docs/STYLE-SYSTEM-MIGRATION.md`; keep current model explanation in `docs/DESIGN-SYSTEM.md` |
| `.agents/skills/**`, `.claude/**`, `.codex/**`, review rubric | `docs/REVIEW-RULES.md`, `AGENTS.md` (Definition of Done) |
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
