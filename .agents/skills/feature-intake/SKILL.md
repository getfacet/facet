---
name: feature-intake
description: >
  Turn a rough Facet feature idea into a structured, testable brief through a
  guided conversation — before any technical design. Use when the user describes
  a feature in plain language and you need a complete, internally-consistent brief
  that also fits Facet's architecture invariants.
allowed-tools: Read, Write, AskUserQuestion, Glob, Grep
---

# Feature Intake (Facet)

> Convert a rough idea into a structured, testable feature brief through guided
> conversation. The brief must be complete, internally consistent, AND fit
> Facet's responsibility boundary and invariants.

## Purpose

A product-intake conversation layer that runs BEFORE technical design.

- Captures intent + acceptance criteria in plain language.
- Does NOT produce code/file/API edits (that is `/spec-bridge`).
- Adds one thing the generic intake doesn't: an **Invariant Fit** check, because
  in Facet the wrong feature can quietly break the whole thesis (see below).

Use order: `/context-scout` (optional) → `/feature-intake` → `/spec-bridge` → `/implement` (→ `/update-tests` → `/verify` → `/code-review` → `/update-docs`).

## Required context (read first)

1. `AGENTS.md` (repo root — the Facet contract; `AGENTS.md` is a symlink to it).
2. `docs/ARCHITECTURE.md`.
3. `docs/REVIEW-RULES.md` (the P0–P2 severity model).
4. Template: `.Codex/skills/feature-intake/templates/feature-intake-template.md`.
5. Consistency checklist: `.Codex/skills/feature-intake/references/consistency-checklist.md`.

## Facet's invariants (the brief MUST respect these)

These are the load-bearing decisions. A feature that violates one is almost
always the wrong feature — surface the conflict, don't design around it silently.

1. **Responsibility boundary.** Facet owns only UI-OUT (the agent draws) and
   UI-IN (user events flow to the agent). The DOMAIN/BACKEND (fetch data, place
   orders, DB) is the agent's OWN tools, brought by the operator. Facet must not
   grow backend affordances (no `kind:"fetch"`, no arbitrary-URL data binding).
2. **Mechanism vs policy.** Facet provides capability; the AGENT authors both
   structure and behavior. Don't move authoring decisions into the framework.
3. **Fail-safe.** The renderer/validator never throw, never inject, and degrade
   to "plain" on bad input. Bricks are declarative data — never raw HTML/JS/CSS.
4. **Declarative + tokens only.** No pixels/hex/raw CSS in the tree; only the
   token vocabulary. New visual capability = new tokens or a new brick, not an
   escape hatch.
5. **Flow-only safety.** Boxes stack/wrap and never overlap or fall off-screen.
   Overlap (dropdown/modal) is allowed only via a constrained, dedicated brick —
   never a general z-index escape hatch.
6. **Two-writers discipline.** If the browser executes interactions locally
   (pre-declared actions), the server-authoritative stage must stay coherent with
   the agent's edits (ordering/version). Any feature that adds local execution
   must say how.
7. **Backend calls go through the agent**, never a client-side fetch from the page.

## Output

One brief file: `specs/feature-intake/<feature-slug>.md`
(template: `.Codex/skills/feature-intake/templates/feature-intake-template.md`).

## Required sections (must capture)

1. `Goal` (outcome, not implementation)
2. `Current Problem` (concrete pain + who is affected)
3. `User Scenario` (step-based; for Facet, name WHO the user is — the agent
   author using the framework, and/or the end-user of a page an agent built)
4. `Input/Output Examples` (≥1 normal, ≥1 edge/error)
5. `Constraints (What not to do)` (explicit non-goals)
6. `Policy & Edge Cases` (per scenario step: failure / boundary / concurrency)
7. `Done Criteria` (testable, each with a verification method and a stable ID
   `DC-001…`; include ≥1 happy-path and ≥1 boundary/error)
8. `Invariant Fit` (**Facet-specific, REQUIRED**) — for each of the 7 invariants
   above: does this feature comply, and if it touches one (e.g. adds local
   execution → #6, adds overlap → #5), how does it stay safe? Mark
   `OK / TOUCHES (mitigation) / CONFLICT`.
9. `Decision Lock` (Decision | Assumption | Open Question; with owner + checkpoint)

## Recommended (when relevant)

- `Public API / package surface` — which `@facet/*` packages' PUBLISHED surface
  changes, and whether it's additive or breaking (pre-1.0, but still note it).
- `Priority`, `Data/privacy notes`, `Open questions`.

## Interview workflow

### Stage A — completeness
1. Start from the user's own words; don't force jargon.
2. Fill required sections with short question rounds:
   - one short question per turn; offer A/B/C options where possible.
   - if the user is unsure, propose a sensible default and mark it an Assumption.
   - for each scenario step, probe error/boundary/concurrency before moving on.
3. Deep probing (all features): for each scenario step ask failure policy,
   input boundaries, and concurrency/duplicate-trigger behavior.

### Stage A.5 — Invariant Fit probe (Facet-specific)
Walk the 7 invariants explicitly. In particular, ask:
- Does this need the backend? → then it belongs to the agent's tools, not Facet.
  Re-scope to "Facet gives the capability; the agent calls its own tool."
- Does an interaction need to run WITHOUT the LLM? → it's a local pre-declared
  action → invoke #6 (two-writers) and record how the stage stays coherent.
- Does anything need to float/overlap? → #5, constrained overlay brick only.
- Does it add expression/logic to declared actions? → watch the DSL line: static
  patches + a tiny closed op set at most; real logic is the agent's job.

### Stage B — consistency
Run `references/consistency-checklist.md` (includes the Invariant Fit gate). If a
contradiction or a hard invariant CONFLICT remains, mark the intake `FAIL` and
ask focused follow-ups.

### Stage C — produce brief and confirm
Write the file, show a concise summary, then ask:
`Approve this intake brief? If yes, proceed with /spec-bridge.`

## Quality gate (before finalizing)
- Goal outcome-oriented; Problem has concrete pain + affected user.
- Scenario step-based; Input/Output has a normal AND an edge case.
- Constraints include explicit non-goals.
- Every Done Criterion is pass/fail testable with a verification method + stable ID.
- Invariant Fit filled for all 7, with mitigations for any `TOUCHES`.
- Decision Lock covers every high-impact choice; Assumptions/Open Questions have
  an owner + resolution checkpoint.

## Hard failure rules
- Any of the 9 required sections missing → FAIL.
- Done criteria not testable / missing verification method / missing `DC-00N` IDs → FAIL.
- Done criteria missing boundary/error coverage → FAIL.
- `Invariant Fit` missing, or any invariant marked `CONFLICT` without a re-scope → FAIL.
- Assumptions not labeled, or Assumption/Open-Question without owner + checkpoint → FAIL.
- Any unresolved contradiction across scenario / constraints / done criteria → FAIL.
- A feature that requires Facet to own backend/domain work → FAIL (re-scope to the
  agent's own tools).

## Output contract
1. `Brief Path`
2. `Coverage Check` (required sections pass/fail)
3. `Invariant Fit` summary (per invariant: OK / TOUCHES / CONFLICT)
4. `Decision Lock`
5. `Consistency Gate` (PASS/FAIL + blockers)
6. `Ready for Spec Translation` (YES/NO)

## Next skill
After approval → `/spec-bridge`.
