---
"@facet/core": minor
"@facet/agent": minor
"@facet/react": minor
"@facet/runtime": minor
"@facet/quickstart": minor
"@facet/server": minor
"@facet/client": minor
---

Interaction phase 2 — `appear` animation tokens, `onHold` long-press, and bounded
`scroll` regions. Three additive, token-shaped words that grow the agent's
interaction vocabulary with **zero new protocol messages** and the two-writers
split untouched. (Overlay and drag were deferred from this bundle.)

The invariants hold: every new capability is a **token or a declared action**,
never a raw value — animation timing/curves and the scroll region's max height
live only in the renderer (framework constants, not theme documents, so
`validateTheme` stays closed to animation CSS); the fail-safe boundary strips
unknown `appear`/`scroll` tokens and malformed `onHold` on both the stored
(`validateTree`/`foldPatchIntoStage`/`validateStamp`) and raw render paths.

- `@facet/core`: `APPEARS` token group (`none`/`fade`/`slide`) + `Appear` type;
  `BoxStyle.appear?` and `BoxStyle.scroll?`; `BoxNode.onHold?: FacetAction`
  (the same action union as `onPress`, so a hold-emitted event is byte-identical
  in shape to a press — no gesture discriminator); `asAction` parameterized by
  field so `onHold` diagnostics name `onHold`; the `STAGE_SPEC` lines teaching
  all three (with the "hold is a secondary gesture — never gate critical content
  hold-only" advice). Trees without the new fields validate byte-identically.
- `@facet/react`: `onHold` long-press detection (`HOLD_MS`/`HOLD_SLOP_PX`,
  gesture-scoped to the arming pointer) routed through the ONE existing
  `classifyPress`/`handlePress` seam; the browser-synthesized post-hold click is
  swallowed by a window-capture one-shot interceptor so press and hold never both
  fire. Every box renders through ONE always-mounted internal element with
  nullable press/hold, so a live patch adding/removing `onHold` never remounts
  the subtree (uncontrolled field text and scroll offsets survive). `scroll:true`
  maps to a bounded `overflow-y:auto` region (theme-owned max-height,
  `min-height:0` so it clips inside a flex column). Framework-owned `APPEAR_CSS`
  (`fade`/`slide` keyframes + a `prefers-reduced-motion` gate) rides once per
  stage, gated on the budget-bounded render walk. Token-free trees stay
  byte-identical.

Real-browser verified (DC-009): animate-in, bounded inner scroll, and the
press-vs-hold split. One exotic multi-pointer edge (two simultaneous holds on two
boxes sharing one click interceptor) is a recorded maintainer-waived residual,
deferred to the drag bundle's pointer rework.

(`@facet/*` are versioned together as a fixed group.)
