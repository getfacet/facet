import type { FacetTheme } from "@facet/core";
import { DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme.js";

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
