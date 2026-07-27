# @facet/bridge

## 0.1.0

### Minor Changes

- 0d27d03: Hard-cut Facet's style and design-system contract to one agent-friendly model.

  - Every native Brick owns a closed `style` vocabulary: shared-looking target or
    property names on different Bricks are still separate Brick-owned contracts.
    Styles may be omitted, select a same-Brick Preset, use direct semantic token
    names, or combine a Preset with direct overrides. Raw CSS remains Theme-only.
  - One complete per-agent Theme contains concrete token values, Brick defaults,
    and Presets. It cannot be selected from a Facet document. The host-owned
    `colorMode` switches the whole document between Theme light and dark paint.
  - Patterns replace reusable reference trees. They are exact, read-only examples
    with discovery metadata; agents inspect them and then author ordinary Bricks.
  - Agent discovery is progressive and bounded through `get_pattern`,
    `get_preset`, single-Brick `get_brick_spec`, and exact-path
    `get_style_choices`. Authoring errors are structured and atomic so an agent can
    retry, while the renderer still skips only invalid fragments.
  - Assets are exactly `theme.json`, `patterns.json`, and optional
    `initial.tree.json` (or equivalent store fields). The former asset-policy,
    reference-tree, style-selector, subtree-palette, and document-Theme surfaces
    have no compatibility aliases or runtime conversion.

  All in-repo consumers, storage adapters, prompts, tests, and documentation move
  atomically to the new contract.

- e5c7ebc: Add `@facet/bridge` — a local bridge (`facet-bridge`) that lets a local coding
  agent (Claude Code, Codex, …) own a Facet link and drive the page. Two modes:
  `spawn` (a CLI per event — any CLI, e.g. claude/codex) and `persistent` (one
  always-on Claude session, via the Agent SDK, that owns the link and drives it
  through in-process `facet_*` tools). Both use the local Claude Code auth (no API
  key). Configurable server URL, agent id, mode, method, brain command, and model.
- 559e170: Live streaming v1: agents can return async iterable batches of server messages,
  letting the runtime apply, persist, and deliver a turn incrementally while
  recording one accumulated sink event. `defineStreamingAgent` streams Stage
  deltas per step, quickstart now yields provider steps as live page updates, and
  non-streaming remote/bridge boundaries explicitly collapse async results into a
  single control batch.

### Patch Changes

- d3cd13c: Clarify agent-stack ownership ahead of the first release. Reference-agent now
  uses only canonical `Reference*` implementation names; the `Quickstart*`
  factory and option names move to `@facet/quickstart`, with no aliases left in
  `@facet/reference-agent`. Test-only compaction controls are no longer part of
  the public options. Quickstart also drops unpublished compatibility modules and
  duplicated suites, agent-tools shares deterministic structural comparison and
  splits its executor by responsibility, and bridge runners share one internal
  event-prompt builder. Oversized agent-stack production modules are split into
  cohesive internal modules.
- a9a15ca: Async delivery & scale round 1 — an agent turn's result is never silently lost
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
- 9af8d4b: Structural cleanup ahead of the first release (refactor-audit 1). Renames and
  moves — all pre-first-publish, no shims: `BridgeOptions.mode`/`method` are now
  `runner` ("spawn" | "persistent") and `continuity` ("oneshot" | "resume"), with
  env vars `FACET_RUNNER`/`FACET_CONTINUITY`; unrecognized values now fail fast
  instead of silently defaulting. `browserVisitorId` moved from `@facet/react` to
  `@facet/client` (next to the transport that needs it). New in `@facet/core`: `createLruMap` (the shared bounded-LRU used by the
  runtime session cache, the bridge resume ids, and the server frame log),
  `AgentControlFrame`, `sanitizeActionPayload`/`isPrimitiveRecord`, and a base
  `isTreeShaped`. The server's `createFacetServer` was decomposed into unit-tested
  internal modules (frame log, late window, agent channel, offline) with no
  behavior change; the late-result staleness guard now carries its arrival
  `{index, era}` pair atomically. `@facet/client` no longer depends on
  `@facet/runtime` at runtime. All packages now declare `engines`, `repository`,
  and ship a LICENSE. (`@facet/*` are versioned together as a fixed group.)
- 63fffb5: Add the name-only theme action to the local bridge and CLI surfaces so local
  agents can select validated stage themes.
- cddf444: Consolidate shared event, action, node, and browser-view validation paths,
  align authoring guidance with Facet's closed brick hierarchy, and clean up
  package and test boundaries without changing protocol behavior. Core now exports
  canonical event normalizers, and client exports a shared `withView` helper.
- Updated dependencies [e3a1ff5]
- Updated dependencies [0a0ad44]
- Updated dependencies [a9a15ca]
- Updated dependencies [4bf72e3]
- Updated dependencies [67e2cd4]
- Updated dependencies [0d27d03]
- Updated dependencies [7f247b0]
- Updated dependencies [736c795]
- Updated dependencies [4c89b56]
- Updated dependencies [e7b7a48]
- Updated dependencies [6327291]
- Updated dependencies [b6c1cf9]
- Updated dependencies [0753cf7]
- Updated dependencies [d111724]
- Updated dependencies [65f10a0]
- Updated dependencies [89175af]
- Updated dependencies [a285569]
- Updated dependencies [852e070]
- Updated dependencies [3726db7]
- Updated dependencies [831a740]
- Updated dependencies [d2cf7b3]
- Updated dependencies [75f7206]
- Updated dependencies [a1a57ca]
- Updated dependencies [559e170]
- Updated dependencies [d9d2308]
- Updated dependencies [d183aed]
- Updated dependencies [e4765ca]
- Updated dependencies [c1e812f]
- Updated dependencies [9af8d4b]
- Updated dependencies [63fffb5]
- Updated dependencies [f20f5db]
- Updated dependencies [1a2a517]
- Updated dependencies [99b1a84]
- Updated dependencies [bbec237]
- Updated dependencies [cddf444]
- Updated dependencies [6ca8fdc]
- Updated dependencies [330e9d9]
  - @facet/core@0.1.0
  - @facet/agent@0.1.0
  - @facet/agent-client@0.1.0
  - @facet/cli@0.1.0
