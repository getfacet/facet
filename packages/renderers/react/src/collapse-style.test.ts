import { describe, expect, it } from "vitest";
import {
  COLLAPSE_CLASS,
  COLLAPSE_CSS,
  COLLAPSE_ITEM_CLASS,
  collapseClass,
  collapseItemClass,
} from "./collapse-style.js";
import { NARROW_BREAKPOINT_PX } from "./layout-contract.js";

// WU-5 (box-layout-foundation): the CSS-only collapse concern. jsdom applies a
// `@media` block to getComputedStyle only when its media list literally contains
// `screen`, so a `(max-width: 639px)` block is never applied here — these tests
// pin the CSS CONSTANT TEXT (mirroring motion.test.ts:53-60) and the CLASS GATE,
// NOT the narrow reflow. The stacked outcome is proven only by WU-12's real
// 390x844 viewport journey; do not read a rendered layout claim into this file.

describe("collapse marker classes", () => {
  it("uses the exact framework literals (WU-12's Lab journey hardcodes them)", () => {
    // The constants are package-private (never barrel-exported), so this literal
    // assertion is the only thing preventing drift from the Lab selector string.
    expect(COLLAPSE_CLASS).toBe("facet-collapse");
    expect(COLLAPSE_ITEM_CLASS).toBe("facet-collapse-item");
  });
});

describe("COLLAPSE_CSS (R8 two-rule media block)", () => {
  it("effects flex-direction:column!important (overrides the inline row)", () => {
    // Not merely present — `!important` is load-bearing so the media rule beats
    // the inline flexDirection:row emitted by boxStyle.
    expect(COLLAPSE_CSS).toContain("flex-direction:column!important");
    expect(COLLAPSE_CSS).toContain(`.${COLLAPSE_CLASS}{flex-direction:column!important}`);
  });

  it("derives its breakpoint from NARROW_BREAKPOINT_PX (single source, R9)", () => {
    expect(COLLAPSE_CSS).toContain(`@media (max-width: ${String(NARROW_BREAKPOINT_PX - 1)}px)`);
    // Concretely 640 -> 639 today; guards an accidental off-by-one drift.
    expect(COLLAPSE_CSS).toContain("(max-width: 639px)");
  });

  it("scopes the child reset to the marker child selector only", () => {
    // Literally `.facet-collapse > .facet-collapse-item` — bounded by a marker
    // emitted only where this feature put it.
    expect(COLLAPSE_CSS).toContain(
      `.${COLLAPSE_CLASS} > .${COLLAPSE_ITEM_CLASS}{flex-basis:auto!important;flex-shrink:1!important}`,
    );
  });

  it("has a closed child declaration list — flex-basis + flex-shrink ONLY", () => {
    // Extract the child rule's declaration block and assert it is exactly the two
    // flex-item main-axis properties this feature emits, never width/max-width/
    // spacing/color/paint. (R8 bound a.)
    const childSelector = `.${COLLAPSE_CLASS} > .${COLLAPSE_ITEM_CLASS}{`;
    const start = COLLAPSE_CSS.indexOf(childSelector);
    expect(start).toBeGreaterThanOrEqual(0);
    const declStart = start + childSelector.length;
    const declEnd = COLLAPSE_CSS.indexOf("}", declStart);
    const decls = COLLAPSE_CSS.slice(declStart, declEnd);
    expect(decls).toBe("flex-basis:auto!important;flex-shrink:1!important");
    for (const forbidden of ["width", "max-width", "padding", "margin", "color", "background"]) {
      expect(decls).not.toContain(forbidden);
    }
  });

  it("uses NO universal selector (R8 bound b — would strip renderer-owned flex-shrink:0)", () => {
    // A universal `> *` (or bare `*`) would reach icon media roots
    // (renderer-media.tsx:84) and indicator dots (brick-style-data.ts:187), which
    // are real direct DOM children of a collapse row because children render
    // through element-less Fragments (renderer-render.tsx:252-270).
    expect(COLLAPSE_CSS).not.toContain("> *");
    expect(COLLAPSE_CSS).not.toMatch(/\*/);
  });

  it("emits NO position / z-index / inset (DC-008 — flow-only)", () => {
    expect(COLLAPSE_CSS).not.toMatch(/position/i);
    expect(COLLAPSE_CSS).not.toMatch(/z-index/i);
    expect(COLLAPSE_CSS).not.toMatch(/inset/i);
  });

  it("contains exactly the two rules and no others", () => {
    // Count the declaration blocks inside the media block: parent + child = 2.
    const openBraces = COLLAPSE_CSS.match(/\{/g) ?? [];
    // media `{` + parent rule `{` + child rule `{` = 3 total.
    expect(openBraces).toHaveLength(3);
  });
});

describe("collapseClass (R7 gate — fail-safe totality)", () => {
  it("returns the class ONLY for a non-grid direction:row box with collapse:stack", () => {
    expect(collapseClass({ collapse: "stack", direction: "row" })).toBe(COLLAPSE_CLASS);
    // columns:"none" is not a grid.
    expect(collapseClass({ collapse: "stack", direction: "row", columns: "none" })).toBe(
      COLLAPSE_CLASS,
    );
  });

  it("R9 conflict precedence: direction:row + collapse:stack still gets the class", () => {
    // Below the breakpoint collapse wins over the authored row by design.
    expect(collapseClass({ collapse: "stack", direction: "row", columns: undefined })).toBe(
      COLLAPSE_CLASS,
    );
  });

  it("returns undefined for a column box, a grid, no/absent collapse, and junk", () => {
    expect(collapseClass({ collapse: "stack", direction: "column" })).toBeUndefined();
    // A grid (2|3|4|"auto") never collapses via this class.
    expect(collapseClass({ collapse: "stack", direction: "row", columns: 2 })).toBeUndefined();
    expect(collapseClass({ collapse: "stack", direction: "row", columns: 3 })).toBeUndefined();
    expect(collapseClass({ collapse: "stack", direction: "row", columns: 4 })).toBeUndefined();
    expect(collapseClass({ collapse: "stack", direction: "row", columns: "auto" })).toBeUndefined();
    expect(collapseClass({ collapse: "none", direction: "row" })).toBeUndefined();
    expect(collapseClass({ direction: "row" })).toBeUndefined();
    expect(collapseClass({ collapse: "stack" })).toBeUndefined();
    // Raw/junk live-path inputs never throw and never yield a class.
    expect(collapseClass(null)).toBeUndefined();
    expect(collapseClass(undefined)).toBeUndefined();
    expect(collapseClass("stack")).toBeUndefined();
    expect(collapseClass(42)).toBeUndefined();
    expect(collapseClass({})).toBeUndefined();
    expect(collapseClass({ collapse: "maybe", direction: "row" })).toBeUndefined();
  });
});

describe("collapseItemClass (R8b gate — fail-safe totality)", () => {
  it("returns the class ONLY when the resolved style carries basis", () => {
    expect(collapseItemClass({ basis: "sm" })).toBe(COLLAPSE_ITEM_CLASS);
    expect(collapseItemClass({ basis: "xs" })).toBe(COLLAPSE_ITEM_CLASS);
  });

  it("returns undefined for a basis-less style and junk", () => {
    expect(collapseItemClass({})).toBeUndefined();
    expect(collapseItemClass({ basis: undefined })).toBeUndefined();
    expect(collapseItemClass(null)).toBeUndefined();
    expect(collapseItemClass(undefined)).toBeUndefined();
    expect(collapseItemClass("sm")).toBeUndefined();
    expect(collapseItemClass(42)).toBeUndefined();
    expect(collapseItemClass([])).toBeUndefined();
  });
});
