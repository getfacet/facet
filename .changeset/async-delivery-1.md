---
"@facet/core": patch
---

Async delivery & scale round 1 — an agent turn's result is never silently lost
and the reference deployment survives load. The server no longer discards a
result that outlives the per-event timeout: the visitor gets an interim note and
the finished result is applied and delivered when it arrives, guarded by an
era/index staleness check so a late result can never overwrite a newer stage.
Browser SSE frames carry a per-session sequence (`id: era:seq`); reconnects
resume via standard `Last-Event-ID` (join-first + gap replay — the documented
reconnect say-loss window is closed), with full rehydrates preceded by an
explicit `reset` message (the client no longer synthesizes one on reopen — pair
the reference client and server together). New: `createSemaphore` in
`@facet/core`; `FacetRuntime.applyMessages`; `FacetServerOptions.agentStaleMs`;
spawn-mode concurrency cap `BridgeOptions.maxConcurrent` / `FACET_MAX_CONCURRENT`
(default 4, FIFO, per-visitor order preserved); a fixed 10s abort on the
client's event POSTs. (`@facet/*` are versioned together as a fixed group.)
