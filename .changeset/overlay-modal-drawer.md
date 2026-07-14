---
"@facet/core": minor
"@facet/react": minor
---

Add `overlay` — the one sanctioned way a `box` floats ABOVE flow content, as a
bounded modal or drawer. This is flow-only's single deliberate exception, done as
a constrained renderer-owned descriptor (never a z-index/absolute escape hatch).

- **Shape (closed, extensible):** a new `overlay?: { kind: "modal" | "drawer" }`
  field on `box` (part of the `Layered` concern pack, alongside `backdrop`). The
  author supplies ONLY the closed `kind` name — never coordinates, size, or
  z-index. `@facet/core` exports `OVERLAY_KINDS` / `OverlayKind` / `Overlay`.
  (`popover` + an anchored variant are deferred, addable additively.)

- **Renderer-owned (`@facet/react`):** a visible overlay box floats in a
  renderer-fixed positive-z band — `modal` centered, `drawer` at the end edge —
  over a full-viewport scrim, with a bounded internal scroll region so tall
  content is never clipped under the body scroll-lock. The renderer owns
  placement, scrim, z, focus, Esc, and scrim-click; a stack of overlays closes
  one-at-a-time (topmost first).

- **Open/close reuses the existing local `toggle`:** start the box `hidden`, wire
  a trigger `onPress: { kind: "toggle", target: <box id> }`. Esc / scrim / a
  close button all hide the box via the same `view.toggled` entry (idempotent —
  double-close never reopens), so the agent's view snapshot stays coherent and no
  close is an agent turn.

- **Fail-safe:** an unknown/malformed `overlay` (`{kind:"lightbox"}`, `{}`,
  non-object, extra keys) is dropped in validation and renders as a normal inline
  box; the renderer never throws.

STAGE_SPEC teaches `overlay` so agents can author it. Additive — existing trees
are byte-identical.
