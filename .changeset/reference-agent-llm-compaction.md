---
"@facet/runtime": minor
"@facet/reference-agent": minor
"@facet/store-postgres": minor
"@facet/quickstart": minor
---

LLM context compaction for the reference agent.

- `@facet/runtime` gains a fourth persistence seam: `SummaryStore` — an opaque
  per-visitor rolling-summary record (monotonic `coveredThrough` guard,
  `delete` for rebuilds) with `MemorySummaryStore` in the main barrel and
  `FileSummaryStore` (distinct `.summary.json` extension) in
  `@facet/runtime/node`.
- `@facet/store-postgres` adds `PostgresSummaryStore` + `initSummarySchema`
  (`facet_summary` table, SQL-enforced monotonic upsert, NULL-safe corrupt-row
  repair).
- `@facet/reference-agent` compacts context with the same provider/model it
  acts with, sized in tokens calibrated from provider-reported usage: a
  background per-visitor cross-turn rolling summary (redacted, schema-validated,
  conversation-anchored, chunked under `maxSummarizerInputChars`, injected as a
  pinned user-role data block) and pair-safe in-turn tool-transcript folding
  with a shadow-refreshed stage block. Every summarizer failure degrades to the
  existing deterministic truncation. Budgets gain a token/compaction model
  (`maxContextTokens`, trigger/target ratios, verbatim windows, summary caps,
  cooldowns); provider adapters report `ProviderStep.usage` and declare
  `contextWindowTokens`; the Anthropic adapter enables `cache_control` prefix
  caching; new `compaction_triggered`/`compaction_done`/`compaction_failed`
  trace events.
- `@facet/quickstart` wires `MemorySummaryStore` by default (compaction ON out
  of the box) via `composeQuickstartAgent`; opt out with `summaryStore: null`
  or bring a durable store.
