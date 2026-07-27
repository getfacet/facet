# @facet/agent-client

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

- 559e170: Live streaming v1: agents can return async iterable batches of server messages,
  letting the runtime apply, persist, and deliver a turn incrementally while
  recording one accumulated sink event. `defineStreamingAgent` streams Stage
  deltas per step, quickstart now yields provider steps as live page updates, and
  non-streaming remote/bridge boundaries explicitly collapse async results into a
  single control batch.

### Patch Changes

- 3726db7: Hardening campaign 1 — robustness fixes across the protocol, renderer,
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
- Updated dependencies [f20f5db]
- Updated dependencies [1a2a517]
- Updated dependencies [99b1a84]
- Updated dependencies [bbec237]
- Updated dependencies [cddf444]
- Updated dependencies [6ca8fdc]
- Updated dependencies [330e9d9]
  - @facet/core@0.1.0
