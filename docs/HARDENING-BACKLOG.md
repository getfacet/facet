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

## P2 — scale / async-delivery: RESOLVED by async-delivery-1 (2026-07-03)

The deferred umbrella was designed (`specs/dev-specs/async-delivery-1.md`) and
implemented: late results are applied + delivered (never discarded, with an
era/index staleness guard so a late result can't overwrite a newer stage);
browser frames carry `id: era:seq` and reconnects resume via `Last-Event-ID`
(the RISK-HRD-4 say-loss window is closed); spawn mode is capped by a global
FIFO semaphore (`FACET_MAX_CONCURRENT`, default 4); the client send chain has a
10s `AbortSignal.timeout` (RISK-HRD-3 interim fix); the remote-agent handshake
and the new delivery behaviors are pinned by an HTTP-level harness.
**Remaining from the umbrella:** the full per-kind `/event` validation matrix
(visit/message/action × normal/malformed/boundary) — behavior-scoped tests
landed, the exhaustive matrix did not.

## P3 — residuals from async-delivery-1's review (track, fix opportunistically)

- **server lateWindow TTL** — parked late-turn entries are FIFO-bounded (100)
  but have no expiry; on an unauthenticated port, sequential request ids make
  them injectable until evicted. Accepted per the trust model (port access
  already grants full takeover via `/agent/stream`); a TTL is defense-in-depth.
- **server backpressure** — no global cap on in-flight turns/timers; SSE
  `res.write` return values ignored (slow-client buffering). Trust-model
  territory; the resource-exhaustion surface of the reference server.
- ~~era/LRU continuity-guard variant untested~~ — RESOLVED by refactor-audit-1:
  the frame-log store is now a unit seam (`frame-log.test.ts` covers eviction /
  era re-mint / ring bound directly).
- **client/server version pairing** — the client no longer synthesizes `reset`
  on reopen (the server sends it); a new client against a pre-async-delivery
  server duplicates chat on reconnect (cosmetic). Reference transports ship
  together; noted in the changeset.

## P3 — dropped from campaign 1 with recorded reasons

- ~~[P3] naming~~ — RESOLVED by refactor-audit-1 (2026-07-03): viewer→visitor
  swept everywhere (28 lines); `mode`/`method` renamed to `runner`/`continuity`
  (env `FACET_RUNNER`/`FACET_CONTINUITY`, invalid values now fail fast).
- ~~[P3] server/server.ts (hygiene)~~ — RESOLVED and re-audited. The first
  pass (2026-07-03) extracted frame-log, late-result, agent-channel, and offline
  seams. The 2026-07-12 consolidation pass also separated request validation,
  rehydration, turn tracking, and POST handling after later features had grown
  the assembly module again. Every `@facet/server` production module is now
  below 500 lines, while the public entry point and route behavior stay fixed.

## P3 — residuals from campaign 1's review (track, fix opportunistically)

Found by the campaign's own `/code-review` verification pass; all confirmed
real but downgraded/non-blocking. Evidence in the PR #3 review record.

- ~~core/patch.ts + runtime vs react~~ — RESOLVED before
  core-runtime-hardening, recorded here on 2026-07-08: both runtime and React now
  fold delivered patch batches with `foldPatchIntoStage`; the server emits one
  coalesced patch frame and `useFacet` runs the same salvage + validation fold,
  so the old "server salvages while client drops the whole batch" backlog entry
  is stale.
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
- ~~runtime + bridge + server (LRU duplication)~~ — RESOLVED by refactor-audit-1: `createLruMap` in `@facet/core`, adopted at all three sites, eviction unit-tested once for everyone. Original note: the bounded re-insert-on-touch LRU
  now lives in `FileStageStore.cachePut` AND `bridge` `touchSessionId`, and
  neither eviction path has a test (silent, user-visible failure: an active
  visitor's `--resume` id evicted → conversation resets). *Fix:* extract a
  shared helper (creates the missing unit seam), one test covers both.
- **bridge/env.test.ts** — the `BRIDGE_DEFAULTS` pin test is a pure
  change-detector (cli.ts has no test seam); don't count it as drift coverage.
- ~~chat dock palette drift~~ — RESOLVED by refactor-audit-cleanup-1: the dock
  background and input border now use the shared COLOR map, so a palette reskin
  reaches the whole component.
- ~~packages/{react,runtime,server}/README.md install lines~~ — RESOLVED before
  gate-release-hygiene, recorded here on 2026-07-12: each install command now
  includes the packages imported by its snippet (`@facet/client` for React;
  `@facet/agent` for runtime/server).

## P3 — residuals from Bundle D's review (appear-hold-scroll; track, fix opportunistically)

Found by the bundle's adversarially-verified `/code-review` (P1 + all P2 and
the spec-alignment/doc P3s fixed in-branch; this is the one confirmed
non-blocking residual).

- ~~react/StageRenderer.tsx (onHold add/remove remount)~~ — RESOLVED in-branch
  (review r6, escalated to P2 there — P2 can't ship without a waiver, so it was
  fixed rather than deferred): every box now renders through ONE always-mounted
  internal component (`BoxElement`) with nullable `press`/`hold` props, so a
  live patch adding/removing onPress/onHold changes only props, never the React
  element type at that position — no remount, so uncontrolled field text and
  scrollTop survive. The WU-3 "press-only/plain boxes keep today's exact inline
  elements" done-condition is superseded and re-pinned as *byte-identical
  serialized DOM* (a component wrapping the same markup): the static exact-
  markup suite passes unmodified. Pinned by three element-identity survival
  tests (add-onHold / remove-onHold / plain→press+hold).
- ~~playground dual builder helper~~ — RESOLVED by refactor-audit-cleanup-1:
  the bricks and gallery authoring helpers now share one local flat-map tree
  builder in `apps/playground`.
- ~~react/StageRenderer.tsx (hold not scoped to the arming pointerId)~~ —
  RESOLVED in-branch (review r4, escalated to P2 there: the disarm made the
  release's synthesized click dispatch onPress — the wrong action, not
  fail-closed): `gesturePointerRef` scopes move/up/leave to the arming
  pointer; pinned by two multi-touch tests.
- ~~react/StageRenderer.tsx (interceptor release-aware lifecycle)~~ —
  RESOLVED in-branch (review r5, escalated to P2 there): `expire` now ignores
  non-primary pointercancels (mirrors `reset`'s guard — a palm-rejection
  cancel no longer lets hold+press both fire), the interceptor expires one
  macrotask after the primary pointerup (a never-synthesized click can't
  leave it lingering), and any keydown tears it down (keyboard activations
  are never swallowed). Pinned by three tests. Per-pointerType keying was NOT
  added (no longer needed under the release expiry).
- ~~react/StageRenderer.tsx (hybrid re-entry guard, r5)~~ — RESOLVED in-branch
  (review r6): handlePointerDown ignores a pointerdown whose id differs from
  the live gesture's arming pointer, so a second concurrent primary pointer
  (hybrid mouse+touch) cannot overwrite the origin/timer. Pinned by one test.
  NOTE: the deeper two-overlapping-holds-on-two-boxes starvation (the single
  module-level interceptor serves one click) remains — see the per-gesture
  interceptor map entry below.
- ~~react/StageRenderer.tsx (slop boundary exactness, r5)~~ — RESOLVED
  in-branch (review r6): a boundary test pins the strict `>` (8.0px keeps the
  hold armed, 9px disarms).
- ~~react/StageRenderer.tsx (appear prescan bypassed the render budget, r7)~~
  — RESOLVED in-branch (review r7): appear detection now rides the
  budget-bounded render walk (`appearSeen` flag set when a REACHABLE box gets an
  appear class) instead of an unbounded `Object.values(tree.nodes)` scan on
  every render — closes the per-render soft-DoS on a huge unreachable-node map
  and is strictly more correct (an unrendered appear node no longer forces a
  useless `<style>`). Pinned by an unreachable-appear-node test.
- ~~docs/ARCHITECTURE.md (brick-palette drift, r7)~~ — RESOLVED in-branch: the
  `box` bullet now lists `appear`/`scroll` styles and `onHold`.
- **react/StageRenderer.tsx (per-gesture click interceptor, r6/r7)** —
  **P2, MAINTAINER-WAIVED for the appear-hold-scroll merge (owner, 2026-07-04;
  recorded in the PR).** The post-hold click swallow is a single module-level
  `swallowArmed` boolean, so two *overlapping* holds on two different boxes
  (two concurrent primary pointers — e.g. a mouse held on box A AND a touch
  finger held on box B on a hybrid device, both past 500ms, both released) share
  one interceptor: the second hold's `swallowNextClick()` is a no-op, the first
  release consumes the interceptor, and the second box's synthesized click fires
  its onPress — that box dispatches both hold and press. *Waiver rationale:*
  the trigger is a two-handed mouse+touch gesture no single user performs
  intentionally; the failure degrades to one spurious, recoverable agent event
  (no crash / data loss / security); and a correct fix needs click→pointer
  attribution the DOM does not provide at window-capture scope (every
  capture-phase click listener sees every click, so a per-gesture registry
  can't pair a swallow to its own click). A counter ("swallow the next N
  clicks") handles the concurrent case but entangles with the reset/expire/
  release lifecycle that already absorbed review rounds r3–r5, each of which
  spawned the next round's finding. *Fix (structural, deferred to the drag
  bundle, which reworks pointer handling anyway):* key the interceptor by
  pointerId/pointerType, or drive the swallow off the browser's own
  `click`-after-`pointerup` sequencing per pointer.
- **react/StageRenderer.tsx (no keyboard path for hold-only boxes, r4)** — a
  hold-only box (onHold, no onPress) renders role="button" but Enter/Space
  cannot trigger the hold (accepted v1 decision; STAGE_SPEC advises never to
  gate critical content hold-only). Revisit alongside a broader keyboard
  interaction pass.
- **react/StageRenderer.tsx (long-press over selectable content, r3)** — a
  hold on a box suppresses the touch context menu while armed, but native
  text-selection long-press behavior inside the box (e.g. over a field) can
  still race the hold on some platforms. Revisit with real-device evidence;
  STAGE_SPEC already advises against hold-only critical paths.
- ~~core/validate.ts (asAction secondary messages omit the field label)~~ —
  RESOLVED in-branch (review r6): the nameless-agent / navigate-`to` /
  toggle-`target` messages now interpolate the `field` param, so onHold junk
  of those shapes reports "onHold".
- ~~playground/print-tree.ts (outline blind to onHold)~~ — RESOLVED in-branch
  (review r6): the outline prints a `[hold …]` marker; pinned by a test.

## P3 — residuals from Bundle B's review (kits-themes-as-data; track, fix opportunistically)

Found by the bundle's 3-round adversarially-verified `/code-review` (all P0–P2
fixed in-branch; these are the confirmed non-blocking nits). Evidence in the
Bundle B PR review record.

