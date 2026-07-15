import { readFileSync } from "node:fs";
import type { Color, FacetTheme, FontFamily, RecipePartName, Shadow, Space } from "@facet/core";
import { DEFAULT_CATALOG, validateTheme } from "@facet/core";
import { describe, expect, it } from "vitest";
import {
  COLOR,
  COLOR_DARK,
  DEFAULT_THEME,
  FONT_FAMILY,
  FONT_SIZE,
  GRADIENT,
  HIGHLIGHT,
  LEADING,
  MAX_WIDTH,
  MIN_HEIGHT,
  SCRIM,
  TRACKING,
} from "./theme.js";

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

  // Pinned shape: the name + the eight base token groups + recipes, plus the
  // validator-legal landing-grade groups (tracking/gradient/scrim/highlight/
  // colorDark). The landing-grade dimension groups (minHeight/maxWidth/leading)
  // are intentionally NOT part of the document (their svh/ch/unitless defaults
  // are not document-expressible); they resolve via @facet/react's fallback.
  it("keeps the name + base token groups + recipes + validator-legal landing groups", () => {
    expect(Object.keys(DEFAULT_THEME).sort()).toEqual(
      [
        "color",
        "colorDark",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "gradient",
        "highlight",
        "name",
        "radius",
        "ratio",
        "recipes",
        "scrim",
        "shadow",
        "space",
        "tracking",
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
    expect(DEFAULT_THEME.recipes?.input?.default?.parts?.control?.box).toEqual({
      bg: "bg",
      border: true,
      pad: "sm",
      radius: "sm",
    });
    expect(DEFAULT_THEME.recipes?.input?.default?.parts?.control?.field).toEqual({
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
        component: "input",
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
      // badge/alert/divider recipes were removed in PR-5a — their tokens are now
      // baked into the per-tone badge*/alert* compositions in @facet/assets.
      { component: "progress", variant: "default", parts: ["label", "track", "fill"] },
      { component: "list", variant: "default", parts: ["item", "itemTitle", "itemText"] },
      { component: "form", variant: "default", parts: ["header", "title", "body", "actions"] },
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
    // badge/alert/divider are demoted to compositions in PR-5a; their recipes are
    // gone even though the shared @facet/core DEFAULT_CATALOG still advertises them
    // until the atomic core-removal WU lands (lockstep). Excluding them here is
    // forward-compatible — the entries disappear from the catalog in that WU.
    const DEMOTED = new Set(["badge", "alert", "divider"]);
    for (const component of DEFAULT_CATALOG.components ?? []) {
      if (DEMOTED.has(component.type)) continue;
      for (const variant of component.variants ?? []) {
        expect(
          DEFAULT_THEME.recipes?.[component.type]?.[variant],
          `${component.type}.${variant}`,
        ).toBeDefined();
      }
    }

    for (const brick of DEFAULT_CATALOG.bricks) {
      if (DEMOTED.has(brick.type)) continue;
      for (const variant of brick.variants ?? []) {
        expect(
          DEFAULT_THEME.recipes?.[brick.type]?.[variant],
          `${brick.type}.${variant}`,
        ).toBeDefined();
      }
    }
  });
});

// WU-4 (DC-005 + DC-001): concrete default CSS for every new landing-grade token
// group + the 3 new FONT_SIZE keys (RISK-API-1 repair). The dimension groups
// (minHeight/maxWidth/leading) carry viewport/character/unitless CSS that WU-2's
// strict dimensionHandler cannot express, so their defaults live only in the raw
// maps that @facet/react's DEFAULT_RESOLVED imports directly; DEFAULT_THEME wires
// in only the validator-legal groups (tracking/gradient/scrim/highlight/colorDark)
// and must still round-trip through validateTheme with zero issues.
describe("landing-grade-vocab", () => {
  it("extends FONT_SIZE to a 10-step display ramp (RISK-API-1 repair)", () => {
    expect(Object.keys(FONT_SIZE).sort()).toEqual(
      ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"].sort(),
    );
    expect(FONT_SIZE["4xl"]).toBe("64px");
    expect(FONT_SIZE["5xl"]).toBe("80px");
    expect(FONT_SIZE["6xl"]).toBe("96px");
    expect(Object.getPrototypeOf(FONT_SIZE)).toBeNull();
  });

  it("provides resolvable min-height + max-width defaults", () => {
    expect(MIN_HEIGHT.auto).toBe("auto");
    expect(MIN_HEIGHT.half).toBe("50svh");
    expect(MIN_HEIGHT.screen).toBe("100svh");
    expect(MAX_WIDTH.none).toBe("none");
    expect(MAX_WIDTH.prose).toBe("65ch");
    expect(MAX_WIDTH.narrow).toBe("640px");
    expect(MAX_WIDTH.wide).toBe("1200px");
  });

  it("provides tracking + leading defaults", () => {
    expect(TRACKING.tight).toBe("-0.02em");
    expect(TRACKING.normal).toBe("0");
    expect(TRACKING.wide).toBe("0.04em");
    expect(LEADING.tight).toBe("1.1");
    expect(LEADING.normal).toBe("1.5");
    expect(LEADING.relaxed).toBe("1.75");
  });

  it("provides gradient / scrim / highlight CSS defaults", () => {
    expect(GRADIENT.none).toBe("none");
    expect(GRADIENT.accent).toMatch(/^linear-gradient\(/);
    expect(GRADIENT.dusk).toMatch(/^linear-gradient\(/);
    expect(GRADIENT.dawn).toMatch(/^linear-gradient\(/);
    expect(SCRIM.none).toBe("transparent");
    expect(SCRIM.light).toMatch(/^rgba\(/);
    expect(SCRIM.dark).toMatch(/^rgba\(/);
    expect(HIGHLIGHT.none).toBe("none");
    expect(HIGHLIGHT.accent).toMatch(/^linear-gradient\(/);
    expect(HIGHLIGHT.band).toMatch(/^linear-gradient\(/);
  });

  it("provides a full dark-scheme palette with the same Color keys", () => {
    expect(Object.keys(COLOR_DARK).sort()).toEqual(Object.keys(COLOR).sort());
    expect(COLOR_DARK.bg).toBe("#0b0b0f");
    expect(COLOR_DARK.fg).toBe("#f5f5f7");
    expect(COLOR_DARK.bg).not.toBe(COLOR.bg);
    expect(COLOR_DARK.fg).not.toBe(COLOR.fg);
  });

  it("uses null-prototype maps for every new group", () => {
    for (const map of [
      MIN_HEIGHT,
      MAX_WIDTH,
      TRACKING,
      LEADING,
      GRADIENT,
      SCRIM,
      HIGHLIGHT,
      COLOR_DARK,
    ]) {
      expect(Object.getPrototypeOf(map)).toBeNull();
    }
  });

  it("wires the validator-legal groups into DEFAULT_THEME and still validates clean", () => {
    expect(DEFAULT_THEME.tracking).toBe(TRACKING);
    expect(DEFAULT_THEME.gradient).toBe(GRADIENT);
    expect(DEFAULT_THEME.scrim).toBe(SCRIM);
    expect(DEFAULT_THEME.highlight).toBe(HIGHLIGHT);
    expect(DEFAULT_THEME.colorDark).toBe(COLOR_DARK);
    expect(validateTheme(DEFAULT_THEME).issues).toEqual([]);
  });
});
