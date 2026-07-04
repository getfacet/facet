---
name: spec-bridge
description: >
  Translate an approved Facet feature-intake brief into an executable development
  spec + execution manifest (Work Units, TDD red checks, invariant-fit audit) via
  a Workflow: context pass + risk probes → writer → independent adversarial
  reviewer → bounded fix loop. Stops at an approvable plan. Use before coding.
allowed-tools: Read, Glob, Grep, Agent, AskUserQuestion, Write
---

# Spec Bridge (Facet)

> Convert a product brief into technical implementation planning — one human
> approval spec + one agent-executable manifest — run as a **Workflow**. Writer
> and reviewer run in SEPARATE contexts (the reviewer never sees the writer's
> reasoning) to avoid self-review blind spots. The workflow stops at an
> approvable plan; **you** (the main agent) own the human-approval step, which a
> workflow can't do.

Use order: `/context-scout` (optional) → `/feature-intake` → **`/spec-bridge`** →
`/implement` (→ `/update-tests` → `/verify` → `/code-review` → `/update-docs`).

## Before you launch — pick the slug

The workflow needs the intake-brief slug. Determine it from the approved brief in
`specs/feature-intake/<slug>.md` (ask the user if ambiguous). This is the one
decision that must be made before the workflow runs.

## Run it

Call the workflow (this skill is your opt-in to `Workflow`):

```
Workflow({ name: 'spec-bridge', args: { slug: '<slug>' } })
```

The workflow fans out discovery and verification and keeps authoring single:
**Context** (a package-map agent, then **parallel RISK-lens probes** — INV / API /
PKG, each an independent investigation — then a context writer assembles
`specs/context/<slug>.md`) → **Write** (a *single* separate-context author
produces `specs/dev-specs/<slug>.md` **and** the `.execution.yaml` manifest
together, so WU ids/files/deps/checks stay identical) → **Review** (an independent
**multi-reviewer panel**, one reviewer per gate-family — traceability /
decomposition / invariant-fit / risk-consistency — none of whom saw the writer;
findings unioned) → **Fix loop** (on P0/P1, a fixer edits the spec and the *whole
panel* re-runs, max 3 rounds). Watch live progress with `/workflows`.

All the hard gates (DC traceability, ≤5 files/WU, red_check present, Invariant Fit
Audit real, every RISK resolved, `final_gate_owner: main-agent`, spec/manifest
consistency) are split across the reviewer panel per
`.claude/skills/spec-bridge/references/spec-qa-gates.md`.

## After it returns — Stage 3 (yours, not the workflow's)

The workflow returns `{ verdict, awaitingApproval, escalate, contextPath,
specPath, manifestPath, workUnits, packages, risks, fixRounds, counts, findings,
gateReport }`. Also handle the early-stop shapes: `stop: 'BRIEF_NOT_FOUND' |
'CONTEXT_INVALID' | 'WRITER_FAILED' | 'REVIEWER_FAILED'`, and `error` (bad/no
slug).

- **PASS** (`awaitingApproval: true`) — show the spec path, manifest path, gate
  summary, any P2/P3 (informational), then ask the user:
  > Approve this dev spec + manifest? After approval I'll hand off to `/implement`
  > (WUs TDD-first) and keep the final `/verify` + `/code-review` with the main
  > agent.
  On approval, hand off to `/implement` with the slug.
- **FAIL** (`escalate: true` — 3 fix rounds exhausted) — show the remaining
  findings + `gateReport` and escalate to the user; do NOT approve or start
  implementation.
- **Early stop / error** — report the `stop`/`error` reason (e.g. run
  `/feature-intake` first if the brief is missing). Do not proceed.

## Hard rules (unchanged)

- Never start implementation without explicit user approval.
- Never approve on a FAIL verdict.
- The reviewer's gate list and the P0/P1 = must-fix rule are the source of truth;
  don't override the workflow verdict — fix (re-run) or escalate.

## Optional — Codex second opinion

The previous inline Stage 2.5 (Codex adversarial review) is not part of the
workflow. If a Codex reviewer is available and you want a second independent
opinion, run it against `specs/dev-specs/<slug>.md` after a PASS and merge any
P1+ findings before asking for approval. Skipping it is not a gate violation.

## Handoff — implementation

After approval, **execution is `/implement`'s job** (branch/worktree → Work Units
TDD-first from the manifest → inner-loop gates). Pass the slug so it can read
`specs/dev-specs/<slug>.md` + `specs/dev-specs/<slug>.execution.yaml`. This skill
stops at an approved, delegatable plan; it does not write production code.
