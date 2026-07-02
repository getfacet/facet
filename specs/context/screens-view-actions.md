# Context Evidence: screens-view-actions

> Stage 0 of /spec-bridge. Anchors verified by direct reads + git grep on the
> current tree (post-commit 4c26768). Line numbers may drift a few lines; symbol
> names are stable.

## Current shapes the feature changes

- **Stage**: `FacetTree = { root: NodeId, nodes: Record<NodeId, FacetNode> }` —
  `packages/core/src/tree.ts:13-16`; `EMPTY_TREE` at `tree.ts:20` (root "root").
- **Action**: `FacetAction = { name: string, payload?: Record<string, string|number|boolean> }` —
  `packages/core/src/nodes.ts:32-37`. Attached only via `BoxNode.onPress`
  (`nodes.ts:76-83`). No kind discriminant exists.
- **Bricks**: exactly `box | text | image | field` (`nodes.ts:116`); box is the
  only container, flow-only. `FIELD_INPUTS` single-source (`nodes.ts:100-102`).
- **Protocol**: `ClientEvent = visit | message | action` (`packages/core/src/protocol.ts:33-36`),
  `ServerMessage = patch | say` (`protocol.ts:42-44`), `FacetAgent` (`protocol.ts:52-55`),
  `FacetTransport` (same file). **No new endpoints/events needed for this feature** —
  navigate/toggle never reach the server.

## Fail-safe machinery to extend (invariant #3)

- `validateTree` — never throws, strips unknown types/tokens, breaks cycles
  (gray/settled DFS), caps depth `MAX_DEPTH = 100`, `isSafeImageSrc` exported:
  `packages/core/src/validate.ts` (cycle-break + depth around `:252-290`).
  → must learn the screens map: validate each screen's tree, normalize legacy
  `{root,nodes}` input, sanitize `entry`, strip malformed action kinds.
- `applyPatch` — RFC6902, pure, shared client/server (`packages/core/src/patch.ts:167-173`);
  a root replace faithfully returns `operation.value` (`patch.ts:125-128`) — the
  reason normalization must live in validateTree, not in patch.
- Renderer fail-safe — `isRenderableTree` guard, ancestor-set cycle guard,
  `MAX_DEPTH`, unsafe-image drop, unknown-type skip:
  `packages/react/src/StageRenderer.tsx` (guards at top; onPress →
  `role="button"` + onClick → onAction around `:86-97`; field renders an
  uncontrolled input with NO handler `:115-128` — leave dead in this phase).
- Client patch fail-safe — try/catch keeps current tree:
  `packages/react/src/useFacet.ts:30-46`.
- Server-side stage always validated on save: `packages/runtime/src/runtime.ts:88-105`
  (`applyToSession` per-patch try/catch + `validateTree(stage).tree` at `:104`).
- Per-(agent,visitor) serialization: `runtime.ts:39,67-71` (`createSerialQueue`).

## Where view-state must live (invariant #6 mitigation)

- Browser owns view-state; server owns content. Renderer-side seam:
  `packages/react/src/StageRenderer.tsx` (+ possibly a small hook in
  `packages/react/src/useFacet.ts` or a new `useViewState`). React state keyed by
  screen name / node id. Content arrives via the existing patch flow — no change
  to `packages/server/src/server.ts` push path (`pushToBrowser`, rehydrate around
  `server.ts:212-257`).

## Authoring + vocabulary surfaces

- `Stage` fluent authoring → RFC6902: `packages/agent/src/stage.ts:24-75`
  (render/set/append/remove/say + flush). Needs screens-aware authoring (e.g.
  render a named screen) — exact API is the writer's call.
- CLI op-building: `packages/cli/src/commands.ts` (`buildMessages`, tested in
  `commands.test.ts`).
- **STAGE_SPEC** (LLM-facing vocabulary, single source):
  `packages/core/src/spec.ts:8-20`; embedded by `apps/playground/src/generator.ts`,
  `packages/bridge/src/bridge.ts` (spawn SPEC), `packages/bridge/src/persistent.ts`
  (SYSTEM). MUST teach screens/entry/navigate/toggle.
- Persistent bridge sanitizes render-tool output through validateTree
  (`persistent.ts` render handler) — normalization there is free once
  validateTree learns screens.
- Kit presets emit bricks only (`packages/kit/src/kit.ts`; `page()` returns a
  full tree) — must keep emitting valid (single-screen) stages.

## Consumer sweep (RISK-API) — from `git grep`, 2026-07-02

- `FacetTree` consumers: **24 files** across every package + playground:
  core(tree/patch/validate/protocol), react(StageRenderer+tests/useFacet),
  runtime(runtime/stage-store.test), server, agent(stage), agent-client(connect —
  `EMPTY_TREE` fallback at `connect.ts:106`), cli(commands), kit(kit), bridge
  (bridge/persistent), playground(demo/gallery/generated/generator/print-tree/
  server/ui).
- `FacetAction`/`onPress` consumers: core(nodes/protocol/spec/validate),
  react(StageRenderer+tests), kit(kit+test), playground(App/gallery/generated/
  live/nova/print-tree).
- `STAGE_SPEC` embedders: generator.ts, bridge.ts, persistent.ts (+ spec.ts).
- `EMPTY_TREE` consumers: agent-client, playground demo/generated, core tests.

## Risk register (writer MUST resolve each)

- **RISK-INV-1 (invariant #6)**: two-writers — resolved by ownership split
  (browser: view-state only; server: content only). Seam: StageRenderer/useFacet
  view-state React state; content path untouched. Spec must state the reconcile
  rules: current screen kept if alive, else entry, else first screen, else plain;
  orphaned toggle entries no-op.
- **RISK-INV-2 (invariant #3)**: new shapes must be fail-safe — validateTree
  normalizes screens/entry/action-union (legacy shapes normalized, malformed
  stripped); renderer guards unknown screen/target. Pin with DC-004/005 tests.
- **RISK-API-1**: FacetTree shape change ripples 24 files — mitigation:
  validateTree normalization is the single conversion point; every consumer that
  only passes trees through keeps working; consumers that construct trees
  (kit/agent/cli/playground/EMPTY_TREE) migrate in-repo. No external users
  (unpublished, pre-1.0).
- **RISK-API-2**: FacetAction discriminated union — legacy `{name,payload}`
  normalized to `kind:"agent"`; unknown kinds stripped (box becomes
  non-pressable). Update validate + STAGE_SPEC + kit `button()` + renderer.
- **RISK-PKG-1**: `@facet/core` stays browser-safe/node-free (view-state lives in
  `@facet/react`); barrel exports preserved (`index.ts` per package).

## Conventions every WU inherits

- TS strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`); `import type`; `.js` import extensions; barrel exports.
- Tests: vitest; react interaction tests via jsdom `.test.tsx` with
  `// @vitest-environment jsdom` docblock (see `StageRenderer.interaction.test.tsx`,
  `useFacet.test.tsx`); static render via `renderToStaticMarkup` `.test.ts`.
- Gates: `pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm build`;
  review bar P0–P2 = 0. No new dependencies without approval.