- ~~quickstart/cli.ts (--assets guard)~~ — RESOLVED in-branch (review r6): the
  explicit path must be a readable directory (statSync + readdirSync probe,
  exit 1), pinned by a cli test.
- ~~core/validate.ts (composition validator bounds, now
  `validateComposition`)~~ — RESOLVED in-branch (review r5+r6): composition
  names share `isValidThemeName`, descriptions truncate at the shared 200-char
  cap, and the refusal issue never echoes the raw name.
- ~~quickstart/prompt.ts (composition budget)~~ — OBSOLETE after the component
  model: the canonical `@facet/agent-tools` prompt advertises a bounded
  name-description reference index. The agent can request one exact reference on
  demand; that JSON stays in the provider conversation and never enters browser
  frames. The unpublished quickstart prompt shim was removed by the agent-stack
  ownership cleanup.
- **agent-tools/executor-node.ts (set_theme)** — an unknown theme name returns
  `ok`/`mutated:true` while the page silently keeps the default look. *Fix:*
  error observation naming the available themes (append_node precedent).
- ~~runtime/assets.ts (composition dedup)~~ — RESOLVED in-branch (review r6):
  first-wins + issue, mirroring themes; pinned by an assets test.
- ~~core/validate.ts (sanitizeScreens)~~ — RESOLVED before
  gate-release-hygiene, recorded here on 2026-07-12: screens accumulate in a
  null-prototype map, forbidden prototype keys are rejected with an issue, and
  entry lookup cannot resolve through `Object.prototype`.
