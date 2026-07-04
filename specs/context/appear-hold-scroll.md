# Context Evidence: appear-hold-scroll

> Stage 0 of /spec-bridge. Evidence assembled from the context pass (direct
> reads + grep on the current tree, 2026-07-04). Line numbers may drift a few
> lines; symbol names are stable. Brief:
> `specs/feature-intake/appear-hold-scroll.md`.

## Affected packages

- `@facet/core`
- `@facet/react`
- `@facet/kit`
- `@facet/quickstart`

## Code entrypoints

### @facet/core

- `packages/core/src/tokens.ts:16` — closed const-array token group pattern
  (`export const SPACES = [...] as const; export type Space = (typeof SPACES)[number]`);
  a new APPEAR group (fade/slide) and the scroll token follow this exact shape.
- `packages/core/src/nodes.ts:78` —
  `export type FacetAction = AgentAction | NavigateAction | ToggleAction` —
  onHold reuses this union unchanged.
- `packages/core/src/nodes.ts:80` — `interface BoxStyle` — where the scroll
  (and appear, per brief assumption box-style-only) tokens land.
- `packages/core/src/nodes.ts:122` — `readonly onPress?: FacetAction` on
  BoxNode — `onHold?: FacetAction` mirrors this optional-field pattern.
- `packages/core/src/validate.ts:121-179` — `asAction` normalizes onPress
  (legacy bare `{name}` = agent kind, unknown kind dropped with issue at
  `:179`); onHold must route through the same function (DC-005).
- `packages/core/src/validate.ts:195-217` —
  `boxStyle(value: unknown): BoxStyle` sanitizer keeps only known token
  values; unknown appear/scroll stripped here.
- `packages/core/src/validate.ts:274-275` —
  `const onPress = asAction(raw.onPress, id, issues); if (onPress !== undefined) node.onPress = onPress;`
  — exactOptionalPropertyTypes-safe conditional assignment pattern onHold
  must copy.
- `packages/core/src/spec.ts:8-29` — STAGE_SPEC single-source vocabulary (box
  line at `:11` documents onPress/hidden; examples at `:26-29`) —
  appear/onHold/scroll must be taught here (DC-009), covered by
  `spec.test.ts`.

### @facet/react

- `packages/react/src/StageRenderer.tsx:98-102` — `ClassifiedPress` union
  (agent carries `collect?`) — a hold classification reuses this shape.
- `packages/react/src/StageRenderer.tsx:206-226` —
  `classifyPress(onPress: unknown)` re-classifies the untrusted raw-patch
  path (returns null = render plain); onHold gets the same treatment.
- `packages/react/src/StageRenderer.tsx:281-330` — view-state ownership:
  `visibilityOverrides` React state + `handlePress` at `:315` switching
  navigate/toggle locally (two-writers split, DC-006).
- `packages/react/src/StageRenderer.tsx:487-502` — pressable box render:
  `classifyPress(node.onPress)` at `:489`, `onClick={() => onPress(press)}`
  at `:496` — pointer-down/timer long-press handling (threshold/slop as
  renderer constants per Decision Lock) is added here.
- `packages/react/src/theme.ts:135` — `DEFAULT_THEME`; `:220`
  `boxStyle(style, theme)` token→CSS mapping — appear animation CSS
  (duration/curve, prefers-reduced-motion gate) and scroll max-height live
  only here; FacetTheme documents do NOT accept animation CSS (locked).
- `packages/react/src/StageRenderer.interaction.test.tsx` — existing jsdom
  interaction-test pattern for DC-002/004 fake-timer press/hold tests.

### @facet/kit

- `packages/kit/src/kit.ts:109` (stack) / `:169` (page) — optional preset
  adoption of the scroll token (not required for DoD).

### @facet/quickstart

- `packages/quickstart/src/prompt.ts:13,119` — imports and embeds STAGE_SPEC
  from `@facet/core`; vocabulary pickup is pass-through, but any
  `packages/quickstart/` diff makes /live-test Tier 2 blocking.

## Risk register

### RISK-INV-1 (INV — #6 two-writers): single-seam press pipeline + post-hold click

