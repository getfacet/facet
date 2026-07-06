# Context: brick-vocab-v1

Assembled context-pass evidence for the **brick-vocab-v1** feature. This doc is
the input to `/spec-bridge` — it captures code entrypoints and the invariant/API
risk register gathered from the codebase. Do not invent facts beyond what is
recorded here.

The change grows Facet's brick vocabulary without growing the brick count (stays
4): `image`→`media` (image|video), an expanded `field.input` set with
`field.options`, `BoxStyle.scroll` axis (x|y), and a new `BoxStyle.columns`
layout token.

## Affected packages

- `@facet/core`
- `@facet/react`
- `@facet/quickstart`
- `apps/playground`

## Code entrypoints (file:line)

### @facet/core
- `packages/core/src/nodes.ts:155-161` — `ImageNode` interface (id/src/alt/style)
  in the `FacetNode` union; becomes `MediaNode` with a `kind:"image"|"video"`
  discriminator + kind-specific props (poster/controls). Pattern to follow:
  discriminated node interface, brick count stays 4.
- `packages/core/src/nodes.ts:113-117` — `ImageStyle` interface (radius/width/ratio
  token props); rename → `MediaStyle`, still token-only.
- `packages/core/src/nodes.ts:163-165` — `FIELD_INPUTS` `as const` array is the
  SINGLE source (validator + renderer derive from it); extend with
  checkbox/radio/select/switch. Pattern: add members to the const, type
  auto-derives.
- `packages/core/src/nodes.ts:168-176` — `FieldNode` interface; add
  `options?: readonly string[]` (open question: `string[]` vs
  `{label,value}[]` — assume `string[]`).
- `packages/core/src/nodes.ts:81-104` — `BoxStyle`: `scroll?: boolean` →
  `"x"|"y"|true` (legacy `true`=y back-compat); add new `columns?` token prop.
  Compare `appear?`/`scroll?` doc-comment pattern.
- `packages/core/src/nodes.ts:179` — `FacetNode` union
  (`BoxNode|TextNode|ImageNode|FieldNode`) — swap `ImageNode`→`MediaNode`.
- `packages/core/src/tokens.ts:60-65` — `SIZINGS`/`RATIOS` `as const` array +
  derived-type pattern; add a new `COLUMNS` token group (and possibly a Scroll
  axis type) the same way. This is the token-membership single-source discipline
  validators check against.
- `packages/core/src/validate.ts:265-276` — `imageStyle()` sanitizer →
  `mediaStyle()`; token-membership `asToken` gate pattern.
- `packages/core/src/validate.ts:323-335` — `sanitizeNode` case `"image"`
  (src+alt required, `isSafeImageSrc` gate) → case `"media"` (kind token, src
  safety, poster/controls bools) + normalize legacy `{type:"image"}` for DC-010
  back-compat. Fail-safe: unknown kind/missing src → drop/skip.
- `packages/core/src/validate.ts:336-362` — `sanitizeNode` case `"field"`:
  already `asToken<FieldInput>(raw.input, FIELD_INPUTS)` so expanded inputs come
  free; ADD `options` array sanitize (strings only, empty-safe).
- `packages/core/src/validate.ts:207-248` — `boxStyle()`: `scroll = asBool(...)`
  → axis token with legacy `true`; add `columns` via the existing
  `set(key, allowed)` token helper. New-token-with-issue vs silent-strip policy
  documented at `:222-239`.
- `packages/core/src/validate.ts:195-205` — `isSafeImageSrc()` URL-scheme
  allowlist; decide video src safety (reuse or widen to `data:video/` — brief
  keeps src a static URL like image).
- `packages/core/src/spec.ts:8-33` — `STAGE_SPEC` prompt string (image line at
  `:14`, field inputs at `:15`, BoxStyle/ImageStyle token lists at `:18-20`).
  DC-009 requires teaching media kinds, new field inputs, columns/scroll axis.
  Covered by `spec.test.ts`.