- ~~runtime/assets.ts vs server/offline.ts tree-content duplication~~ —
  RESOLVED before gate-release-hygiene, recorded here on 2026-07-12: runtime
  seeding and server offline selection both delegate to core's fail-safe
  `treeHasContent`; its invariant matrix is covered directly in `tree.test.ts`.
- ~~local theme action surface drift~~ — RESOLVED by refactor-audit-cleanup-1:
  the CLI and bridge now expose validated, name-only theme selection.
- ~~core font-size clamp naming~~ — RESOLVED by refactor-audit-cleanup-1:
  font-size clamping now has a distinct range constant instead of borrowing the
  spacing range name.
- **core/theme.ts** — redundant `theme as FacetTheme` cast at the return
  (compiles clean without it).
- ~~reference prompt oversized-composition suppression test~~ — OBSOLETE with
  the concrete reference model: valid composition names and bounded descriptions
  remain indexed, while an exact reference is read on demand and retained only
  in the provider conversation; the canonical reference-agent prompt suite pins
  that contract.
- **tests** — `core/src/theme.test.ts`: negative-dimension clamp floor
  (`"-20px"` → `"0px"`) untested.
- ~~server/server.ts:385 (seed frame vs lastApplied)~~ — RESOLVED in-branch
  (review r6, upgraded to P2): `FacetRuntime.handle`/`applyMessages` return
  `TurnResult` with `agentMutated` (computed pre-seed), and the server gates
  `recordApplied` on it — a say-only turn re-emitting the seed can no longer
  falsely stale a parked late result; pinned by a server interleaving test.
