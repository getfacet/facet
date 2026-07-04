# Context: unified-asset-pipeline

Context evidence for the `unified-asset-pipeline` feature. This doc is the
spec-writer-facing assembly of the context pass — file:line entrypoints, the
risk register, and the decision constraints (DC-xxx) the dev spec must satisfy.
All facts below were gathered/verified against the working tree; do not treat
absent facts as implied.

## Goal (one line)

Home the bundled **default theme data** (moved out of `@facet/react`) and the
**default stamp library** (moved out of `@facet/kit`) in a new browser-safe,
node-free `@facet/assets` package, and make `loadAssets` seed them as a **base
layer** that custom operator assets merge onto — one effective theme (per-field
merge) + one stamp union (custom shadows default). Remove `@facet/kit`.

## Affected packages

- `@facet/assets` (NEW)
- `@facet/react`
- `@facet/kit`
- `@facet/runtime`
- `@facet/core`
- `apps/playground`
- `@facet/quickstart`

## Code entrypoints (file:line)

### `@facet/assets` (NEW — does not exist yet)

- Verified absent: `ls packages/assets` = "No such file or directory".
- New **browser-safe / node-free** data package depending **only on**
  `@facet/core`. Will home:
  - the default-theme **DATA** (moved from `@facet/react`), and
  - the default **stamps** (moved from `@facet/kit`).
