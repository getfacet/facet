# Context: `richtext`

Context pass evidence for the `richtext` primitive brick — a flowing block of
mixed-format prose with inline runs, bounded nested lists, headings, and inline
links (internal `FacetAction` targets + gated external URLs). This document
captures the gathered evidence for the spec writer. It records facts only; it
does not design the feature.

## Affected packages

- `@facet/core`
- `@facet/react`
- `@facet/agent-tools`
- `@facet/reference-agent`

## Code entrypoints (file:line)

### `@facet/core`
- `packages/core/core/src/nodes.ts` — node union, `PRIMITIVE_BRICK_TYPES`
  (:308), `CoreNodeType`, `FacetAction` closed navigate/agent/toggle union (:93).
- `packages/core/core/src/component-nodes.ts` — component node types.
- `packages/core/core/src/brick-registry.ts` — `BRICK_REGISTRY: Record<CoreNodeType, BrickEntry>`
  compiler-exhaustive map; required-key site (:181).
- `packages/core/core/src/primitive-node-validation.ts` — `isSafeMediaSrc`
  (:81-90), `asNumberToken`/clamp idiom (:66-70), `boxStyle` `asToken`
  sanitizers (:92-171).
- `packages/core/core/src/component-validation-data.ts` — component validation data.
- `packages/core/core/src/tokens.ts` — token vocabulary.
- `packages/core/core/src/spec.ts` — spec surface.
- `packages/core/core/src/action-validation.ts` — `normalizeFacetAction` (:32),
  the single shared action sanitizer.

### `@facet/react`
- `packages/core/react/src/brick-render-registry.ts` — `BRICK_RENDERERS`,
  `BrickRendererType = ComponentNodeType | 'field'` (:36).
- `packages/core/react/src/brick-renderer-data.tsx` — data-bound brick renderers.
- `packages/core/react/src/renderer-render.tsx` — `renderNode` switch (:346),
  bespoke `case 'text':` path (:489), `default:` fallthrough (:531),
  `brickRendererEntry` undefined → `return null` (:539); `onPress` dispatch prop
  (:68).
- `packages/core/react/src/theme.ts` — token→CSS theme (mark look, flow indent).

### `@facet/agent-tools`
- `packages/agent-stack/agent-tools/src/prompt-kit.ts` — Facet prompt kit.

### `@facet/reference-agent`
- `packages/agent-stack/reference-agent/src/prompt.ts` — reference agent prompt.

### Additional referenced seams (from risk probes)
- `packages/core/react/src/renderer-press.ts` — `classifyPress` / `ClassifiedPress`
  (:201, :25).
- `packages/core/react/src/renderer-safe.ts` — media-src client-side re-gate (:126),
  imports `isSafeMediaSrc` from `@facet/core` (:3).
- `packages/core/react/src/renderer-motion.ts` — motion-snapshot switch (:172),
  `default:` (~:194), `participatesInMotionSnapshot`.
- `packages/core/react/src/brick-render-registry.test.ts` — registry-sync
  exhaustiveness test, hardcoded `bespoke = ['box','text','media']` (:19-21).
- `packages/agent-stack/agent-tools/src/executor-registry.ts` —
  `EXECUTOR_REGISTRY: ExecutorRegistry`, mapped type over full node union (:47),
  value site (:101), `PRIMITIVE_NODE_TYPES`/`COMPONENT_NODE_TYPE_SET` derivation
  (:492/:498).
- `packages/agent-stack/agent-tools/src/executor-policy.ts` — catalog-policy
  primitive-fallback gate on `PRIMITIVE_NODE_TYPES.has(node.type)` (:52).
- `packages/agent-stack/agent-tools/src/executor-input.ts` — `FACET_NODE_TYPES_TEXT`
  (:16), auto-includes new node types.
- `packages/core/core/src/catalog-types.ts` — `CATALOG_BRICK_TYPES` auto-derives
  from `PRIMITIVE_BRICK_TYPES` (:13-16).
- `packages/core/core/src/catalog-defaults.ts` — `DEFAULT_PRIMITIVE_BRICKS`
  hand-maintained list (:75).
- `packages/core/core/src/index.ts` — curated barrel; `export * from "./nodes.js"`
  (:2), `export * from "./validate.js"` (:11).
