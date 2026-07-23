import type { BoxStyle, FacetTheme } from "@facet/core";
import type { CSSProperties } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";
import { boxStyle, resolveTheme } from "./theme.js";
import { resolveBrickStyle } from "./style-resolver.js";
import { TABLE_STICKY_MAX_HEIGHT, tableScrollContainmentStyle } from "./layout-contract.js";

const NON_PAINT_GROUPS = [
  "space",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "radius",
  "borderWidth",
  "aspectRatio",
  "minHeight",
  "maxWidth",
  "layoutWidth",
  "maxHeight",
  "letterSpacing",
  "lineHeight",
  "controlHeight",
  "indicatorSize",
  "progressThickness",
  "chartThickness",
] as const;

const PAINT_GROUPS = ["color", "shadow", "gradient", "scrim", "highlight"] as const;

function customTheme(): FacetTheme {
  return {
    ...DEFAULT_THEME,
    name: "custom",
    tokens: {
      ...DEFAULT_THEME.tokens,
      space: { ...DEFAULT_THEME.tokens.space, md: "3rem" },
      paint: {
        light: {
          ...DEFAULT_THEME.tokens.paint.light,
          color: { ...DEFAULT_THEME.tokens.paint.light.color, accent: "#123456" },
        },
        dark: {
          ...DEFAULT_THEME.tokens.paint.dark,
          color: { ...DEFAULT_THEME.tokens.paint.dark.color, accent: "#abcdef" },
        },
      },
    },
  };
}

describe("resolveTheme", () => {
  it("resolves every complete Theme token group", () => {
    const resolved = resolveTheme(DEFAULT_THEME);

    expect(resolved.name).toBe("default");
    for (const group of NON_PAINT_GROUPS) {
      expect(resolved[group]).toEqual(DEFAULT_THEME.tokens[group]);
      expect(Object.getPrototypeOf(resolved[group])).toBeNull();
    }
    for (const group of PAINT_GROUPS) {
      expect(resolved[group]).toEqual(DEFAULT_THEME.tokens.paint.light[group]);
      expect(Object.getPrototypeOf(resolved[group])).toBeNull();
    }
    expect(resolved.defaults).toEqual(DEFAULT_THEME.defaults);
    expect(resolved.presets).toEqual(DEFAULT_THEME.presets);
  });

  it("uses a valid custom Theme whole rather than overlaying a partial document", () => {
    const theme = customTheme();
    const resolved = resolveTheme(theme);

    expect(resolved.name).toBe("custom");
    expect(resolved.space.md).toBe("3rem");
    expect(resolved.color.accent).toBe("#123456");
  });

  it("changes paint only between light and dark modes", () => {
    const theme = customTheme();
    const light = resolveTheme(theme, "light");
    const dark = resolveTheme(theme, "dark");

    expect(light.colorMode).toBe("light");
    expect(dark.colorMode).toBe("dark");
    for (const group of NON_PAINT_GROUPS) expect(dark[group]).toEqual(light[group]);
    expect(dark.defaults).toEqual(light.defaults);
    expect(dark.presets).toEqual(light.presets);
    expect(light.color.accent).toBe("#123456");
    expect(dark.color.accent).toBe("#abcdef");
    expect(dark.color).not.toEqual(light.color);
  });

  it("falls back as a whole for incomplete, hostile, or unknown mode input", () => {
    const fallback = resolveTheme();
    const incomplete = resolveTheme({
      name: "partial",
      tokens: { space: { md: "4rem" } },
    });
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const hostile = resolveTheme(proxy, "dark");
    const unknownMode = resolveTheme(DEFAULT_THEME, "sepia");

    expect(incomplete).toEqual(fallback);
    expect(hostile).toEqual(resolveTheme(DEFAULT_THEME, "dark"));
    expect(unknownMode.colorMode).toBe("light");
    expect(unknownMode.color).toEqual(DEFAULT_THEME.tokens.paint.light.color);
    expect((fallback.color as Record<string, unknown>)["constructor"]).toBeUndefined();
    expect((fallback.space as Record<string, unknown>)["__proto__"]).toBeUndefined();
  });
});

// The renderer's private vertical-scroll cap (SCROLL_MAX_HEIGHT in
// layout-contract.ts, not exported). Pinned as a literal here so the DC-006
// parity and R1 "no clobber" checks are falsifiable.
const RENDERER_SCROLL_CAP = "20rem";

const markupOf = (style: CSSProperties): string =>
  renderToStaticMarkup(createElement("div", { style }));

const assertNoOverlayEmission = (css: CSSProperties): void => {
  const markup = markupOf(css);
  expect(markup).not.toContain("position:");
  expect(markup).not.toContain("z-index:");
  expect(markup).not.toContain("inset:");
};

