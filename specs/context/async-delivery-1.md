# Context Evidence: async-delivery-1

> Stage 0 output of `/spec-bridge`. Evidence gathered against `main` (post
> hardening-1, 2026-07-02). Brief: `specs/feature-intake/async-delivery-1.md`.
> All claims carry file:line anchors verified by the context pass.

Scope pin from the brief's Decision Lock: (1) late results applied+delivered;
(2) SSE `id:` seq + `Last-Event-ID` resume, join-fan-out-first; (3) spawn global
cap default 4 (`FACET_MAX_CONCURRENT`) + FIFO, per-visitor order kept; (4) client
POST `AbortSignal` timeout; (5) behavior-centric HTTP harness. `tsconfig.base.json:9`
`exactOptionalPropertyTypes: true` (matters for any optional `seq` field).

## 1. server/src/server.ts

**Pending map + timeout mechanics (remoteAgent)**
- `server.ts:79-82` `interface Pending { resolve; timer }` — no requestId/visitorId/event stored (needed to re-apply a late result via the visitor path).
- `server.ts:187` `const pending = new Map<number, Pending>()`; `:190` `requestCounter = 0`.
- `server.ts:223-244` `remoteAgent`: `:228` `requestId = (requestCounter += 1)`; `:230-233` timer → `pending.delete(requestId); resolve(offline("(agent timed out)"))` — **the discard-on-timeout seam**; `:234` `pending.set(requestId,{resolve,timer})`; `:235-242` builds `AgentEventFrame` + `sse(stream, frame)`.
- `dropAgent` `:212-220` clears all pending with offline note on disconnect.

**/agent/control resolution path**
- `server.ts:416-439`: `:425` `p = pending.get(requestId)`; `:426-430` if present `clearTimeout; pending.delete; p.resolve(messages)`; **`:426` `if (p !== undefined)` — when the timeout already fired, `p` is undefined and messages are silently dropped, always answering 202 (`:431`). This is the LATE-path insertion point.** The late result never reaches `runtime`/`pushToBrowser` here.
- Control body has NO visitorId (`isControlBody` `:167-181` only `requestId`+`messages`); to apply a late result the server must recover visitorId from a richer `Pending` entry (or a late-window map).

**/stream handler + rehydrate-before-join (campaign-1) + RESIDUAL**
- `server.ts:292-351`. `:299` `writeHead(200, streamHeaders)`; `:300` `res.write(": connected\n\n")`.
- `:302-308` `req.on("close")` prunes from `browserStreams`.
- `:311-322` **RESIDUAL comment** — RISK-HRD-4: frames in the snapshot-read→set-join window lost; "full fix (version/seq gating on frames) is deferred" — THIS feature.
- `:323-341` rehydrate IIFE: `stageFor` → `sse(res,{kind:"patch",...replace...})`; loops `historyFor` says; THEN joins `browserStreams` set (`:336-340`). **No Last-Event-ID read anywhere** (`url.searchParams`/`req.headers` only read `visitorId` at `:293`).
- `:342-349` `.catch` → `console.error` + `res.end()` — **INV#3 fail-safe seam (DC-004 degrade / replay failure ends stream)**.

**sse() helper — does NOT write an `id:` field**
- `server.ts:90-92` `function sse(res, data){ res.write(\`data: ${JSON.stringify(data)}\n\n\`) }` — **only `data:`, no `id:`. The single frame-writer to extend for per-session seq.** Comments via raw `res.write(": ...\n\n")` (`:300,:400,:454`).

**pushToBrowser / browserStreams**
- `server.ts:186` `browserStreams = new Map<string, Set<ServerResponse>>()`.
- `:260-266` `pushToBrowser(visitorId, messages)`: iterates connections × messages, `sse(res, message)`. **INV#6 seam: this is delivery-order; seq assignment must happen here (or via a shared per-session counter) so apply-order == delivery-order.**
- `/event` push: `:364-366` `runtime.handle(...).then(messages => pushToBrowser(...))`.

**heartbeat / reaper / close()**
- `:185` `staleMs = 30_000`; `:447-455` reaper `setInterval(...,10_000)`: `agentStream.end()`+`dropAgent` if stale else `agentStream.write(": ping\n\n")`. Only the agent stream is pinged, not browser streams (why rehydrate-fail must `res.end`).
- `close()` `:467-478`: clearInterval, `agentStream?.end()`, end all browserStreams, `server.close` + `closeAllConnections?.()`.

