# Context Evidence: kits-themes-as-data

> Stage 0 of /spec-bridge. Anchors verified by direct reads + git grep on the
> current tree (post-commit c1e812f, 2026-07-03). Line numbers may drift a few
> lines; symbol names are stable.

## Current shapes the feature changes

### Themes (S1)
- **Hardcoded theme**: `packages/react/src/theme.ts` — null-prototype token maps
  `SPACE:28`, `FONT_SIZE:38`, `FONT_WEIGHT:51`, `RADIUS:61`, `COLOR:76`
  (exported), `RATIO:93`; style fns `boxStyle:127`, `textStyle:146`,
  `imageStyle:157`, `fieldStyle:165` close over the module-level maps. The
  null-proto + `satisfies` pattern (`theme.ts:22-28` comment) is exactly what
  `validateTheme` output maps must reproduce (hostile `__proto__` keys resolve
  to `undefined`).
- **Token groups single-source**: `packages/core/src/tokens.ts` — runtime arrays
  `SPACES:16`, `FONT_SIZES:20`, `FONT_WEIGHTS:23`, `RADII:26`, `COLORS:30`,
  `RATIOS:64` with types derived from them. `validateTheme` per-group key
  validation iterates these same arrays (membership check precedent:
  `asToken`, `packages/core/src/validate.ts:94-96`).
- **Tree**: `FacetTree` at `packages/core/src/tree.ts:13-26` (root, nodes,
  screens?, entry?) — `theme?: string` is one more optional field.
  `isTreeShaped` (`tree.ts:40-46`) checks only root/nodes → additive-safe.
  `EMPTY_TREE` at `tree.ts:49-59` needs no change.
- **validateTree output construction**: `packages/core/src/validate.ts:465-475`
  builds the output tree from an explicit field list (root, nodes, screens,
  entry) — an unmodified validateTree would silently DROP `theme`. The
  keep-if-string logic goes here (`asString` helper at `validate.ts:86-88`;
  screens/entry sanitation precedent `sanitizeScreens:314-350`).
- **Renderer theme seam**: `packages/react/src/StageRenderer.tsx:17` imports the
  style fns; call sites `:394,:401` (box), `:406` (text), `:414` (image),
  `:432` (field). Theme-parameterization = style fns gain an optional resolved
  theme argument (or a factory) with today's maps as default; `StageRenderer`
  gains optional props (theme map + the tree's `theme` name is already on the
  `tree` prop). Narrow existing usages (`<StageRenderer tree onAction />` at
  `packages/quickstart/src/page/main.tsx:66`, playground) compile unchanged.
- **COLOR export consumer**: `packages/react/src/ChatDock.tsx:3,70-103` reuses
  the exported palette for chrome. Decide at spec: ChatDock stays on the
  DEFAULT document's palette (safe, zero API change) or takes a theme prop.
  Either way `COLOR` must remain exported (it is public via the barrel
  `packages/react/src/index.ts`).

### Registry (S1–S3, DC-007)
- **Adapter posture to copy**: `packages/runtime/src/stage-store.ts:14-18`
  (interface) + `MemoryStageStore:47-61` in the browser-safe barrel
  (`packages/runtime/src/index.ts:1-4` — "no Node built-ins" comment), with the
  file reference behind the node-only entry `packages/runtime/src/node.ts:1-4`
  and the `"./node"` subpath export (`packages/runtime/package.json` `exports`).
  The assets registry (themes + stamps + initial tree, per agent) follows this
  exactly: interface + `MemoryAssets` in `index.ts`, `FileAssets` in `node.ts`.
- **File-reference patterns**: `packages/runtime/src/file-stage-store.ts` —
  shape-guard before trusting a disk blob (`isSession:15-27`), log-and-return-
  undefined on unreadable JSON (`:90-99`). Registry loading reuses the posture:
  invalid document → skipped + logged issue, boot proceeds (brief policy table).

