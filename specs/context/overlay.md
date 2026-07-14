# Context: `overlay`

Spec-writer-facing context for adding an `overlay` capability to the primitive
`box` brick. `overlay?: { kind: "modal" | "drawer" }` lets a validated box float
above flow (renderer-owned placement, positive-z, toggle-to-open/close, no author
coordinates), reusing the existing local toggle + `view.toggled` channel. This
doc assembles the context pass evidence only — it invents no new facts.

## Affected packages

- `@facet/core`
- `@facet/react`
- `@facet/assets`

## Code entrypoints

### @facet/core

- `packages/core/core/src/nodes.ts:250-260` — the module-private `Layered`
  concern pack (`backdrop?: NodeId`) that `BoxNode` composes via `extends`
  (`nodes.ts:268-269`). Add `overlay?: { kind: "modal" | "drawer" }` here per the
  ARCHITECTURE growth-rule worked example (`docs/ARCHITECTURE.md` line 224-227).
- `packages/core/core/src/primitive-node-validation.ts:357-364` — the
  `validateBox` `backdrop` passthrough sanitizer (string-kept-else-dropped-with-
  issue). Add a `sanitizeOverlay` closed-kind sanitizer alongside it (drop unknown
  kind / strip extra keys), and widen the local `node` type literal at
  `331-343` to carry `overlay?`.
- `packages/core/core/src/spec.ts:13` (box line) + `spec.ts:51` (BoxStyle) —
  STAGE_SPEC box descriptor prose. Teach `overlay` (kind set, renderer-owned
  placement, toggle-to-open/close, no coords) mirroring the existing `backdrop`
  sentence. Spec assertions live at
  `packages/core/core/src/spec.test.ts:201-220` (DC-007).
- `packages/core/core/src/brick-registry.ts:205-213` — the `box` `BrickEntry`
  (`validate: validateBox`). Overlay is validated through `validateBox`, so no new
  registry entry is needed — only that validator changes.
- `packages/core/core/src/validate.test.ts:2144-2164` — the `backdrop` keep/drop
  unit-test pattern to mirror for overlay sanitize tests (DC-003/DC-004).

### @facet/react

- `packages/core/react/src/layout-contract.ts:17-74` — the flow-only overlay-
  discipline helpers (`backdropHostStyle` `isolation:isolate` host, `scrimStyle`,
  NEGATIVE-z `BACKDROP_MEDIA_Z`/`BACKDROP_SCRIM_Z` band at `36-40`). Extend with a
  renderer-FIXED POSITIVE-z overlay band + modal-center / drawer-end-edge
  placement presets (first paint ABOVE flow). Note lines `29-31`: stacking is not
  SSR-verifiable → live-journey mandatory.
- `packages/core/react/src/renderer-render.tsx:20` (imports
  `backdropHostStyle`/`scrimStyle`), `475-490` — the box render return where the
  backdrop host/scrim/layers wrap the `BoxElement`. The overlay float/scrim/
  placement wraps here when a box is visible AND carries a valid `overlay`.
- `packages/core/react/src/StageRenderer.tsx:191-241` — `handlePress` + the
  `toggle` case (`202-220`) that flips `visibilityOverrides` and records the local
  tap. Esc/scrim-click close must dispatch the SAME toggle (target = overlay box
  id) through this path so `view.toggled` stays coherent (DC-005).
  `visibilityOverrides` state at `StageRenderer.tsx:113`; raw override map contract
  at `brick-renderer-types.ts:24-31`.
- `packages/core/react/src/renderer-press.ts:216-217` — the `toggle`
  `ClassifiedPress` shape reused for the renderer-dispatched close.

### @facet/assets

- `packages/core/assets/src/catalog.ts:1` — re-exports `DEFAULT_CATALOG` from
  `@facet/core`. The actual default-catalog DATA lives in
  `packages/core/core/src/catalog-defaults.ts`, so any "advertise overlay as a box
  capability" change is a `@facet/core` edit surfaced through `@facet/assets` (the
  brief marks this "confirm in spec").

## Risk register

