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
- ~~[P3] server/server.ts (hygiene)~~ — RESOLVED by refactor-audit-1
  (2026-07-03): `createFacetServer` decomposed into `frame-log.ts` /
  `late.ts` / `agent-channel.ts` / `offline.ts` (non-barreled) + a flat route
  table; 530→180 lines; the LRU/era/FIFO seams gained direct unit tests.

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
- ~~runtime + bridge + server (LRU duplication)~~ — RESOLVED by refactor-audit-1: `createLruMap` in `@facet/core`, adopted at all three sites, eviction unit-tested once for everyone. Original note: the bounded re-insert-on-touch LRU
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

## P3 — residuals from Bundle D's review (appear-hold-scroll; track, fix opportunistically)

Found by the bundle's adversarially-verified `/code-review` (P1 + all P2 and
the spec-alignment/doc P3s fixed in-branch; this is the one confirmed
non-blocking residual).

- **react/StageRenderer.tsx (onHold add/remove remount)** — a live patch that
  ADDS or REMOVES `onHold` on a box flips that position between the inline
  `<div>` and the `HoldableBox` component; React treats it as an element-type
  change and remounts the subtree, wiping uncontrolled field text and
  scrollTop inside. In tension with the pinned WU-3 done-condition
  ("press-only/plain boxes keep today's exact inline elements"), so it needs
  an owner decision, not a drive-by fix. *Fix candidate:* mount `HoldableBox`
  for any interactive box (press OR hold) with a nullable `hold` prop that
  no-ops when null — element type then stays stable across interaction-
  metadata patches; re-pin the static-markup tests accordingly.
- **kit/kit.ts + playground/gallery.tsx (duplicated box builder)** — the same
  positional box-builder exists in both (edited in lockstep for `onHold`;
  review r2). Minimal alignment done in-branch (shared API-guard comment +
  identical conditional-spread spelling). *Fix (structural, next
  /refactor-audit):* fold the gallery `Sheet` onto `@facet/kit`'s builder or
  extract one shared helper.
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
- **react/StageRenderer.tsx (hybrid re-entry guard, r5)** — a primary
  pointerdown from a DIFFERENT pointer (hybrid mouse+touch) while a gesture
  is live re-arms the timer and overwrites `gesturePointerRef`/origin,
  orphaning the first pointer's gesture. Obscure hardware interleaving;
  fail direction is a mis-attributed hold, not a wrong press. *Fix:* ignore a
  pointerdown when `gesturePointerRef` is set to another id + one test.
- **react/StageRenderer.tsx (slop boundary exactness, r5)** — no test pins
  the strict `>` at exactly HOLD_SLOP_PX (an 8.0px move must NOT disarm; the
  squared comparison flipping to `>=` would pass the suite). *Fix:* one
  boundary test at dx=8,dy=0 and dx=8.01.
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
- **core/validate.ts (asAction secondary messages omit the field label, r3)**
  — the nameless-agent / navigate-`to` / toggle-`target` issue strings don't
  say whether the bad action sat on `onPress` or `onHold` (the three primary
  strings do). *Fix:* interpolate the `field` param into the remaining three
  messages + pin with one test.
- **playground/print-tree.ts (outline blind to onHold, r3)** — the debug
  outline prints `onPress`/`hidden` but not `onHold`, so holdable boxes are
  invisible in dumps. *Fix:* one line in the outline printer.

## P3 — residuals from Bundle B's review (kits-themes-as-data; track, fix opportunistically)

Found by the bundle's 3-round adversarially-verified `/code-review` (all P0–P2
fixed in-branch; these are the confirmed non-blocking nits). Evidence in the
Bundle B PR review record.

- ~~quickstart/cli.ts (--assets guard)~~ — RESOLVED in-branch (review r6): the
  explicit path must be a readable directory (statSync + readdirSync probe,
  exit 1), pinned by a cli test.
- ~~core/validate.ts (validateStamp bounds)~~ — RESOLVED in-branch (review
  r5+r6): stamp names share `isValidThemeName`, descriptions truncate at the
  shared 200-char cap, and the refusal issue never echoes the raw name.
- **quickstart/prompt.ts (stamp budget)** — the 4000-char cap measures only the
  fragment JSON, not the `- name: description` head, and there is no aggregate
  section cap. *Fix:* measure head+fragment; add `MAX_STAMPS_SECTION_CHARS`.
