import { readFileSync } from "node:fs";
import type { Color, FacetTheme, FontFamily, Shadow, Space } from "@facet/core";
import { validateTheme } from "@facet/core";
import { describe, expect, it } from "vitest";
import { COLOR, DEFAULT_THEME, FONT_FAMILY } from "./theme.js";

// COLOR is the single source of truth for the palette (ChatDock consumes it via
// the renderer re-export), so its values are pinned here — byte-identical to the
// values @facet/react shipped before the data moved into @facet/assets.
describe("COLOR", () => {
  it("is exported with a pinned palette", () => {
    expect(COLOR.border).toBe("#e2e5ea");
    expect(COLOR.fg).toBe("#1a1d23");
    expect(COLOR.bg).toBe("#ffffff");
    expect(COLOR.accent).toBe("#4f46e5");
    expect(COLOR["fg-muted"]).toBe("#6b7280");
    expect(COLOR["surface-2"]).toBe("#eceef1");
    expect(COLOR["accent-fg"]).toBe("#ffffff");
  });

  it("is a null-prototype map so a hostile token name resolves to nothing", () => {
    expect(Object.getPrototypeOf(COLOR)).toBeNull();
    expect(COLOR["constructor" as Color]).toBeUndefined();
    expect(COLOR["__proto__" as Color]).toBeUndefined();
  });
});

// DEFAULT_THEME is today's values expressed as an operator FacetTheme document.
// It must round-trip through core's validator with no errors so operators can
// copy it as a starting point and hosts can register it by name.
describe("DEFAULT_THEME", () => {
  it("passes validateTheme with zero issues", () => {
    const result = validateTheme(DEFAULT_THEME);
    expect(result.theme).toBeDefined();
    expect(result.issues).toEqual([]);
  });

  // Pinned shape: exactly the name + the eight token groups + recipes, nothing else.
  it("keeps exactly the name + eight token groups + recipes", () => {
    expect(Object.keys(DEFAULT_THEME).sort()).toEqual(
      [
        "color",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "name",
        "radius",
        "ratio",
        "recipes",
        "shadow",
        "space",
      ].sort(),
    );
  });

  it("includes a complete default font family token map", () => {
    expect(FONT_FAMILY.sans).toBe("Nunito, sans-serif");
    expect(FONT_FAMILY.serif).toBe('Georgia, "Times New Roman", serif');
    expect(FONT_FAMILY.mono).toBe("ui-monospace, SFMono-Regular, Menlo, monospace");
    expect(Object.getPrototypeOf(FONT_FAMILY)).toBeNull();
    expect(FONT_FAMILY["constructor" as FontFamily]).toBeUndefined();

    expect(DEFAULT_THEME.fontFamily).toBe(FONT_FAMILY);
    expect(validateTheme(DEFAULT_THEME).issues).toEqual([]);
  });

  it('is named "default" and covers every token group with the pinned values', () => {
    expect(DEFAULT_THEME.name).toBe("default");
    expect(DEFAULT_THEME.color?.bg).toBe("#ffffff");
    expect(DEFAULT_THEME.space?.md).toBe("16px");
    expect(DEFAULT_THEME.fontFamily?.sans).toBe("Nunito, sans-serif");
    expect(DEFAULT_THEME.fontSize?.md).toBe("16px");
    expect(DEFAULT_THEME.fontWeight?.bold).toBe(700);
    expect(DEFAULT_THEME.radius?.md).toBe("10px");
    expect(DEFAULT_THEME.ratio?.wide).toBe("16 / 9");
    expect(DEFAULT_THEME.shadow?.md).toBe("0 12px 30px rgba(15, 23, 42, 0.14)");
  });

  it("uses null-prototype group maps (hostile token names resolve to nothing)", () => {
    const theme = DEFAULT_THEME as Required<
      Pick<
        FacetTheme,
        "color" | "space" | "fontFamily" | "fontSize" | "fontWeight" | "radius" | "ratio" | "shadow"
      >
    >;
    expect(Object.getPrototypeOf(theme.color)).toBeNull();
    expect(Object.getPrototypeOf(theme.space)).toBeNull();
    expect(Object.getPrototypeOf(theme.fontFamily)).toBeNull();
    expect(Object.getPrototypeOf(theme.fontSize)).toBeNull();
    expect(Object.getPrototypeOf(theme.fontWeight)).toBeNull();
    expect(Object.getPrototypeOf(theme.radius)).toBeNull();
    expect(Object.getPrototypeOf(theme.ratio)).toBeNull();
    expect(Object.getPrototypeOf(theme.shadow)).toBeNull();
    expect(theme.space["__proto__" as Space]).toBeUndefined();
    expect(theme.shadow["__proto__" as Shadow]).toBeUndefined();
  });
});

describe("DEFAULT_THEME recipes", () => {
  it("recipes validate with required semantic, chart, and shadow token maps", () => {
    const result = validateTheme(DEFAULT_THEME);

    expect(result.theme).toBeDefined();
    expect(result.issues).toEqual([]);
    expect(DEFAULT_THEME.color?.neutral).toBe("#64748b");
    expect(DEFAULT_THEME.color?.info).toBe("#0284c7");
    expect(DEFAULT_THEME.color?.success).toBe("#16a34a");
    expect(DEFAULT_THEME.color?.warning).toBe("#d97706");
    expect(DEFAULT_THEME.color?.danger).toBe("#dc2626");
    expect(DEFAULT_THEME.color?.["chart-1"]).toBe("#2563eb");
    expect(DEFAULT_THEME.color?.["chart-6"]).toBe("#0891b2");
    expect(DEFAULT_THEME.shadow?.none).toBe("none");
    expect(DEFAULT_THEME.shadow?.sm).toBe("0 1px 2px rgba(15, 23, 42, 0.08)");
    expect(DEFAULT_THEME.shadow?.md).toBe("0 12px 30px rgba(15, 23, 42, 0.14)");
    expect(DEFAULT_THEME.shadow?.lg).toBe("0 24px 60px rgba(15, 23, 42, 0.18)");
    expect(DEFAULT_THEME.recipes?.button?.primary?.box).toEqual({
      bg: "accent",
      border: true,
      pad: "sm",
      radius: "md",
      shadow: "sm",
    });
    expect(DEFAULT_THEME.recipes?.button?.primary?.text).toEqual({
      color: "accent-fg",
      weight: "semibold",
    });
    expect(DEFAULT_THEME.recipes?.chart?.default?.box).toEqual({
      bg: "surface",
      border: true,
      pad: "md",
      radius: "md",
      shadow: "sm",
    });
    expect(DEFAULT_THEME.recipes?.stat?.default?.text).toEqual({
      color: "fg-muted",
      size: "sm",
    });
  });

  it("recipes stay node-free and renderer-free", () => {
    const recipeData = DEFAULT_THEME.recipes;
    const forbiddenRecipeKeys = new Set([
      "id",
      "type",
      "children",
      "nodes",
      "root",
      "onPress",
      "onHold",
      "label",
      "value",
      "items",
      "rows",
      "series",
    ]);
    const seenForbiddenKeys: string[] = [];
    const visit = (value: unknown): void => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (forbiddenRecipeKeys.has(key)) seenForbiddenKeys.push(key);
        visit(child);
      }
    };

    expect(recipeData).toBeDefined();
    visit(recipeData);
    expect(seenForbiddenKeys).toEqual([]);

    const source = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(
      /\bfrom\s+["@']@facet\/(react|runtime|server|client|reference-agent|quickstart)["']/,
    );
    expect(source).not.toMatch(/\b(CSSProperties|React)\b/);
  });
});
