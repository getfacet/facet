import { describe, expect, it } from "vitest";
import { APPEARS } from "@facet/core";
import { APPEAR_CSS, appearClass } from "./appear.js";

// APPEAR_CSS is the ONE place appear animation CSS lives (framework-owned,
// invariant #4): a static string — no theme-document or tree data is ever
// interpolated into it — so the token→class mapping adds zero injection
// surface. The reduced-motion gate must target exactly the appear classes so
// an OS-level "reduce motion" preference suppresses the enter animation
// without touching any other style on the page (DC-008).
describe("APPEAR_CSS", () => {
  it("appear css defines enter keyframes gated by prefers-reduced-motion", () => {
    // A static string constant — nothing dynamic to interpolate.
    expect(typeof APPEAR_CSS).toBe("string");

    // Both enter animations exist as keyframes + a stable class each.
    expect(APPEAR_CSS).toContain("@keyframes facet-appear-fade");
    expect(APPEAR_CSS).toContain("@keyframes facet-appear-slide");
    expect(APPEAR_CSS).toContain(".facet-appear-fade");
    expect(APPEAR_CSS).toContain(".facet-appear-slide");

    // Fade: 160ms ease-out, opacity-only. Slide: 200ms ease-out, sub-gap
    // translateY(6px) combined with opacity (RISK-INV-6b: offset stays below
    // the smallest real gap and opacity-led, so a mid-animation paint never
    // reads as an overlay).
    expect(APPEAR_CSS).toMatch(/facet-appear-fade[^}]*160ms\s+ease-out/);
    expect(APPEAR_CSS).toMatch(/facet-appear-slide[^}]*200ms\s+ease-out/);
    expect(APPEAR_CSS).toContain("translateY(6px)");
    expect(APPEAR_CSS).not.toContain("translateX");

    // The reduced-motion gate is present…
    const mediaIndex = APPEAR_CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(mediaIndex).toBeGreaterThanOrEqual(0);
    // …and scoped to exactly the appear classes: every selector inside the
    // media block is one of the two appear classes, and it disables the
    // animation rather than hiding content.
    const mediaBlock = APPEAR_CSS.slice(mediaIndex);
    expect(mediaBlock).toContain("animation: none");
    const selectors = mediaBlock.match(/\.[a-zA-Z-]+/g) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect([".facet-appear-fade", ".facet-appear-slide"]).toContain(selector);
    }
  });
});

// appearClass is TOTAL on the raw live path (which bypasses validateTree by
// design): only the exact strings "fade"/"slide" on a real style object yield
// a class; "none", junk tokens, non-objects, and null all resolve to
// undefined — no class, no style element, never a throw (DC-005).
describe("appearClass", () => {
  it('returns the fade class for exact "fade"', () => {
    expect(appearClass({ appear: "fade" })).toBe("facet-appear-fade");
  });

  it('returns the slide class for exact "slide"', () => {
    expect(appearClass({ appear: "slide" })).toBe("facet-appear-slide");
  });

  it('returns undefined for the explicit "none" token', () => {
    expect(appearClass({ appear: "none" })).toBeUndefined();
  });

  it("returns undefined for junk tokens and non-string appear values", () => {
    expect(appearClass({ appear: "explode" })).toBeUndefined();
    expect(appearClass({ appear: 42 })).toBeUndefined();
    expect(appearClass({ appear: null })).toBeUndefined();
    expect(appearClass({ appear: { nested: "fade" } })).toBeUndefined();
  });

  it("returns undefined for a style object with no appear at all", () => {
    expect(appearClass({})).toBeUndefined();
    expect(appearClass({ gap: "md" })).toBeUndefined();
  });

  it("returns undefined for non-object and nullish styles without throwing", () => {
    expect(appearClass(null)).toBeUndefined();
    expect(appearClass(undefined)).toBeUndefined();
    expect(appearClass(42)).toBeUndefined();
    expect(appearClass("fade")).toBeUndefined();
    expect(appearClass([])).toBeUndefined();
  });

  // Drift net derived from core's APPEARS: adding a token to the palette
  // without teaching appearClass/APPEAR_CSS about it must fail HERE, not
  // silently render the new token as a no-op class.
  it("covers every core APPEARS token: class + keyframes for all but 'none'", () => {
    for (const token of APPEARS) {
      if (token === "none") {
        expect(appearClass({ appear: token })).toBeUndefined();
        continue;
      }
      expect(appearClass({ appear: token })).toBe(`facet-appear-${token}`);
      expect(APPEAR_CSS).toContain(`.facet-appear-${token}`);
      expect(APPEAR_CSS).toContain(`@keyframes facet-appear-${token}`);
    }
  });
});
