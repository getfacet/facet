---
"@facet/core": patch
"@facet/runtime": patch
"@facet/reference-agent": patch
---

Consolidate component validation and sensitive-data redaction ahead of the first
release. All component nodes now pass through one canonical validator while the
stale partial `HIGH_LEVEL_NODE_TYPES` surface is removed. Runtime owns the shared
redaction helpers used at both Sink and prompt/history boundaries, and the record
settlement callback type is renamed to `RuntimeRecordSettlementObserver` to
distinguish it from the conversation `Sink`.
