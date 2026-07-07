---
"@facet/reference-agent": patch
"@facet/quickstart": patch
---

Split the reference agent public surface around the new provider, prompt, and
harness modules while preserving compatibility aliases. The package root now
exports the bounded harness budget presets/normalizer, stop and retry helpers,
sanitized trace event helpers, and loop summary/fallback types. The reference
agent and quickstart option types also include additive `budgetPreset`, `budget`,
and `trace` options. The harness now bounds stage JSON assembly before
stringifying large stages, degrades corrupt sink/stage input into safe prompt
placeholders, rejects malformed provider tool calls, preserves ordered tool
observations, and keeps terminal trace events when async trace sinks are
saturated.