The entire press pipeline is single-seam: `classifyPress` at
`packages/react/src/StageRenderer.tsx:210` classifies untrusted onPress, and
`handlePress` at `StageRenderer.tsx:315` is the ONLY switch where
navigate/toggle write browser view-state (`currentScreen` `:286`,
`visibilityOverrides` `:292`) and agent-kind reaches `onAction` (`:342-354`,
the only transport channel). Risk: a bespoke second handler for onHold would
create a parallel writer path that drifts from this validation/split. Also
the pressable box binds bare `onClick` (`StageRenderer.tsx:496`); browsers
fire a synthetic click AFTER pointerup, so a completed long-press will ALSO
fire onPress unless suppressed — press+hold both firing violates DC-004 and
double-writes view-state.

**Resolution the spec must implement:** onHold reuses classifyPress +
handlePress verbatim (one classifier, one switch); gesture detection via
pointerdown/pointerup/pointercancel + timer with explicit post-hold click
suppression (and pointer-move slop cancel), pinned by a jsdom fake-timer test
asserting tap→onPress only, hold→onHold only, never both.

### RISK-INV-2 (INV — #6 two-writers): scroll offset destroyed by remount

Scroll offset is browser view-state carried by DOM element identity, but
renderNode's box divs are reconciled positionally — only children get id-keys
(`Fragment key={childId}`, `packages/react/src/StageRenderer.tsx:474`); the
container div itself (`:502`) has no key, and a toggled-hidden or off-screen
node returns null (`:446-449`) causing a FULL unmount. Consequence: an
unrelated content patch or a toggle re-show can remount the scroll container,
silently resetting scrollTop — a server content-write destroying browser
view-state, i.e. a two-writers coherence break in effect even though no new
writer exists. Same seam decides appear-replay semantics (remount = animation
replays), the brief's open question.

**Resolution the spec must implement:** DC-006 must include a jsdom test that
applies a patch to a sibling/child of a scroll-region box and asserts the
scroll container's DOM element identity (or scrollTop) survives; and pin
appear semantics as replay-on-mount (which includes toggle re-show and screen
navigation, since the renderer unmounts hidden nodes) so tests aren't
ambiguous.

### RISK-INV-3 (INV — #3 fail-safe): two validation layers, raw path bypasses validateTree

The brief says unknown tokens/malformed onHold are "stripped by
validateTree", but Facet has TWO validation layers and the live patch path
bypasses validateTree entirely (comment at
`packages/react/src/StageRenderer.tsx:35-37`; `classifyPress` `:210` and
`styleOf` `:38` exist precisely for this). Each new word therefore needs BOTH
seams:

- (a) **stored path** — `asAction` in `packages/core/src/validate.ts:127`
  must cover onHold with identical normalization incl. legacy `{name}`=agent
  and collect/payload handling (`:141-156`), and the closed-token strip in
  `validate.ts:195-217` (`asToken` `:116`) must add appear/scroll to
  boxStyle;
- (b) **raw live path** — the renderer must classify onHold through
  classifyPress, and theme.ts `boxStyle`
  (`packages/react/src/theme.ts:220-240`) must map appear/scroll as TOTAL
  functions where junk values degrade to no CSS (the existing
  `theme.space[style.gap]`→undefined pattern).

**Resolution:** spec Work Units must list both layers explicitly, and DC-005
tests must exercise the raw path (StageRenderer fed an unvalidated tree with
`appear:'explode'`, `onHold:42`, `scroll:'sideways'`), not only validateTree
unit tests.

### RISK-INV-4 (INV — #4 declarative-tokens): no stylesheet surface for @keyframes

