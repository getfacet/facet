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