### RISK-INV-1 (INV) — Invariant #5 (flow-only): first renderer paint ABOVE flow

Seam: `packages/core/react/src/layout-contract.ts:36-80`. Today the ONLY overlay
discipline is the backdrop path, and it is hard-committed to paint BELOW flow:
`BACKDROP_MEDIA_Z=-2` / `BACKDROP_SCRIM_Z=-1` (lines `38-39`) are both NEGATIVE,
and the module contract (lines `17-31`) states `position:absolute` is "confined to
these renderer-owned layers … NEVER emitted onto an authored flow child, and no
author z-index/offset exists". `overlay` inverts this: the floated box must be
lifted OUT of flow into a renderer-fixed POSITIVE-z band.

Mitigation the spec must implement: declare framework-owned positive-z constants +
placement presets HERE (modal = fixed screen-center, drawer = fixed end-edge, plus
a positive-z scrim reusing the `scrimStyle` pattern), selected PURELY by `kind` —
never any author z/inset/top/position value; the `box` still lays out its children
flow-only inside the floated frame. Because string-SSR tests cannot verify
stacking/focus (the explicit NOTE at lines `29-31`), the live-journey real-browser
tier is MANDATORY for this feature (DC-001/DC-006, decision-lock line 179), not the
usual optional tier.

### RISK-INV-2 (INV) — Invariant #4/#5 (declarative+tokens only; no author positioning/z leak, DC-004)

