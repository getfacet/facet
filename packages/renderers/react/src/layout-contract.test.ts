import { describe, expect, it } from "vitest";
import {
  NARROW_BREAKPOINT_PX,
  OVERLAY_FRAME_Z,
  OVERLAY_SCRIM_Z,
  STICKY_TOP,
  TABLE_STICKY_HEADER_Z,
  TABLE_STICKY_MAX_HEIGHT,
  drawerFrameStyle,
  isGridColumns,
  modalFrameStyle,
  overlayScrimStyle,
  scrollContainmentStyle,
  tableScrollContainmentStyle,
} from "./layout-contract.js";

// WU-3: renderer-OWNED positive-z placement presets for overlay (DC-002 / DC-004).
// The overlay band mirrors the backdrop discipline but with POSITIVE z: the frame
// floats ABOVE flow content, the scrim sits just below the frame, and the author
// supplies NOTHING — every preset is a nullary framework builder (no author
// top/left/inset/z/position argument exists to leak). Stacking is a real-browser
// fact SSR cannot verify; these unit tests pin the style values only.

describe("overlay band z constants", () => {
  it("uses a positive, shared band with the frame above the scrim", () => {
    expect(OVERLAY_SCRIM_Z).toBeGreaterThan(0);
    expect(OVERLAY_FRAME_Z).toBeGreaterThan(0);
    expect(OVERLAY_FRAME_Z).toBeGreaterThan(OVERLAY_SCRIM_Z);
  });
});

describe("modalFrameStyle", () => {
  // The builder takes NO author argument — DC-004: no author z/inset/position leak.
  it("takes no arguments (framework preset only)", () => {
    expect(modalFrameStyle).toHaveLength(0);
  });

  it("is fixed, screen-centered, at the positive frame z", () => {
    const style = modalFrameStyle();
    expect(style.position).toBe("fixed");
    // centered on the viewport via translate, not an author offset
    expect(style.top).toBe("50%");
    expect(style.left).toBe("50%");
    expect(String(style.transform)).toContain("translate(-50%, -50%)");
    expect(style.zIndex).toBe(OVERLAY_FRAME_Z);
  });

  it("carries no author-controlled right/bottom/inset offset", () => {
    const style = modalFrameStyle();
    expect(style.inset).toBeUndefined();
    expect(style.right).toBeUndefined();
    expect(style.bottom).toBeUndefined();
  });

  it("is bounded to the viewport with an internal scroll region (never clips under scroll-lock)", () => {
    const style = modalFrameStyle();
    expect(style.maxHeight).toBeDefined();
    expect(style.maxWidth).toBeDefined();
    expect(style.overflow).toBe("auto");
  });
});

describe("drawerFrameStyle", () => {
  it("takes no arguments (framework preset only)", () => {
    expect(drawerFrameStyle).toHaveLength(0);
  });

  it("is fixed, pinned to the logical end (right) edge, full height, positive frame z", () => {
    const style = drawerFrameStyle();
    expect(style.position).toBe("fixed");
    expect(style.right).toBe(0);
    expect(style.top).toBe(0);
    expect(style.bottom).toBe(0);
    expect(style.height).toBe("100%");
    expect(style.zIndex).toBe(OVERLAY_FRAME_Z);
  });

  it("does not pin the logical start (left) edge", () => {
    const style = drawerFrameStyle();
    expect(style.left).toBeUndefined();
  });

  it("bounds its width and scrolls its own overflow (never clips under scroll-lock)", () => {
    const style = drawerFrameStyle();
    expect(style.maxWidth).toBeDefined();
    expect(style.overflowY).toBe("auto");
  });
});

describe("overlayScrimStyle", () => {
  it("takes no arguments (framework preset only)", () => {
    expect(overlayScrimStyle).toHaveLength(0);
  });

  it("is a full-viewport fixed tint just below the frame", () => {
    const style = overlayScrimStyle();
    expect(style.position).toBe("fixed");
    expect(style.inset).toBe(0);
    expect(style.background).toBeTruthy();
    expect(style.zIndex).toBe(OVERLAY_SCRIM_Z);
    expect(style.zIndex).toBeLessThan(OVERLAY_FRAME_Z);
  });
});

