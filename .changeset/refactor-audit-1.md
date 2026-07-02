---
"@facet/core": patch
"@facet/kit": patch
"@facet/bridge": patch
"@facet/react": patch
"@facet/client": patch
"@facet/runtime": patch
"@facet/server": patch
"@facet/agent-client": patch
---

Structural cleanup ahead of the first release (refactor-audit 1). Renames and
moves — all pre-first-publish, no shims: `BridgeOptions.mode`/`method` are now
`runner` ("spawn" | "persistent") and `continuity` ("oneshot" | "resume"), with
env vars `FACET_RUNNER`/`FACET_CONTINUITY`; unrecognized values now fail fast
instead of silently defaulting. `browserVisitorId` moved from `@facet/react` to
`@facet/client` (next to the transport that needs it). `@facet/kit`'s `grid()`
was removed (it was identical to `row()`), and `row()` now honors its `pad`
option. New in `@facet/core`: `createLruMap` (the shared bounded-LRU used by the
runtime session cache, the bridge resume ids, and the server frame log),
`AgentControlFrame`, `sanitizeActionPayload`/`isPrimitiveRecord`, and a base
`isTreeShaped`. The server's `createFacetServer` was decomposed into unit-tested
internal modules (frame log, late window, agent channel, offline) with no
behavior change; the late-result staleness guard now carries its arrival
`{index, era}` pair atomically. `@facet/client` no longer depends on
`@facet/runtime` at runtime. All packages now declare `engines`, `repository`,
and ship a LICENSE. (`@facet/*` are versioned together as a fixed group.)