Seams: (a) the `Layered` concern pack `packages/core/core/src/nodes.ts:251-260`
(today only `backdrop?: NodeId`) is where `overlay?: { kind: "modal" | "drawer" }`
must be added — correct home per the decision lock, and it keeps media/field
(which don't extend `Layered`) free of it; (b) the sanitize seam is `validateBox`
at `packages/core/core/src/primitive-node-validation.ts:322-373`, which builds an
explicit WHITELIST object and copies only known keys from `raw` (see the `backdrop`
string-guard precedent, lines `357-364`) — there is NO generic spread, and grep
shows no existing overlay/backdrop sanitizer in `validate.ts` (only
`sanitizeActionPayload` is imported).

Mitigation: add a `sanitizeOverlay` in `validateBox` that reads ONLY
`raw.overlay.kind`, admits it iff `kind ∈ {modal, drawer}` (closed EXTENSIBLE set),
and DROPS THE WHOLE descriptor on unknown kind / missing kind / wrong type / extra
keys (`{kind:'modal',z:999,top:10}` → keep nothing but `kind`; `overlay:'modal'`
string → drop) with a bounded issue — matching the fail-safe style of the backdrop
drop. The whitelist-copy pattern already prevents extra author keys from ever
reaching the renderer, but the descriptor-level drop (DC-003) must be explicit.
Also update STAGE_SPEC: the box line `packages/core/core/src/spec.ts:13` must teach
`overlay` (kind set, renderer-owned placement, toggle-to-open/close, no coords) per
DC-007.

### RISK-INV-3 (INV) — Invariant #6 (two-writers coherence)

Open-state must stay single-sourced in the existing local toggle + `view.toggled`
channel — NO overlay-specific `isOpen`. Seams: the toggle writer is
`StageRenderer.tsx:202-221` (`handlePress` `'toggle'` case), which does BOTH
`setVisibilityOverrides(flip)` AND `recordLocalTap({kind:'tap', target: sourceId,
effect:{toggle: press.target}})`; the reported `view.toggled` is DERIVED purely
from `visibilityOverrides` in `view-snapshot.ts` `captureViewSnapshot` (the
`toggled` loop).

The hazard: the renderer's new close affordances (Esc, scrim-click) originate from
NO pressed node, so it is tempting to hide the overlay with a component-local
`useState` or a direct DOM hide — that would make the visual state diverge from
`view.toggled` and the agent's snapshot would read "open" after a local close.

Mitigation the spec must implement: Esc/scrim/close-button ALL route through the
SAME `setVisibilityOverrides` + `recordLocalTap` path on the OVERLAY BOX id (never a
renderer-internal hide), so `view.toggled` flips byte-coherently. The spec must also
define the `recordLocalTap` `sourceId` for a chromeless close (Esc/scrim have no
pressed box) — use the overlay box id itself so the tap record stays well-formed.

### RISK-INV-4 (INV) — Invariant #6 corner: literal "reuse the toggle" for close is NOT idempotent

A literal reuse of the flip-toggle for close can REOPEN a closed overlay,
contradicting the brief's own policy row ("Double-close is idempotent … toggle to
hidden twice = hidden", line 107). Seam: `StageRenderer.tsx:213-217` — the toggle
case computes `effective = prev.get(target) ?? !isHiddenByDefault(target)` then
`next.set(target, !effective)`: a PURE FLIP. If Esc/scrim fire twice (or a close
fires on an already-hidden overlay), the second flip sets the box back to VISIBLE →
the modal reopens with no scrim-close wired.

Mitigation the spec must implement: the close paths must write visibility
DETERMINISTICALLY to hidden (set false idempotently) — still via
`setVisibilityOverrides` + `recordLocalTap` so `view.toggled` stays coherent
(RISK-INV-3) — rather than blindly re-dispatching the flip-style toggle;
equivalently, guard the close so it is a no-op when the overlay is already hidden.
The TRIGGER button keeps the normal flip semantics; only the close affordances need
the idempotent-hide.

### RISK-API-1 (API) — allowlist-reconstruction gate (silent-strip)

`validateBox` at `packages/core/core/src/primitive-node-validation.ts:322-373`
builds a FRESH `node` object copying only recognized keys (id/type/style/children/
variant/activeVariant/activeStyle/active/backdrop/onPress/onHold/hidden); any
unknown key on the raw box is dropped. `overlay` is not among them, so an
agent-emitted `overlay` is silently discarded before it reaches the tree or
renderer. This is the SINGLE gate every consumer passes through — agent-tools
`set_page`/`set_node`/`append_node` (open `NODE_SCHEMA` at
`packages/agent-stack/agent-tools/src/specs.ts:5`) → `validateTree`
(`packages/agent-stack/agent-tools/src/executor-page.ts:30`), and `@facet/agent`
`Stage.set`/`append` (`packages/extensions/agent/src/stage.ts:65-75`) →
`validateTree`.

CLASSIFY: additive to the published `BoxNode` surface, but REQUIRED-atomic: the
field is inert without this edit. RESOLUTION the spec must implement: add
`sanitizeOverlay` in `validateBox` mirroring the `backdrop` block at lines
`357-364` — accept `raw.overlay` only when it is an object whose `kind` ∈ closed set
`{"modal","drawer"}`, strip all extra keys (reject `{kind:'modal',z:999,top:10}` →
only `kind` survives, DC-004), drop unknown/malformed (`{kind:'lightbox'}`, `{}`,
`"modal"`) with a bounded issue, and assign `node.overlay` only on success (DC-003).

### RISK-API-2 (API) — renderer is the only float-capable consumer; missing branch = inert feature

The react box render case at `packages/core/react/src/renderer-render.tsx:348`
reads structural fields via casts (e.g. backdrop at line `388`
`(node as {readonly backdrop?: unknown}).backdrop`) and has NO overlay branch;
`layout-contract.ts` only paints NEGATIVE-z backdrop/scrim layers below flow
(`packages/core/react/src/layout-contract.ts:36` "both NEGATIVE so in-flow content
paints" above). A validated `overlay` therefore renders as a normal inline box
(correct fail-safe, but the FEATURE does nothing).

CLASSIFY: additive to `@facet/react` (no signature change), but atomic with
RISK-API-1 — core-validate + react-render + STAGE_SPEC must land in ONE PR (the
codebase's documented rule that adding/removing a node capability must be ATOMIC
across core+assets+react+agent). RESOLUTION: extend `layout-contract.ts` with a
renderer-FIXED positive-z band + scrim + placement presets (modal=center,
drawer=end-edge), gated on `node.overlay` AND visibility; author supplies no
z/inset/position (DC-001/002/004).

### RISK-API-3 (API) — public prop surface must stay frozen (guardrail)

Overlay close (Esc/scrim/close-button) MUST reuse the EXISTING internal toggle
press writer at `packages/core/react/src/StageRenderer.tsx:202-220` (`case
"toggle"` mutates `visibilityOverrides` then `recordLocalTap({kind:'tap',
target:sourceId, effect:{toggle: press.target}})`), NOT a new callback. The
`@facet/react` published `StageRenderer` props (`onAction` at
`StageRenderer.tsx:51`, `onRecord` at `:53`, `onViewSnapshot` at `:72`) are the
entire consumer contract.

CLASSIFY: keeps `@facet/react` purely additive (behavior-only) ONLY IF no
overlay-specific prop is added. RESOLUTION the spec must enforce: route
overlay-close through the same internal toggle path so `view.toggled` stays
single-sourced (invariant #6, DC-005) and `onAction` is never fired for a close; DO
NOT add an `onOverlayClose`/`isOpen`/overlay prop or callback to `StageRenderer` —
that would be an unnecessary public-surface expansion and would fork open-state out
of `view.toggled`.

### RISK-API-4 (API) — brief asserts a @facet/assets surface that does not exist

The brief's Public API table (`specs/feature-intake/overlay.md:164`) claims
`@facet/assets (catalog): overlay advertised as a box capability if the catalog
enumerates box modes — Additive (confirm in spec)`. GREP DISPROVES the premise:
`DEFAULT_CATALOG` enumerates node TYPES with prose guidance only
(`packages/core/core/src/catalog-defaults.ts:76`
`{ type: "box", guidance: "Primitive fallback for custom flow layout." }`), never
per-field box modes; the precedent field `backdrop` has zero catalog entry.

CLASSIFY: no `@facet/assets` change is required (NO-OP). RESOLUTION: the spec must
drop the `@facet/assets` row (or explicitly mark it NO-CHANGE) so implementation
does not invent a new catalog capability surface; overlay is taught to the model via
STAGE_SPEC (DC-007) and validated by `validateBox`, not advertised in the catalog.

### RISK-API-5 (API) — extensibility of the closed union (additive export opportunity, not a break)

The brief inlines `overlay?: { kind: "modal" | "drawer" }` with no named export,
whereas the established convention for closed-EXTENSIBLE unions in the same file
exports a const tuple + derived type (`packages/core/core/src/nodes.ts:296`
`FIELD_INPUTS`/`FieldInput`, `:329` `MARK_KINDS`/`MarkKind`, `:320` `BLOCK_TYPES`).
The decision-lock keeps `kind` a closed-extensible union so `"popover"` + optional
`anchor?` can be added later.

CLASSIFY: additive either way; a new `OVERLAY_KINDS`/`OverlayKind` barrel export
(via `nodes.js`) is a pure addition, no consumer migration. RESOLUTION: spec should
export `OVERLAY_KINDS = ["modal","drawer"] as const` + `type OverlayKind` and have
`validateBox` derive its check from it (single source, mirrors
`FIELD_INPUTS`→validator), so the deferred popover/anchor add is a non-breaking
reshape — matching the maintainer's standing "always design for extensibility"
instruction.

### RISK-PKG-1 (PKG) — coupling-claim inaccuracy in the brief's Public API table

`specs/feature-intake/overlay.md:164` lists an additive catalog change on
`@facet/assets`, but `packages/core/assets/src/catalog.ts:1` is a pure re-export
(`export { DEFAULT_CATALOG } from "@facet/core"`) and holds no catalog data of its
own; the actual box catalog entry (`packages/core/core/src/catalog-defaults.ts:76`)
carries only `type`+`guidance` and does NOT enumerate per-capability box modes
today.

Resolution the spec must implement: remove the `@facet/assets` change from the
Public API/surface table (assets needs zero change); if the catalog is to advertise
the `overlay` capability at all, that enumeration is core-owned and must be added in
`packages/core/core/src/catalog-defaults.ts` (source of `DEFAULT_CATALOG`), keeping
`@facet/assets` a passthrough. No new cross-package import edge is created by this —
it removes a claimed edge.
