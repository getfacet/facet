# Context: `landing-grade-vocab`

Evidence gathered by the context pass, for the spec writer. Do not add facts beyond what is captured here.

## Affected packages

- `@facet/core`
- `@facet/react`
- `@facet/assets`

## Code entrypoints

| File:line | What lives here |
| --- | --- |
| `packages/core/core/src/tokens.ts:16-97` | Token enumerations (`FONT_SIZES`, `SIZINGS`, and the other closed token arrays / union types). |
| `packages/core/core/src/nodes.ts:86-159` | Node types incl. `BoxNode` (target of the new `backdrop?: NodeId` field, `BoxNode` at nodes.ts:141). |
| `packages/core/core/src/primitive-node-validation.ts:180-251` | Primitive node/style token membership validation (`asToken(value, FONT_SIZES)` for theme size at :241, width/`SIZINGS` at :258/:268); `isSafeMediaSrc` at :169. |
| `packages/core/core/src/spec.ts:47-51` | `STAGE_SPEC` LLM-facing constant; inline `size(xs\|sm\|md\|lg\|xl\|2xl\|3xl)` + BoxStyle/TextStyle token names at spec.ts:49. |
| `packages/core/core/src/theme-types.ts:28-89` | `FacetTheme`, `RecipeBoxStyle` (:38-56), `RecipeTextStyle` (:58-64) type surface. |
| `packages/core/core/src/theme-validation.ts:30-154` | Operator theme-doc validation: `KNOWN_KEYS` (:30-42), typed input interface (:65-72), per-group `validateGroup(...)` blocks (:95-144). |
| `packages/core/core/src/theme-token-validation.ts:64-173` | Theme token-value validation helpers. |
| `packages/core/react/src/theme.ts:62-72,207-363` | `ResolvedTheme` interface (:62-70), `DEFAULT_RESOLVED` (:187), `resolveTheme` `overlayGroup(...)` wiring (:244-253); `boxStyle` at :311-345. |
| `packages/core/react/src/renderer-render.tsx:284-344` | Render path; child recursion resolves ids via `tree.nodes[id]` (:234); render budget decrements `budget.refsLeft`/`budget.left` (:119, :245). |
| `packages/core/react/src/layout-contract.ts:7-15` | `rootContainmentStyle` — flow-only containment, emits no `position`. |
| `packages/core/assets/src/theme-tokens.ts:14-77` | Default token value maps; `FONT_SIZE: Record<FontSize,string>` with `satisfies Record<FontSize,string>` (:27-37). |
| `packages/core/assets/src/theme.ts:418-429` | Default theme assembly. |

Additional seam references cited by the risk register:
- `packages/core/react/src/renderer-media.tsx:24` (the only media sink; inert mode at :37/:47-49).
- `packages/core/core/src/tree-validation.ts:144-172` (`pruneDanglingChildren`), `:192-254` / `:222-229` (`breakCycles`).
- `packages/core/react/src/motion.test.ts:46` (asserts `MOTION_CSS` never contains `position: absolute`).
- `packages/core/core/src/theme-recipe-validation.ts` (recipe style validation; size check at :151, width at :109).
- `packages/core/react/src/theme.ts:65` / `:187` (`ResolvedTheme.fontSize`, `DEFAULT_RESOLVED`); `:247` `overlayGroup(FONT_SIZE, doc.fontSize, FONT_SIZES,...)`.

## Risk register

### RISK-INV-1 (INV) — Invariant #5: flow-only, no absolute positioning

**Seam.** `packages/core/react/src/theme.ts:311-345` (`boxStyle`) and `packages/core/react/src/layout-contract.ts:7-15` (`rootContainmentStyle`) currently emit NO `position` anywhere. Grepping `theme.ts` / `layout-contract.ts` / `brick-renderer-shared.ts` yields zero `position`/`zIndex` hits, so flow-only is *structurally* guaranteed today; `packages/core/react/src/motion.test.ts:46` even asserts `MOTION_CSS` never contains `position: absolute`.

**Pressure.** The brief's `backdrop` two-layer requirement (brief lines 40-42, 84-87) forces the FIRST introduction of `position:relative` (host box) + `position:absolute` (bg media layer) into the renderer, plus `sticky` -> `position:sticky`.

**Resolution the spec must implement.** Confine `position:absolute` to the renderer-SYNTHESIZED backdrop layer element ONLY — never emitted onto any authored flow child; host box gets `position:relative`, children stay in normal flow, no author-settable z-index/offset (`sticky` top offset is a renderer-owned framework constant, token is boolean/enum). Add the DC-004 layout-contract structural test (mirroring motion.test.ts:46) asserting exactly two layers and that no flow child ever receives `position:absolute`.

### RISK-INV-2 (INV) — Invariant #1: UI-out / no new fetch sink + safe-src gate

**Seam.** `packages/core/react/src/renderer-media.tsx:24` is the ONLY media sink today and gates every `src` through `isSafeMediaSrc` (`packages/core/core/src/primitive-node-validation.ts:169`). Grepping `packages/core/react/src` for `background-image`/`backgroundImage`/`url(` yields ZERO hits — so a CSS-url sink does not exist yet.

