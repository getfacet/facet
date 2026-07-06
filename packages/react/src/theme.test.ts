import type { BoxStyle, Color, FacetTheme, Space, TextStyle } from "@facet/core";
import { DEFAULT_THEME as ASSETS_DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";
import {
  COLOR,
  DEFAULT_THEME,
  boxStyle,
  fieldStyle,
  mediaStyle,
  resolveTheme,
  textStyle,
} from "./theme.js";

// The theme is where token NAMES become concrete CSS (invariant #1's trusted
// side): agents only ever emit tokens, so these maps are the single place a
// wrong value would silently produce broken UI.
describe("boxStyle", () => {
  it("defaults to a column flexbox", () => {
    expect(boxStyle()).toEqual({
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
    });
  });

  it("maps direction, spacing, and color tokens", () => {
    const css = boxStyle({ direction: "row", gap: "md", pad: "2xl", bg: "surface" });
    expect(css.flexDirection).toBe("row");
    expect(css.gap).toBe("16px");
    expect(css.padding).toBe("64px");
    expect(css.background).toBe("#f6f7f9");
  });

  it("maps alignment tokens to flex values", () => {
    const css = boxStyle({ align: "center", justify: "between" });
    expect(css.alignItems).toBe("center");
    expect(css.justifyContent).toBe("space-between");
    expect(boxStyle({ align: "start" }).alignItems).toBe("flex-start");
    expect(boxStyle({ justify: "around" }).justifyContent).toBe("space-around");
  });

  it("maps border, radius, wrap, grow, and width", () => {
    const css = boxStyle({ border: true, radius: "full", wrap: true, grow: true, width: "full" });
    expect(css.border).toBe("1px solid #e2e5ea");
    expect(css.borderRadius).toBe("9999px");
    expect(css.flexWrap).toBe("wrap");
    expect(css.flexGrow).toBe(1);
    expect(css.width).toBe("100%");
  });

  it("maps scroll:y and legacy scroll:true to a bounded vertical scroll region", () => {
    for (const scroll of ["y", true] as const) {
      const css = boxStyle({ scroll });
      expect(css.overflowY).toBe("auto");
      expect(css.overflowX).toBe("hidden");
      expect(css.maxHeight).toBe("20rem");
      expect(css.minHeight).toBe(0);
    }
  });

  it("maps scroll:x to a bounded horizontal scroll region", () => {
    const css = boxStyle({ scroll: "x" });
    expect(css.overflowX).toBe("auto");
    expect(css.overflowY).toBe("hidden");
    expect(css.maxWidth).toBe("100%");
    expect(css.minWidth).toBe(0);
    expect(css.width).toBeUndefined();
  });

  it("maps columns to a flow grid", () => {
    const css = boxStyle({ columns: 3, direction: "row", wrap: true });
    expect(css.display).toBe("grid");
    expect(css.gridTemplateColumns).toBe("repeat(3,minmax(0,1fr))");
    expect(css.flexDirection).toBeUndefined();
    expect(css.flexWrap).toBeUndefined();
  });

  it("keeps legacy scroll:true vertical and not horizontally scrollable", () => {
    const css = boxStyle({ scroll: true });
    expect(css.overflowY).toBe("auto");
    expect(css.overflowX).toBe("hidden");
  });

  it("maps scroll:false and junk scroll/columns values to no scroll or grid CSS", () => {
    for (const scroll of [false, "sideways", 1, "true", {}] as const) {
      const css = boxStyle({ scroll } as unknown as BoxStyle);
      expect(css.overflowY).toBeUndefined();
      expect(css.overflowX).toBeUndefined();
      expect(css.maxHeight).toBeUndefined();
      expect(css.minHeight).toBeUndefined();
    }
    const css = boxStyle({ columns: "lots" } as unknown as BoxStyle);
    expect(css.display).toBe("flex");
    expect(css.gridTemplateColumns).toBeUndefined();
  });

  // appear is renderer-bound (class + <style> in StageRenderer, not this
  // token→CSS map) and a token-free box must stay byte-identical to today.
  it("leaves token-free output unchanged (appear adds nothing here)", () => {
    expect(boxStyle({ appear: "fade" } as BoxStyle)).toEqual({
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
    });
  });
});

describe("textStyle", () => {
  it("defaults to zero margin only", () => {
    expect(textStyle()).toEqual({ margin: 0 });
  });

  it("maps size, weight, and color tokens", () => {
    const css = textStyle({ size: "2xl", weight: "bold", color: "fg-muted" });
    expect(css.fontSize).toBe("36px");
    expect(css.fontWeight).toBe(700);
    expect(css.color).toBe("#6b7280");
  });

  it("maps text alignment tokens", () => {
    expect(textStyle({ align: "start" }).textAlign).toBe("left");
    expect(textStyle({ align: "center" }).textAlign).toBe("center");
    expect(textStyle({ align: "end" }).textAlign).toBe("right");
  });
});

describe("mediaStyle", () => {
  it("defaults to a cover block", () => {
    expect(mediaStyle()).toEqual({ display: "block", objectFit: "cover" });
  });

  it("maps radius, width, and ratio tokens", () => {
    const css = mediaStyle({ radius: "md", width: "full", ratio: "wide" });
    expect(css.borderRadius).toBe("10px");
    expect(css.width).toBe("100%");
    expect(css.aspectRatio).toBe("16 / 9");
  });
});

describe("fieldStyle", () => {
  it("defaults to empty", () => {
    expect(fieldStyle()).toEqual({});
  });

  it("maps full width", () => {
    expect(fieldStyle({ width: "full" }).width).toBe("100%");
  });
});

// Agents emit token NAMES that index straight into these maps. A plain object
// literal carries Object.prototype, so a hostile token like "constructor" or
// "__proto__" would resolve to a truthy prototype value and land in the CSS.
// The maps must be null-prototype so those keys resolve to nothing.
describe("prototype-safe token maps", () => {
  it("prototype-key tokens resolve to no style on the raw path", () => {
    expect(boxStyle({ bg: "constructor" } as unknown as BoxStyle).background).toBeUndefined();
    expect(boxStyle({ bg: "__proto__" } as unknown as BoxStyle).background).toBeUndefined();
    expect(textStyle({ color: "constructor" } as unknown as TextStyle).color).toBeUndefined();
    expect(textStyle({ color: "__proto__" } as unknown as TextStyle).color).toBeUndefined();
  });
});

// COLOR is the single source of truth for the palette (ChatDock consumes it),
// so its values are pinned here.
describe("COLOR", () => {
  it("is exported with a pinned palette", () => {
    expect(COLOR.border).toBe("#e2e5ea");
    expect(COLOR.fg).toBe("#1a1d23");
    expect(COLOR.accent).toBe("#4f46e5");
    expect(COLOR["fg-muted"]).toBe("#6b7280");
    expect(COLOR["surface-2"]).toBe("#eceef1");
    expect(COLOR["accent-fg"]).toBe("#ffffff");
  });
});

// DEFAULT_THEME is no longer owned by react: it re-exports the SINGLE source of
// default-theme truth from @facet/assets (RISK-INV-1 — no second copy to drift).
// The re-export keeps it on the react barrel for back-compat (RISK-API-2); the
// document's shape/validity is pinned by @facet/assets' own tests.
describe("DEFAULT_THEME is re-exported from @facet/assets", () => {
  it("is the very same object as the @facet/assets DEFAULT_THEME", () => {
    expect(DEFAULT_THEME).toBe(ASSETS_DEFAULT_THEME);
  });
});

// resolveTheme is a PURE lookup: a name + the operator registry → a full,
// null-proto ResolvedTheme. Fallbacks return the default values; a match overlays
// the document's overrides while every un-overridden token keeps its default.
describe("resolveTheme", () => {
  it("returns the default values for a missing, non-string, or unknown name", () => {
    for (const name of [undefined, null, 42, "", "no-such"] as const) {
      const resolved = resolveTheme(name as unknown, [{ name: "midnight", space: { md: "99px" } }]);
      expect(resolved.space.md).toBe("16px");
      expect(resolved.color.bg).toBe("#ffffff");
    }
    // No registry at all is also the default.
    expect(resolveTheme("midnight").space.md).toBe("16px");
  });

  it("overlays a matching document's overrides onto the defaults", () => {
    const midnight: FacetTheme = {
      name: "midnight",
      color: { bg: "#010101" },
      space: { md: "99px" },
    };
    const resolved = resolveTheme("midnight", [midnight]);
    expect(resolved.space.md).toBe("99px"); // overridden
    expect(resolved.space.sm).toBe("8px"); // default kept within the same group
    expect(resolved.color.bg).toBe("#010101"); // overridden
    expect(resolved.color.fg).toBe("#1a1d23"); // untouched group default
    expect(resolved.fontSize.md).toBe("16px"); // group with no override at all
  });

  it("ignores forbidden/unknown keys and non-primitive values, and never pollutes", () => {
    // JSON.parse gives a REAL own "__proto__" key (a literal would set the
    // prototype) — the exact shape a shell → JSON.parse round trip restores.
    const hostile = JSON.parse(
      '{"name":"evil","space":{"__proto__":"5px","constructor":"6px","nonsense":"7px","md":"77px","sm":9}}',
    ) as FacetTheme;
    const resolved = resolveTheme("evil", [hostile]);
    expect(resolved.space.md).toBe("77px"); // valid member + string ⇒ copied
    expect(resolved.space.sm).toBe("8px"); // non-string 9 ⇒ dropped, default kept
    // Forbidden/unknown keys were never even looked up.
    expect(resolved.space["__proto__" as Space]).toBeUndefined();
    expect(resolved.space["nonsense" as Space]).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)["md"]).toBeUndefined();
  });

  it("returns null-proto group maps so a hostile token name resolves to nothing", () => {
    const resolved = resolveTheme("default", [DEFAULT_THEME]);
    expect(resolved.color["constructor" as Color]).toBeUndefined();
    expect(resolved.color["__proto__" as Color]).toBeUndefined();
    expect(Object.getPrototypeOf(resolved.color)).toBeNull();
    expect(Object.getPrototypeOf(resolved.space)).toBeNull();
  });
});
