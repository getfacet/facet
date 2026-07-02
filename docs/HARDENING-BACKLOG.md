# Hardening Backlog

> A dedicated hardening campaign for pre-existing latent issues in Facet. Work
> these on their own merits (not under a feature gate): `/spec-bridge` (this file
> as input) → `/implement`, or fix item-by-item with `/verify` after each.
>
> **Status:** Hardening campaign 1 (PR #3, merged 2026-07-02) fixed 21 of the 24
> findings from the original complete sweep (`specs/dev-specs/hardening-1.md` has
> the finding→fix mapping and recorded waivers). What follows is the REMAINING
> work: the three deferred scale items, the two deliberately-dropped items, and
> the residual P3s surfaced by campaign 1's own adversarially-verified review.

## P2 — scale / async-delivery (deferred umbrella — design before fixing)

Deferred from campaign 1 by scope pin (`specs/context/hardening-1.md`). These
need a design round (version/seq on frames, delivery guarantees) before code —
start with `/feature-intake`.

- **[P2] server/server.ts** — per-event timeout silently discards a queued
  agent turn's completed result (routine in persistent mode).
- **[P2] bridge/bridge.ts** — spawn mode: unbounded concurrent brain CLIs keyed
  on client-supplied `visitorId` (resource exhaustion vector).
- **[P2] server + bridge** — server remote-agent handshake and per-kind `/event`
  validation have no HTTP-level regression tests (needs a small server test
  harness).
- Folds in two waived residuals from campaign 1 (both documented in code and in
  RISK-HRD-3/4): the `/stream` rehydrate window can lose a `say` under an
  *async* sink (in-memory reference unaffected), and the client send chain has
  no fetch timeout (`AbortSignal.timeout` is the cheap interim fix). A stage
  version/seq design closes the first properly.

## P3 — dropped from campaign 1 with recorded reasons

- **[P3] naming** — the concept is "visitor" in every identifier but "viewer" in
  ~15 comments across 5 packages; `BridgeOptions.mode` vs `method` are
  near-synonyms for two levels of one knob. *Fix:* a standalone comment-only
  sweep commit; decide `mode`/`method` deliberately BEFORE first npm release
  (renaming after is breaking).
- **[P3] server/server.ts (hygiene)** — `createFacetServer` is a ~300-line
  function: request dispatch + SSE wiring + control handling + lifecycle in one
  closure. *Fix:* dedicated refactor PR (extract per-request dispatch into named
  helpers); deliberately kept out of campaign 1 so behavior fixes stayed
  reviewable. Re-run `/refactor-audit` first.

## P3 — residuals from campaign 1's review (track, fix opportunistically)

Found by the campaign's own `/code-review` verification pass; all confirmed
real but downgraded/non-blocking. Evidence in the PR #3 review record.

- **core/patch.ts + runtime vs react** — server salvages a partially-bad patch
  batch per-op while the client drops the whole batch (`useFacet` keeps the
  current tree) and the server forwards the ORIGINAL batch — a mixed batch
  diverges the live view until reconnect. Pre-existing design asymmetry, no
  in-repo producer can trigger it today. *Fix (design):* forward the salvaged
  batch instead of the original, or unify the error policy both sides.
- **core/patch.ts (deepEqual)** — recurses without a depth bound; a ~50k-deep
  `test` value blows the stack (absorbed by runtime salvage; agent-supplied
  input only). *Fix:* depth guard for parity with `MAX_DEPTH`.
- **server/server.ts (readJson)** — the oversize-body path rejects then
  `req.destroy()`s, so the client usually sees a connection reset, not the
  400 the comment claims. Cap works; contract is overstated. *Fix:* respond
  413/400 before destroying, or fix the comment.
- **server/server.ts (close)** — a stream mid-rehydrate is in no fan-out set,
  so shutdown relies solely on `server.closeAllConnections?.()` (absent before
  Node 18.2) — `close()` can hang on old Node. *Fix:* track pre-join responses
  or pin engines >= 18.2.
- **agent-client/connect.ts** — a terminal refusal (403 / exhausted-409) is
  observable only via `console.error`: `onStatus` never fires and
  `AgentConnection` exposes no state, so an embedder can't distinguish
  "retrying" from "gave up". Also `response.body` is never cancelled on non-ok
  responses (one pinned socket per retry under undici). *Fix:* a
  `"refused"`-style status or `onError` callback + `void response.body?.cancel()`.
- **agent-client/connect.test.ts** — the sustained-409 test asserts the error
  log + loop stop but not the fetch call count, so a regression back to
  attempt-counted budgeting would pass it. *Fix:* assert the count.
- **runtime + bridge (LRU duplication)** — the bounded re-insert-on-touch LRU
  now lives in `FileStageStore.cachePut` AND `bridge` `touchSessionId`, and
  neither eviction path has a test (silent, user-visible failure: an active
  visitor's `--resume` id evicted → conversation resets). *Fix:* extract a
  shared helper (creates the missing unit seam), one test covers both.
- **bridge/env.test.ts** — the `BRIDGE_DEFAULTS` pin test is a pure
  change-detector (cli.ts has no test seam); don't count it as drift coverage.
- **react/ChatDock.tsx** — two near-palette hexes remain (`#fbfbfc` dock
  background, `#d7dbe0` input border): a COLOR-map reskin restyles the rest of
  ChatDock but not these. *Fix:* map to nearest tokens or comment them as
  intentional one-offs.
- **packages/{react,runtime,server}/README.md** — install lines omit packages
  their own snippet imports (`@facet/client`, `@facet/agent`); copy-pasting the
  quickstart fails to resolve. *Fix:* align install lines with the snippets.

## Accepted (documented trust model — revisit on trigger)

- **server/server.ts** — `/agent/*` unauthenticated by default + CORS `*` +
  `visitorId` trusted as the session key. Documented in SECURITY.md for the
  local/single-operator reference transport; becomes required work the moment a
  hosted/multi-tenant deploy path appears.

---

_Campaign 1 source sweeps: code-review 6 lanes (`wf_4e2fadd0-31d`) + types lane
(`wf_0f294ddd-bb4`), refactor-audit 5 dimensions (`wf_84bc52dc-f8f`) + hygiene
(`wf_4d26ff5d-8e6`) — 24 confirmed findings, 21 fixed in PR #3._