- **quickstart/agent.ts (set_theme)** — an unknown theme name returns
  `ok`/`mutated:true` while the page silently keeps the default look. *Fix:*
  error observation naming the available themes (append_node precedent).
- ~~runtime/assets.ts (stamp dedup)~~ — RESOLVED in-branch (review r6):
  first-wins + issue, mirroring themes; pinned by an assets test.
- **core/validate.ts (sanitizeScreens)** — `kept` is a plain object: a screen
  keyed `__proto__` drops silently and `entry:"constructor"` resolves through
  the prototype chain into the output. *Fix:* null-proto map + own-key check.
- **runtime/assets.ts vs server/offline.ts** — `isSeedableTree` duplicates
  `hasBuiltStage` (already divergent: `isContainer` vs `"children" in`). *Fix:*
  server imports the runtime helper.
- **cli/commands.ts (surface drift)** — Stage.theme() and set_theme exist but
  the `facet` CLI has no `theme` command while STAGE_SPEC (embedded in the
  bridge prompt) now advertises the slot. *Fix:* add the command + bridge
  prompt line.
- **core (consolidation ×3)** — `isPlainObject`/`isObject` duplicate guard;
  the `__proto__/prototype/constructor` blocklist defined thrice (theme.ts,
  validate.ts, patch.ts); fontSize clamp reuses `SPACE_PX_RANGE`. *Fix:* one
  shared internal module; a `FONT_SIZE_PX_RANGE` of its own.
- **core/theme.ts** — redundant `theme as FacetTheme` cast at the return
  (compiles clean without it).
- **tests** — prompt.test.ts: no assertion that an all-oversized stamp set
  suppresses the STAMPS section; theme.test.ts: negative-dimension clamp floor
  (`"-20px"` → `"0px"`) untested.
- ~~server/server.ts:385 (seed frame vs lastApplied)~~ — RESOLVED in-branch
  (review r6, upgraded to P2): `FacetRuntime.handle`/`applyMessages` return
  `TurnResult` with `agentMutated` (computed pre-seed), and the server gates
  `recordApplied` on it — a say-only turn re-emitting the seed can no longer
  falsely stale a parked late result; pinned by a server interleaving test.
- **runtime/assets.ts (loadAssets throw guards, r7)** — the theme/stamp loops
  are try/catch-guarded but `await store.load()` and the initial-tree
  `validateTree` call are not; a rejecting DB adapter or throwing accessor
  breaks the documented "never throws" contract. *Fix:* mirror the loop
  guards at both seams (skip + issue).
- **runtime/assets.ts (seed arming order + eviction comment, r7)** —
  `withInitialStage.open()` arms `takeSeeded` only after `store.save`
  resolves, so a commit-then-reject save loses the seed frame permanently;
  and the FIFO-eviction comment calls a dropped armed key "benign" when it
  actually means a failed-first-turn client keeps a blank page until reload.
  *Fix:* arm before save; correct both comments.
- **core/theme.ts (contrast parser coverage, r7)** — `parseSrgb` skips
  keyword and `hsl()` colors that `isAllowedColor` admits, so the WCAG check
  silently misses them. *Fix:* HSL→RGB conversion + a named-colors table, or
  narrow the allowlist claim.
- **core/patch.ts (move ghost key, r11)** — a failed `move` whose `from` is a
  missing object member restores a ghost `undefined` key, violating per-op
  atomicity. *Fix:* verify source existence before mutating (RFC 6902 "from
  MUST exist").
- ~~runtime (effect-based agentMutated, r11)~~ — RESOLVED in-branch (review
  r12, upgraded to P2): `StageFoldResult.mutated` (true iff a non-`test` op
  actually applied) now feeds `TurnResult.agentMutated`; over-cap/empty/
  non-array/all-salvage-dropped turns no longer bump `recordApplied` (r13
  closed the late-apply seam variant with the same effect-based gate).
- **core/stage-fold.ts (test-guard pre-guard ops, r13)** — ops applied BEFORE
  a failed `test` guard stay applied while the in-code RFC 6902 §5 citation
  promises whole-document abort. *Fix:* roll back to the pre-batch stage on a
  failed guard (or correct the citation to the deliberate partial-salvage
  semantics).
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

---

_Campaign 1 source sweeps: code-review 6 lanes (`wf_4e2fadd0-31d`) + types lane
(`wf_0f294ddd-bb4`), refactor-audit 5 dimensions (`wf_84bc52dc-f8f`) + hygiene
(`wf_4d26ff5d-8e6`) — 24 confirmed findings, 21 fixed in PR #3._
