import type { CSSProperties } from "react";

export type RendererScrollAxis = "x" | "y";

const SCROLL_MAX_HEIGHT = "20rem";

export function rootContainmentStyle(style: CSSProperties = {}): CSSProperties {
  return {
    ...style,
    boxSizing: "border-box",
    minWidth: style.minWidth ?? 0,
    maxWidth: style.maxWidth ?? "100%",
    overflowWrap: style.overflowWrap ?? "break-word",
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
// The `overlay` band (modal / drawer, below) is the ONE sanctioned POSITIVE-z
// exception: a valid overlay floats a rendered box ABOVE flow content over a
// scrim. It stays renderer-OWNED in the exact same way as the backdrop band —
// `position:fixed`, the placement, the scrim tint, and the z values are all
// FRAMEWORK constants selected purely by `kind`; the author supplies NO
// z/inset/coordinate/position (DC-002 / DC-004). Positive z (frame above scrim,
// both above flow) is the deliberate inverse of the backdrop's negative band.
//
// NOTE: stacking order is a real-browser property that string SSR tests cannot
// verify — the z-index values below (negative backdrop band AND positive overlay
// band) are asserted by unit tests but the visible result must be confirmed by
// the live-journey (real-browser) tier.

/** Framework-owned sticky offset. Agents never author a sticky offset. */
export const STICKY_TOP = "0px";

// ── Table containment: container-relative vs viewport-relative stickiness ──
// A box `sticky` (stickyStyle above) is `position:sticky; top:STICKY_TOP` pinning
// against the VIEWPORT (nearest scroll ancestor) — viewport-relative flow. A
// table's sticky header instead pins against the table's OWN renderer-owned
// bounded scroll region (`tableScrollContainmentStyle` below), so it is
// CONTAINER-relative: the header stays put while the wrapper's own rows scroll
// under it, and it never escapes the table's box. The wrapper ALWAYS owns
// horizontal scroll so a wide table scrolls inside its own bounds and never
// pushes parent/page width (DC-006) — with OR without a parent scroll box. Only
// when the resolved style pins the header does the SAME wrapper additionally own
// a bounded VERTICAL scroll region (TABLE_STICKY_MAX_HEIGHT), giving the sticky
// `<thead>` a scroll ancestor to pin against; without it there is NO vertical
// bounding (byte-identical to today's flow height). SSR string tests cannot prove
// the pinning — the visible result is confirmed by the live-journey tier
// (RISK-INV-1). All offsets/heights/z here are framework constants; the author
// supplies no z/inset/coordinate/height.

/** Framework-owned max-height of a table that pins its header. A sticky header
 * needs a bounded scroll ancestor, so pinning turns the wrapper into a vertical
 * scroll region capped at this height. Never authored (RISK-INV-1 / DC-004). */
export const TABLE_STICKY_MAX_HEIGHT = "28rem";

/** z-index of a sticky `<thead>` cell, confined to a small LOCAL band INSIDE the
 * table's own scroll region: positive so header cells paint above scrolled body
 * rows, but far below the overlay band — never a runaway global z-index war. */
export const TABLE_STICKY_HEADER_Z = 1;

/**
 * The table's renderer-owned containment wrapper. Always `overflow-x:auto` +
 * bounded width, so a wide table scrolls inside its own box. It is deliberately
 * NOT `scrollContainmentStyle("x")` (that helper sets `overflow-y:hidden`, which
 * would forbid the sticky header its vertical scroll region — RISK-INV-1). When
 * `stickyHeader` is set the same wrapper additionally owns a bounded vertical
 * scroll region; otherwise it leaves the vertical axis in normal flow.
 */
export function tableScrollContainmentStyle(stickyHeader: boolean): CSSProperties {
  const base: CSSProperties = {
    overflowX: "auto",
    maxWidth: "100%",
    minWidth: 0,
  };
  if (!stickyHeader) return base;
  return {
    ...base,
    overflowY: "auto",
    maxHeight: TABLE_STICKY_MAX_HEIGHT,
    minHeight: 0,
  };
}

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

// ── Overlay band (modal / drawer): the sanctioned POSITIVE-z exception ──
// Mirrors the backdrop band but inverts the sign: the scrim floats ABOVE flow
// content and the frame floats ABOVE the scrim. Both z values are FRAMEWORK
// constants shared across the presets — never author-settable (DC-004). Kept in
// a bounded high band so the overlay clears ordinary page content without a
// runaway z-index war.

/** z-index of the overlay scrim tint: positive so it floats above flow content,
 * but below the frame. */
export const OVERLAY_SCRIM_Z = 100;
/** z-index of the overlay frame: positive and ABOVE the scrim, so the floated
 * box paints over the tint and the underlying page. */
export const OVERLAY_FRAME_Z = 101;

/** Framework-owned overlay scrim tint. The author never authors this — the
 * modal/drawer dimming is a renderer decision, like the backdrop scrim. */
const OVERLAY_SCRIM = "rgba(0, 0, 0, 0.5)";

/** Framework-owned viewport bounds for a floated overlay frame. The frame scrolls
 * its OWN content past these (the body is scroll-locked while open), so nothing is
 * ever clipped out of reach. Not author-settable (DC-004). */
const OVERLAY_MAX_HEIGHT = "90vh";
const OVERLAY_MAX_WIDTH = "90vw";

/**
 * `overlay:{kind:"modal"}` → a `position:fixed`, screen-centered frame at the
 * positive frame z. Centering is done with a framework translate, not an author
 * offset; no author top/left/inset/z/position exists to leak (DC-002 / DC-004).
 */
export function modalFrameStyle(): CSSProperties {
  return {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: OVERLAY_FRAME_Z,
    // Bounded to the viewport with an internal scroll region: while open the body
    // is scroll-locked, so a modal taller/wider than the screen must scroll its
    // OWN content (never clip it out of reach). Framework constants — no author
    // dimension input (DC-004).
    maxHeight: OVERLAY_MAX_HEIGHT,
    maxWidth: OVERLAY_MAX_WIDTH,
    overflow: "auto",
  };
}

/**
 * `overlay:{kind:"drawer"}` → a `position:fixed` panel pinned to the logical END
 * (right) edge, full viewport height, at the positive frame z. The start (left)
 * edge is intentionally left free so the drawer hugs the end edge. All values
 * are framework constants — no author placement input (DC-002 / DC-004).
 */
export function drawerFrameStyle(): CSSProperties {
  return {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    height: "100%",
    zIndex: OVERLAY_FRAME_Z,
    // Bounded width + internal vertical scroll: a drawer taller than the viewport
    // scrolls its OWN content (the body is scroll-locked while open), and it never
    // exceeds the viewport width. Framework constants — no author input (DC-004).
    maxWidth: OVERLAY_MAX_WIDTH,
    overflowY: "auto",
  };
}

/**
 * The overlay scrim: a `position:fixed`, full-viewport (`inset:0`) tint that
 * fills the screen behind the frame at the positive scrim z (just below the
 * frame). Framework-owned tint and z — the author supplies nothing (DC-004).
 */
export function overlayScrimStyle(): CSSProperties {
  return { position: "fixed", inset: 0, background: OVERLAY_SCRIM, zIndex: OVERLAY_SCRIM_Z };
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
