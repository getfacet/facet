import type { CSSProperties } from "react";
import type {
  BoxStyle,
  Color,
  ComponentRecipe,
  FacetTheme,
  FontFamily,
  Space,
  TextStyle,
} from "@facet/core";
import { DEFAULT_THEME as ASSETS_DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";
import {
  COLOR,
  DEFAULT_THEME,
  boxStyle,
  fieldStyle,
  mediaStyle,
  resolveRecipe,
  resolveTheme,
  textStyle,
} from "./theme.js";
import {
  STICKY_TOP,
  backdropHostStyle,
  backdropLayerStyle,
  scrimStyle,
  stickyStyle,
} from "./layout-contract.js";

// The theme is where token NAMES become concrete CSS (invariant #1's trusted
// side): agents only ever emit tokens, so these maps are the single place a
// wrong value would silently produce broken UI.
describe("boxStyle", () => {
  it("defaults to a column flexbox", () => {
    expect(boxStyle()).toEqual({
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
      minWidth: 0,
      maxWidth: "100%",
      overflowWrap: "anywhere",
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
  // token→CSS map); token-free boxes still carry renderer containment guards.
  it("keeps token-free output contained (appear adds nothing here)", () => {
    expect(boxStyle({ appear: "fade" } as BoxStyle)).toEqual({
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
      minWidth: 0,
      maxWidth: "100%",
      overflowWrap: "anywhere",
    });
  });
});

describe("textStyle", () => {
  it("defaults to zero margin and the sans font family", () => {
    expect(textStyle()).toEqual({
      margin: 0,
      wordBreak: "break-word",
      fontFamily: "Nunito, sans-serif",
      boxSizing: "border-box",
      minWidth: 0,
      maxWidth: "100%",
      overflowWrap: "anywhere",
    });
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

  it("maps font family tokens and defaults omitted family to sans", () => {
    const typeTheme = resolveTheme("type", [
      {
        name: "type",
        fontFamily: {
          sans: "Inter, sans-serif",
          mono: '"Fira Code", monospace',
        },
      },
    ]);

    expect(textStyle({}, typeTheme).fontFamily).toBe("Inter, sans-serif");
    expect(textStyle({ family: "mono" }, typeTheme).fontFamily).toBe('"Fira Code", monospace');
    expect(textStyle({ family: "serif" }, typeTheme).fontFamily).toBe(
      'Georgia, "Times New Roman", serif',
    );
  });

  it("falls back to sans when raw-path font family is invalid", () => {
    const typeTheme = resolveTheme("type", [
      {
        name: "type",
        fontFamily: {
          sans: "Inter, sans-serif",
          mono: '"Fira Code", monospace',
        },
      },
    ]);

    expect(textStyle({ family: "display" } as unknown as TextStyle, typeTheme).fontFamily).toBe(
      "Inter, sans-serif",
    );
    expect(textStyle({ family: 123 } as unknown as TextStyle, typeTheme).fontFamily).toBe(
      "Inter, sans-serif",
    );
  });
});

describe("mediaStyle", () => {
  it("defaults to a cover block", () => {
    expect(mediaStyle()).toEqual({
      display: "block",
      objectFit: "cover",
      height: "auto",
      boxSizing: "border-box",
      minWidth: 0,
      maxWidth: "100%",
      overflowWrap: "anywhere",
    });
  });

  it("maps radius, width, and ratio tokens", () => {
    const css = mediaStyle({ radius: "md", width: "full", ratio: "wide" });
    expect(css.borderRadius).toBe("10px");
    expect(css.width).toBe("100%");
    expect(css.aspectRatio).toBe("16 / 9");
  });
});

describe("fieldStyle", () => {
  it("defaults to containment guards", () => {
    expect(fieldStyle()).toEqual({
      boxSizing: "border-box",
      minWidth: 0,
      maxWidth: "100%",
      overflowWrap: "anywhere",
    });
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
      fontFamily: { mono: '"Fira Code", monospace' },
    };
    const resolved = resolveTheme("midnight", [midnight]);
    expect(resolved.space.md).toBe("99px"); // overridden
    expect(resolved.space.sm).toBe("8px"); // default kept within the same group
    expect(resolved.color.bg).toBe("#010101"); // overridden
    expect(resolved.color.fg).toBe("#1a1d23"); // untouched group default
    expect(resolved.fontFamily.mono).toBe('"Fira Code", monospace'); // overridden
    expect(resolved.fontFamily.sans).toBe("Nunito, sans-serif");
    expect(resolved.fontSize.md).toBe("16px"); // group with no override at all
  });

  it("keeps default recipes for fallback and partial custom themes", () => {
    expect(resolveRecipe(resolveTheme(undefined), "button", "primary").box).toMatchObject({
      bg: "accent",
      pad: "sm",
    });

    const resolved = resolveTheme("brand", [
      {
        name: "brand",
        space: { sm: "10px" },
        recipes: {
          button: {
            primary: {
              box: { bg: "danger", pad: "lg" },
            },
          },
        },
      },
    ]);

    expect(resolveRecipe(resolved, "button", "primary").box).toMatchObject({
      bg: "danger",
      pad: "lg",
    });
    expect(resolveRecipe(resolved, "button", "primary").text).toMatchObject({
      color: "accent-fg",
      weight: "semibold",
    });
    expect(resolveRecipe(resolved, "card", "default").box).toMatchObject({
      bg: "surface",
      shadow: "sm",
    });
  });

  it("overlays font family maps while ignoring hostile keys and non-strings", () => {
    const hostile = JSON.parse(
      '{"name":"evil","fontFamily":{"__proto__":"Bad","constructor":"Bad","nonsense":"Bad","sans":"Brand Sans, sans-serif","mono":7}}',
    ) as FacetTheme;

    const resolved = resolveTheme("evil", [hostile]);

    expect(resolved.fontFamily.sans).toBe("Brand Sans, sans-serif");
    expect(resolved.fontFamily.mono).toBe("ui-monospace, SFMono-Regular, Menlo, monospace");
    expect(resolved.fontFamily["__proto__" as FontFamily]).toBeUndefined();
    expect(resolved.fontFamily["nonsense" as FontFamily]).toBeUndefined();
    expect(Object.getPrototypeOf(resolved.fontFamily)).toBeNull();
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
    expect(Object.getPrototypeOf(resolved.fontFamily)).toBeNull();
  });
});

// Landing-grade vocabulary (WU-5): the new closed token groups resolve/overlay
// through the SAME machinery as every other group, map to concrete CSS in
// boxStyle/textStyle, and the flow-only layer helpers keep `position:absolute`
// confined to the synthesized backdrop layer (RISK-INV-1 / DC-004 / DC-001 /
// DC-005).
describe("landing-grade-vocab", () => {
  // DC-005: every new operator-overridable group overlays from a document and
  // falls back to the shipped default when the document omits (or supplies an
  // unknown) member — exactly like the pre-existing groups.
  describe("resolveTheme overlays the new groups (DC-005)", () => {
    it("overlays each new group while keeping un-overridden members at their default", () => {
      const doc: FacetTheme = {
        name: "land",
        minHeight: { screen: "90vh" },
        maxWidth: { prose: "72ch" },
        tracking: { tight: "-0.05em" },
        leading: { relaxed: "2" },
        gradient: { accent: "linear-gradient(90deg, red, blue)" },
        scrim: { dark: "rgba(0,0,0,0.8)" },
        highlight: { accent: "linear-gradient(transparent 50%, pink 50%)" },
        colorDark: { bg: "#000000" },
      };
      const t = resolveTheme("land", [doc]);
      expect(t.minHeight.screen).toBe("90vh"); // overridden
      expect(t.minHeight.half).toBe("50svh"); // default kept in the same group
      expect(t.maxWidth.prose).toBe("72ch");
      expect(t.maxWidth.wide).toBe("1200px");
      expect(t.tracking.tight).toBe("-0.05em");
      expect(t.leading.relaxed).toBe("2");
      expect(t.leading.tight).toBe("1.1");
      expect(t.gradient.accent).toBe("linear-gradient(90deg, red, blue)");
      expect(t.scrim.dark).toBe("rgba(0,0,0,0.8)");
      expect(t.highlight.accent).toBe("linear-gradient(transparent 50%, pink 50%)");
      expect(t.colorDark.bg).toBe("#000000"); // overridden
      expect(t.colorDark.fg).toBe("#f5f5f7"); // default dark palette kept
    });

    it("falls back to the shipped defaults when a document omits the new groups", () => {
      const t = resolveTheme("bare", [{ name: "bare", space: { md: "99px" } }]);
      expect(t.minHeight.screen).toBe("100svh");
      expect(t.minHeight.auto).toBe("auto");
      expect(t.maxWidth.prose).toBe("65ch");
      expect(t.tracking.wide).toBe("0.04em");
      expect(t.leading.normal).toBe("1.5");
      expect(t.gradient.none).toBe("none");
      expect(t.scrim.dark).toBe("rgba(0, 0, 0, 0.5)");
      expect(t.highlight.band).toBe("linear-gradient(transparent 55%, #fde68a 55%)");
      expect(t.colorDark.bg).toBe("#0b0b0f");
    });

    it("keeps the new group maps null-proto and ignores hostile keys", () => {
      const hostile = JSON.parse(
        '{"name":"evil","gradient":{"__proto__":"bad","constructor":"bad","accent":"linear-gradient(1deg, a, b)","dusk":9}}',
      ) as FacetTheme;
      const t = resolveTheme("evil", [hostile]);
      expect(t.gradient.accent).toBe("linear-gradient(1deg, a, b)"); // valid member + string
      expect(t.gradient.dusk).toBe("linear-gradient(180deg, #1e293b, #4f46e5)"); // non-string 9 dropped
      expect(t.gradient["__proto__" as keyof typeof t.gradient]).toBeUndefined();
      expect(Object.getPrototypeOf(t.gradient)).toBeNull();
      expect(Object.getPrototypeOf(t.minHeight)).toBeNull();
      expect(Object.getPrototypeOf(t.colorDark)).toBeNull();
    });

    it("mirrors the active color map into colorLight (scheme mechanism)", () => {
      const t = resolveTheme("default", [DEFAULT_THEME]);
      expect(t.colorLight.bg).toBe("#ffffff");
      expect(t.colorLight.bg).toBe(t.color.bg); // color IS the light scheme by default
      expect(t.colorDark.bg).toBe("#0b0b0f");
      // An operator light-palette override lands in BOTH color and colorLight.
      const branded = resolveTheme("brand", [{ name: "brand", color: { bg: "#101010" } }]);
      expect(branded.color.bg).toBe("#101010");
      expect(branded.colorLight.bg).toBe("#101010");
    });
  });

  // DC-001 / DC-004: the new tokens map to concrete CSS on the default theme.
  describe("boxStyle maps the new box tokens (DC-001)", () => {
    it("maps minHeight to min-height", () => {
      expect(boxStyle({ minHeight: "screen" }).minHeight).toBe("100svh");
      expect(boxStyle({ minHeight: "half" }).minHeight).toBe("50svh");
      expect(boxStyle({ minHeight: "auto" }).minHeight).toBe("auto");
    });

    it("maps maxWidth to max-width and centers a constrained column", () => {
      const prose = boxStyle({ maxWidth: "prose" });
      expect(prose.maxWidth).toBe("65ch");
      expect(prose.marginInline).toBe("auto");
      const wide = boxStyle({ maxWidth: "wide" });
      expect(wide.maxWidth).toBe("1200px");
      expect(wide.marginInline).toBe("auto");
      // `none` releases the constraint and is NOT centered.
      const none = boxStyle({ maxWidth: "none" });
      expect(none.maxWidth).toBe("none");
      expect(none.marginInline).toBeUndefined();
    });

    it("maps sticky to position:sticky with the framework-owned top offset", () => {
      const css = boxStyle({ sticky: true });
      expect(css.position).toBe("sticky");
      expect(css.top).toBe(STICKY_TOP);
      // No sticky token → no position emitted on a flow box.
      expect(boxStyle({}).position).toBeUndefined();
    });

    it("maps gradient to a background image", () => {
      expect(boxStyle({ gradient: "accent" }).backgroundImage).toBe(
        "linear-gradient(180deg, #4f46e5, #7c3aed)",
      );
      expect(boxStyle({ gradient: "dawn" }).backgroundImage).toBe(
        "linear-gradient(135deg, #f59e0b, #db2777)",
      );
    });

    it("never emits position:absolute for a flow box", () => {
      for (const style of [
        { minHeight: "screen" },
        { maxWidth: "prose" },
        { sticky: true },
        { gradient: "accent" },
      ] as const) {
        expect(boxStyle(style).position).not.toBe("absolute");
      }
    });
  });

  describe("textStyle maps the new text tokens (DC-001)", () => {
    it("maps tracking to letter-spacing", () => {
      expect(textStyle({ tracking: "tight" }).letterSpacing).toBe("-0.02em");
      expect(textStyle({ tracking: "wide" }).letterSpacing).toBe("0.04em");
    });

    it("maps leading to line-height", () => {
      expect(textStyle({ leading: "relaxed" }).lineHeight).toBe("1.75");
      expect(textStyle({ leading: "tight" }).lineHeight).toBe("1.1");
    });

    it("maps highlight to a background image behind the text run", () => {
      expect(textStyle({ highlight: "accent" }).backgroundImage).toBe(
        "linear-gradient(transparent 60%, #c7d2fe 60%)",
      );
      expect(textStyle({ highlight: "band" }).backgroundImage).toBe(
        "linear-gradient(transparent 55%, #fde68a 55%)",
      );
    });
  });

  // DC-004: the flow-only backdrop layers. `position:absolute` is confined to the
  // two renderer-SYNTHESIZED layers (media + scrim), never a flow child; both
  // layers carry NEGATIVE z-index so flow children paint above them, and the host
  // is its own stacking context so the negative-z layers stay contained.
  describe("layout-contract backdrop/scrim/sticky helpers (DC-004)", () => {
    it("backdropHostStyle is position:relative + isolation and preserves the base style", () => {
      const host = backdropHostStyle({ display: "flex", gap: "8px" });
      expect(host.position).toBe("relative");
      // isolation:isolate makes the host its own stacking context so the
      // negative-z backdrop layers can't leak behind ancestor content.
      expect(host.isolation).toBe("isolate");
      expect(host.display).toBe("flex");
      expect(host.gap).toBe("8px");
    });

    it("backdropLayerStyle is the absolute cover media layer at a negative z-index", () => {
      const layer = backdropLayerStyle();
      expect(layer.position).toBe("absolute");
      expect(layer.inset).toBe(0);
      expect(layer.objectFit).toBe("cover");
      expect(layer.width).toBe("100%");
      expect(layer.height).toBe("100%");
      // Negative z ⇒ paints BEHIND the box's in-flow children (the bug fix).
      expect(typeof layer.zIndex).toBe("number");
      expect(layer.zIndex as number).toBeLessThan(0);
    });

    it("scrimStyle is an absolute tint layer ABOVE the media but BELOW content", () => {
      const scrim = scrimStyle("rgba(0, 0, 0, 0.5)");
      expect(scrim.background).toBe("rgba(0, 0, 0, 0.5)");
      // The scrim MUST be positioned for inset:0 to fill the host (the earlier
      // no-position version collapsed to a 0-height no-op).
      expect(scrim.position).toBe("absolute");
      expect(scrim.inset).toBe(0);
      // Negative z (still behind content) but ABOVE the media layer, so it tints
      // the image while the flow copy stays legible on top.
      expect(scrim.zIndex as number).toBeLessThan(0);
      expect(scrim.zIndex as number).toBeGreaterThan(backdropLayerStyle().zIndex as number);
    });

    it("stickyStyle is position:sticky with the framework-owned top constant", () => {
      const css = stickyStyle();
      expect(css.position).toBe("sticky");
      expect(css.top).toBe(STICKY_TOP);
      expect(STICKY_TOP).not.toBe("absolute");
    });

    it("emits position:absolute ONLY on the synthesized backdrop layers, never a flow-box helper", () => {
      const flowHelpers: Record<string, CSSProperties> = {
        backdropHostStyle: backdropHostStyle(),
        stickyStyle: stickyStyle(),
      };
      // No flow-box helper is ever absolutely positioned…
      for (const css of Object.values(flowHelpers)) expect(css.position).not.toBe("absolute");
      // …while both synthesized backdrop layers are (they are renderer-owned,
      // aria-hidden background layers, not authored flow children).
      expect(backdropLayerStyle().position).toBe("absolute");
      expect(scrimStyle("rgba(0,0,0,0.5)").position).toBe("absolute");
    });
  });
});

describe("recipe resolution", () => {
  it("resolves component recipe parts", async () => {
    const { resolveRecipePart } = await import("./recipe-parts.js");
    const resolved = resolveTheme("brand", [
      {
        name: "brand",
        color: {
          accent: "#123456",
          "accent-fg": "#fefefe",
          surface: "#f3f4f6",
        },
        space: { xs: "6px", sm: "10px", lg: "30px" },
        radius: { md: "14px" },
        recipes: {
          button: {
            primary: {
              box: { pad: "lg" },
              parts: {
                label: { text: { color: "accent-fg", weight: "bold" } },
                icon: { box: { pad: "xs" } },
              },
            },
          },
          field: {
            default: {
              field: { width: "full" },
              parts: {
                label: { text: { color: "fg-muted", size: "sm", weight: "medium" } },
                control: {
                  box: { bg: "surface", border: true, pad: "sm", radius: "md" },
                  field: { width: "full" },
                },
              },
            },
          },
        },
      },
    ]);

    const button = resolveRecipe(resolved, "button", "primary");
    expect(button.box).toMatchObject({ bg: "accent", pad: "lg" });
    expect(button.text).toMatchObject({ color: "accent-fg", weight: "semibold" });
    expect(button.parts?.label?.text).toEqual({ color: "accent-fg", weight: "bold" });
    expect(boxStyle(button.box, resolved)).toMatchObject({
      background: "#123456",
      padding: "30px",
    });
    expect(textStyle(button.text, resolved)).toMatchObject({
      color: "#fefefe",
      fontWeight: 600,
    });

    const buttonLabel = resolveRecipePart(button, "label", resolved);
    expect(buttonLabel.text).toMatchObject({
      color: "#fefefe",
      fontWeight: 700,
    });
    expect(resolveRecipePart(button, "icon", resolved).box).toMatchObject({
      padding: "6px",
    });

    const fallbackField = resolveRecipe(resolved, "field", "__proto__");
    expect(fallbackField.field).toEqual({ width: "full" });
    const control = resolveRecipePart(fallbackField, "control", resolved);
    expect(control.box).toMatchObject({
      background: "#f3f4f6",
      border: "1px solid #e2e5ea",
      borderRadius: "14px",
      padding: "10px",
    });
    expect(control.field).toEqual({
      width: "100%",
      boxSizing: "border-box",
      minWidth: 0,
      maxWidth: "100%",
      overflowWrap: "anywhere",
    });
    expect(resolveRecipePart(fallbackField, "unknown", resolved)).toEqual({});
    expect(
      resolveRecipePart({ parts: "junk" } as unknown as ComponentRecipe, "label", resolved),
    ).toEqual({});

    const hostileParts = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileParts, "label", {
      enumerable: true,
      get() {
        throw new Error("hostile part getter");
      },
    });
    const hostileRecipe = { parts: hostileParts } as unknown as ComponentRecipe;
    expect(() => resolveRecipePart(hostileRecipe, "label", resolved)).not.toThrow();
    expect(resolveRecipePart(hostileRecipe, "label", resolved)).toEqual({});

    expect(mediaStyle(undefined, resolved)).toEqual({
      display: "block",
      objectFit: "cover",
      height: "auto",
      boxSizing: "border-box",
      minWidth: 0,
      maxWidth: "100%",
      overflowWrap: "anywhere",
    });
    expect(fieldStyle(fallbackField.field, resolved)).toEqual({
      width: "100%",
      boxSizing: "border-box",
      minWidth: 0,
      maxWidth: "100%",
      overflowWrap: "anywhere",
    });
  });

  it("resolves component recipes through the active theme token maps", () => {
    const resolved = resolveTheme("catalog", [
      {
        name: "catalog",
        color: {
          accent: "#123456",
          "accent-fg": "#fefefe",
          surface: "#f3f4f6",
        },
        space: { lg: "30px" },
        radius: { lg: "18px" },
        shadow: { md: "0 12px 30px rgba(0, 0, 0, 0.18)" },
        recipes: {
          button: {
            primary: {
              box: { bg: "accent", pad: "lg", radius: "lg", shadow: "md" },
              text: { color: "accent-fg", weight: "bold" },
            },
          },
          card: {
            default: {
              box: { bg: "surface", border: true, radius: "lg" },
            },
          },
        },
      },
    ]);

    const button = resolveRecipe(resolved, "button", "primary");
    expect(boxStyle(button.box, resolved)).toMatchObject({
      background: "#123456",
      padding: "30px",
      borderRadius: "18px",
      boxShadow: "0 12px 30px rgba(0, 0, 0, 0.18)",
    });
    expect(textStyle(button.text, resolved)).toMatchObject({
      color: "#fefefe",
      fontWeight: 700,
    });

    const card = resolveRecipe(resolved, "card", "missing");
    expect(boxStyle(card.box, resolved)).toMatchObject({
      background: "#f3f4f6",
      border: "1px solid #e2e5ea",
      borderRadius: "18px",
    });
  });

  it("falls back to default recipe variants for missing or hostile recipe keys", () => {
    const resolved = resolveTheme("catalog", [
      {
        name: "catalog",
        recipes: {
          button: {
            default: { box: { pad: "sm" } },
          },
        },
      },
    ]);

    expect(resolveRecipe(resolved, "stat", "primary")).toEqual({
      box: { bg: "surface", border: true, gap: "xs", pad: "md", radius: "md", shadow: "sm" },
      text: { color: "fg-muted", size: "sm" },
      parts: {
        label: { text: { color: "fg-muted", size: "sm" } },
        value: { text: { color: "fg", size: "xl", weight: "bold" } },
        trend: { text: { color: "fg-muted", size: "sm", weight: "medium" } },
      },
    });
    expect(resolveRecipe(resolved, "button", "__proto__")).toEqual({ box: { pad: "sm" } });
  });

  it("caps custom recipe variant traversal while keeping defaults", () => {
    const button = Object.create(null) as Record<string, unknown>;
    for (let i = 0; i < 80; i += 1) {
      button[`v${String(i)}`] = { box: { pad: "xs" } };
    }
    Object.defineProperty(button, "v64", {
      get() {
        throw new Error("recipe cap over-read");
      },
    });

    expect(() =>
      resolveTheme("catalog", [
        {
          name: "catalog",
          recipes: { button },
        } as unknown as FacetTheme,
      ]),
    ).not.toThrow();

    const resolved = resolveTheme("catalog", [
      {
        name: "catalog",
        recipes: { button },
      } as unknown as FacetTheme,
    ]);
    expect(resolveRecipe(resolved, "button", "v63")).toEqual({ box: { pad: "xs" } });
    expect(resolveRecipe(resolved, "button", "v64")).toEqual({});
    expect(resolveRecipe(resolved, "button", "primary").box).toMatchObject({
      bg: "accent",
      pad: "sm",
    });
  });
});
