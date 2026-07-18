---
"@facet/reference-agent": minor
"@facet/server": minor
"@facet/react": minor
---

Add opt-in observability and replay initialization seams without changing
existing defaults.

- `@facet/reference-agent` adds per-provider model selection, caller-driven
  provider-attempt and retry-backoff cancellation, and bounded synchronous
  lifecycle/tool diagnostics. Custom two-argument providers remain compatible,
  and omitted model, signal, and observer options preserve prior behavior.
- `@facet/server` adds a best-effort observer for normalized UI input and
  accepted live/late frames. Observations are detached and frozen; observers
  cannot affect authoritative folding, persistence, delivery, or stale-frame
  policy.
- `@facet/react` adds one-shot, Core-sanitized `StageRenderer.initialView`
  hydration for replay screen, toggle, and table-sort state. Later prop changes
  do not control renderer-local interaction state; remount to hydrate another
  checkpoint.