**Pressure.** If the backdrop is painted via CSS `background-image:url(src)`, it BYPASSES `isSafeMediaSrc`: a `javascript:`/`data:text/html` src reaches the DOM ungated, and even a safe https src can break out of `url()` via an unescaped `)`/quote.

**Resolution.** Paint the backdrop by REUSING `renderMediaNode` (inert mode already exists, `renderer-media.tsx:37/47-49`) as a real absolutely-positioned `<img>`/`<video>`, so the existing `isSafeMediaSrc` gate still applies. If a CSS background is used instead, the spec MUST route src through `isSafeMediaSrc` AND CSS-escape before composing `url()`. Cover DC-003/Example-3 (backdrop names a non-media or unsafe-src node -> no layer painted, no throw).

### RISK-INV-3 (INV) — Invariant #6: two-writers coherence + #2 fail-safe bounds; new cross-node reference escapes tree-collapse and render budget

**Seam.** The renderer resolves node ids ONLY via `tree.nodes[id]` through child recursion (`packages/core/react/src/renderer-render.tsx:234`), and `validateTree`'s `breakCycles` (`packages/core/core/src/tree-validation.ts:192-254`) collapses the graph to a true tree by walking `node.children` ONLY, applying per-root single-parent `claimed`, cycle, `MAX_DEPTH` and `maxReachable` node-count guards.

**Pressure.** A `backdrop: NodeId` (brief line 157) is a NEW reference edge that (a) `breakCycles` never follows — so a backdrop pointing at a container, or a `backdrop->box->backdrop` cycle, is not cycle/shared-collapsed, and (b) is NOT counted by the renderer's `budget.refsLeft`/`budget.left` decrements (renderer-render.tsx:119, :245), so it can escape `MAX_RENDER_NODES`.

**Resolution.** Constrain backdrop resolution to a MEDIA node only (resolved `node.type` must be `image`/`video` else no layer — media has no children, structurally preventing recursion); resolve strictly read-only (renderer writes no stage state; server stays sole writer); and decrement the render budget for the resolved backdrop node. Add a fail-safe test: backdrop pointing at a box / a self-cycle renders no layer and never recurses (DC-003).

### RISK-INV-4 (INV) — Invariant #6: two-writers coherence; node-consumption / double-render is UNPINNED (brief open item, Decision Lock line 171)

**Seam.** `pruneDanglingChildren` (`packages/core/core/src/tree-validation.ts:144-172`) prunes only dangling CHILD refs and dedupes siblings — it does NOT prune standalone/orphan nodes, so a media node used as `backdrop` survives in `nodes` whether or not it is a flow child. `breakCycles` (tree-validation.ts:222-229) claims a node as a flow child when it appears in some box's `children`.

**Pressure.** If the agent puts the media id in BOTH `children` and `backdrop`, the two writers (agent-authored tree + renderer resolution) disagree — it renders once in flow AND once as the backdrop layer (painted twice); if it is standalone it renders once as backdrop only.

**Resolution.** The spec must pin deterministically: define backdrop as referencing a standalone media node NOT required to be a child, and specify one behavior when the same id is also a flow child (render both vs renderer de-dupe by id). Add a DC-004/DC-006 test proving the chosen node-consumption semantics so live server-writes and client render stay coherent.

### RISK-API-1 (API) — CHANGED PUBLISHED SURFACE: `FONT_SIZES` extension

**Change.** The only extended existing token group: `FONT_SIZES` gains `4xl`/`5xl`/`6xl` in `packages/core/core/src/tokens.ts:20` (exported union `FontSize`).

**Impact.** Union widening is additive for agents/consumers that pass old values, BUT it breaks every EXHAUSTIVE (non-`Partial`) `Record<FontSize,_>` at compile time. In-repo exhaustive maps that MUST gain the 3 new keys or `pnpm typecheck` fails:
- (a) `packages/core/assets/src/theme-tokens.ts:27-37` — `FONT_SIZE: Record<FontSize,string>` with `satisfies Record<FontSize,string>`.
- (b) `packages/core/react/src/theme.ts:65` — `ResolvedTheme.fontSize: Record<FontSize,string>` (published type, re-exported from `@facet/react`) and its full literal `DEFAULT_RESOLVED` at theme.ts:187.

React `resolveTheme` (theme.ts:247, `overlayGroup(FONT_SIZE, doc.fontSize, FONT_SIZES,...)`) auto-covers at runtime once assets `FONT_SIZE` has the keys, so no code change there beyond the record itself.

**Consumer sweep.** NO external package hand-builds a full `FontSize` record (grep for `Record<FontSize`/`Record<Sizing` outside core/react/assets = zero hits; `packages/assets`, `packages/react`, `packages/core/dist` are STALE build artifacts with only dist/node_modules, no src — not consumers, regenerated on build).

