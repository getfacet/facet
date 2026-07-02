# Hardening Backlog

> Latent issues surfaced by the whole-codebase review during the screens-view-actions
> feature (2026-07-02), deliberately deferred out of that feature PR. These are
> mostly PRE-EXISTING bugs, not caused by that feature. Work them as a dedicated
> hardening campaign (/refactor-audit + focused review), each on its own merits —
> not under a feature gate.

## Deferred P2 (waived on the feature; must be addressed)

These P2s were waived under the async-delivery/scale umbrella + a server-test-harness follow-up:

- **[P2] packages/server/src/server.ts** — Server per-event timeout silently discards a queued agent turn's completed result (persistent mode makes this routine)
- **[P2] packages/bridge/src/bridge.ts** — Spawn mode: unbounded concurrent brain-CLI processes keyed on client-supplied visitorId
- **[P2] packages/server/src/server.ts** — Server per-kind /event payload validation (the P1 'malformed event kills the persistent session' fix) has no regression test
- **[P2] packages/server/src/server.ts** — Server remote-agent handshake (pending/requestId resolve, agent timeout, dropAgent settling, single-agent 409) is entirely untested
- **[P2] packages/bridge/src/persistent.ts** — Persistent bridge driver (turn queue / wake / turnDone / settleAll coordination, 229 lines) has zero tests — owner waiver recorded

## P3 (non-blocking nits — track, fix opportunistically)

- **[P3] packages/core/src/patch.ts** — applyPatch array handling violates RFC 6902: negative index inserts mid-array, out-of-bounds index silently appends, and copy/move/add from a missing path inserts literal undefined into the tree
- **[P3] packages/react/src/useFacet.ts** — useFacet treats ANY non-"patch" message kind as a say — an unknown-kind message appends undefined to the chat array
- **[P3] packages/core/src/patch.ts** — RFC 6902 `test` op compares via JSON.stringify — structurally-equal objects with different key order fail the test
- **[P3] packages/react/src/StageRenderer.tsx** — classifyPress casts an untrusted onPress payload to the scalar-record payload type, diverging from validateTree's filtering
- **[P3] packages/core/src/patch.ts** — applyPatch's public signature promises FacetTree but a root replace/move/copy returns the raw operation value via an unchecked cast
- **[P3] packages/runtime/src/file-stage-store.ts** — File-backed store and sink cast disk JSON to FacetSession/StoredEvent unchecked
- **[P3] packages/react/src/useFacet.ts** — useFacet's else-branch treats every non-patch message as "say", letting `undefined` into the public `chat: readonly string[]`
- **[P3] packages/client/src/sse-transport.ts** — SseTransport.send: fetch rejection unhandled — event silently lost plus an unhandled promise rejection
- **[P3] packages/agent-client/src/connect.ts** — connectAgent retries a terminal 403/409 forever, silently, with no log or status callback
- **[P3] packages/runtime/src/file-stage-store.ts** — FileStageStore.get caches JSON.parse output with no shape check — a valid-JSON-but-wrong-shape file (e.g. `null`) poisons the session permanently
- **[P3] packages/runtime/src/file-stage-store.ts** — FileStageStore.save writes non-atomically — a crash mid-write leaves a torn file and loses the durable stage
- **[P3] packages/server/src/server.ts** — readJson buffers request bodies with no size limit — a huge POST body accumulates unbounded in memory
- **[P3] packages/bridge/src/cli.ts** — Non-numeric FACET_BRIDGE_PORT crashes the bridge with an uncaught ERR_SOCKET_BAD_PORT
- **[P3] packages/bridge/src/bridge.ts** — makeFacetShim leaks a temp directory per bridge launch — never removed on close()
- **[P3] packages/react/src/visitor.ts** — visitor id fallback collapses to a fixed constant when crypto.getRandomValues is unavailable, contradicting the "hard to guess" safety comment
- **[P3] packages/bridge/src/bridge.ts** — Spawn mode sessionIds map grows unbounded (one entry per visitorId ever seen, never evicted)
- **[P3] packages/runtime/src/runtime.ts** — Fire-and-forget sink.record can persist a visitor's events out of order in PostgresSink (history replays misordered)
- **[P3] packages/server/src/server.ts** — /stream rehydrate can write a stale full-stage snapshot after a newer patch was already pushed to the same connection
- **[P3] packages/react/src/ChatDock.tsx** — ChatDock hardcodes theme hex values, duplicating theme.ts's COLOR map and contradicting its 'one place pixels and hex codes live' claim
- **[P3] packages/bridge/src/persistent.ts** — Driver-mode parity drift: spawn mode ships `facet screens` but the persistent driver has no `screens` tool
- **[P3] packages/bridge/src/bridge.ts** — Copy-pasted streaming UTF-8 JSON body reader (bridge cmd server re-implements server.ts readJson, comment included)
- **[P3] packages/bridge/src/cli.ts** — facet-bridge env-config doc block omits FACET_AGENT_TOKEN, which the code reads
- **[P3] packages/react/src/visitor.ts** — browserVisitorId storage-failure degradation (blocked/write-denied localStorage) is untested
- **[P3] packages/core/src/validate.ts** — isSafeImageSrc branch coverage: only javascript: (reject) and https: (accept) are tested; data:image/ vs data:text/html and //-vs-/ branches are unpinned
- **[P3] packages/agent-client/src/connect.ts** — connectAgent's agent-error fallback and event routing are untested — only the pure parseSseFrames helper has coverage

---
_Source: code-review run wf_4e3dca98-667 (52 candidates, 47 confirmed). Feature-introduced findings were fixed in the feature branch; everything above is deferred._
