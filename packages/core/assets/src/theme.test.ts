import { readFileSync } from "node:fs";
import type { Color, FacetTheme, FontFamily, RecipePartName, Shadow, Space } from "@facet/core";
import { DEFAULT_CATALOG, validateTheme } from "@facet/core";
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
    expect(DEFAULT_THEME.recipes?.field?.default?.parts?.control?.box).toEqual({
      bg: "bg",
      border: true,
      pad: "sm",
      radius: "sm",
    });
    expect(DEFAULT_THEME.recipes?.field?.default?.parts?.control?.field).toEqual({
      width: "full",
    });
    expect(DEFAULT_THEME.recipes?.stat?.default?.text).toEqual({
      color: "fg-muted",
      size: "sm",
    });
    expect(DEFAULT_THEME.recipes?.metric?.default).toEqual(DEFAULT_THEME.recipes?.stat?.default);
    expect(DEFAULT_THEME.recipes?.metric?.success).toEqual(DEFAULT_THEME.recipes?.stat?.success);
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

    const source = ["./theme.ts", "./theme-tokens.ts"]
      .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      /\bfrom\s+["@']@facet\/(react|runtime|server|client|reference-agent|quickstart)["']/,
    );
    expect(source).not.toMatch(/\b(CSSProperties|React)\b/);
  });

  it("component default recipes define token-only parts for component affordances", () => {
    const expectedParts: ReadonlyArray<{
      readonly component: keyof NonNullable<FacetTheme["recipes"]>;
      readonly variant: string;
      readonly parts: readonly RecipePartName[];
    }> = [
      {
        component: "field",
        variant: "default",
        parts: ["label", "control", "input", "helpText", "errorText"],
      },
      { component: "button", variant: "primary", parts: ["label"] },
      { component: "button", variant: "secondary", parts: ["label"] },
      { component: "tabs", variant: "default", parts: ["tabList", "tab", "activeTab"] },
      { component: "nav", variant: "default", parts: ["item", "activeTab"] },
      {
        component: "table",
        variant: "default",
        parts: ["title", "table", "headerRow", "headerCell", "row", "cell"],
      },
      { component: "chart", variant: "default", parts: ["title", "plot", "legend"] },
      { component: "metric", variant: "default", parts: ["label", "value", "trend"] },
      { component: "metric", variant: "success", parts: ["label", "value", "trend"] },
      { component: "keyValue", variant: "default", parts: ["item", "label", "value"] },
      { component: "stat", variant: "default", parts: ["label", "value", "trend"] },
      { component: "stat", variant: "success", parts: ["label", "value", "trend"] },
      { component: "badge", variant: "neutral", parts: ["label"] },
      { component: "progress", variant: "default", parts: ["label", "track", "fill"] },
      { component: "alert", variant: "info", parts: ["title", "body"] },
      { component: "list", variant: "default", parts: ["item", "itemTitle", "itemText"] },
      { component: "divider", variant: "default", parts: ["label", "rule"] },
      { component: "form", variant: "default", parts: ["header", "title", "body", "actions"] },
      { component: "search", variant: "default", parts: ["label", "control", "input"] },
      { component: "filterBar", variant: "default", parts: ["item", "label", "control", "input"] },
      { component: "emptyState", variant: "default", parts: ["title", "body"] },
      { component: "loading", variant: "default", parts: ["label"] },
    ];

    for (const { component, variant, parts } of expectedParts) {
      const recipe = DEFAULT_THEME.recipes?.[component]?.[variant];
      expect(recipe, `${String(component)}.${variant}`).toBeDefined();
      for (const part of parts) {
        expect(
          recipe?.parts?.[part],
          `${String(component)}.${variant}.parts.${part}`,
        ).toBeDefined();
      }
    }

    const tokenOnly = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        expect(value, path).not.toMatch(/#|rgb\(|hsl\(|url\(|var\(|\b\d+(px|rem|em|%)\b/);
        return;
      }
      if (typeof value === "boolean" || value === undefined) return;
      expect(typeof value === "object" && value !== null && !Array.isArray(value), path).toBe(true);
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        tokenOnly(child, `${path}.${key}`);
      }
    };

    tokenOnly(DEFAULT_THEME.recipes, "DEFAULT_THEME.recipes");
    expect(validateTheme(DEFAULT_THEME).issues).toEqual([]);
  });

  it("defines every catalog-advertised default variant as a recipe", () => {
    for (const component of DEFAULT_CATALOG.components ?? []) {
      for (const variant of component.variants ?? []) {
        expect(
          DEFAULT_THEME.recipes?.[component.type]?.[variant],
          `${component.type}.${variant}`,
        ).toBeDefined();
      }
    }

    for (const brick of DEFAULT_CATALOG.bricks) {
      for (const variant of brick.variants ?? []) {
        expect(
          DEFAULT_THEME.recipes?.[brick.type]?.[variant],
          `${brick.type}.${variant}`,
        ).toBeDefined();
      }
    }
  });
});