- `packages/core/core/src/validate.ts` — explicit named re-export block
  surfacing `isSafeMediaSrc` from `./primitive-node-validation.js` (:1-5).
- `packages/agent-stack/reference-agent/src/prompt/stage-summary.ts` —
  `STAGE_SUMMARY_REGISTRY: Partial<Record<SummarizableNodeType, NodeSummarizer>>`
  (:79), dispatch with `type=unknown` fallthrough (:230).

## Risk register

### RISK-INV-1 (INV) — link href gate must NOT mirror `isSafeMediaSrc` verbatim
INV #7/#1 (backend-via-agent, never client fetch): the external-URL link mark is
the ONE new outside-touching surface. The brief (line 97, 157) says `isSafeHref`
should "mirror `isSafeMediaSrc`" — that mirror is UNSAFE if copied verbatim.

Seam: `isSafeMediaSrc` at `packages/core/core/src/primitive-node-validation.ts:81-90`
allows `data:image/` and protocol-relative `//`. A media src is LOADED into
`<img>`/`<video>`; a link href is NAVIGATED at top level, where
`data:image/svg+xml,...` can execute script (SVG scripting on navigation) and any
`data:` navigation is a script/exfil vector that `isSafeMediaSrc` does NOT close.

Resolution the spec MUST implement: define a SEPARATE `isSafeHref` that allows
ONLY `http(s)://`, protocol-relative `//`, and local `/path` — reject ALL `data:`
and `javascript:` (and every other scheme) for hrefs; render the external link as
a plain `<a href>` with `rel="noopener noreferrer"` and no programmatic
`window.open`. Confirmed grep: NO `fetch(` exists anywhere in
`packages/core/react/src` — the spec must NOT introduce a client fetch/resolver;
the link is browser navigation only. Cover with a core `isSafeHref` test
(`data:`/`javascript:`/svg dropped) per DC-004.

### RISK-INV-2 (INV) — internal link must route through the single dispatch writer
INV #6 (two-writers coherence): brief marks this OK, but the coherence only holds
if a richtext link's internal navigate/agent/toggle target routes through the
SINGLE existing dispatch writer, not a new one.

Seam: the one dispatch prop is
`onPress: (press: ClassifiedPress, sourceId: NodeId) => void` at
`packages/core/react/src/renderer-render.tsx:68`, fed by `classifyPress` /
`ClassifiedPress` at `packages/core/react/src/renderer-press.ts:201` and `:25`.

Risk: `renderRichText` attaching its OWN `onClick` handler that mutates
screen/toggle view-state for the internal link would be a SECOND local writer
bypassing the navigate/toggle coherence path.

Resolution the spec MUST implement: the internal link target must be normalized
at validate time by the shared `normalizeFacetAction`
(`packages/core/core/src/action-validation.ts:32`) — NOT a parallel validator —
and dispatched at render time via the same `classifyPress` → `onPress(sourceId)`
path used by box `onPress`; the external-URL link stays a plain anchor with
default browser navigation (no JS writer). Assert reuse in the react
link-render test (DC-001/DC-004).

### RISK-INV-3 (INV) — nested-list `depth` must stay flow-only, clamped
INV #5 (flow-only safety): brief marks OK and inline runs/wrapping is genuinely
flow-safe, but list `depth` (nested bullets, line 48/98) is the one place flow
discipline can slip.

Seam: numeric-token clamping pattern `asNumberToken` at
`packages/core/core/src/primitive-node-validation.ts:66-70` and the `boxStyle`
`asToken` sanitizers (lines 92-171) — richtext has NO absolute-positioning token
today and must not gain one.

Resolution the spec MUST implement: `depth` and heading `level` (1-3) are bounded
integers CLAMPED inside `validateTree` (reuse the `asNumberToken`/clamp idiom, cap
`depth`), and the react renderer must express nesting as renderer-owned FLOW
indent (margin/padding token), never author-controlled `position:absolute` or
raw-pixel indent — keeping layout flow-only. Over-cap depth clamps, never throws
(DC-007).

### RISK-API-1 (API) — `BRICK_REGISTRY` compiler-exhaustive; missing entry = compile error
`@facet/core` `BRICK_REGISTRY: Record<CoreNodeType, BrickEntry>` is
compiler-exhaustive (`CoreNodeType = PrimitiveBrickType | ComponentNodeType`).
Adding `richtext` to `PRIMITIVE_BRICK_TYPES`
(`packages/core/core/src/nodes.ts:308`) makes `richtext` a required key at
`packages/core/core/src/brick-registry.ts:181` — MISSING ENTRY = TypeScript
compile error (`Property 'richtext' is missing in type`).

