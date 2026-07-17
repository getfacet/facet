---
"@facet/core": minor
"@facet/react": minor
"@facet/client": minor
"@facet/server": minor
"@facet/agent-tools": minor
"@facet/reference-agent": minor
"@facet/ag-ui": minor
"@facet/quickstart": patch
---

View-state channel: forwarded events can now carry an optional `view` snapshot
of the visitor's current browser view-state, so the live agent knows which
screen they are on. Purely additive and UI-IN inert — the stage document schema
is unchanged, no new round-trip is added, and `view` provably never reaches a
stage patch/fold/executor path.

- `@facet/core`: new `ViewSnapshot`/`Viewport`/`ColorMode` types,
  `VIEWPORTS`/`COLOR_MODES`/`MAX_VIEW_TOGGLED_KEYS`, and the single pure `sanitizeView` bounds
  source; optional `view?` added to every `ClientEvent`/`CollectedEvent`
  variant (forward⊆collected preserved).
- `@facet/server`: `/event` and `/record` clamp `view` via `sanitizeEventView`
  (calling core `sanitizeView`) without ever rejecting the event for `view`
  reasons.
- `@facet/react`: `StageRenderer` gains an optional read-only `onViewSnapshot`
  callback plus `captureViewSnapshot`/`useViewportColorMode`/`DeviceClasses`;
  viewport and effective `colorMode` are report-only; only colorMode selects the
  Theme paint branch and neither changes document layout.
- `@facet/client`: `persistView`/`loadPersistedView` persist the snapshot per
  agent link in `localStorage`, re-validated on read, degrading silently.
- `@facet/agent-tools`: prompt-kit guidance priming the agent to target the
  visitor's current screen.
- `@facet/reference-agent`: `describeEvent` renders one inert, escaped `view`
  prompt line (current + revisit).
- `@facet/ag-ui`: input normalizers pass a clamped `view` through via core
  `sanitizeView` instead of stripping it.
- `@facet/quickstart`: the built page attaches `view` on send, persists it, and
  seeds the revisit `visit` from storage (report-only, no auto-restore).