- Follow the `@facet/core` / `@facet/react` **barrel-only** pattern (`index.ts`).
- MUST NOT import `node:*` (REVIEW-RULES invariant #4 — browser-safety).

### `@facet/react`

- `packages/react/src/theme.ts:135` — `export const DEFAULT_THEME: FacetTheme`:
  the default-theme **DATA** that must move out to `@facet/assets`. Built from
  module consts `SPACE` / `FONT_SIZE` / `FONT_WEIGHT` / `RADIUS` / `COLOR` /
  `RATIO` (`theme.ts:38-94`) and `DEFAULT_RESOLVED` (`theme.ts:120`). React
  keeps the token→CSS **APPLICATION** only.
- `packages/react/src/theme.ts:178` — `export function resolveTheme(name, themes?)`;
  and the private per-field overlay pattern `overlayGroup` (`theme.ts:153`) —
  the existing per-field merge precedent that the theme base-layer merge
  (DC-002) should follow.
- `packages/react/src/index.ts:3` — `export * from "./theme.js"` barrel
  (`DEFAULT_THEME` currently re-exported here; a direct-importer break surface).

### `@facet/kit`

- `packages/kit/src/stamps.ts:17` — `export const KIT_STAMPS: readonly FacetStamp[]`
  (the default stamp library), derived via `fragment()` / `hero` / `card` /
  `button` from `kit.ts:161/147/108`. This DATA moves to `@facet/assets`;
  `toStamp` helper at `stamps.ts:13`.
- `packages/kit/src/index.ts` — barrel `export * from "./kit.js"` +
  `"./stamps.js"`; the **whole package is to be REMOVED** (DC-005).
  `kit.ts` exports: `page:182`, `text:91`, `heading:95`, `hero:161`,
  `card:147`, `button:108`, `fragment:211`, `Fragment:201` — `page` / `text`
  are the only externally-consumed helpers.

### `@facet/runtime`

- `packages/runtime/src/assets.ts:72` — `export async function loadAssets(store, agentId): Promise<LoadedAssets>`:
  the single validation gate to extend with base-layer seeding + per-type merge.
  Theme loop `78-108` (`validateTheme`, first-wins dedup); stamp loop `112-137`
  (`validateStamp` union); **never-throws** contract. This is where theme
  field-merge (DC-002) + stamp union/shadow (DC-003) + defaults-always-survive
  (DC-001/004) land.
- `packages/runtime/src/assets.ts:54` — `interface LoadedAssets`
  (`themes` / `stamps` / `initialTree` / `issues` — semantics may shift to
  'effective' resolved assets).
- `packages/runtime/src/assets.ts:28` — `interface AssetDocuments` (raw docs).
- `packages/runtime/src/assets.ts:44` — `class MemoryAssets` (the AssetsStore
  reference impl).
- `packages/runtime/src/index.ts:5` — `export * from "./assets.js"` barrel;
  file-backed `FileAssets` lives behind `@facet/runtime/node`
  (`packages/runtime/src/file-assets.ts`) — browser-safety boundary to preserve.

### `@facet/core`

- `packages/core/src/theme.ts` — `FacetTheme` (`:38`), `validateTheme` (`:510`),
  `isValidThemeName` (`:69`), `DEFAULT_COLORS` (`:144`). No theme-**MERGE**
  helper exists today; the brief flags a possible small additive merge helper
  here (core must stay dependency-free). `FacetStamp` / `FacetTheme` types stay
  unchanged.

### `@facet/quickstart`

- `packages/quickstart/src/cli.ts:169` — `const loaded = await loadAssets(new FileAssets(...))`,
  then `themes` / `stamps` fed to the shell theme-map + agent
  (`cli.ts:170-218`). Downstream consumer of `LoadedAssets` semantics — affected
  if merge changes what `loadAssets` returns. Depends on `@facet/react`
  (optional/peer, `package.json:38`) and `@facet/runtime`.

### `apps/playground`

- `src/ui.ts:2` and `src/server.ts:13` — `import { page, text } from "@facet/kit"`
  (the only real `@facet/kit` consumers; `gallery.tsx` references it in comments
  only). Must be replaced with local helpers / bricks on kit removal (DC-005),
  no behavior change.

## Decision constraints (DC-xxx) referenced by the risks

- **DC-001** — with all custom themes dropped, the default base layer must still
  resolve.
- **DC-002** — theme merge is **per-field**: custom fields override the default
  per-field, other fields kept.
- **DC-003** — stamp union: a **custom** stamp sharing a default's name
  **SHADOWS** the default; default stamps carry unique names.
- **DC-004** — a bad doc among good ones survives; `loadAssets` never throws.
- **DC-005** — `@facet/kit` is deleted entirely; `git grep '@facet/kit'` = 0
  outside specs/history.
- **DC-006** — `@facet/react` no longer **OWNS** the default-theme data (single
  source of truth is `@facet/assets`), without value drift.

## Risk register

### RISK-INV-1 (INV) — INVARIANT #3 (fail-safe) + #6 (two-writers coherence)

The brief moves the theme per-field merge into `loadAssets` ("the default theme
merged per-field with the custom theme → one effective theme"), but that merge
**already exists at render time** and there is **no merge in `loadAssets` today**.

- Seam A (render-time merge): `packages/react/src/theme.ts:178` `resolveTheme`
  calls `overlayGroup` (`packages/react/src/theme.ts:153`) to overlay each custom
  field onto the DEFAULT floor.
- Seam B (load, no merge): `packages/runtime/src/assets.ts:72` `loadAssets` only
  collects themes into a flat list — grep for merge/base/default in `assets.ts`
  returns ZERO.
- Worse, the DEFAULT theme is **two divergent representations**: the copy-me
  DOCUMENT `DEFAULT_THEME` (`packages/react/src/theme.ts:135`) and the actual
  render FLOOR `DEFAULT_RESOLVED` (`packages/react/src/theme.ts:120`), whose
  space/fontSize/fontWeight/radius/ratio values live ONLY as literals in
  `packages/react/src/theme.ts:38,48,61,71,94` (colors live separately in core
  `DEFAULT_COLORS`, `packages/core/src/theme.ts:145`). Moving `DEFAULT_THEME`
  data to `@facet/assets` while `resolveTheme` keeps its own SPACE/FONT_SIZE
  floor creates TWO sources of default truth that can drift, and running both
  merges double-applies custom-over-default.

**Resolution the spec must implement:** pick ONE merge site and make
`@facet/assets` the single default-theme data source. Concretely — keep
`resolveTheme` as the ONLY merge (its `overlayGroup` floor imports the default
groups from `@facet/assets` instead of react-local literals; `loadAssets` seeds
the default DOCUMENT into the themes list but does NOT pre-merge), OR if
`loadAssets` produces the effective theme, delete `resolveTheme`'s floor and ship
the merged theme via `window.__FACET_THEMES__`. Either way: (a) the seeded
default document must pass `validateTheme` including the #5 dimension clamps at
`packages/core/src/theme.ts:132-134`; (b) zero-arg style output must stay
byte-identical (the kits-themes-as-data DoD); (c) with all custom themes dropped,
the default base layer must still resolve (DC-001) and `loadAssets` must never
throw (DC-004).

### RISK-INV-2 (INV) — INVARIANT #3 (fail-safe) + #4/#5 (declarative + flow-only)

Base-layer DEFAULT stamps must pass the SAME `validateStamp` / `validateTree`
gate as custom stamps, and the union's collision ordering INVERTS today's posture.

- Custom stamps are validated at load: `packages/runtime/src/assets.ts` stamp
  loop (~line 110) runs `validateStamp` (`packages/core/src/validate.ts:699`),
  which sanitizes the node map, prunes dangling children, and calls
  `breakCycles` — this is the flow-only + fail-safe gate.
- But the default library `KIT_STAMPS` (`packages/kit/src/stamps.ts:17`) is
  validated ONLY in kit's own test (`packages/kit/src/stamps.test.ts`), never at
  load. If the unified pipeline seeds the moved default stamps as trusted
  `@facet/assets` DATA and unions them WITHOUT re-running `validateStamp`, a
  malformed or overlay/absolute-positioned default node would bypass the
  declarative / flow-only gate.
- Second problem: today's loop is **duplicate-FIRST-WINS** via `seenStampNames`
  (`packages/runtime/src/assets.ts` ~line 127:
  `duplicate stamp name ... ignored (first wins)`), but the brief (DC-003)
  requires custom to SHADOW a same-named default — the opposite order.

**Resolution the spec must implement:** (a) route the base-layer default stamps
through the same `validateStamp` path at load (or assert they are frozen
pre-validated `FacetStamp`s and re-validate), dropping a bad default with a
recorded issue while custom + remaining defaults survive and never throwing;
(b) define load order as **defaults-first then custom**, and change the collision
rule so a custom name deterministically shadows the default rather than being
dropped as a first-wins duplicate — with a test pinning DC-003 shadowing AND
DC-004 (a bad doc among good ones survives).

### RISK-INV-3 (INV) — INVARIANT #1 (UI-out / browser-safe boundary) + dependency direction

The new `@facet/assets` package must be node-free and must not create a
core→assets or assets→renderer edge.

- Current graph (verified): `@facet/core` has NO dependencies
  (`packages/core/package.json` has no dependencies block) and must stay so — the
  brief forbids a new dep into core. `@facet/react` depends only on `@facet/core`
  (`packages/react/package.json`).
- The default assets are consumed on the BROWSER path:
  `packages/quickstart/src/page/main.tsx:96` calls `resolveTheme(themeName, themes)`
  and `packages/quickstart/src/server.ts:97` inlines `window.__FACET_THEMES__` —
  so any package feeding the default theme/stamp DATA into that path must not drag
  in `node:fs` (the same reason `FileAssets` is quarantined behind
  `@facet/runtime/node`).
- Meanwhile `loadAssets` (`packages/runtime/src/assets.ts:72`, in `@facet/runtime`)
  will import `@facet/assets` to seed the base layer, and react's `resolveTheme`
  floor (`packages/react/src/theme.ts:120,178`) will import the default groups
  from it.

**Resolution the spec must implement and prove:** dependency edges are strictly
`@facet/assets → @facet/core` only (data/types, zero `node:` imports);
`@facet/runtime → @facet/assets`, `@facet/react → @facet/assets`; and NEITHER
`@facet/core` NOR `@facet/assets` imports `@facet/react` (an assets→react edge
would re-couple the default theme to the web renderer and block the stated
`@facet/vue` multi-renderer goal, plus pull react into the runtime bundle).
Verify via `@facet/assets` package.json `dependencies` (core only), a
`grep -rE 'node:' packages/assets/src` = 0, and an import-graph check that
`@facet/assets` names no renderer.

### RISK-API-1 (API) — BREAKING removal of the published `@facet/kit` package

- Detected consumers (grep `@facet/kit`): manifest dep
  `apps/playground/package.json:23`; runtime imports
  `apps/playground/src/server.ts:13` and `apps/playground/src/ui.ts:2` both do
  `import { page, text } from "@facet/kit"`; path alias `tsconfig.base.json:26`
  (`"@facet/kit": ["packages/kit/src/index.ts"]`).
- Concrete usage: `page(...)` builds `OFFLINE_FACE` (server.ts:18) and the
  blank/live face (ui.ts:6); `text(...)` builds heading/subtitle nodes. The kit
  barrel also exports
  `heading/image/field/button/stack/row/card/hero/page/text/fragment/Block/Fragment`
  (`packages/kit/src/kit.ts`) — all become unavailable.

**Resolution the spec must implement:** inline a tiny local `page` / `text` brick
helper into `apps/playground` (or emit raw `box` / `text` bricks) with
byte-identical output for the two faces, delete the `@facet/kit` workspace dep
and the `tsconfig.base.json` path alias, and confirm `git grep '@facet/kit'` = 0
outside specs/history (DC-005). Only `apps/playground` (unpublished) consumes it,
so no published downstream migration is needed.

### RISK-API-2 (API) — BREAKING move of `DEFAULT_THEME` off the `@facet/react` barrel

- `packages/react/src/index.ts` does `export * from "./theme.js"`, re-exporting
  `DEFAULT_THEME` (defined `packages/react/src/theme.ts:135`). No OTHER package
  imports it today (grep `DEFAULT_THEME` hits only react's own tests), so no
  cross-package importer breaks — but it IS a removed public export of
  `@facet/react`.
- Coupling the spec must resolve: react's live path does NOT read `DEFAULT_THEME`;
  `resolveTheme` / `DEFAULT_RESOLVED` (`theme.ts:120,178`) and
  `boxStyle` / `textStyle` / … are built from the raw token maps
  `SPACE/COLOR/FONT_SIZE/RADIUS/RATIO/FONT_WEIGHT`. If the default-theme DATA
  moves to a node-free `@facet/assets`, either (a) react adds a `@facet/assets`
  dependency (`react/package.json:28` currently lists ONLY `@facet/core`) and
  derives its maps from the assets doc, or (b) `@facet/assets` and `@facet/react`
  each keep a copy — a drift hazard the `theme.test.ts` pins
  (`DEFAULT_THEME.space?.md === "16px"`, etc.) exist to catch.

**Resolution:** name the single source of truth for the six token maps, add the
`@facet/assets` dep to `@facet/react` (or re-export `DEFAULT_THEME` from assets
through react for back-compat), and keep a cross-package equality test so DC-006
(react no longer OWNS the data) holds without value drift.

### RISK-API-3 (API) — Relocating `KIT_STAMPS` is not a pure move (DERIVED code)

- `packages/kit/src/stamps.ts:17` builds `KIT_STAMPS: readonly FacetStamp[]` by
  running the kit code factory (`fragment(block, prefix)` over the
  `hero` / `card` / `cta-button` preset builders — see `kit.ts` `fragment` at
  `:211` and presets `:147/:161`). The feature DELETES that factory (RISK-API-1).
- `KIT_STAMPS` has ZERO import consumers anywhere (grep shows only kit's own
  `stamps.test.ts`).

**Resolution the spec must implement:** re-express the default stamps as
validated literal `FacetStamp` trees inside browser-safe `@facet/assets` (no
`fragment()` / `page()` / `Builder` dependency), each still passing
`validateStamp` with zero error issues and carrying unique names (DC-003), and
port the kit stamp tests to `@facet/assets` so the tree shapes stay pinned after
the factory is gone.

### RISK-API-4 (API) — Behavioral break in `loadAssets` / `LoadedAssets` semantics its ONLY external consumer will silently miss

- Today `loadAssets` (`packages/runtime/src/assets.ts:72`) returns only validated
  CUSTOM docs; `LoadedAssets.themes` / `.stamps` are EMPTY with no operator input.
- The sole external caller, `packages/quickstart/src/cli.ts:169`, runs
  `loadAssets` ONLY inside `if (flags.assets !== undefined)` (`cli.ts:154`) —
  with no `--assets`, `themes` / `stamps` stay `[]` (`cli.ts:151-152`) and
  defaults reach the UI purely via react's `DEFAULT_RESOLVED` fallback.
- If the feature makes defaults a base layer INSIDE `loadAssets`, that seeding is
  bypassed whenever `--assets` is absent, so the default STAMP library never
  reaches `createQuickstartAgent` (`agent.ts:257-258`, prompt ②) and no default
  THEME name reaches the server shell.

**Resolution the spec must implement:** seed the default base layer
unconditionally (`loadAssets` returns defaults even for an empty/absent
AssetsStore) AND make quickstart call `loadAssets` on EVERY boot — e.g.
`loadAssets(new MemoryAssets({themes:[],stamps:[]}), id)` when no `--assets` — so
`themes` / `stamps` always carry the defaults; add a cli test for the
no-`--assets` path asserting non-empty resolved stamps.

### RISK-API-5 (API) — Existing duplicate-name policy CONTRADICTS the brief's collision rule once defaults are seeded

- Brief DC-002/DC-003 require custom to WIN: theme custom fields override the
  default per-field, and a custom stamp sharing a default's name SHADOWS it.
- But `loadAssets` is FIRST-WINS and drops the later entry: themes
  `packages/runtime/src/assets.ts:99-103`
  (`if (seenThemeNames.has) … ignored (first wins)`) and stamps `:125-132`
  (same). If the base layer is concatenated FIRST into
  `docs.themes` / `docs.stamps` and run through these loops, a colliding CUSTOM
  asset is the SECOND entry and gets dropped — i.e. DEFAULT wins, the exact
  opposite of the spec.
- Also themes are treated as name-keyed rows (shadow), whereas the brief wants
  per-FIELD merge (custom `color.bg` over default, other fields kept) — the
  current loop has no field-merge at all.

**Resolution the spec must implement:** for the base-layer path, either seed
defaults LAST/custom-first, or replace the theme loop with an explicit per-field
overlay (reuse the react `overlayGroup` merge, `theme.ts:161`) and the stamp loop
with a custom-shadows-default union; update the `first wins` issue text/tests
accordingly so DC-002/DC-003 pass.

### RISK-PKG-1 (PKG) — MODULE MOVE + NEW CROSS-PACKAGE IMPORT (react → assets)

- The default-theme DATA is not just `DEFAULT_THEME` — it is the concrete
  web-flavored value maps `SPACE`, `FONT_SIZE`, `FONT_WEIGHT`, `RADIUS`, `RATIO`
  defined ONLY in `packages/react/src/theme.ts:38,48,61,71,94`. They back BOTH
  `DEFAULT_THEME` (`packages/react/src/theme.ts:135`) AND the overlay base of the
  application-side `resolveTheme` (`packages/react/src/theme.ts:178`,
  `overlayGroup` base args at `:185-189`).
- DC-006 requires react to stop owning this data, so these maps must move to
  `@facet/assets`, and react's `resolveTheme` / `DEFAULT_RESOLVED` must then
  IMPORT them back from `@facet/assets` — a new `@facet/react → @facet/assets`
  edge that does not exist today (react deps = {`@facet/core`} only).

**Spec must** (a) relocate the five value maps + assembled `DEFAULT_THEME` into
`@facet/assets`, (b) add `@facet/assets: workspace:*` to react's package.json
dependencies, and (c) keep `resolveTheme` importing its overlay base from
`@facet/assets`, NOT re-duplicating the values in react. Note `COLOR`
(`packages/react/src/theme.ts:89`) is derived from core's `DEFAULT_COLORS`
(`packages/core/src/theme.ts:144`), so only the non-color maps are genuinely
react-owned data to move.

### RISK-PKG-2 (PKG) — NEW CROSS-PACKAGE IMPORT (runtime → assets); cycle-safe only if assets depends on core alone

- The brief requires `loadAssets` to seed the bundled default theme + default
  stamps as a base layer, but `loadAssets` (`packages/runtime/src/assets.ts:74`)
  currently imports ONLY `@facet/core` and seeds nothing.
- Base-layer seeding forces a new `@facet/runtime → @facet/assets` import
  (runtime deps today = {`@facet/core`} only). This is acyclic ONLY IF
  `@facet/assets` depends exclusively on `@facet/core`.

**Spec MUST** declare `@facet/assets` package.json dependencies =
`{"@facet/core": "workspace:*"}` and forbid any back-import from assets into
`@facet/runtime` or `@facet/react`; otherwise runtime↔assets or react↔assets
cycles are introduced. Resolution: pin the dependency direction
`runtime → assets → core` and `react → assets → core` (both DAGs), and add
`@facet/assets: workspace:*` to runtime's deps.

### RISK-PKG-3 (PKG) — MODULE DELETION with a live producer dependency

- The default stamps are CONSTRUCTED by the kit code factory being deleted.
  `KIT_STAMPS` (`packages/kit/src/stamps.ts:17`) is built by importing
  `fragment, hero, card, heading, button, text` from the kit builders
  (`packages/kit/src/stamps.ts:2` `import { ... } from "./kit.js"`).
- DC-005 deletes `@facet/kit` entirely, so the default stamp DATA cannot be
  produced by importing kit any longer. `fragment()` and the builders have NO
  consumer outside kit (grep `fragment(` across `packages/` and `apps/` minus kit
  = 0 hits), so they can be dropped — but the RESULTING stamp trees must be
  captured as standalone data in `@facet/assets`.

**Spec must** either (a) inline each default stamp as a literal
`{name, description, root, nodes}` `FacetStamp` object in `@facet/assets`, or
(b) relocate the minimal node-free builder helpers into `@facet/assets` to
regenerate them. Deleting kit without relocating this producer would lose the
default stamp library. `@facet/assets` must stay node-free (data + core types
only) so a browser renderer bundle can consume it.

### RISK-PKG-4 (PKG) — CORE NODE-FREE + NO-BACK-EDGE guard on the optional theme-merge helper

- The brief floats adding "a small theme-merge helper" to `@facet/core` (whose
  package.json has ZERO dependencies today — the dependency-free invariant #1).
  The merge primitive is the existing `overlayGroup` in
  `packages/react/src/theme.ts:145`.
- If it moves to core, it MUST stay base-PARAMETERIZED (caller supplies the base
  group) and MUST NOT import the default value maps — those default maps live in
  `@facet/assets` (RISK-PKG-1), so any `@facet/core → @facet/assets` import to
  fetch defaults would create a `core → assets → core` cycle AND violate core's
  dependency-free / node-free invariant.

**Resolution the spec must state:** keep core's merge helper pure and
defaults-agnostic (no import of `DEFAULT_THEME` or the value maps); the base layer
is injected by `@facet/runtime`'s `loadAssets` (which owns the assets→runtime
seam) or by react's `resolveTheme`, never fetched from inside core. Also: new
package `@facet/assets` needs its own barrel `index.ts` exporting `DEFAULT_THEME`
+ default stamps, and removing `DEFAULT_THEME` from react's
`export * from "./theme.js"` (`packages/react/src/index.ts:3`) is a barrel-surface
change — confirmed no external importer (only react + dist reference it;
quickstart uses `resolveTheme`, not `DEFAULT_THEME`), so the spec may optionally
re-export it from react for back-compat but must not leave a dangling barrel
export.
