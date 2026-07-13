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
// A `backdrop` yields renderer-synthesized BACKGROUND layers behind the box's
// normal-flow children. `position:absolute` is confined to these renderer-owned
// layers (`backdropLayerStyle` media + `scrimStyle` tint) — it is NEVER emitted
// onto an authored flow child, and no author z-index/offset exists (RISK-INV-1 /
// DC-004). Stacking (fixes the "layer paints over content" bug): the host is its
// own stacking context (`isolation:isolate`) and the layers carry NEGATIVE
// z-index (media below scrim below content), so per CSS paint order the flow
// children always paint ABOVE the backdrop while the scrim tints the media for
// legibility. `sticky` is `position:sticky` with a FRAMEWORK-owned top constant,
// so it stays in normal flow with no author-settable offset.
//
// NOTE: stacking order is a real-browser property that string SSR tests cannot
// verify — the z-index values below are asserted by unit tests but the visible
// result must be confirmed by the live-journey (real-browser) tier.

/** Framework-owned sticky offset. Agents never author a sticky offset. */
export const STICKY_TOP = "0px";

/** z-index of the two backdrop layers: both NEGATIVE so in-flow content paints
 * above them; the media sits below the scrim. */
const BACKDROP_MEDIA_Z = -2;
const BACKDROP_SCRIM_Z = -1;

/**
 * The host of a backdrop: `position:relative` so the absolute layers are
 * contained, and `isolation:isolate` so it forms its own stacking context — the
 * negative-z backdrop layers then paint above the host's own background but
 * BELOW its in-flow children (never leaking behind ancestor content).
 */
export function backdropHostStyle(style: CSSProperties = {}): CSSProperties {
  return { ...style, position: "relative", isolation: "isolate" };
}

/**
 * A synthesized backdrop cover layer (inset-0, object-fit cover) at a NEGATIVE
 * z-index so it paints behind the box's flow children. `position:absolute` here
 * is on a renderer-owned media layer, never on an authored flow child.
 */
export function backdropLayerStyle(): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    zIndex: BACKDROP_MEDIA_Z,
  };
}

/**
 * The readability scrim: an absolutely-positioned tint layer that fills the host
 * and sits ABOVE the media layer but BELOW the flow children (negative z between
 * the two). It must be `position:absolute` for `inset:0` to fill the host —
 * without it the tint collapsed to a 0-height in-flow block and did nothing.
 */
export function scrimStyle(scrim: string): CSSProperties {
  return { position: "absolute", inset: 0, background: scrim, zIndex: BACKDROP_SCRIM_Z };
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
