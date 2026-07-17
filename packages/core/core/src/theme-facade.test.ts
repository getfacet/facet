import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as themeFacade from "./theme.js";
import { CONTRAST_PAIRS, isAllowedColor, parseSrgb } from "./theme-color.js";
import type { FacetPreset, FacetPresets, FacetTheme } from "./theme.js";

const sourcePath = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

describe("Theme facade", () => {
  it("exports Preset terminology without recipe aliases", () => {
    const panel: FacetPreset<"box"> = {
      description: "A bounded panel treatment.",
      useWhen: "Use for grouped content.",
      style: { background: "surface" },
    };
    const presets: FacetPresets = { box: { panel } };
    const theme = { presets } as FacetTheme;

    expect(theme.presets?.box?.panel).toBe(panel);
    expectTypeOf<"recipes" extends keyof FacetTheme ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<"recipe" extends keyof FacetPreset ? true : false>().toEqualTypeOf<false>();
    expect(Object.keys(themeFacade).sort()).toEqual([
      "MAX_DESCRIPTION_LENGTH",
      "MAX_THEME_CSS_VALUE_BYTES",
      "isValidThemeName",
      "validateTheme",
    ]);

    const facadeSource = readFileSync(sourcePath("./theme.ts"), "utf8");
    expect(facadeSource).not.toMatch(/recipe/i);
    expect(existsSync(sourcePath("./theme-recipe-validation.ts"))).toBe(false);
    expect(existsSync(sourcePath("./theme-recipes.ts"))).toBe(false); // style-hard-cut: allowed-negative

    expect(CONTRAST_PAIRS).toEqual([
      ["foreground", "background"],
      ["foreground", "surface"],
      ["foreground", "mutedSurface"],
      ["mutedForeground", "background"],
      ["mutedForeground", "surface"],
      ["accentForeground", "accent"],
      ["accentForeground", "accentSurface"],
      ["successForeground", "success"],
      ["successForeground", "successSurface"],
      ["warningForeground", "warning"],
      ["warningForeground", "warningSurface"],
      ["dangerForeground", "danger"],
      ["dangerForeground", "dangerSurface"],
      ["infoForeground", "info"],
      ["infoForeground", "infoSurface"],
    ]);

    for (const value of [
      "#fff",
      "#ffffffff",
      "rgb(0, 127.5, 255)",
      "rgb(0%, 50%, 100%)",
      "hsl(-360, 100%, 50%)",
      "orange",
    ]) {
      expect(isAllowedColor(value), value).toBe(true);
      expect(parseSrgb(value), value).toBeDefined();
    }
    for (const value of [
      "#ffffff00",
      "rgb(0%, 2, 3%)",
      "rgb(1e2, 0, 0)",
      "rgba(0, 0, 0, 1)",
      "hsl(0, 101%, 50%)",
      "transparent",
      "inherit",
      "var(--paint)",
    ]) {
      expect(isAllowedColor(value), value).toBe(false);
      expect(parseSrgb(value), value).toBeUndefined();
    }
  });
});