### @facet/react
- `packages/react/src/StageRenderer.tsx:971-979` — `renderNode` case `"image"`
  (`<img>` with `isSafeImageSrc` guard) → case `"media"` rendering native
  `<video>`(poster/controls)/`<img>` by kind, fail-safe skip on unknown.
- `packages/react/src/StageRenderer.tsx:980-1004` — case `"field"` renders one
  `<input>`; extend to native `<select>`(options)/checkbox/radio/switch; unknown
  input→text fallback already at `:983-985`.
- `packages/react/src/StageRenderer.tsx:132-218` + `:202-217` —
  `collectFieldValues` DOM read uses `input.value` and
  `input[data-facet-field-id]` selector; checkbox/switch need `.checked` and
  select needs option value — TWO-WRITERS-sensitive (DC-004). Password-exclusion
  at `:164-166` is the precedent for control-type-specific handling.
- `packages/react/src/StageRenderer.tsx:25` — `import { imageStyle } from
  ./theme.js` → `mediaStyle`.
- `packages/react/src/theme.ts:187-196` — `imageStyle()`→`mediaStyle()`
  token→CSS; `boxStyle:164-169` scroll (currently `=== true` → overflowY only;
  must add axis x→overflowX) and add CSS-grid `columns` branch.
  `SCROLL_MAX_HEIGHT` constant at `:132` is the renderer-owns-scalar precedent.

### @facet/quickstart
- `packages/quickstart/src/agent.ts:115-135` — `asNode()` shape-check case
  `"image"` (src+alt) → case `"media"`; error string at `:134` lists
  `"box|text|image|field"` — update to media.
- `packages/quickstart/src/prompt.ts:143` — `NODE_SCHEMA` description
  `"(box | text | image | field)"` text; `:41` prose
  `"(box, text, image, field)"` — migrate image→media.

### apps/playground
- `apps/playground/src/gallery.tsx:69-74` (`image()` builder → `media()`), `:80`
  (field builder — add options), `:133`/`:236`/`:321` (image call sites), `:344`
  (`scroll:true`). `print-tree.ts:19` (`node.type==="image"`). `App.tsx:16`
  (brick-list description text). Consumer migration for DC-010.

## Risk register

### Invariant risks

#### RISK-INV-1 (INV) — Invariant #5 (flow-only overlap safety): DIRECT REGRESSION
The brief's `scroll:"x"` horizontal carousel reverses an existing,
deliberately-hardened guard: `packages/react/src/theme.ts:164-167` forces
`css.overflowX = "hidden"` inside the `scroll===true` branch, explicitly
annotated `// Never overflow-x (RISK-INV-6a)` — a prior risk-mitigation that
forbade horizontal overflow so children cannot fall off the viewport (flow-only
page safety). Enabling `scroll:"x"` re-introduces `overflow-x:auto`.

RESOLUTION the spec must implement:
(a) branch the scroll CSS on axis — `y`/legacy `true` keeps
`overflowY:auto`+`overflowX:hidden`+`maxHeight`; `x` sets
`overflowX:auto`+`overflowY:hidden` and MUST bound the region so it never widens
the page (`max-width:100%` / contained flex, children clip inside the box, no
ancestor horizontal scroll).
(b) Document that this is a BOUNDED internal scroll region, not a relaxation of
flow-only — the box still cannot overlap siblings. Cite the RISK-INV-6a comment
in the spec so the reviewer knows the earlier decision is being consciously
superseded, not accidentally broken.

#### RISK-INV-2 (INV) — Invariant #5 (no overlay/floating brick): renderer form-control seam
`packages/react/src/StageRenderer.tsx:1001` renders EVERY field as
`<input type={input} .../>`. `type="select"|"checkbox"|"radio"|"switch"` is not
a valid single-input rendering: `<input type=select>` is invalid HTML (degrades
to text), and a switch has no native element. The brief's invariant #5
mitigation is 'native browser controls only, browser owns the popup — no custom
z-index/overlay brick.'

