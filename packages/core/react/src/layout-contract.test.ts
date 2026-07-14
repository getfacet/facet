import { describe, expect, it } from "vitest";
import {
  OVERLAY_FRAME_Z,
  OVERLAY_SCRIM_Z,
  drawerFrameStyle,
  modalFrameStyle,
  overlayScrimStyle,
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