- ~~runtime/assets.ts (loadAssets throw guards, r7)~~ — RESOLVED by
  core-runtime-hardening (2026-07-08): `loadAssets` now guards `store.load()`,
  malformed store shapes, hostile accessors/arrays, oversized asset and issue
  arrays, `initialTree` accessors, and initial-tree validation; skipped seams
  become bounded/sanitized issues and the default assets still resolve. Pinned
  by rejecting-store, malformed-shape, revoked-array, cap, and throwing-accessor
  tests.
- ~~runtime/assets.ts (seed arming order + eviction comment, r7)~~ — RESOLVED
  by core-runtime-hardening (2026-07-08): `withInitialStage.open()` arms the
  seed before `store.save`, so a commit-then-reject durable save re-emits the
  seed frame on the next turn, and committed-but-unreported seeds can be
  re-armed after pending-key eviction without flagging unrelated pre-existing
  seed-shaped sessions; the comments now describe that failure model. Pinned by
  commit-then-reject and cap-eviction seed-save runtime tests.
- ~~core/theme.ts (contrast parser coverage, r7)~~ — RESOLVED by
  core-runtime-hardening (2026-07-08): color allowance now goes through the
  same `parseSrgb` parser the contrast check uses, with hex, `rgb()`/`rgba()`,
  `hsl()`/`hsla()`, and a conservative named-color table covered by tests.
- ~~core/patch.ts (move ghost key, r11)~~ — RESOLVED by core-runtime-hardening
  (2026-07-08): object-member source reads now require an own property, so
  `move`/`copy` from a missing object member throws before mutating. Pinned by
  `applyPatch`, `applyOpInPlace`, and `foldPatchIntoStage` tests.
- ~~runtime (effect-based agentMutated, r11)~~ — RESOLVED in-branch (review
  r12, upgraded to P2): `StageFoldResult.mutated` (true iff a non-`test` op
  actually applied) now feeds `TurnResult.agentMutated`; over-cap/empty/
  non-array/all-salvage-dropped turns no longer bump `recordApplied` (r13
  closed the late-apply seam variant with the same effect-based gate).
- ~~core/stage-fold.ts (test-guard pre-guard ops, r13)~~ — RESOLVED by
  core-runtime-hardening (2026-07-08): the misleading RFC whole-document-abort
  comment was removed and the in-code contract now states the deliberate
  partial-salvage policy: a failed `test` drops itself and following ops in the
  salvage stream, while already-salvaged pre-guard ops stay applied.
- **server/server.ts:390 (deliver-throw comment precision, r14)** — the
  "failed handle leaves the stage untouched" comment overclaims for a
  commit-then-reject durable store; the behavior is the accepted trade-off.
  *Fix:* reword to the runtime's documented failure model.
- **over-cap /agent/control 400 observability (r14)** — the 400 is silent
  server-side and agent-client's `post` swallows the status, so a whole turn
  (says included) can vanish until the interim timeout. *Fix:* one server
  log naming the requestId + an `ok` check/onError surface in
  agent-client's sendControl.
- **runtime coalescing vs RFC 6902 `test` document scope (r12)** — a failed
  `test` guard in one patch message drops the remaining ops of the whole
  coalesced turn, not just its own document. *Fix:* thread document-boundary
  offsets through the fold and (optionally) the wire frame; both sides scope
  identically. No shipped SDK emits `test` ops today.
- **runtime !hasPatch early return delivers junk patch frames (r12)** — a
  turn whose every patch message is non-array returns the original messages,
  shipping the junk frames verbatim to the browser/replay ring (client folds
  them as no-ops — no drift, just noise). *Fix:* filter patch-kind messages
  in that early return, mirroring the mixed case.