**Test harness pattern (server.test.ts)**
- `start()` `:9-23` random port `20_000+rand(20_000)`, retry 10× on EADDRINUSE.
- `readFrames(res,count)` `:26-46` parses `data: ` frames; `collectFrames(res,ms)` `:50-75` time-boxed; `waitFor` `:78-85`; `streamEnded(res,ms)` `:131-146`.
- `DelayedGetStore` `:91-107` (delays `get` only); `FailOnceGetStore` `:111-127` (rejects first `get`).
- Existing coverage: token gate 403 `:214-224`; offline face `:226-240`; 404 `:242-246`; rehydrate-no-overwrite `:250-306`; ends-stream-on-fail `:308-323`. **No 409 second-agent test, no heartbeat/reap test, no late-delivery test** (DC-009 is net-new at the HTTP level).

## 2. runtime/src

- `runtime.ts:72-76` `handle(visitor,event)` → `serialize(sessionKey, ()=>handleOne)`; `:39` `serialize = createSerialQueue<readonly ServerMessage[]>()` (**per-visitor serial queue — INV#6 apply-order source of truth**).
- `handleOne` `:78-93`: `stageStore.open` → `agent(event,session)` → `stageStore.save(applyToSession(...))`; `:88` `entry = {at: Date.now(), event, messages}`; `:89-91` `serializeRecord` fire-and-forget `sink.record` (`:44` second queue). **A late result, to preserve ordering + persistence, should route back through `handle`/a handle-like runtime path, not bypass it.**
- `applyToSession` `:95-125`: **per-op salvage** (`:108-118`) + `validateTree` `:124` — DC-008 fail-safe already lives here; late-apply reuses it if routed through the runtime.
- `stageFor` `:58-60` → `stageStore.get(...).stage`; `historyFor` `:63-65` → `sink.history`.

**Sink / StoredEvent — no seq today; `at` is the only ordering**
- `sink.ts:5-10` `StoredEvent { at:number; event; messages }` — `at` = epoch ms, coarse, **no monotonic seq**. Adding `seq?` is additive; consumers below must tolerate.
- `Sink` `:25-30` `record`/`history` (history "oldest first").
- `MemorySink` `:41-54`; `FileSink` `file-sink.ts:37-57` JSONL append + `isStoredEvent` guard `:8-21` (extra `seq` field passes the guard today).
- `stage-store.ts:14-18` StageStore; `MemoryStageStore` `:47-61`. **`FacetSession` comes from @facet/core (`:1` import) — a per-session seq on it = core type change with wide blast radius. Prefer a server-local seq counter (no core change).**

## 3. core/src

- `protocol.ts:26-30` `FacetSession {agentId, visitor, stage}` — no seq. `:48-51` `ServerMessage = patch|say|reset` — **seq is transport framing (SSE `id:`), NOT a ServerMessage field per the brief** (avoids touching all ServerMessage consumers).
- `:33-36` ClientEvent; `:79-86` `AgentEventFrame` (server→agent frame; carries requestId).
- `index.ts:1-8` barrel: tokens, nodes, tree, patch, protocol, validate, serial-queue, spec.
- **Core is node-free** (grep `node:` = only false-positive variable names). `createSerialQueue` `serial-queue.ts:10-23` exported from core.

## 4. client/src/sse-transport.ts

- `subscribe` `:53-82`: `new EventSource(...)` — **native EventSource sends `Last-Event-ID` automatically ONLY if frames carry `id:` (server doesn't write it today → native resume is a no-op until the server does).**
- `onopen` `:58-70`: re-open synthesizes `{kind:"reset"}` (`:64`) then flushes queue. `onmessage` `:71-77` `JSON.parse(message.data)` — **ignores the id field; unaffected by adding `id:` lines.**
- **send chain (AbortSignal target)** `:38-51`: `sendChain.then(()=>fetch(...))` — **no `signal`; DC-007 inserts `AbortSignal.timeout(~10s)` here**; `.catch` `:46-50` already logs + keeps the chain alive.
- `:5` `MAX_QUEUE = 100`; overflow drop-oldest sparing leading visit `:29-37`.
- Test infra: `FakeEventSource` `sse-transport.test.ts:7-24`; deferred-fetch pattern `:145-172`; rejected-POST chain-alive `:174-198`. **No fake timers yet — DC-007 needs `vi.useFakeTimers` (or a stubbed AbortSignal.timeout) + never-resolving fetch.**

## 5. agent-client/src/connect.ts — parseSseFrames tolerance

- `parseSseFrames` `:72-84`: splits on `\n\n`, extracts only the line starting `data:` (`:79`) — **an `id:` line is ignored; `id:` will NOT break parsing.** Tests `connect.test.ts:30-33` already pin non-data-line tolerance. (Server writes `id:` only on the browser channel anyway.)

## 6. bridge/src/bridge.ts — spawn cap insertion

- `createSpawnAgent` `:136-286`. Per-visitor chain: `:273` `serialize = createSerialQueue<...>()`; `:274-275` `agent = (event,session)=>serialize(visitorId, ()=>runOne(...))` — **a global semaphore/FIFO must wrap `runOne`/`runBrain` (`:190-256`) INSIDE the serialized task, so per-visitor order is kept while capping across visitors.**
- `children = new Set<...>()` `:158`, `child.on("close", ...)` `:234,:245-255` — slot release hook; `finish()` `:218-223` clears timer/resolves — natural semaphore-release point.
- sessionIds LRU `:149-157`; `MAX_SESSION_IDS=500` `:15`.
- **env.ts `parseBridgePort` `:37-46` is the model for `parseMaxConcurrent` (`FACET_MAX_CONCURRENT`, default 4, integer ≥ 1)**; `safeEnv` `:22-29`.
- **cli.ts env wiring** `:19-33`: try/catch parse → `process.exit(1)` pattern (`:27-33`) — mirror for FACET_MAX_CONCURRENT (DC-006); pass into `createBridge` `:35-48`. `BridgeOptions` `bridge.ts:28-55` (add `maxConcurrent?`).

## 7. Patterns to follow

- `createSerialQueue` `core/src/serial-queue.ts:10-23` (per-key tail, rejection-safe, self-pruning) — model for a FIFO+cap primitive (candidate: a small `createSemaphore`/bounded-queue in @facet/core next to it).
- Campaign-1 rehydrate + RESIDUAL: `server.ts:311-322` (comment to rewrite), `:323-349` (code + fail-safe `res.end`).
- Test mocks: deferred fetch `sse-transport.test.ts:145-172`; stub-fetch + ReadableStream `connect.test.ts:56-71`; `DelayedGetStore`/`FailOnceGetStore` `server.test.ts:91-127`; async-sink ordering `runtime.test.ts:73-95`; env matrix `env.test.ts:42-47`. **No spawn-mode bridge test exists** — DC-005 needs a NEW stub-command harness; `persistent.test.ts:155-183` (serial-order concurrency, records concurrent count) is the closest pattern.

## 8. RISK register (writer MUST consume each)

- **RISK-INV-1 (invariant #6, two-writers)** — Apply-order authority is the runtime per-visitor queue (`runtime.ts:73`); delivery-order authority is `pushToBrowser` (`server.ts:260-266`). For a LATE result the seam is `/agent/control` `server.ts:416-439`: after timeout there is no awaiter, so late messages must be re-injected through a runtime path that hits `applyToSession` + the per-visitor serial queue AND then `pushToBrowser`. **If seq is assigned at push time but apply happens on the runtime queue, a late apply racing a live event can invert seq vs stage state — seq assignment must be serialized with the apply (assign in the same ordered section that applies/pushes).** Two late results for one visitor must pass through `serialize` in arrival order.
- **RISK-INV-2 (invariant #3, fail-safe)** — Bad/ancient `Last-Event-ID` → full-snapshot rehydrate (branch point `server.ts:323-341`); replay/rehydrate failure → existing `.catch` + `res.end()` (`:342-349`) so EventSource retries. `/stream` must never 4xx/5xx for a bad resume token (only the missing-visitorId 400 at `:294-298` remains).
- **RISK-API-1 (StoredEvent.seq)** — If `seq?: number` is added to `StoredEvent` (`sink.ts:5-10`): consumers are `runtime.ts`, Memory/Null/Forward sinks, `file-sink.ts:8-21,37-57`, **`store-postgres/postgres-store.ts:66-95` (fixed SQL columns — a new field is silently lost unless the schema/queries change)**, plus test mocks. `exactOptionalPropertyTypes: true` → never assign `undefined` explicitly; use conditional spread (idiom at `server.ts:256-257`). Resolution: either thread seq through Sink with a postgres migration, or keep seq entirely server-local (replay derives seq from history order) — writer must pick one and justify.
- **RISK-API-2 (frame framing)** — Keep seq OUT of `ServerMessage` (15 consumer files incl. `react/useFacet.ts`, `client/local-transport.ts`, `cli/*`, `agent/stage.ts`). SSE `id:` framing only; `parseSseFrames` tolerance verified (§5).
- **RISK-PKG-1 (dependency direction)** — A FIFO/semaphore helper belongs in `@facet/core` next to `createSerialQueue` (node-free, keeps server/bridge/runtime depending downward; no cycle). `@facet/core` must gain no Node-only import.
