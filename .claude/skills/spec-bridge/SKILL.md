---
name: spec-bridge
description: >
  Translate an approved Facet feature-intake brief into an executable development
  spec + execution manifest (Work Units, TDD red checks, test traceability,
  invariant-fit audit). Use when you need concrete file/API candidates and an
  implementation sequence before coding. Runs a light context pass, then a
  writer and an independent reviewer in separate contexts.
allowed-tools: Read, Glob, Grep, Agent, AskUserQuestion, Write
---

# Spec Bridge (Facet)

> Convert a product brief into technical implementation planning: one human
> approval spec + one agent-executable manifest. Writer and reviewer run in
> SEPARATE contexts (the reviewer never sees the writer's reasoning) to avoid
> self-review blind spots.

## Purpose

- Input: approved intake brief (from `/feature-intake`).
- Outputs:
  - `specs/context/<slug>.md` (codebase evidence)
  - `specs/dev-specs/<slug>.md` (human approval spec)
  - `specs/dev-specs/<slug>.execution.yaml` (delegation manifest)
- Includes a light context pass as Stage 0 (no separate scout skill needed).

Use order: `/feature-intake` → `/spec-bridge` → implement (WU + TDD) → `/verify` → `/code-review`.

## Required context

1. `AGENTS.md` (Facet contract).
2. Intake brief: `specs/feature-intake/<slug>.md`.
3. `docs/ARCHITECTURE.md` and `docs/REVIEW-RULES.md`.
4. Spec template: `.claude/skills/spec-bridge/templates/dev-spec.md`.
5. Manifest template: `.claude/skills/spec-bridge/references/execution-manifest-template.yaml`.
6. QA gates: `.claude/skills/spec-bridge/references/spec-qa-gates.md`.

## Facet packages (map the brief to these — there are no "services")

`@facet/core` (bricks/tokens/patch/validate/protocol — browser-safe, node-free),
`@facet/runtime`, `@facet/agent`, `@facet/agent-client`, `@facet/server`,
`@facet/react`, `@facet/cli`, `@facet/kit`, `@facet/store-postgres`,
`@facet/bridge`, and `apps/playground`. Note which package(s) each Work Unit
touches; respect barrel exports and keep `@facet/core` free of Node-only imports.

## Architecture

```
Main agent (orchestrator)
  ├─ Stage 0  Context pass  → evidence map (file:line) → specs/context/<slug>.md
  ├─ Stage 1  Spec writer (subagent, separate context) → specs/dev-specs/<slug>.md
  ├─ Stage 1.5 Execution manifest → specs/dev-specs/<slug>.execution.yaml
  ├─ Stage 2  Spec reviewer (subagent, separate context) → gate report
  └─ Stage 3  Present → PASS: ask approval / FAIL: fix + re-review
```

## Workflow

### Stage 0 — Context pass
1. Read the intake brief; from `User Scenario`, `Invariant Fit`, and
   `Public API / Package Surface`, infer the affected `@facet/*` packages.
2. Spawn ONE `Explore` (or `general-purpose`) subagent to map, per affected
   package: the entry files, the existing patterns the feature must follow, and
   the exact `file:line` anchors the writer should reference. Ask it to return
   evidence, not prose.
3. Run the Facet RISK PROBES (only the ones the brief triggers):
   - **Invariant probe** — REQUIRED if the brief `Invariant Fit` marks any
     invariant `TOUCHES` (esp. #5 overlay, #6 two-writers, #1 backend). For each,
     record the concrete code seam + the mitigation the spec must implement as a
     `RISK-INV-N` item (with `file:line`).
   - **Public-API probe** — REQUIRED if a published `@facet/*` surface changes.
     Grep existing consumers (other packages + `apps/playground` + `examples/`)
     of the changed symbol; record additive vs breaking, and the migration for
     each consumer, as `RISK-API-N`.
   - **Cross-package coupling probe** — REQUIRED if the change moves/splits a
     module or adds an import across packages. Verify `@facet/core` stays
     node-free, barrel exports hold, and no import cycle is introduced; record
     as `RISK-PKG-N`.
   Each `RISK-*` item: detected pattern, `file:line`, proposed resolution. The
   writer MUST consume these (resolve in-spec or record an explicit waiver).
4. Save to `specs/context/<slug>.md`. If a probe finds the brief references a
   package/pattern that doesn't exist, STOP and report before proceeding.

### Stage 1 — Spec writer (separate context)
Spawn a `general-purpose` subagent (model: `fable`):
```
Agent(subagent_type="general-purpose", model="fable",
  prompt="Write a Facet development spec for '<slug>'.
   - Intake brief: specs/feature-intake/<slug>.md
   - Context evidence: specs/context/<slug>.md
   - Spec template: .claude/skills/spec-bridge/templates/dev-spec.md
   - Write to: specs/dev-specs/<slug>.md
   Follow the template. Use context evidence for accurate file:line paths.
   Report RESULT: DONE|FAIL.")
```
The writer MUST:
- preserve intake `DC-00N` ids and map `DC → file/function/test`.
- decompose into Work Units (**max 5 files each**); assign every file to exactly
  one WU; no orphan files.
- per WU: `owner_role`, `packages`, `depends_on`, `parallel_group`, `red_check`
  (TDD: a vitest command that FAILS before impl, PASSES after — or `N/A` with a
  justification for deletion/docs/move-only WUs), `quick_checks`,
  `no_regression_checks`, `test_plan` (type/target/covers_dc/action), and a
  `handoff_format` including `refactor_decision` + `green_diff_summary`.
- the union of all WU `test_plan.covers_dc` MUST cover every `DC-*`.
- include an **Invariant Fit Audit** section: for each invariant the brief marked
  `TOUCHES`, the concrete design that keeps it safe (esp. #6 two-writers:
  ordering/version rule; #5 overlay: the constrained brick shape; #3 fail-safe:
  what the renderer/validator does on bad input).
- include a `Fail-safe & boundary checklist` (malformed/empty/deep/cyclic input,
  offline agent, rapid events) and a risk register that resolves every `RISK-*`.
- include the final gate chain (Facet): `/verify` → `/code-review` (P0–P2=0),
  with `/refactor-audit` as periodic, and `final_gate_owner = main-agent`.

### Stage 1.5 — Execution manifest
Generate `specs/dev-specs/<slug>.execution.yaml` from
`.claude/skills/spec-bridge/references/execution-manifest-template.yaml`. Keep WU
ids, files, `depends_on`, `parallel_group`, `red_check`, `quick_checks`,
`no_regression_checks`, and `handoff_format` IDENTICAL to the Markdown spec. Keep
`final_gate_owner: main-agent`.

### Stage 2 — Spec reviewer (separate context)
Spawn a second `general-purpose` subagent (model: `fable`) that never saw the
writer's reasoning:
```
Agent(subagent_type="general-purpose", model="fable",
  prompt="Independently review the Facet dev spec. Be adversarial.
   - Spec: specs/dev-specs/<slug>.md
   - Manifest: specs/dev-specs/<slug>.execution.yaml
   - Brief: specs/feature-intake/<slug>.md
   - Context: specs/context/<slug>.md
   - Gates: .claude/skills/spec-bridge/references/spec-qa-gates.md
   Evaluate every gate. Verify file:line paths against context evidence.
   Verify spec/manifest consistency. Verify the Invariant Fit Audit is real,
   not hand-wave. Return a gate report with PASS/FAIL + evidence per gate.")
```

### Stage 2.5 — Codex adversarial review (OPTIONAL)
If a Codex reviewer is available in this environment, run it against the spec for
a second independent opinion and merge P1+ findings. If not available, skip with
a one-line log — this is not a gate violation for Facet.

### Stage 3 — Present
- **PASS** (reviewer P0=0, P1=0): show spec path, manifest path, gate summary,
  any P2/P3 (informational), then ask:
  `Approve this dev spec + manifest? After approval I'll execute WUs (TDD-first) and keep the final /verify + /code-review with the main agent.`
- **FAIL** (any P0/P1): show findings + evidence, then edit the spec directly and
  re-run ONLY the reviewer (Stage 2). Max 3 rounds, then escalate to the user.

## Hard failure rules
- Intake brief not found → FAIL (stop).
- Context pass finds a referenced package/pattern that doesn't exist → FAIL.
- Writer returns FAIL, or a required spec section is missing → FAIL.
- Missing execution manifest, or any spec/manifest mismatch (WU ids/files/deps/checks) → FAIL.
- No file/function candidates, or any orphan file → FAIL.
- `DC-*` ids missing or not traceable to a WU `test_plan` → FAIL.
- Any WU > 5 files → FAIL (split).
- Any prod-code WU missing `red_check` (or `red_check: N/A` without a valid
  deletion/docs/move justification) → FAIL.
- Missing `Invariant Fit Audit`, or any `TOUCHES` invariant without a concrete
  safe design → FAIL.
- Any `RISK-*` from Stage 0 dropped without resolution or explicit waiver → FAIL.
- `final_gate_owner` not `main-agent` → FAIL.
- Reviewer P0 or P1 → FAIL (fix before approval). 3 FAIL rounds → escalate.
- Starts implementation without approval → FAIL.

## Handoff — Work Unit execution (TDD-first)

After approval, the main agent orchestrates from the MANIFEST (not memory).

Per WU, spawn a `general-purpose` subagent with this work order (deviation = WU rejected):
- **STEP 1 RED**: run the WU's `red_check` BEFORE touching production code (only
  test files may change). It must FAIL → capture `red_check_output_before`.
  (`N/A` only for deletion/docs/move-only WUs, with justification.)
- **STEP 2 GREEN**: minimal production change within the WU's ≤5 files to flip RED
  → GREEN. Re-run; capture `red_check_output_after` (must PASS).
- **STEP 3 REFACTOR** (WU files only, STEP-2 code only): apply the minimal
  refactor if a trigger fires (function too long, dup ≥5 lines ×2, dead code,
  cross-package/`internal` leak, `@facet/core` gaining a node import); else skip
  with per-trigger evidence. Anything larger → record for `/refactor-audit`.
- **STEP 4 Report** (`handoff_format`): `changed_files`, `executed_commands`,
  `red_check_output_before` (FAIL), `red_check_output_after` (PASS),
  `green_diff_summary`, `refactor_decision`, `pass_fail`, `next_action`.
- Subagents do NOT run the final gate chain. `/verify` and `/code-review` stay
  with the main agent.

### DoD verification (main agent)
- Only the WU's listed files changed.
- `red_check_output_before` shows FAIL and `_after` shows PASS (or `N/A` justified).
- `refactor_decision` present and concrete. `green_diff_summary` not
  disproportionate to scope.
- On pass: `git commit` the WU (branch, not the default branch).

### Retry policy (max 3): re-delegate with error context → main agent fixes → escalate.

### Final gate chain (post-WU) — Facet
1. `/verify` (typecheck + tests + lint + format:check + build).
2. `/code-review` (PASS = P0–P2 = 0; P3 are non-blocking nits).
3. `/refactor-audit` — periodic, not required per feature (owner runs it).
4. Squash WU commits into one feature commit; commit/PR only on the user's
   explicit go (no `/qa`, `/visual-check`, `/update-docs`, `/commit-push-pr` in
   Facet — those are AMA2-only).

## Output contract
1. `Context Evidence Path`
2. `Spec Path` + `Execution Manifest Path`
3. `Writer Summary` (packages, DCs mapped, Work Units, risks resolved)
4. `Reviewer Verdict` (PASS/FAIL) + `Gate Report`
5. `Findings` (P0–P3 counts)
6. `Approval Required` (YES)