**Resolution.** In the SAME change, add `4xl`/`5xl`/`6xl` entries to theme-tokens.ts `FONT_SIZE` and to react `DEFAULT_RESOLVED`; classify as additive-with-required-internal-record-updates. Flag `ResolvedTheme` (exported `@facet/react` type) as technically breaking for any out-of-repo consumer that constructs a `ResolvedTheme` literal (none in-repo).

### RISK-API-2 (API) — NEW OVERRIDABLE THEME GROUPS silently dropped if not wired

**Change.** The brief adds new theme-overridable token groups (heights, container maxWidth, gradient, scrim, scheme, highlight, tracking, leading) as additive optional fields on `FacetTheme` (`packages/core/core/src/theme-types.ts:29-42`).

**Impact.** `theme-validation.ts` gates operator theme docs against a hardcoded allowlist: `KNOWN_KEYS` at `packages/core/core/src/theme-validation.ts:30-42` + the typed input interface at theme-validation.ts:65-72 + a per-group `validateGroup(...)` block per group (theme-validation.ts:95-144). A new group NOT added to all three is treated as an unknown key -> override rejected/dropped with an issue and never themed. Mirror wiring is also required in react: `ResolvedTheme` interface (theme.ts:62-70), `DEFAULT_RESOLVED` (theme.ts:187), and a new `overlayGroup(...)` line in `resolveTheme` (theme.ts:244-253). Failure mode is SILENT (fail-safe drops the group) -> DC-005 (theme override) would pass compile but produce an unthemed default.

**Resolution.** The spec must enumerate, for each new theme group, the 3 core theme-validation edits + 3 react resolveTheme edits, and add a `theme.test.ts` case asserting each new group actually overrides.

### RISK-API-3 (API) — RECIPE STYLE TYPES duplicate BoxStyle/TextStyle and will silently lack the new fields

**Seam.** `RecipeBoxStyle` (`packages/core/core/src/theme-types.ts:38-56`) and `RecipeTextStyle` (theme-types.ts:58-64) are hand-mirrored copies of BoxStyle/TextStyle used by component variant recipes, validated in `packages/core/core/src/theme-recipe-validation.ts` (size check at :151, width at :109).

**Impact.** The new BoxStyle fields (`minHeight`/`maxWidth`/`sticky`/`gradient`/`backdropScrim`/`scheme`) and TextStyle fields (`tracking`/`leading`/`highlight`) are additive to the node styles but will NOT be settable via component recipes unless also added to `RecipeBoxStyle`/`RecipeTextStyle` and validated in theme-recipe-validation.ts.

**Resolution.** Not a consumer break (additive), but a capability gap the spec must decide on explicitly: either mirror the new fields into the Recipe* types + recipe validation, or document that landing-grade tokens are node-style-only (not recipe-overridable) for v1.

### RISK-API-4 (API) — STAGE_SPEC hardcodes the token enumerations the agent may emit

**Seam.** `STAGE_SPEC` (the LLM-facing published constant, exported from `@facet/core`) hardcodes token enumerations: `packages/core/core/src/spec.ts:49` lists `size(xs|sm|md|lg|xl|2xl|3xl)` and the BoxStyle/TextStyle token names inline.

**Impact.** New FontSizes (`4xl`/`5xl`/`6xl`), the new BoxStyle/TextStyle tokens, and `backdrop` must be added here or the agent brain is never taught them (DC-007). `spec.test.ts` asserts STAGE_SPEC content, so the test must be updated in lockstep.

**Resolution.** Additive teaching edit, but a required change the spec must call out with its covering test assertion.

### RISK-API-5 (API) — ENFORCEMENT SITE for the closed-vocab invariant

**Seam.** `packages/core/core/src/primitive-node-validation.ts` is where BoxStyle/TextStyle tokens are membership-checked via `asToken(value, FONT_SIZES)` (theme size at :241, width/`SIZINGS` at :258/:268). Because it validates by array membership, the FONT_SIZES extension needs NO change here (auto-valid) — good.

**Impact.** Every NEW BoxStyle/TextStyle field (`minHeight`/`maxWidth`/`sticky`/`gradient`/`backdropScrim`/`scheme`/`tracking`/`leading`/`highlight`) needs a new `asToken(...)` call against its new token array, or the field passes through UNVALIDATED (violating invariant #4 closed-vocab and DC-002). The new `BoxNode.backdrop?: NodeId` (nodes.ts:141 `BoxNode`) is NOT a token — it is a node-id reference and needs a DISTINCT validation path (id shape/existence is fail-safe at render time per DC-003; the renderer must reuse the existing `isSafeMediaSrc` gate and resolve non-media/dangling refs to no-backdrop). `SIZINGS` itself is unchanged (heights are a NEW group, not an extension of `Sizing`), so `MediaStyle.width`/`FieldStyle.width`/`BoxStyle.width` consumers are unaffected.

**Resolution.** The spec must list one `asToken` wiring per new style token in primitive-node-validation.ts plus theme-recipe-validation.ts, and specify the backdrop reference-resolution/fail-safe path separately from token membership.