`appear` requires @keyframes plus a `prefers-reduced-motion` media query
(DC-008), but `@facet/react` has ZERO stylesheet surface — grep proves no
`<style>`/keyframes/prefers-reduced anywhere in `packages/react/src`; all
styling is inline CSSProperties (`packages/react/src/theme.ts:220-240`),
which cannot express either. The two easy escapes each break a locked rule:
putting durations/easings in the tree violates invariant #4, and letting
FacetTheme documents carry animation CSS violates the Decision Lock and would
reopen the injection surface that validateTheme's character rejection
(`packages/core/src/theme.ts:188`, rejects ``;{}<>` ``) currently closes.

**Resolution the spec must implement:** all animation CSS lives in a
framework-owned STATIC constant — either a `<style>` element StageRenderer
renders once (constant string, no theme-document or tree data interpolated)
or the Web Animations API gated by
`matchMedia('(prefers-reduced-motion: reduce)')`; the appear token maps only
to a class/animation NAME in that constant, and validateTheme stays closed to
animation CSS.

### RISK-INV-5 (INV — #1 backend/UI-out + "no new protocol messages"): no gesture side-channel

Server boundary `isEventBody` (`packages/server/src/server.ts:150-174`)
accepts only kind:'agent' actions with name/payload/collect/fields — but it
does NOT reject unknown EXTRA properties, so a spec that stamps a gesture
discriminator (e.g. `gesture:'hold'`) onto the action/event would (a) violate
the brief's zero-protocol-change constraint and (b) ride through validation
to the agent as an unvalidated side-channel. Likewise "no scroll telemetry"
is only structurally guaranteed if no scroll handler ever calls `onAction`
(`StageRenderer.tsx:342-354` is the sole transport call site today).

**Resolution the spec must implement:** hold-triggered agent actions emit a
ClientEvent byte-identical in SHAPE to press events (no gesture field — the
agent differentiates by the action `name` it authored); server.ts validation
stays unchanged as the proof of zero protocol delta; DC-002/DC-006 tests
assert hold-toggle/navigate and scroll interaction produce zero transport
`send` calls.

### RISK-INV-6 (INV — #5 flow-only): brief marks OK; code check confirms with two conditions

The scroll token lands in boxStyle (`packages/react/src/theme.ts:220-240`),
which today never sets overflow/height. Conditions for the OK to hold:

- (a) the mapping must be overflow-y + theme-owned max-height ONLY — never
  overflow-x — and must account for flex context (a flex child defaults to
  `min-height:auto`, so inside a `grow` column the region needs `minHeight:0`
  or it will not clip, silently failing DC-003's "bounded" claim while a
  naive jsdom style assertion still passes; hence DC-009's real-browser check
  is load-bearing, not optional);
- (b) the slide `appear` uses a transient transform, which never changes
  layout position but CAN paint over siblings mid-animation — the theme's
  static CSS must keep translate offsets small (sub-gap scale) and prefer
  opacity so nothing perceptually reads as an overlay, since overlay is
  explicitly descoped.

**Resolution:** spec pins the exact scroll CSS (`overflowY:'auto'`, theme
max-height token, `minHeight:0`) at the `theme.ts:220` seam and constrains
slide keyframes in the framework-owned animation constant.

### RISK-API-1 (API): STAGE_SPEC change dodges the path-based Tier 2 gate

PATTERN: STAGE_SPEC is a published `@facet/core` export whose change
materially alters `@facet/quickstart`'s LLM prompt WITHOUT touching any
`packages/quickstart/` path — but the /live-test Tier 2 trigger is
path-based: `.claude/skills/live-test/SKILL.md:39` defines
quickstart-touched ⇔ "any candidate path starts with `packages/quickstart/`".
quickstart imports the const verbatim (`packages/quickstart/src/prompt.ts:13`
and `:119`; `packages/quickstart/src/prompt.test.ts:24` asserts verbatim
inclusion, so it auto-passes and gives no signal). The brief
(`specs/feature-intake/appear-hold-scroll.md:174`) marks quickstart
"Pass-through" and assumes "Tier 2 blocks if packages/quickstart/ changes" —
for a core-only spec.ts edit that gate would legitimately report SKIPPED
while quickstart behavior changed. Also `packages/core/src/spec.test.ts:7-15`
asserts STAGE_SPEC content and must gain assertions for appear/onHold/scroll
(DC-009).

CLASSIFICATION: additive export change, but with a gate hole.

**Resolution:** the dev spec must (a) extend spec.test.ts content assertions
for the three new words, and (b) explicitly mandate Tier 2 as BLOCKING for
this bundle regardless of the path heuristic (or include a quickstart-side
change, e.g. a prompt/e2e assertion touching `packages/quickstart/`, so the
heuristic fires).

### RISK-API-2 (API): boxStyle's published signature cannot carry appear

PATTERN: the published `@facet/react` barrel exports
`boxStyle(style?: BoxStyle, theme?: ResolvedTheme): CSSProperties`
(`packages/react/src/theme.ts:220`, re-exported via
`packages/react/src/index.ts:3`) as THE complete BoxStyle→CSS mapping — but
`appear` needs @keyframes and DC-008 needs an
`@media (prefers-reduced-motion)` gate, neither expressible as inline
CSSProperties; grep shows `packages/react/src` has NO stylesheet-injection
mechanism today (no `<style>`, no keyframes anywhere). Changing boxStyle's
return shape would be BREAKING for direct consumers of the export; putting
the appear binding elsewhere is ADDITIVE but silently makes the exported
boxStyle an incomplete mapping (a consumer calling boxStyle directly gets no
animation), and `scroll` (plain overflow/max-height) CAN stay inline in
boxStyle — splitting one BoxStyle across two mechanisms.

**Resolution:** spec must pin the mechanism — keep boxStyle's CSSProperties
signature unchanged (scroll handled inline there), bind `appear` via a
renderer-owned CSS class + a once-injected `<style>` element (keyframes +
reduced-motion media query) applied in StageRenderer, and document that
appear is renderer-bound, not boxStyle-bound; add the injection point as an
internal (non-exported) module so no new public surface is created.

### RISK-API-3 (API): asAction hardcodes "onPress" in diagnostics; boxStyle whitelist strips silently

PATTERN: `validateTree`'s action normalizer hardcodes the field name
'onPress' in every issue string (`packages/core/src/validate.ts:131` "onPress
is not an action object", `:154` "onPress collect is not a string", `:179`
"unknown onPress kind ... dropped") and is called from exactly one site
(`validate.ts:274` for `raw.onPress`); reusing it verbatim for `onHold` emits
misleading 'onPress' diagnostics for a malformed onHold. Separately, the
box-style whitelist builder (`validate.ts:195-218` `boxStyle()`) copies only
listed keys, so `appear`/`scroll` are silently stripped until added —
validateTree is also re-run client-side on every fold
(`packages/react/src/useFacet.ts:54` via foldPatchIntoStage,
`packages/core/src/stage-fold.ts:60/74/124`) and shared by `validateStamp`
(`validate.ts:416` comment: shared node builder), so one addition covers
tree, fold, and stamp paths in lockstep.

CLASSIFICATION: additive (absent fields = today's behavior).

**Resolution:** parameterize asAction with the field label
(`asAction(value, nodeId, field, issues)`) so onHold issues name onHold; add
appear/scroll to the boxStyle whitelist with closed-set token checks; DC-005
unit tests must cover malformed onHold AND unknown appear/scroll through
validateTree, foldPatchIntoStage, and validateStamp.

### RISK-API-4 (API): pressable-box DOM contract — click suppression + keyboard path

PATTERN: the published StageRenderer's pressable-box contract is a
`<div role="button" tabIndex={0} onClick={...}>`
(`packages/react/src/StageRenderer.tsx:490-500`) with press classification in
the internal `classifyPress` (`StageRenderer.tsx:210`). Implementing hold
requires pointer-event + timer handling on the SAME element; two concrete
hazards: (a) after a completed long-press, the browser still fires `click` on
pointerup, so without explicit click-suppression BOTH onHold and onPress fire
— violating the brief's Example 2 ("the two never both fire") and DC-004;
(b) the current element has no onKeyDown (keyboard activation relies on
role=button click synthesis), so onHold has NO keyboard path — a hold-only
affordance is keyboard-inaccessible. DC-007 also demands byte-identical DOM
for trees without onHold.

CLASSIFICATION: additive only if hold handlers (pointerdown/up/move,
contextmenu suppression, touch-action) attach EXCLUSIVELY when a classified
onHold is present.

**Resolution:** spec must state (1) hold handlers are conditional on onHold
presence (no-onHold trees keep today's exact element/props), (2) a completed
hold sets a suppress-next-click latch, (3) add a classifyHold mirroring
classifyPress (raw live-patch path is untrusted), and (4) record the
keyboard-inaccessibility of hold as accepted-or-mitigated (STAGE_SPEC
guidance: never hide critical content behind hold-only — brief invariant #2
note).

### RISK-API-5 (API): theme surfaces must stay byte-identical

PATTERN: `ResolvedTheme` is a published `@facet/react` interface whose every
group is REQUIRED (`packages/react/src/theme.ts:106-113`), and
`FacetTheme`/`validateTheme` in core have a closed KNOWN_KEYS set
(`packages/core/src/theme.ts:38-47` and `:81-90`). If the spec-writer
expresses the scroll region's bounded max-height or appear duration/curve as
a THEME group, that is (a) a BREAKING change for any consumer constructing a
ResolvedTheme literal (new required property) and (b) a widening of
validateTheme's raw-CSS acceptance surface — which the brief's Decision Lock
explicitly forbids ("theme documents do NOT accept keyframes/animation CSS in
v1", `specs/feature-intake/appear-hold-scroll.md:186`).

CLASSIFICATION: avoidable breaking change.

**Resolution:** spec must pin appear duration/curve and the scroll max-height
as non-exported renderer constants in `@facet/react` (like today's hold
threshold/slop assumption, brief line 187) — ResolvedTheme, FacetTheme,
DEFAULT_THEME, and validateTheme stay byte-identical; if a themed knob is
ever added later it must land as an OPTIONAL ResolvedTheme property.

### RISK-API-6 (API): kit builder positional signature — last cheap slot

PATTERN: `@facet/kit`'s published builder signature is positional —
`box(style: BoxStyle, children: readonly NodeId[], onPress?: FacetAction): NodeId`
(`packages/kit/src/kit.ts:36`, surfaced in the published d.ts via the
exported `Block = (builder: Builder) => NodeId` type at `kit.ts:76`) — and
`apps/playground/src/gallery.tsx:32` maintains a PARALLEL builder with the
same signature. Appending `onHold?: FacetAction` as a 4th positional
parameter is ADDITIVE (existing calls compile unchanged), but it is the last
cheap positional slot; the brief says presets "may optionally adopt" (not
required for DoD). MIGRATION per consumer: kit presets (button/card/hero at
`kit.ts:95-161`) need no change; `apps/playground/src/gallery.tsx` needs no
change unless it wants the new words (it constructs BoxNode literals —
optional fields are additive); KIT_STAMPS (`packages/kit/src/stamps.ts`)
revalidate via the shared validateStamp path so scroll adoption there is free
once RISK-API-3 lands.

**Resolution:** spec should either append the optional onHold param
(documenting it as the final positional slot) or, if it foresees more per-box
words, introduce an options-object overload now — and must state that
playground's duplicate builder is intentionally independent (no forced
migration).

### RISK-API-7 (API): quickstart's prebuilt bundle — stale-artifact trap

PATTERN: `@facet/quickstart` ships a PREBUILT browser bundle (`/app.js`,
`packages/quickstart/src/server.ts:110-151`, resolved at `server.ts:119`)
that statically embeds `@facet/core`'s validateTree and `@facet/react`'s
renderer; a core/react-only change leaves a stale bundle whose embedded
validateTree strips the new appear/onHold/scroll fields CLIENT-side (useFacet
re-folds and re-validates every patch, `packages/react/src/useFacet.ts:54`) —
degradation is silent and fail-safe, so nothing errors while the new
vocabulary simply never renders. The server-side /event gate needs NO change
(`packages/server/src/server.ts:150-157` already accepts any agent-kind
action regardless of which gesture fired it — this is the evidence the
brief's "zero new protocol messages" claim holds).

CLASSIFICATION: additive, but with a stale-artifact trap.

**Resolution:** spec's DoD must include
`pnpm --filter @facet/quickstart build` before the live gate and rely on Tier
1b's real-bundle run (`packages/quickstart/e2e/bundle.test.ts`) to prove the
shipped bundle carries the new fields; the DC-009 real-browser check must be
run against the REBUILT bundle, not the playground dev server only.