### Initial tree (S3)
- **Session open seam**: `openSession` (`packages/runtime/src/stage-store.ts:34-44`)
  hardcodes `stage: EMPTY_TREE` at `:41` — the natural seed point (fresh
  session only, by construction). All session access is serialized per
  (agent, visitor) by `FacetRuntime.handle` (`packages/runtime/src/runtime.ts:72-76`,
  `createSerialQueue` at `:39`), and `handleOne` opens the session BEFORE the
  agent call (`runtime.ts:98-105`) — so a seed at open time is (a) inside the
  same serialized write path (invariant #6) and (b) visible to the agent's
  first turn ("refines the seeded stage").
- **Snapshot already correct**: the browser's first snapshot comes from
  `runtime.stageFor` via rehydrate (`packages/server/src/server.ts:281,299-301`)
  — a stage seeded at open ships automatically; no server change for DC-009.
- **Interaction to record as intentional**: `hasBuiltStage`
  (`packages/server/src/offline.ts:29-35`) — a seeded initial tree counts as
  "built", so the offline face (`offlineFor:40-48`) will NOT overwrite it. That
  is the desired behavior (the skeleton IS the page), but the spec must state it.

### Stamps + prompt layer ② (S2, DC-008)
- **Injection point**: `buildSystem` (`packages/quickstart/src/prompt.ts:56-63`)
  joins `[intro, STAGE_SPEC, WORKFLOW, PAGE BRIEF]` — theme names+descriptions
  and stamp fragments + the id-prefix rule slot in as new sections; with no
  assets the join must stay byte-identical (DC-008; pinned by
  `packages/quickstart/src/prompt.test.ts:24-27` which asserts STAGE_SPEC
  verbatim).
- **Stamp validation posture**: reuse `validateTree`'s node sanitizer semantics
  (brick shapes + token membership). Note: `sanitizeNode`
  (`packages/core/src/validate.ts:226-305`) is module-private today — the
  fragment validator either lives next to it in core (recommended; same file,
  shares helpers) or revalidates fragments as mini-trees.
- **STAGE_SPEC**: `packages/core/src/spec.ts:8-33` (single source; must teach
  `theme?: string` select-by-name-only). Embedders (from git grep):
  `apps/playground/src/generator.ts:7,11`, `packages/bridge/src/bridge.ts:8,91`,
  `packages/bridge/src/persistent.ts:11,37`; content pins in
  `packages/core/src/spec.test.ts` (add a `"theme"` pin, DC-012).

### Kit namespacing (S4, DC-006)
- **Collision source**: `packages/kit/src/kit.ts` — `Builder.next()` mints
  sequential `k${count}` (`:23-26`); `page()` hardcodes `"root"` (`:164`).
  Presets are `Block = (builder) => NodeId` (`:68`) so an instance-prefix on the
  Builder (per `page()` call / per graft) is a contained change.
- **Id-contract check**: `packages/kit/src/kit.test.ts:14` pins only
  `tree.root === "root"`; no test or consumer references `k1…kn`
  (`apps/playground/src/ui.ts:6`, `server.ts:18`, `gallery.tsx` build via
  `page()` and hand-rolled trees only). Generated-id change is additive-safe
  as the brief claims. `page()`'s output must still satisfy `validateTree`
  (root box) — keep `"root"` as page()'s own root id; namespace the block ids.

### Quickstart wiring (S1–S3 live, DC-009/010)
- **CLI flags**: `parseFlags` (`packages/quickstart/src/cli.ts:52-102`) — add
  `--assets <dir>`; explicit-path-must-exist / default-silent-fallback
  precedent is the guide resolution at `cli.ts:120-137`.
- **Agent options**: `QuickstartAgentOptions`
  (`packages/quickstart/src/agent.ts:32-43`); `buildSystem` is called once at
  agent creation (`agent.ts:231`) — matches "assets read once at boot".
- **Server options**: `QuickstartServerOptions`
  (`packages/quickstart/src/server.ts:34-52`); `SHELL_HTML` at `:62-66` is the
  boot-seam candidate (below). `startQuickstart` already threads
  `stageStore`/`sink` (`:274-275`) — the initial-tree-seeding store wraps here.
- **Stub for DC-010**: `packages/quickstart/src/stub.ts` (deterministic keyless
  agent) must gain a deterministic theme-switch behavior; E2E homes:
  `packages/quickstart/src/quickstart.e2e.test.ts` (Tier 1a),
  `packages/quickstart/e2e/bundle.test.ts` / `e2e/smoke.test.ts` (Tier 1b/2).

## The boot seam (brief Open Question — evidence for the writer)

Two candidates for shipping the validated theme map to the browser:

1. **HTML shell (recommended by evidence)** — inline the validated map as a
   `<script>` global in quickstart's `SHELL_HTML`
   (`packages/quickstart/src/server.ts:62-66`), read it in
   `packages/quickstart/src/page/main.tsx` and pass it to `StageRenderer` as a
   prop. Only `@facet/quickstart` + `@facet/react` change; `@facet/server`,
   `@facet/client`, and the protocol stay untouched — which the brief's own
   constraint ("No new protocol messages") requires. Non-quickstart hosts pass
   the map to `StageRenderer` themselves (they already own their shell).
2. **SSE snapshot** — would extend `ServerMessage`
   (`packages/core/src/protocol.ts:76-79`) or the rehydrate write
   (`packages/server/src/server.ts:297-301`); that IS a new protocol message
   and also complicates `Last-Event-ID` resume stamping. Conflicts with the
   brief constraint; reject unless the writer finds a blocker in (1).

## Consumer sweep (RISK-API) — from `git grep`, 2026-07-03

- `boxStyle/textStyle/imageStyle/fieldStyle` (react theme fns): in-package
  `StageRenderer.tsx:17` + public via the react barrel; same NAMES also exist
  as private validators in `core/src/validate.ts:167-224` (no relation — do not
  confuse when grepping).
- `COLOR`: `packages/react/src/ChatDock.tsx` only (plus barrel export).
- `@facet/kit` consumers: `apps/playground/src/{gallery.tsx,server.ts,ui.ts}`,
  `packages/kit/src/kit.test.ts` — none references generated `k*` ids.
- `STAGE_SPEC` embedders: playground generator, bridge (spawn + persistent),
  spec.test.ts, quickstart prompt.ts/prompt.test.ts.
- `FacetTree` re-constructors that must PRESERVE `theme`:
  `validateTree` output (`core/src/validate.ts:465-475` — the one real change);
  `applyPatch` is pure JSON (no field knowledge, no change);
  `FileStageStore.isSession/isTreeShaped` (`runtime/src/file-stage-store.ts:15-59`)
  and `useFacet`'s guard are shape floors — additive-safe, no change.
- `validateTree` callers (18 files) are unaffected by an added keep-field;
  `runtime.ts:157` (`validateTree(stage).tree` on every save) is why the
  keep must land in core or the theme name would be stripped on first save.

## Risk register (writer MUST resolve each)

- **RISK-INV-1 (invariant #3, fail-safe — brief TOUCHES)**: every new surface
  degrades, never throws. Resolutions with anchors: unknown/non-string `theme`
  → kept-only-if-string in `validateTree` (`validate.ts:465-475`) + renderer
  resolves unknown names to the exported default document (lookup style:
  `liveScreenRoot`/`styleOf` defensiveness, `StageRenderer.tsx:24-49`);
  `validateTheme` output maps built on `Object.create(null)` (pattern
  `theme.ts:28`); invalid registry documents skipped+logged
  (`file-stage-store.ts:90-99` posture); invalid initial tree → `EMPTY_TREE`
  fallback is automatic (`validateTree` returns EMPTY_TREE on garbage,
  `validate.ts:352-357` — but the seed must check for that and SKIP seeding,
  else the "fallback to model-first paint" claim silently becomes "seed an
  empty tree", which flips `hasBuiltStage` and changes the offline face —
  DC-009 must pin this). Renderer probe sweep = DC-011.
- **RISK-INV-2 (invariant #4, declarative/tokens — brief TOUCHES)**: raw CSS
  exists only as operator data behind `validateTheme` in `@facet/core`
  (value-format allowlist; deny `url()/var()/expression()/javascript:`; clamp
  dimensions; contrast = warning). The tree carries a NAME only; the style fns
  still index by token name; STAGE_SPEC (`spec.ts:8`) advertises select-by-name
  only; prompt ② injects names + descriptions, never values
  (`prompt.ts:56-63`). No model-facing surface accepts a value (DC-012).
- **RISK-INV-3 (invariant #6, two-writers — seeding touches the write path)**:
  the initial-tree seed must run inside the per-(agent,visitor) serialized
  path. Seeding at `openSession` (`stage-store.ts:34-44`) or a store wrapper
  satisfies this because ALL opens happen under `FacetRuntime`'s serial queue
  (`runtime.ts:72-76`); seeding anywhere browser-side is forbidden. The
  browser's theme resolution is a pure lookup on boot-shipped data — it writes
  no stage state (StageRenderer view-state precedent, `StageRenderer.tsx:252-259`).
- **RISK-API-1 (`FacetTree.theme` ripple)**: additive optional field; the only
  code that must actively change is `validateTree`'s output construction
  (`validate.ts:465-475`). All shape guards (`isTreeShaped`, `isSession`,
  useFacet/renderer floors) pass an extra field through. Tree constructors
  (`EMPTY_TREE`, kit `page()`, `offline.ts:4`, playground) need nothing. No
  external users (pre-1.0, unpublished).
- **RISK-API-2 (react style-fn/theme surface)**: `boxStyle` et al. and `COLOR`
  are public via the barrel. Contract: zero-extra-arg calls stay byte-identical
  to today (brief: "Additive (default = today)"; pinned by the existing static
  render suite `StageRenderer.test.ts` + `theme.test.ts`). `StageRenderer`
  gains optional props only — existing `(tree, onAction)` usages
  (`main.tsx:66`, playground) compile unchanged. Decide ChatDock's palette
  source explicitly (default-document is the no-break option).
- **RISK-API-3 (kit generated ids change)**: no consumer or test pins `k*` ids
  (`kit.test.ts:14` pins only "root"); playground uses `page()` opaquely.
  Breaking-in-theory, additive-in-practice; brief already waives (ids never
  contractual, pre-1.0). Keep `page()`'s root id `"root"` (validateTree's root
  fallback expects it, `validate.ts:406-411`).
- **RISK-API-4 (STAGE_SPEC text)**: bridge + playground embed it verbatim —
  they inherit the `theme` line automatically, which is safe (select-by-name
  needs no new tool). `spec.test.ts` gains a pin; `prompt.test.ts:24-27`
  (STAGE_SPEC-verbatim in buildSystem) keeps quickstart in sync.
- **RISK-PKG-1 (core stays node-free, barrels hold, no cycles)**:
  `validateTheme` + `FacetTheme` are pure string/number ops — zero deps, no
  `node:*` (WCAG contrast math is arithmetic). Registry interface + memory ref
  → `@facet/runtime` browser-safe barrel; file ref → `@facet/runtime/node`
  (existing subpath, `runtime/package.json` exports). Dependency direction
  unchanged: react→core, runtime→core, quickstart→{core,runtime,server,agent}
  all already exist; nothing new crosses packages.
- **RISK-PKG-2 (boot-seam containment)**: under the recommended HTML-shell
  seam, `@facet/server` and `@facet/client` change NOT AT ALL — the brief's
  "possibly" row resolves to "no change". If the writer instead touches the
  snapshot path, that is a protocol change the brief's own constraints forbid;
  treat as a spec-review blocker.

## Conventions every WU inherits

- TS strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`); `import type`; `.js` import extensions; barrel
  exports only (the `facet-quickstart` bin is the standing exception).
- Tests: vitest in `packages/**/src/*.test.ts`; react DOM assertions via jsdom
  `.test.tsx` with `// @vitest-environment jsdom`; static render via
  `renderToStaticMarkup`. Tier 1 E2E: `quickstart.e2e.test.ts` +
  `e2e/vitest.config.ts` suites (see `.claude/skills/live-test/SKILL.md`).
- Gates: `pnpm typecheck && pnpm test && pnpm lint && pnpm format:check &&
  pnpm build`; review bar P0–P2 = 0; no new dependencies (`@facet/core` stays
  dependency-free — `validateTheme` must not pull a color library).
