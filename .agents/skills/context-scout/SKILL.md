---
name: context-scout
description: >
  Deterministic pre-implementation context gathering for Facet. Detects changed
  files, maps them to packages, reads the docs + code entrypoints each change
  needs, sweeps cross-package consumers of any changed public surface, and
  returns a GO/NO-GO with evidence. Use before coding a non-trivial change (or
  when the user says "context-scout"). For the /spec-bridge flow this is already
  done inline as its Stage 0 — run this standalone for direct implementation.
---

# Context Scout (Facet)

> Gather context first, then implement. Non-doc changes: required. Docs-only:
> optional (skip with an explicit reason).

## Required context
- `AGENTS.md` (Facet contract + invariants).
- `docs/ARCHITECTURE.md` (the two-layer model + fail-safe invariants).
- The affected package's entrypoints + its `README.md` (bridge/client have one).

## Detect changes (triple git diff)
```
git diff --name-only HEAD
git diff --name-only --cached
git ls-files --others --exclude-standard
```
Merge into one changed-files list.

## Workflow

### Step 1 — Parse & classify
1. Parse task intent (goal, non-goal, done criteria).
2. Classify:
   - docs-only (`*.md`, `docs/**`) → skip allowed with an explicit reason.
   - any code/config/build path → must proceed.

### Step 2 — Map changed files to packages
| Path | Package / area |
|---|---|
| `packages/core/**` | `@facet/core` (bricks/tokens/patch/validate/protocol/spec — browser-safe, node-free) |
| `packages/runtime/**` | `@facet/runtime` |
| `packages/agent/**` | `@facet/agent` |
| `packages/agent-client/**` | `@facet/agent-client` |
| `packages/client/**` | `@facet/client` |
| `packages/server/**` | `@facet/server` |
| `packages/react/**` | `@facet/react` |
| `packages/assets/**` | `@facet/assets` |
| `packages/cli/**` | `@facet/cli` |
| `packages/store-postgres/**` | `@facet/store-postgres` |
| `packages/bridge/**` | `@facet/bridge` |
| `packages/quickstart/**` | `@facet/quickstart` |
| `apps/playground/**` | playground (integration surface) |
| `.agents/**`, `.codex/**`, `specs/**`, `.changeset/**`, root `*.md`, `docs/**` | infra/docs/planning |

### Step 3 — Gather evidence per affected package
For each affected package, collect (as `file:line`):
- **Docs read**: `AGENTS.md`, `docs/ARCHITECTURE.md`, the package `README.md` if present.
- **Code entrypoints read**: the package barrel `index.ts` + the files the change
  will touch + the existing pattern it must follow.
- **Planned edit set**: the concrete files you expect to change.
- **Open questions / assumptions**.
Solo/default: read inline. For a wide change you MAY spawn one `Explore` subagent
per package to return evidence; otherwise inline.

### Step 3.5 — Cross-package consumer sweep (Facet's version of the consumer map)
**Trigger** when the change adds / renames / removes a PUBLISHED surface — an
export in a package barrel `index.ts`, a brick/token/action shape in `@facet/core`,
a protocol type, or a CLI command.

Facet's "consumer trees" are the other packages + the playground + examples:
```
git grep -n -- '<symbol-or-string>' packages apps/playground examples 2>/dev/null
```
Record one row per (surface × consumer area). Show `(no match)` with the literal
command + `0` when empty — never a free-form "not used" claim. For every hit,
name where the migration happens. Special Facet checks:
- If the change touches the brick/token/action vocabulary → the LLM-facing
  `packages/core/src/spec.ts` (STAGE_SPEC) is a consumer; flag it.
- `@facet/core` must stay node-free; flag any new Node-only import.

### Step 3.6 — Invariant touch check (Facet-specific)
Note which of Facet's invariants the change touches (so implementation stays
honest): UI-out/UI-in boundary (no backend/domain), mechanism-vs-policy,
fail-safe, declarative-only, flow-only overlay, two-writers coherence,
backend-via-agent. Mark each `untouched` / `touched (how it stays safe)`.

### Step 4 — Evaluate
Check: every affected package has doc + entrypoint evidence (`file:line`); the
evidence map covers the planned edit set; the consumer sweep (if triggered) shows
a command + count per consumer area; the test plan names ≥1 test per affected
package.

### Step 5 — Decide: `GO` or `NO-GO`.

## Hard failure rules
- Non-doc change without a scout report → FAIL.
- Affected package missing doc or entrypoint evidence (`file:line`) → FAIL.
- Consumer sweep triggered but a consumer area is missing, or a row is a
  free-form claim instead of a literal grep + count → FAIL.
- Vocabulary changed but STAGE_SPEC not flagged as a consumer → FAIL.
- An open assumption not declared → FAIL.

## Output contract
1. `Task Intent`
2. `Changed Scope` (packages)
3. `Must-Read Docs` (with file:line)
4. `Must-Read Code Entrypoints` (with file:line)
5. `Evidence`
6. `Cross-Package Consumer Sweep` (or `SKIPPED — no published surface changed`)
7. `Invariant Touch` (per invariant)
8. `Planned Edit Set`
9. `Test Plan`
10. `Open Questions / Assumptions`
11. `Decision` (`GO` / `NO-GO`) + `Overall` (`PASS` / `FAIL`)

## Next steps
- `PASS` + `GO` → implement (or feed the evidence into `/implement`).
- `NO-GO` → resolve missing context first.
