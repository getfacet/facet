import type { CSSProperties } from "react";

export type RendererScrollAxis = "x" | "y";

const SCROLL_MAX_HEIGHT = "20rem";

export function rootContainmentStyle(style: CSSProperties = {}): CSSProperties {
  return {
    ...style,
    boxSizing: "border-box",
    minWidth: style.minWidth ?? 0,
    maxWidth: style.maxWidth ?? "100%",
    overflowWrap: style.overflowWrap ?? "anywhere",
  };
}

// ── Landing-grade backdrop / scrim / sticky (flow-only overlay discipline) ──
// A `backdrop` yields EXACTLY two renderer-synthesized layers: a `position:
// relative` HOST box (`backdropHostStyle`) and, inside it, a single absolutely-
// positioned cover LAYER (`backdropLayerStyle`). `position:absolute` is
// confined to the layer helper — it is NEVER emitted onto an authored flow
// child, and no author z-index/offset exists (RISK-INV-1 / DC-004). The scrim
// is a pure tint (no position of its own — it composes onto the same absolute
// layer). `sticky` is `position:sticky` with a FRAMEWORK-owned top constant, so
// it stays in normal flow with no author-settable offset.

/** Framework-owned sticky offset. Agents never author a sticky offset. */
export const STICKY_TOP = "0px";

/** The host of a backdrop: relative so the absolute cover layer is contained. */
export function backdropHostStyle(style: CSSProperties = {}): CSSProperties {
  return { ...style, position: "relative" };
}

/**
 * The ONLY place `position:absolute` is introduced: the synthesized backdrop
 * cover layer (inset-0, object-fit cover). Applied to a renderer-owned media
 * layer, never to an authored flow child.
 */
export function backdropLayerStyle(): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  };
}

/**
 * The readability scrim painted over the backdrop layer — a pure tint with NO
 * position of its own; the renderer composes it onto the absolute cover layer,
 * so `position:absolute` stays confined to `backdropLayerStyle`.
 */
export function scrimStyle(scrim: string): CSSProperties {
  return { inset: 0, background: scrim };
}

/** `sticky` → `position:sticky` with the framework-owned top offset (in flow). */
export function stickyStyle(): CSSProperties {
  return { position: "sticky", top: STICKY_TOP };
}

export function scrollContainmentStyle(axis: RendererScrollAxis): CSSProperties {
  return axis === "x"
    ? {
        overflowX: "auto",
        overflowY: "hidden",
        maxWidth: "100%",
        minWidth: 0,
      }
    : {
        overflowY: "auto",
        overflowX: "hidden",
        maxHeight: SCROLL_MAX_HEIGHT,
        minHeight: 0,
        maxWidth: "100%",
        minWidth: 0,
      };
}
