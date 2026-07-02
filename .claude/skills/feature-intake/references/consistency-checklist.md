# Feature Intake Consistency Checklist (Facet)

Run after the required sections are filled. Goal: catch section-complete but
contradictory (or invariant-breaking) briefs.

## 1) Scenario vs Constraints
- Does any scenario step violate a stated non-goal?
- Do constraints forbid behavior the done criteria still require?

## 2) Scenario vs Done Criteria
- Does each core scenario map to ≥1 done criterion?
- Is every done criterion observable in the scenario/examples?
- Are edge/error scenarios covered by ≥1 validation criterion?
- Do done criteria use stable IDs (`DC-001`, …)?

## 3) Actor clarity
- For each step, is the actor explicit (agent author / end-user / the agent brain)?
- If an interaction is meant to run WITHOUT the brain, is that stated?

## 4) Invariant Fit gate (Facet-specific — the important one)
- Is the `Invariant Fit` section filled for all 7 invariants?
- Is there any `CONFLICT` left unresolved? (→ FAIL — re-scope the feature)
- For each `TOUCHES`, is the mitigation concrete (not "we'll handle it later")?
- Backend/domain smell: does the feature need Facet to fetch/compute/store domain
  data? → it belongs to the agent's own tools; re-scope so Facet only provides the
  UI capability and the agent calls its tool.
- Local-execution smell: does an interaction run without the LLM? → invariant #6
  (two-writers) must be addressed in the brief, not deferred.
- Overlay smell: does anything float over content? → invariant #5, dedicated
  overlay brick only, never a general escape hatch.
- DSL smell: do declared actions need conditions/math? → hold the line (static
  patches + tiny closed ops; real logic is the agent's job).

## 5) Decision Lock health
- High-impact choices tagged Decision / Assumption / Open Question.
- Assumptions include impact-if-wrong.
- Open Questions include owner + resolution checkpoint.

## Gate result
- `PASS` when no unresolved contradiction AND no unresolved invariant CONFLICT.
- `FAIL` when any contradiction affects scope/testability, or any invariant is in
  CONFLICT without a re-scope.