Resolution: add a `richtext` `BrickEntry`
`{kind:'primitive', established:false, validate: validateRichText (new),
rendersSelf, fill, stringLeaves}` with NO `resolve`/`resolveFromContent`
(richtext is not `from`-bound per the brief's leaf/not-store-bound decision,
DC-005).

### RISK-API-2 (API) — `EXECUTOR_REGISTRY` mapped over full node union; missing = compile error
`@facet/agent-tools` `EXECUTOR_REGISTRY: ExecutorRegistry` where
`type ExecutorRegistry = { [K in FacetNode['type']]: ExecutorBrickEntry<K> }`
(`packages/agent-stack/agent-tools/src/executor-registry.ts:47`, value at `:101`)
is a mapped-type over the full node union — MISSING `richtext` = compile error.
`PRIMITIVE_NODE_TYPES`/`COMPONENT_NODE_TYPE_SET` (executor-registry.ts:492/498)
derive from each entry's `policy.kind`, and catalog-policy at executor-policy.ts:52
gates the primitive-fallback path on `PRIMITIVE_NODE_TYPES.has(node.type)`.

Resolution: add a `richtext` `ExecutorBrickEntry` with `policy.kind:'primitive'`
so richtext is accepted under `primitiveFallback:'allowed'` and not mis-routed as
a component. (Side effect, no action needed: `FACET_NODE_TYPES_TEXT` at
executor-input.ts:16 auto-includes it, so the agent's error text auto-lists
richtext.)

### RISK-API-3 (API) — renderer has no richtext case → silent blank render
`@facet/react` renderer has NO bespoke case for richtext and it is NOT a
`BRICK_RENDERERS` key (`BrickRendererType = ComponentNodeType | 'field'`,
`packages/core/react/src/brick-render-registry.ts:36`). The `renderNode` switch
(`packages/core/react/src/renderer-render.tsx:346`) handles box/text/media/field
bespoke, else falls to `default:` at `:531` → `brickRendererEntry('richtext')`
returns undefined (`:539`) → `return null`. NOT a crash (fail-safe), but richtext
would render BLANK — a silent functional gap that fails DC-001/DC-007.

Resolution: add a bespoke `case 'richtext':` in renderer-render.tsx calling a new
`renderRichText` (flow blocks/runs, apply mark look via theme, gated link href,
bounded depth), mirroring the `case 'text':` path at `:489`.

### RISK-API-4 (API) — registry-sync test hardcodes bespoke list
`@facet/react` registry-sync test hardcodes the bespoke-primitive list:
`const bespoke = ['box','text','media']` and asserts
`[...Object.keys(BRICK_RENDERERS), ...bespoke].sort()` equals
`[...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES].sort()`
(`packages/core/react/src/brick-render-registry.test.ts:19-21`). Once `richtext`
joins `PRIMITIVE_BRICK_TYPES`, `allCoreTypes` gains `'richtext'` but neither the
registry nor the hardcoded `bespoke` array does → this test FAILS.

Resolution: add `'richtext'` to the `bespoke` array on line 19 (it is drawn by a
bespoke inline path, consistent with RISK-API-3), keeping the exhaustiveness guard
green.

### RISK-API-5 (API) — motion-snapshot excludes richtext (no appear, not tracked)
`@facet/react` motion-snapshot pass: `renderer-motion.ts` switch on `node.type`
(`packages/core/react/src/renderer-motion.ts:172`) has bespoke text/media/field
cases; a leaf richtext hits `default:` (`~:194`) →
`participatesInMotionSnapshot('richtext')` → `brickRendererEntry` undefined →
false. So richtext is EXCLUDED from the visibility/appear snapshot: no `appear`
enter-animation and not tracked as a leaf on toggle/navigate re-show. Functional
gap (silent, no crash).

Resolution: add a bespoke `case 'richtext':` in the motion switch mirroring the
text/media cases (`ids.add(id); nodes.set(...)` when the node has ≥1 valid run)
so richtext participates in the snapshot.