describe("boxStyle box layout translation", () => {
  const theme = resolveTheme(DEFAULT_THEME);

  // ── R5: basis × grow ──
  it("emits flexBasis + flexShrink:0 for basis and NEVER flexGrow (R5/DC-001)", () => {
    const css = boxStyle({ basis: "sm" }, theme);
    expect(css.flexBasis).toBe(theme.layoutWidth.sm);
    expect(css.flexShrink).toBe(0);
    expect(css.flexGrow).toBeUndefined();
  });

  it("keeps flexGrow:1 sole-owned by grow when basis and grow coexist (R5)", () => {
    const css = boxStyle({ basis: "sm", grow: true }, theme);
    expect(css.flexBasis).toBe(theme.layoutWidth.sm);
    expect(css.flexShrink).toBe(0);
    expect(css.flexGrow).toBe(1);
  });

  // ── R2: maxHeight containment ──
  it("applies an authored maxHeight AFTER scroll containment, beating the 20rem cap (R2/DC-002)", () => {
    const css = boxStyle({ scroll: "vertical", maxHeight: "screen" }, theme);
    expect(css.maxHeight).toBe(theme.maxHeight.screen);
    expect(css.maxHeight).not.toBe(RENDERER_SCROLL_CAP);
    expect(css.overflowY).toBe("auto");
    expect(css.minHeight).toBe(0);
    assertNoOverlayEmission(css);
  });

  it("brings its own containment when maxHeight is set on a box with no scroll (R2)", () => {
    const css = boxStyle({ maxHeight: "half" }, theme);
    expect(css.maxHeight).toBe(theme.maxHeight.half);
    expect(css.overflowY).toBe("auto");
    expect(css.minHeight).toBe(0);
    assertNoOverlayEmission(css);
  });

  it("keeps overflowY:hidden AND the cap for scroll:horizontal + maxHeight (accepted vertical-clip boundary, R2)", () => {
    const css = boxStyle({ scroll: "horizontal", maxHeight: "screen" }, theme);
    expect(css.maxHeight).toBe(theme.maxHeight.screen);
    expect(css.overflowY).toBe("hidden");
    // The horizontal-scroll box does NOT gain minHeight:0 — it owns overflow-y:hidden.
    assertNoOverlayEmission(css);
  });

  // ── R1: "none" sentinel on the BASELINE-APPLIED path ──
  it("keeps the renderer's 20rem cap when a baselined maxHeight:none resolves onto a scroll:vertical box (R1/DC-006)", () => {
    const baselineTheme: FacetTheme = {
      ...DEFAULT_THEME,
      name: "baseline-box",
      defaults: {
        ...DEFAULT_THEME.defaults,
        box: { ...DEFAULT_THEME.defaults.box, maxHeight: "none", collapse: "none" },
      },
    };
    const resolved = resolveTheme(baselineTheme);
    // The custom Theme must be used whole (not fallen back), or the baseline never applies.
    expect(resolved.name).toBe("baseline-box");
    const boxResolved = resolveBrickStyle(resolved, "box", { scroll: "vertical" });
    // The baseline sentinels really did merge into the resolved box style.
    expect((boxResolved as { maxHeight?: unknown }).maxHeight).toBe("none");
    expect((boxResolved as { collapse?: unknown }).collapse).toBe("none");
    const css = boxStyle(boxResolved, resolved);
    // maxHeight:"none" emits NOTHING, so the renderer's 20rem containment stands.
    expect(css.maxHeight).toBe(RENDERER_SCROLL_CAP);
    expect(css.overflowY).toBe("auto");
  });

  it("keeps scroll:vertical byte-identical (20rem) when no maxHeight is authored (DC-006 parity)", () => {
    const css = boxStyle({ scroll: "vertical" }, theme);
    expect(css.maxHeight).toBe(RENDERER_SCROLL_CAP);
    expect(css.overflowY).toBe("auto");
    expect(css.minHeight).toBe(0);
  });

  // ── R3 / R4: grid membership + auto-fit template ──
  it("emits the clamped auto-fit template for columns:auto + itemWidth and NO flexDirection (R3/R4/DC-003)", () => {
    const css = boxStyle({ columns: "auto", itemWidth: "md" }, theme);
    expect(css.display).toBe("grid");
    expect(css.gridTemplateColumns).toBe(
      `repeat(auto-fit,minmax(min(${theme.layoutWidth.md},100%),1fr))`,
    );
    expect(css.flexDirection).toBeUndefined();
  });

  it("falls back to layoutWidth.md when columns:auto has no itemWidth (R4)", () => {
    const css = boxStyle({ columns: "auto" }, theme);
    expect(css.gridTemplateColumns).toBe(
      `repeat(auto-fit,minmax(min(${theme.layoutWidth.md},100%),1fr))`,
    );
    expect(css.display).toBe("grid");
    expect(css.flexDirection).toBeUndefined();
  });

  it("resolves a junk itemWidth to the layoutWidth.md floor, same as absent (R4)", () => {
    const junk = boxStyle({ columns: "auto", itemWidth: "garbage" as never }, theme);
    const absent = boxStyle({ columns: "auto" }, theme);
    expect(junk.gridTemplateColumns).toBe(absent.gridTemplateColumns);
    expect(junk.gridTemplateColumns).toBe(
      `repeat(auto-fit,minmax(min(${theme.layoutWidth.md},100%),1fr))`,
    );
  });

  it("ignores itemWidth when columns is not auto and leaves columns:2|3|4 byte-identical (R4/DC-003)", () => {
    const withIgnored = boxStyle({ columns: 3, itemWidth: "lg" }, theme);
    expect(withIgnored.gridTemplateColumns).toBe("repeat(3,minmax(0,1fr))");
    for (const n of [2, 3, 4] as const) {
      const css = boxStyle({ columns: n }, theme);
      expect(css.display).toBe("grid");
      expect(css.gridTemplateColumns).toBe(`repeat(${String(n)},minmax(0,1fr))`);
      expect(css.flexDirection).toBeUndefined();
    }
  });

  it("does not create a grid from itemWidth alone (parent-owned, columns-gated)", () => {
    const css = boxStyle({ itemWidth: "lg" }, theme);
    expect(css.display).toBe("flex");
    expect(css.gridTemplateColumns).toBeUndefined();
  });

  // ── DC-004: shelf child no-shrink + row containment ──
  it("keeps a shelf child at its intrinsic width and the row scroll-contained (DC-004)", () => {
    const child = boxStyle({ basis: "md" }, theme);
    expect(child.flexBasis).toBe(theme.layoutWidth.md);
    expect(child.flexShrink).toBe(0);

    const row = boxStyle({ direction: "row", scroll: "horizontal" }, theme);
    expect(row.overflowX).toBe("auto");
    expect(row.maxWidth).toBe("100%");
    expect(row.minWidth).toBe(0);
    // No page-level horizontal overflow escapes the row.
    assertNoOverlayEmission(row);
  });

  // ── DC-005 / DC-008: fuzz never throws, never emits position/z-index/inset ──
  const JUNK: readonly unknown[] = [undefined, null, "huge", 999, {}, [], true, "", "AUTO", NaN];

  it("never throws or emits position/z-index/inset for junk on any new property (DC-005/DC-008)", () => {
    for (const value of JUNK) {
      for (const key of ["basis", "itemWidth", "maxHeight", "columns"] as const) {
        const style = { [key]: value } as unknown as BoxStyle;
        let css: CSSProperties = {};
        expect(() => {
          css = boxStyle(style, theme);
        }).not.toThrow();
        assertNoOverlayEmission(css);
      }
    }
    for (const scroll of ["vertical", "horizontal", "none"] as const) {
      for (const value of JUNK) {
        const style = {
          scroll,
          maxHeight: value,
          basis: value,
          columns: value,
          itemWidth: value,
        } as unknown as BoxStyle;
        let css: CSSProperties = {};
        expect(() => {
          css = boxStyle(style, theme);
        }).not.toThrow();
        assertNoOverlayEmission(css);
      }
    }
  });

  it("emits no partial declaration for a junk maxHeight or basis (guarded lookups, DC-005)", () => {
    const mh = boxStyle({ maxHeight: "huge" } as unknown as BoxStyle, theme);
    expect(mh.maxHeight).toBeUndefined();
    expect(mh.overflowY).toBeUndefined();
    expect(mh.minHeight).toBeUndefined();

    const b = boxStyle({ basis: "huge" } as unknown as BoxStyle, theme);
    expect(b.flexBasis).toBeUndefined();
    expect(b.flexShrink).toBeUndefined();
  });

  // ── RISK-API-8: TABLE_STICKY_MAX_HEIGHT interaction ──
  it("lets a stickyHeader table inside a maxHeight:screen pane keep both caps without throwing (RISK-API-8)", () => {
    let pane: CSSProperties = {};
    let tableWrapper: CSSProperties = {};
    expect(() => {
      pane = boxStyle({ maxHeight: "screen", scroll: "vertical" }, theme);
      tableWrapper = tableScrollContainmentStyle(true);
    }).not.toThrow();
    // The pane keeps its own screen cap …
    expect(pane.maxHeight).toBe(theme.maxHeight.screen);
    expect(pane.overflowY).toBe("auto");
    // … and the nested table keeps its private 28rem sticky-scroll cap.
    expect(tableWrapper.maxHeight).toBe(TABLE_STICKY_MAX_HEIGHT);
    expect(tableWrapper.overflowY).toBe("auto");
  });
});