RESOLUTION the spec must implement: branch `renderNode`'s `case "field"` on
input kind — emit native `<select>`+`<option>` for `select` (browser owns the
dropdown popup, satisfying #5), `<input type="checkbox"|"radio">` for those, and
a native `<input type="checkbox">` styled as a switch (per the brief's stated
assumption). Add an explicit spec gate: NO node/CSS introduces
`position:absolute`/`z-index` for any popup — the flow-only invariant holds ONLY
because the browser renders the select popup outside the flow, not Facet.

#### RISK-INV-3 (INV) — Invariant #6 (two-writers coherence / collect-at-press): collect READ path won't capture new controls
Silently breaks DC-004. `packages/react/src/StageRenderer.tsx:195` enumerates
values with `root.querySelectorAll("input[data-facet-field-id]")` and line 214
reads `(input as HTMLInputElement).value`. Two defects for the new controls:
(1) a `<select>` element does NOT match `input[...]`, so select values are
dropped entirely; (2) for `checkbox`/`switch`, `.value` is the static attribute
("on") regardless of checked state — the real state is `.checked`. The
uncontrolled-DOM-owns-view-state model (invariant #6, correctly reused) is fine,
but the snapshot READER must be extended.

RESOLUTION the spec must implement: broaden the selector to
`input,select[data-facet-field-id]` (or a shared `[data-facet-field-id]` attr on
every control), and in the value read at line 202-216 special-case by control
kind — read `.checked`→boolean/omit for checkbox/switch, `<select>.value` for
select — instead of unconditional `.value`. Keep the existing
`MAX_FIELD_VALUE_CHARS`/`MAX_FIELDS_KEYS` caps and the password-exclusion (line
164) intact.

#### RISK-INV-4 (INV) — Invariant #6: radio-group collect picks the WRONG member
Radio buttons in a group share one `name`, and only the CHECKED one carries the
answer. `collectFieldValues` buckets ids by name
(`StageRenderer.tsx:172-176`) then at line 207-210 picks
`ids.find(id => inputByNodeId.has(id))` — the FIRST MOUNTED input, chosen for
the hidden-field-shadowing case, with NO notion of which radio is selected. For
a radio group this reports the first radio's value regardless of the user's
choice, so the collected `fields[name]` is systematically wrong.

RESOLUTION the spec must implement: when the same `name` maps to multiple radio
inputs, read the value of the CHECKED member (skip unchecked; if none checked,
omit the key or emit ""), rather than first-mounted-wins. Add a DC/vitest
asserting a 3-option radio group collects the selected value, not the first.

#### RISK-INV-5 (INV) — Invariant #3 (fail-safe / token-membership discipline): new tokens must strip to flow, legacy values normalized, in validateTree
`packages/core/src/validate.ts:234-239` handles `scroll` via `asBool` only;
changing the type to `"x"|"y"|true` means today's coercion DROPS the new string
values (DC-007/008 fail). And there is NO `columns` handling in `boxStyle()`
(the `set(...)` block at `validate.ts:214-221`) nor a `COLUMNS` const in
`packages/core/src/tokens.ts`, so an unknown/invalid `columns` currently can't
be membership-stripped.

RESOLUTION the spec must implement:
(a) add a `COLUMNS` token array in `tokens.ts` and a `set("columns", COLUMNS)`
(or explicit branch) in `validate.ts` `boxStyle` so bad `columns` strips to
normal flow with an issue (DC-008);
(b) replace the `asBool` scroll branch with an axis-normalizer — accept
`"x"`/`"y"`, map legacy `true`→`"y"` (back-compat), strip anything else with an
issue;
(c) in the renderer/theme, when `columns` is set, the box switches from
`display:flex` (hardcoded at `theme.ts:145`) to `display:grid` with
`gridTemplateColumns:repeat(N,1fr)` — the spec must define
columns×direction×scroll interaction so the grid mode never enables absolute
positioning (stays flow-only, invariant #4/#5). Unknown values in ALL three must
degrade to flow and never throw (DC-008).

#### RISK-INV-6 (INV) — Invariant #1/#3 (UI-out static-src boundary + fail-safe): media `video` src gate and image→media migration
The URL-scheme gate `isSafeImageSrc` (`packages/core/src/validate.ts:196-205`,
consumed at `validate.ts:330` and renderer `StageRenderer.tsx:973`) is the
injection/backend boundary that blocks `javascript:`/`data:text/html`; it is
image-specific (allows `data:image/`). Reusing it verbatim for video is wrong (a
`data:image/...` would pass for a video element; `data:video/...` is neither
allowed nor clearly desired) and, more importantly, the spec must keep the SAME
never-`javascript:`/never-`data:text/html` gate for `media.src` so video stays a
static URL exactly like image (invariant #1 — no fetch/data-binding). Also the
new `field.options` array is NEW untrusted surface with no sanitizer today — an
unbounded/non-string options list must be membership/shape-checked and
length-capped (fail-safe, DC-005). And the image→media rename:
`validate.ts:291`'s `switch(type)` has a `case "image"` (line 323) and
`StageRenderer.tsx:971` a `case "image"`; a legacy `{type:"image"}` blob must
still validate+render (DC-010 normalize).

RESOLUTION the spec must implement: generalize `isSafeImageSrc`→`isSafeMediaSrc`
(or a video-specific variant) applied to `media.src` at BOTH validate and render
seams; add an `options` sanitizer (string[], drop non-strings, cap count+per-item
length) in the `field` case of `sanitizeNode` (`validate.ts:336-362`); keep a
`type:"image"` normalize path (alias to `media` kind:image) so legacy trees
survive. Missing `src`/unknown `kind` → skip/plain, never throw (DC-002).

### API / published-surface risks

#### RISK-API-1 (API) — BREAKING brick-shape rename `ImageNode`/`type:"image"` → `media`
Exported via the @facet/core barrel (`packages/core/src/index.ts` → `nodes.js`).
Declaration site: `packages/core/src/nodes.ts:113` (`ImageStyle`), `:155-160`
(`ImageNode` with `type:"image"`), `:179`
(`FacetNode = BoxNode | TextNode | ImageNode | FieldNode`). This is a published
discriminated-union member; renaming the `type` tag and interface is breaking
for every consumer that constructs, narrows, or imports it.

PROVEN consumers to migrate:
(a) `packages/core/src/validate.ts:23` (imports `type ImageStyle`), `:265-275`
(`imageStyle()` normalizer), `:334`
(`return { id, type: "image", src, alt, style: imageStyle(...) }`);
(b) `packages/react/src/theme.ts:11` (imports `ImageStyle`), `:187-197`
(`imageStyle()` CSS fn);
(c) `packages/react/src/StageRenderer.tsx:971` (`case "image":` render arm);
(d) `packages/quickstart/src/agent.ts:123-134` (`case "image":` validation +
error strings `'an "image" node needs string "src" and "alt"'` and
`'"type" must be one of "box" | "text" | "image" | "field"'`),
`packages/quickstart/src/prompt.ts:41` & `:143`
(prose `(box | text | image | field)`);
(e) `apps/playground/src/gallery.tsx:8` (imports `ImageStyle`), `:69-74`
(`image()` builder emitting `{id,type:"image",src,alt}`);
(f) `apps/playground/src/print-tree.ts:19`
(`node.type === "image" ? : ${node.src}`).

RESOLUTION the spec MUST implement: rename to `MediaNode`/`MediaStyle` with
`type:"media"` + `kind:"image"|"video"` and kind-specific props (poster/controls
for video), update the `FacetNode` union and the core barrel, and migrate ALL
six consumer sites above. Per DC-010, `validateTree` (`validate.ts:334`) MUST
normalize a legacy `{type:"image"}` blob into the `media`/`kind:"image"` shape so
old server-persisted trees still render; and because the react raw path
(`StageRenderer.tsx` `switch(node.type)`) also renders UN-normalized junk nodes
in tests, decide whether `case "image"` stays as a legacy alias or all raw input
is normalize-gated.

#### RISK-API-2 (API) — BREAKING type-narrowing of `BoxStyle.scroll` from `boolean` to `"x"|"y"|true`
Declaration `packages/core/src/nodes.ts:100-103`, exported via barrel. Runtime
is back-compat (legacy `true` = vertical) but the normalizer and renderer are
HARD-coupled to the boolean assumption and must change.

PROVEN coupling sites:
(a) `packages/core/src/validate.ts:234-238` —
`const scroll = asBool(value.scroll); if (scroll !== undefined) style.scroll =
scroll; else if (value.scroll !== undefined) issues.push('scroll is not a
boolean; dropped')` — this `asBool` gate ACTIVELY STRIPS `"x"`/`"y"` today and
must become an axis-token check that keeps `x|y|true`;
(b) `packages/react/src/theme.ts:164-173` —
`if (style.scroll === true) { css.overflowY='auto'; css.overflowX='hidden'; ... }`
— must branch: `y`/`true`→overflowY, `x`→overflowX (a carousel), and the
RISK-INV-6a 'never overflow-x' comment there must be revisited for the deliberate
`x` case.

CONSUMER TEST that will FAIL and must be inverted, not just extended:
`packages/core/src/validate.test.ts:786` iterates
`for (const scroll of ["sideways", 1, "y"])` and asserts each is stripped with an
issue — `"y"` must now be KEPT (and add an `"x"` keep-case). Also update
`spec.ts:18` STAGE_SPEC text `scroll(bool)`, `spec.test.ts:36`
(`/scroll\(bool\)/`), `quickstart/prompt.test.ts:46` (same regex), and the
stage-fold parity tests (`stage-fold.test.ts:261-320`) which assert scroll junk
parity with `validateTree`.

RESOLUTION: introduce a `SCROLL_AXES`/axis token, widen the field type, replace
`asBool` with axis-membership coercion mapping legacy `true`→`"y"` (or accept
both), update `theme.ts` branch + all listed tests.

#### RISK-API-3 (API) — ADDITIVE-but-behavioral: `FIELD_INPUTS` tuple expansion + new `field.options?: string[]`
`nodes.ts:164-165` (`FIELD_INPUTS = [text,number,email,password,search]`),
`:172` (`input?: FieldInput`). Widening the exported `as const` tuple to add
checkbox/radio/select/switch is type-additive (the `FieldInput` union grows;
existing values still valid) and `validate.ts:346-351`
(`asToken<FieldInput>(raw.input, FIELD_INPUTS)`) auto-picks them up. BUT the
renderer is coupled to a single-element assumption:
`packages/react/src/StageRenderer.tsx:982-1001` always emits
`<input type={input} ...>` after checking membership at `:984`
(`(FIELD_INPUTS as readonly string[]).includes(node.input)`). `type="select"`/
`"switch"` are NOT valid HTML input types → the browser silently renders a text
box, so the new controls will not appear without a renderer branch.

RESOLUTION the spec MUST implement: in the react `case "field"` arm, branch on
`input` to emit native `<select>` (with `options`), `<input type="checkbox">`
(and switch = styled checkbox), `<input type="radio">` groups; keep unknown →
`text` fallback (DC-005). Add `options?` to `FieldNode` and validate it as a
string[] in `validate.ts` (empty-safe). No existing consumer breaks, but
`StageRenderer.test.ts:156` comment ('constrained to FIELD_INPUTS token set
(else text)') and its raw-path tests must gain new-control coverage.

#### RISK-API-4 (API) — COUPLING that DC-004 depends on but the current collect contract cannot satisfy
The field-value snapshot only reads `<input>` elements.
`packages/react/src/StageRenderer.tsx:195`
`root.querySelectorAll("input[data-facet-field-id]")` and `:212-214`
`String((input as HTMLInputElement).value).slice(0, MAX_FIELD_VALUE_CHARS)`. A
native `<select>` (new input:select) is NOT an `<input>`, so its value is never
collected; a checkbox/switch carries state in `.checked`, not `.value` (`.value`
defaults to "on"), and radios need the checked member of the group. Since
`fields` on the `ClientEvent` is a published protocol payload (the agent reads
it), silently dropping select/checkbox values is a contract-level gap.

RESOLUTION the spec MUST implement: broaden the selector to
`[data-facet-field-id]` across input/select (and stamp `data-facet-field-id`
onto the `<select>`/checkbox/radio elements in the field render arm at
`StageRenderer.tsx:1001`), and in `collectFieldValues` read per-element-type —
`HTMLSelectElement.value`, checkbox/switch → checked→"true"/"" (or value when
checked), radio group → the checked option's value. Keep
`MAX_FIELD_VALUE_CHARS`/`MAX_FIELDS_KEYS` caps. Add a StageRenderer collect test
for a select + checkbox press (DC-004).

#### RISK-API-5 (API) — ADDITIVE new layout token `BoxStyle.columns?` + a `COLUMNS` token const
New export through `packages/core/src/index.ts` → `tokens.js`, mirroring
`SIZINGS` at `packages/core/src/tokens.ts:60-62`. No existing consumer breaks
(new optional field + new const), but three sites must implement it or the token
is inert/unsafe:
(a) `validate.ts` must add a columns membership check in the box-style
normalizer (near the scroll/appear handling at `validate.ts:222-238`) so unknown
N is stripped with an issue (DC-008);
(b) `packages/react/src/theme.ts` `boxStyle()` (`:140-171`) currently sets
`display:"flex"` unconditionally — a grid needs `display:"grid"` +
`gridTemplateColumns: repeat(N,1fr)` when `columns` is present, which interacts
with the existing `flexDirection`/`wrap`/`gap` lines and must be reconciled (open
question in the brief: columns × direction/wrap);
(c) `spec.ts` STAGE_SPEC BoxStyle line (`spec.ts:18`) must teach `columns`.

RESOLUTION: add `COLUMNS` as a bounded token set (owner open-question: fixed
`2|3|4` vs include `auto`), export it, validate membership, and give `boxStyle`
a grid branch. Note `Sizing` (width auto|full, `tokens.ts:61`) is intentionally
NOT widened — grid is the new mechanism, so width stays additive-free.

#### RISK-API-6 (API) — STAGE_SPEC drift
The LLM-facing vocabulary string is a published @facet/core export (`STAGE_SPEC`
via `spec.ts`, barrel `index.ts:13`) and is pinned by drift-net tests across two
packages, so every surface change above must land in `spec.ts` atomically or
these tests fail.

PROVEN pins: `packages/core/src/spec.ts:14`
(`- image: { ...type:"image"... } — use https://picsum.photos/...`), `:18`
(BoxStyle line incl. `scroll(bool)`), `:20`
(`ImageStyle: radius/width/ratio`); asserted by
`packages/core/src/spec.test.ts:31-42` (`/scroll\(bool\)/`, 'teaches appear
onHold and scroll') and MIRRORED in `packages/quickstart/src/prompt.test.ts:38-46`
which re-checks the embedded STAGE_SPEC (`/scroll\(bool\)/`) — a cross-package
drift net.

RESOLUTION (DC-009): rewrite the `spec.ts` `image` line as `media` (kind
image|video, poster/controls), replace `scroll(bool)` with the axis token
wording, add the expanded `field.input` set + `options`, and add the `columns`
token; then update `spec.test.ts` and `quickstart/prompt.test.ts` regexes in
lockstep (the `scroll(bool)` assertions in BOTH files will otherwise fail).