// ── analytics-data-surface (WU-5): the table's OWN renderer-owned containment.
// The table wrapper always owns bounded horizontal scroll so a wide table scrolls
// inside its own box (never pushing parent/page width), and — only when the
// resolved style pins the header — the SAME wrapper owns a bounded VERTICAL scroll
// region with a framework max-height so the container-relative sticky `<thead>`
// has a scroll ancestor to pin against (RISK-INV-1). ──
describe("tableScrollContainmentStyle (analytics-data-surface)", () => {
  it("always owns bounded horizontal scroll and never pushes parent width", () => {
    const style = tableScrollContainmentStyle(false);
    expect(style.overflowX).toBe("auto");
    expect(style.maxWidth).toBe("100%");
    expect(style.minWidth).toBe(0);
    // No vertical bounding without a sticky header — today's flow height.
    expect(style.overflowY).toBeUndefined();
    expect(style.maxHeight).toBeUndefined();
  });

  it("adds a framework-owned bounded vertical scroll region for a sticky header", () => {
    const style = tableScrollContainmentStyle(true);
    expect(style.overflowX).toBe("auto");
    expect(style.overflowY).toBe("auto");
    expect(style.maxHeight).toBe(TABLE_STICKY_MAX_HEIGHT);
    expect(style.minHeight).toBe(0);
    expect(style.maxWidth).toBe("100%");
  });

  it("is NOT the box scroll helper (which hides the cross axis and would block sticky)", () => {
    // `scrollContainmentStyle("x")` sets overflow-y:hidden, so it could never host a
    // sticky header's vertical scroll — the table wrapper must not reuse it verbatim.
    expect(scrollContainmentStyle("x").overflowY).toBe("hidden");
    expect(tableScrollContainmentStyle(false).overflowY).not.toBe("hidden");
  });
});

describe("table sticky header constants (analytics-data-surface)", () => {
  it("pins container-relative with the framework top and a confined LOCAL positive band", () => {
    // Same framework top as box `sticky`, but the table header pins against the
    // table's OWN scroll region (container-relative), not the viewport.
    expect(STICKY_TOP).toBe("0px");
    expect(TABLE_STICKY_HEADER_Z).toBeGreaterThan(0);
    // A small local band, far below the overlay band — never a global z-index war.
    expect(TABLE_STICKY_HEADER_Z).toBeLessThan(OVERLAY_SCRIM_Z);
  });

  it("uses a framework max-height the author never supplies", () => {
    expect(typeof TABLE_STICKY_MAX_HEIGHT).toBe("string");
    expect(TABLE_STICKY_MAX_HEIGHT).toMatch(/(rem|px|vh)$/);
  });
});

// ── box-layout-foundation (WU-5): the framework-owned layout primitives. ──
describe("NARROW_BREAKPOINT_PX (R9 single source)", () => {
  it("is the framework 640px narrow breakpoint", () => {
    // The single source both the report-only viewport classifier (view-snapshot.ts)
    // and the CSS-only collapse reflow (collapse-style.ts) derive from — so they
    // can never disagree. A plain number, never a style domain or authorable scalar.
    expect(NARROW_BREAKPOINT_PX).toBe(640);
    expect(typeof NARROW_BREAKPOINT_PX).toBe("number");
  });
});

describe("isGridColumns (R3 grid membership)", () => {
  it('is true for every grid column value: 2 | 3 | 4 | "auto"', () => {
    expect(isGridColumns(2)).toBe(true);
    expect(isGridColumns(3)).toBe(true);
    expect(isGridColumns(4)).toBe(true);
    expect(isGridColumns("auto")).toBe(true);
  });

  it('is false for "none", undefined, and junk (never a grid)', () => {
    expect(isGridColumns("none")).toBe(false);
    expect(isGridColumns(undefined)).toBe(false);
    expect(isGridColumns(null)).toBe(false);
    expect(isGridColumns(1)).toBe(false);
    expect(isGridColumns(5)).toBe(false);
    expect(isGridColumns("2")).toBe(false);
    expect(isGridColumns("grid")).toBe(false);
    expect(isGridColumns({})).toBe(false);
  });
});