### RISK-API-6 (API) — default catalog will not advertise richtext
`@facet/core` `CATALOG_BRICK_TYPES` auto-derives from `PRIMITIVE_BRICK_TYPES`
(`packages/core/core/src/catalog-types.ts:13-16`) so validation accepts a richtext
brick — but `DEFAULT_CATALOG.bricks` is a HAND-MAINTAINED list
(`DEFAULT_PRIMITIVE_BRICKS`, `packages/core/core/src/catalog-defaults.ts:75`) that
will NOT gain richtext automatically. Result: the default catalog never advertises
richtext (guidance/variants) to the agent, so the reference agent is not told the
brick exists. Not a break; a prompt/discoverability gap.

Resolution: add
`{ type:'richtext', guidance:'Use for a flowing block of mixed-format prose with inline links.' }`
to `DEFAULT_PRIMITIVE_BRICKS`.

### RISK-API-7 (API) — link mark is the only new trust surface; reuse + new gate
The link mark is the ONLY new trust surface. Internal targets must REUSE the
existing exported action sanitizer `normalizeFacetAction`
(`packages/core/core/src/action-validation.ts:32`) rather than a new validator —
`FacetAction` (nodes.ts:93) is already a closed navigate/agent/toggle union,
additive-reuse, no reshape. External URLs need a NEW gate `isSafeHref` that must
MIRROR `isSafeMediaSrc` (`packages/core/core/src/primitive-node-validation.ts:81`)
— drop `javascript:`/`data:`/disallowed schemes (DC-004; see RISK-INV-1 for the
critical divergence: `isSafeHref` must be STRICTER than `isSafeMediaSrc`).

Resolution: add & export `isSafeHref` through the core barrel
(`packages/core/core/src/index.ts`, alongside `isSafeMediaSrc` at ~validate.ts:3);
route link internal targets through `normalizeFacetAction`; the react link renderer
must re-gate the resolved href client-side (mirror renderer-safe.ts:126 media-src
re-gate) — do NOT trust the sanitized value blindly. No client `fetch` may be
introduced (invariant #7).

### RISK-API-8 (API) — reference-agent stage-summary degrades to `type=unknown`
`@facet/reference-agent` stage-summary is a consumer of the node vocabulary but
degrades SOFTLY: `STAGE_SUMMARY_REGISTRY` is a
`Partial<Record<SummarizableNodeType, NodeSummarizer>>`
(`packages/agent-stack/reference-agent/src/prompt/stage-summary.ts:79`, dispatch
`:230`) — a missing type falls through to `type=unknown`. So richtext is NOT a
compile break here, but until a summarizer is added the LLM sees a richtext node
summarized as `type=unknown`, degrading cross-turn context (the agent can't read
back its own prose).

Resolution (recommended, not blocking): add a `richtext` entry to
`STAGE_SUMMARY_REGISTRY` that flattens blocks/runs to a short text preview, so the
compaction/summary loop reflects richtext content.

### RISK-PKG-1 (PKG) — `isSafeHref` must join the explicit named re-export block
Barrel-export coupling: `@facet/react` must import the new safe-href helper from
`@facet/core` the same way it imports its sibling today
(`packages/core/react/src/renderer-safe.ts:3` `isSafeMediaSrc`). But core's public
surface is CURATED, not wildcard — `packages/core/core/src/index.ts:11` does
`export * from "./validate.js"`, and `packages/core/core/src/validate.ts:1-5`
surfaces `isSafeMediaSrc` via an EXPLICIT named re-export block
`export { ... isSafeMediaSrc } from "./primitive-node-validation.js"`.
`primitive-node-validation.js` is NOT wildcard re-exported anywhere.

Resolution the spec MUST implement: if `isSafeHref` is defined in
primitive-node-validation.ts (mirroring `isSafeMediaSrc` as the brief states), it
MUST be added to the explicit named re-export list in validate.ts:1-5 — otherwise
the DC-004 react link-render test fails to import it and `@facet/react` cannot gate
external URLs. (`RichTextNode`/`Mark`/`BLOCK_TYPES`, if placed in nodes.ts, surface
automatically via index.ts:2 `export * from "./nodes.js"` and need no manual barrel
step.)

No other PKG risk: no module move/split, no new cross-package dependency (all four
affected packages already depend on `@facet/core`), core stays
node-free/dependency-free (`packages/core/core/src` imports zero `@facet/*`
packages), and no import cycle is introduced.
