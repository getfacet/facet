# Hardening Campaign 1 — Scope

> This campaign's "requirements" are `docs/HARDENING-BACKLOG.md` (24 findings from
> a complete, adversarially-verified whole-codebase review of `main`). This file
> pins what's IN vs OUT for round 1, for the spec-writer/reviewer.

## In scope (round 1)
Every backlog item **except** the three scale/async-delivery items below.
Concretely: all P2 correctness + single-source + test-gap items, and all P3 nits.
These are independent bug/robustness/consolidation fixes, each small.

## Explicitly OUT (deferred to a later design round — do NOT include)
- **[P2] per-event timeout silently discards a queued agent turn's result** —
  needs async-delivery redesign (version/seq), not a patch.
- **[P2] spawn mode: unbounded concurrent brain CLIs per visitorId** — needs a
  concurrency limiter design.
- **[P2] server remote-agent handshake + /event HTTP-level regression tests** —
  needs a server test harness (its own sizable effort); round 1 covers only unit
  tests that don't require a live HTTP server.

## Constraints (per fix)
- Minimal change; preserve existing behavior and the fail-safe invariants — a
  hardening fix must not alter the product's observable behavior beyond closing
  the specific hole.
- No new dependencies. `@facet/core` stays browser-safe / node-free. Barrel
  exports preserved. TS strict (exactOptionalPropertyTypes, noUncheckedIndexedAccess).
- Each fix that CAN be pinned by a unit test gets one (TDD red_check). Pure
  test-addition items (persistent driver, sse reset) are their own WUs.

## Grouping guidance for the writer
Group by package/area into disjoint-file WUs so they can run in parallel:
- core: patch.ts (test-op deep-equal, array-index RFC6902, return type), validate.ts (dedup siblings), isSafeImageSrc test.
- react: StageRenderer (dedup child keys, field raw-path coercion + FIELD_INPUTS, classifyPress payload filter), theme.ts (null-proto token maps + export COLOR + MAX_DEPTH export/import), ChatDock (use exported COLOR), useFacet.
- runtime: file-stage-store / file-sink (atomic write + shape-check on read), session-file test.
- client: sse-transport (reset test, ordered sends), local-transport.
- bridge: cli/bridge defaults consolidation, port validation, FACET_AGENT_TOKEN doc, sessionIds note; persistent.ts (driver tests + `screens` tool parity).
- agent-client: connect terminal-status handling + tests.
- server: createFacetServer extraction is a LARGER refactor — consider a single
  focused WU or defer; the /agent-default-auth + body-size are small.
- hygiene: add the 9 missing package READMEs (one WU).
Keep every WU ≤5 files; note which items share a file so they land in one WU.