- **server/server.ts:311 (stale replay comment, r11)** — the rehydrate-replay
  safety argument still describes the old atomic-drop client; the client now
  folds replayed frames with salvage. *Fix:* rewrite the comment to the
  post-fold semantics (+ assess the partial-double-apply window it papers
  over).
- **core/validate.ts (entry-without-screens diagnostic, r11)** — an `entry`
  supplied without `screens` is silently discarded; every other malformed
  screens-family field gets an issue. *Fix:* one diagnostic on the early
  return.
- **quickstart prompt — screens/entry authoring quality** (live-browser
  finding, 2026-07-04): the built-in agent sometimes registers only one
  screen and points `entry` at it, so its own navigate buttons target
  non-existent screens (fail-safe no-op — nothing breaks, but navigation
  dies). *Fix (model-quality, batch with the next quickstart-agent
  improvement pass):* one WORKFLOW/STAGE_SPEC line — every screen a navigate
  references must exist in `screens`, and `entry` should be the landing
  screen; consider a stub-level pin.

## Accepted (documented trust model — revisit on trigger)

- **server/server.ts** — `/agent/*` unauthenticated by default + CORS `*` +
  `visitorId` trusted as the session key. Documented in SECURITY.md for the
  local/single-operator reference transport; becomes required work the moment a
  hosted/multi-tenant deploy path appears.

## P3 — event-layer-v1 review nits (deferred, cosmetic — 2026-07-06)

Non-blocking consistency nits from the event-layer-v1 `/code-review` (P0-P1=0;
the P2 runtime-ordering bug and the two server input-validation + two
test-coverage P3s were FIXED in the feature PR). These three are style/dedup only
and were tracked rather than fixed to keep the feature diff focused:

- **quickstart/src/page/main.tsx + playground/src/App.tsx + live.tsx** — the
  visitor-side tap-envelope construction (`send(fields === undefined ? {kind:"tap",
  action} : {kind:"tap", action, fields})`, the `exactOptionalPropertyTypes`
  conditional-spread) is copy-pasted in 3 consumers. Consider one shared helper.
- **playground/src/live.tsx** — the live demo does not wire the new renderer
  `onRecord`→`record` channel that quickstart adopts (WU-8 left it optional).
- **runtime/src/runtime.ts** — `applyMessages`'s `reserveRecordSlot` deadlock-
  prevention branch (`resolveRecord(null)` on a save-reject) has no dedicated test.
  Low risk: it is the SAME reserveRecordSlot + catch mechanism `handle` uses, and
  `handle`'s throw + save-reject paths ARE covered (runtime.test.ts). Add a mirror
  case if the late-apply path grows.

### Pre-existing (surfaced by the event-layer-v1 review/live-test, NOT introduced by it)

- **quickstart restyle can drop card text (real-LLM output)** — the event-layer-v1
  live-journey (owner-run) FAILed `safety×v3`: on the "cat restyle" turn, gpt-5.4-mini
  emitted the six content cards (3 feature + 3 pricing) as boxes WITHOUT their text
  children — empty rounded boxes, header/heading/button intact (artifact
  `packages/agent-stack/quickstart/e2e/journey/artifacts/v3/03-restyle.png`). Unrelated to
  event-layer-v1 (restyle is a `message` turn; the rename/record change touches no
  rendering or stage-generation). A real-LLM robustness gap in the restyle prompt
  (the model should never re-emit a card box without re-including its text). Consider
  a STAGE_SPEC nudge ("a card box must keep its text children on restyle") or a
  post-turn validator warning when a previously-texted box loses all text.

- **bridge/src/persistent.ts:146** (P3, concurrency) — the persistent driver's
  single always-on session drains one shared `pending` queue with NO per-turn
  timeout and NO cap on `pending`. Because `@facet/agent-client` dispatches event
  frames concurrently (`connect.ts` `void handleEvent`), a slow/hung model turn at
  `pending[0]` parks `input()` on `await turnDone` forever — every other visitor's
  turn is blocked and `pending` grows unbounded; the server's `agentTimeoutMs`
  frees only the server lane, not the wedged session. Fix: race the `turnDone`
  await against a per-turn timeout + bound `pending`. Owner-run (opt-in bridge
  runner); out of scope for event-layer-v1.

---

_Campaign 1 source sweeps: code-review 6 lanes (`wf_4e2fadd0-31d`) + types lane
(`wf_0f294ddd-bb4`), refactor-audit 5 dimensions (`wf_84bc52dc-f8f`) + hygiene
(`wf_4d26ff5d-8e6`) — 24 confirmed findings, 21 fixed in PR #3._
