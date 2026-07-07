import { describe, expect, it } from "vitest";
import {
  MANY_CHANGE_THRESHOLD,
  MOTION_CLASS_NAMES,
  MOTION_CSS,
  MOTION_ENTER_MS,
  MOTION_EXIT_MS,
  STAGE_CROSSFADE_MS,
  composeMotionClassName,
  stageCurrentClassName,
  stageFrameClassName,
  stagePreviousClassName,
  withBrickEnterClass,
  withBrickExitClass,
} from "./motion.js";

describe("MOTION_CSS", () => {
  it("defines scoped motion css with reduced motion", () => {
    expect(MANY_CHANGE_THRESHOLD).toBe(8);
    expect(MOTION_ENTER_MS).toBeGreaterThan(0);
    expect(MOTION_EXIT_MS).toBeGreaterThan(0);
    expect(STAGE_CROSSFADE_MS).toBeGreaterThan(0);

    expect(MOTION_CLASS_NAMES).toEqual({
      brickEnter: "facet-motion-brick-enter",
      brickExit: "facet-motion-brick-exit",
      stageFrame: "facet-motion-stage-frame",
      stageCrossfade: "facet-motion-stage-crossfade",
      stageCurrent: "facet-motion-stage-current",
      stagePrevious: "facet-motion-stage-previous",
    });

    expect(typeof MOTION_CSS).toBe("string");
    expect(MOTION_CSS).not.toMatch(/\$\{|attr\(|data-facet-|url\(|var\(/);

    for (const className of Object.values(MOTION_CLASS_NAMES)) {
      expect(MOTION_CSS).toContain(`.${className}`);
    }
    expect(MOTION_CSS).toContain("@keyframes facet-motion-brick-enter");
    expect(MOTION_CSS).toContain("@keyframes facet-motion-brick-exit");
    expect(MOTION_CSS).toContain("@keyframes facet-motion-stage-current");
    expect(MOTION_CSS).toContain("@keyframes facet-motion-stage-previous");
    expect(MOTION_CSS).toContain(`${MOTION_ENTER_MS}ms`);
    expect(MOTION_CSS).toContain(`${MOTION_EXIT_MS}ms`);
    expect(MOTION_CSS).toContain(`${STAGE_CROSSFADE_MS}ms`);
    expect(MOTION_CSS).not.toContain("position: absolute");

    const mediaIndex = MOTION_CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(mediaIndex).toBeGreaterThanOrEqual(0);
    const mediaBlock = MOTION_CSS.slice(mediaIndex);
    expect(mediaBlock).toContain("animation: none");
    expect(mediaBlock).toContain("transition: none");
    expect(mediaBlock).toContain("transform: none");
    expect(mediaBlock).toContain("opacity: 0");

    const allowedSelectors = new Set(
      Object.values(MOTION_CLASS_NAMES).map((className) => `.${className}`),
    );
    const selectors = mediaBlock.match(/\.[a-zA-Z-]+/g) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(allowedSelectors.has(selector)).toBe(true);
    }
  });

  it("composes motion class names predictably", () => {
    expect(
      composeMotionClassName(
        "facet-appear-fade",
        undefined,
        "",
        false,
        "facet-appear-fade",
        MOTION_CLASS_NAMES.brickEnter,
      ),
    ).toBe("facet-appear-fade facet-motion-brick-enter");
    expect(composeMotionClassName(undefined, false, "", null)).toBeUndefined();

    expect(withBrickEnterClass("facet-appear-slide")).toBe(
      "facet-appear-slide facet-motion-brick-enter",
    );
    expect(withBrickExitClass()).toBe("facet-motion-brick-exit");
    expect(stageFrameClassName(false)).toBe("facet-motion-stage-frame");
    expect(stageFrameClassName(true)).toBe("facet-motion-stage-frame facet-motion-stage-crossfade");
    expect(stageCurrentClassName()).toBe("facet-motion-stage-current");
    expect(stagePreviousClassName()).toBe("facet-motion-stage-previous");
  });
});
