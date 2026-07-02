---
"@facet/core": patch
"@facet/react": patch
"@facet/runtime": patch
"@facet/server": patch
"@facet/client": patch
"@facet/agent-client": patch
---

Hardening campaign 1 — robustness fixes across the protocol, renderer,
transports, and stores (21 verified review findings). Highlights: RFC 6902
`test` op now uses structural deep-equal and array index tokens are strictly
validated (invalid ops throw; the runtime's per-op salvage still absorbs them);
`validateTree` and the renderer dedupe duplicate sibling ids; `MAX_DEPTH` and
the theme `COLOR` palette are exported single sources; theme token maps are
null-prototype (prototype-key tokens resolve to nothing); session files are
written atomically and shape-checked on read; visitor-event POSTs and sink
records are ordered; the server sends the reconnect rehydrate before joining
the live fan-out, validates action payloads, and caps request bodies at 5 MiB;
`connectAgent` stops immediately on 403 and retries 409 for a bounded window
instead of silently forever; all publishable packages now ship a README.
(`@facet/*` are versioned together as a fixed group.)
