# Hardening Backlog

> A dedicated hardening campaign for pre-existing latent issues in Facet. Work
> these on their own merits (not under a feature gate): `/spec-bridge` (this file
> as input) → `/implement`, or fix item-by-item with `/verify` after each.
>
> **Sources (fresh, against current `main` 2026-07-02) — sweep COMPLETE:**
> - code-review: 6 lanes (`wf_4e2fadd0-31d`, 14 confirmed) + `types` lane
>   (`wf_0f294ddd-bb4`, 2 confirmed).
> - refactor-audit: 5 dimensions (`wf_84bc52dc-f8f`, 6 confirmed) + `hygiene`
>   dimension (`wf_4d26ff5d-8e6`, 2 confirmed).
> All 7 code-review lanes + all 5 refactor-audit dimensions ran and were
> adversarially verified. 24 confirmed findings total.

## P2 — should-fix

### Correctness
- **[P2] react/StageRenderer.tsx + core/validate.ts** — Duplicate sibling child
  ids survive validateTree → two `RenderNode`s with the same React `key` →
  unstable reconciliation ("rendered broken", violates fail-safe invariant #2).
  Trigger: `children:["a","a"]` on the raw path or a double `stage.append`.
  *Fix:* dedupe sibling child ids in validateTree AND in the renderer's child pass.
- **[P2] react/StageRenderer.tsx:113 (classifyPress)** — the raw-path `onPress`
  payload is cast to `Record<string, string|number|boolean>` after only a
  `typeof === "object"` check — nested/non-primitive values are never filtered
  (drift from validate's `asAction`), so a bad payload reaches `onAction` →
  transport → agent typed as primitives-only. `server.ts` isEventBody has the same
  hole. *Fix:* filter payload values to primitives in classifyPress (mirror
  asAction), and/or in isEventBody.
- **[P2] server/server.ts:277-294** — `/stream` reconnect rehydrate can overwrite
  a newer live patch (ordering race): the res is added to the fan-out set before
  the async `stageFor()` snapshot, so a concurrent `/event` v2 patch can land
  before the v1 full-replace rehydrate reverts the client. Manifests on
  File/Postgres stores (I/O gap); `stageFor` also bypasses the per-visitor serial
  queue. *Fix:* order rehydrate before joining the fan-out set, or carry a stage
  version/seq and drop stale full-replaces.

### Single-source (from refactor-audit)
- **[P2] core/validate.ts + react/StageRenderer.tsx** — `MAX_DEPTH = 100`
  duplicated in two packages (raise one → the other silently truncates). *Fix:*
  `export` it from @facet/core, import in the renderer; reconcile `>=` vs `>`.
- **[P2] react/ChatDock.tsx + react/theme.ts** — ChatDock re-hardcodes the exact
  theme hex values; `theme.ts` claims to be "the one place pixels and hex live"
  but `COLOR` is unexported. *Fix:* export the palette, reference it in ChatDock.

### Test gaps (highest-value coverage)
- **[P2] bridge/persistent.ts:73-229** — `createPersistentDriver` coordination
  (pending queue / input() generator / settleAll / dead-guard / malformed-event
  skip) has ZERO tests. *Fix:* driver tests with a faked `query`. (Prior waiver.)
- **[P2] client/sse-transport.ts:50-62** — the reconnect `reset` synthesis (drop
  the `if (opened)` guard and duplicate-chat returns) is untested. *Fix:* a test
  that fires `onopen` twice and asserts a `reset` on re-open.

### Scale / async-delivery (deferred umbrella — design before fixing)
- **[P2] server/server.ts** — per-event timeout silently discards a queued
  agent turn's completed result (routine in persistent mode).
- **[P2] bridge/bridge.ts** — spawn mode: unbounded concurrent brain CLIs keyed
  on client-supplied `visitorId` (resource exhaustion vector).
- **[P2] server + bridge** — server remote-agent handshake and per-kind `/event`
  validation have no HTTP-level regression tests (needs a small server test
  harness).

## P3 — nits (track, fix opportunistically)

- **[P3] runtime/file-stage-store.ts + file-sink.ts** — non-atomic `writeFileSync`
  + swallowed parse errors: a crash/ENOSPC mid-write silently resets the session;
  a wrong-shape-but-valid-JSON file poisons it. *Fix:* write-temp-then-rename +
  shape-check on read. (corrupt-input fail-safe branches also untested.)
- **[P3] core/patch.ts:175** — RFC 6902 `test` op uses `JSON.stringify` equality
  (key-order sensitive). *Fix:* deep-equal.
- **[P3] core/patch.ts** — array-index handling: negative / out-of-range / `""` /
  float indices insert wrong-position or literal `undefined` instead of erroring.
- **[P3] react/StageRenderer.tsx:285** — field case does not coerce
  name/placeholder/input on the raw path, and `input` isn't constrained to
  `FIELD_INPUTS`, unlike every other coerced node. *Fix:* coerce like the others.
- **[P3] react/theme.ts:111-117** — token maps are prototype-bearing object
  literals; a `__proto__`/`constructor` token name resolves to a function on the
  raw path. *Fix:* `Object.create(null)` maps (same class as the validate fix).
- **[P3] server/server.ts** — reference server: `/agent/*` unauthenticated by
  default + CORS `*`. Documented trust model (SECURITY.md); revisit if a
  hardened/multi-tenant deploy path appears. Also: readJson has no body-size cap.
- **[P3] client/sse-transport.ts:34-43** — visitor events fire as unordered
  concurrent POSTs; a visitor's messages can be processed out of order.
- **[P3] agent-client/connect.ts** — retries a terminal 403/409 forever, silently.
- **[P3] runtime/runtime.ts** — fire-and-forget `sink.record` can persist events
  out of order in an async sink (misordered history replay).
- **[P3] bridge/cli.ts + bridge.ts** — default serverURL/port encoded twice
  (drift risk); non-numeric `FACET_BRIDGE_PORT` crashes with an uncaught error;
  env-config doc omits `FACET_AGENT_TOKEN`.
- **[P3] bridge/bridge.ts** — spawn `sessionIds` map grows unbounded (one entry
  per visitorId ever seen).
- **[P3] apps/playground/package.json** — declares `@facet/bridge` but never
  imports it (phantom dependency). *Fix:* remove it.
- **[P3] naming** — the concept is "visitor" in every identifier but "viewer" in
  ~15 comments across 5 packages; `BridgeOptions.mode` vs `method` are
  near-synonyms for two levels of one knob. *Fix:* pick one term each.
- **[P3] runtime/session-file.ts** — filename path-safety encoding has no test.
- **[P3] core/validate.ts** — `isSafeImageSrc` branch coverage: only
  `javascript:`/`https:` tested; `data:image/` vs `data:text/html` and `//` vs `/`
  branches unpinned.
- **[P3] agent-client/connect.ts** — the agent-error fallback + event routing are
  untested (only the pure `parseSseFrames` helper is covered).
- **[P3] packages/*/ (hygiene)** — 9 of 11 publishable `@facet/*` packages have no
  README (only bridge + client do); all carry `publishConfig.access:public`, so
  they'd land on npm with a blank page. *Fix:* short README per package before
  first release (mirror the package.json description + a usage snippet).
- **[P3] server/server.ts (hygiene)** — `createFacetServer` is a 271-line function
  (429-line file, largest in the tree): request dispatch + SSE wiring + control
  handling + lifecycle inline in one closure. *Fix:* extract per-request dispatch
  into named helpers alongside the existing `setCors`/`sse`/`readJson` helpers.

---
_Rebuilt against current `main` from a COMPLETE fresh sweep (all code-review lanes
+ all refactor-audit dimensions, adversarially verified). Supersedes the prior
screens-feature-incidental list._
