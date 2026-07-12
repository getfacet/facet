import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG } from "./catalog.js";
import * as themeExports from "./theme.js";
import {
  isValidThemeName,
  MAX_DESCRIPTION_LENGTH,
  RECIPE_COMPONENTS,
  validateTheme,
} from "./theme.js";
import type { FacetTheme } from "./theme.js";

/** Every issue carrying severity "error" refuses the whole document. */
function hasError(issues: readonly { severity: "error" | "warning" }[]): boolean {
  return issues.some((i) => i.severity === "error");
}

describe("theme module boundary", () => {
  it("keeps the exact runtime export surface", () => {
    expect(Object.keys(themeExports).sort()).toEqual([
      "DEFAULT_COLORS",
      "MAX_DESCRIPTION_LENGTH",
      "RECIPE_COMPONENTS",
      "RECIPE_PARTS",
      "isValidThemeName",
      "validateTheme",
    ]);
  });
});

describe("isValidThemeName", () => {
  it("accepts short filename-safe identifiers and rejects the rest", () => {
    for (const ok of ["brand", "midnight-2", "A_b", "x", "x".repeat(64)]) {
      expect(isValidThemeName(ok)).toBe(true);
    }
    for (const bad of [
      "",
      "-lead",
      "has space",
      "brand\x00",
      "x".repeat(65),
      "a".repeat(100_000),
    ]) {
      expect(isValidThemeName(bad)).toBe(false);
    }
  });
});

describe("theme clamp constant names", () => {
  it("keeps spacing and font-size clamp bounds separately named", () => {
    const source = [
      readFileSync(new URL("./theme-token-validation.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./theme-validation.ts", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).toMatch(/const SPACE_PX_RANGE/);
    expect(source).toMatch(/const FONT_SIZE_PX_RANGE/);
    expect(source).toMatch(
      /"fontSize"[\s\S]*dimensionHandler\(FONT_SIZE_PX_RANGE\.lo, FONT_SIZE_PX_RANGE\.hi\)/,
    );
  });
});

describe("validateTheme", () => {
  it("rejects url and expression color values as errors", () => {
    const withUrl = validateTheme({ name: "x", color: { accent: "url(https://evil)" } });
    expect(withUrl.theme).toBeUndefined();
    expect(hasError(withUrl.issues)).toBe(true);

    const withExpression = validateTheme({ name: "x", color: { accent: "expression(alert(1))" } });
    expect(withExpression.theme).toBeUndefined();
    expect(hasError(withExpression.issues)).toBe(true);
  });

  it("refuses hostile CSS values (var/javascript:/injection chars) as errors", () => {
    const hostile: unknown[] = [
      { name: "x", color: { accent: "var(--x)" } },
      { name: "x", color: { accent: "#fff;background:red" } },
      { name: "x", space: { md: "16px}injected{" } },
      { name: "x", color: { fg: "javascript:alert(1)" } },
      { name: "x", color: { fg: "</style><script>" } },
      { name: "x", color: { fg: "#fff`" } },
      { name: "x", color: { fg: "expr\x00ession" } },
      { name: "x", color: { fg: "#0000" } },
      { name: "x", color: { fg: "rgba(0, 0, 0, 0.5)" } },
      { name: "x", color: { fg: "hsla(0, 0%, 0%, 50%)" } },
      { name: "x", color: { fg: "rgba(0 0 0 1)" } },
      { name: "x", color: { fg: "hsla(0 0% 0% 1)" } },
      { name: "x", color: { fg: "__proto__" } },
      { name: "x", color: { fg: "constructor" } },
      { name: "x", color: { fg: "rgb(, 0, 0)" } },
      { name: "x", color: { fg: "rgb(%, 0, 0)" } },
      { name: "x", color: { fg: "hsl(, 100%, 50%)" } },
      { name: "x", color: { fg: "hsl(0, 100%, %)" } },
    ];
    for (const doc of hostile) {
      const result = validateTheme(doc);
      expect(result.theme, JSON.stringify(doc)).toBeUndefined();
      expect(hasError(result.issues), JSON.stringify(doc)).toBe(true);
    }
  });

  it("never resolves __proto__/constructor/prototype keys and returns null-proto maps", () => {
    // JSON.parse (the real operator-input path) makes __proto__ an OWN key,
    // unlike an object literal which would set the prototype.
    const input = JSON.parse(
      '{"name":"x","color":{"accent":"#123456","__proto__":"#000000","constructor":"#111111","prototype":"#222222"}}',
    );
    const { theme, issues } = validateTheme(input);
    expect(theme).toBeDefined();
    const color = (theme as FacetTheme).color!;
    expect(color.accent).toBe("#123456");
    expect(Object.getPrototypeOf(color)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(color, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(color, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(color, "prototype")).toBe(false);
    // The forbidden keys were dropped, not silently absorbed.
    expect(hasError(issues)).toBe(false);
    // Global prototype was not polluted.
    expect(({} as Record<string, unknown>).accent).toBeUndefined();
  });

  it("clamps an over-large dimension with a warning but keeps the document", () => {
    const { theme, issues } = validateTheme({ name: "x", space: { md: "9999999px" } });
    expect(theme).toBeDefined();
    expect((theme as FacetTheme).space!.md).toBe("512px");
    expect(issues.some((i) => i.severity === "warning")).toBe(true);
    expect(hasError(issues)).toBe(false);
  });

  it("clamps an out-of-range fontWeight with a warning", () => {
    const { theme, issues } = validateTheme({ name: "x", fontWeight: { bold: 999999 } });
    expect(theme).toBeDefined();
    expect((theme as FacetTheme).fontWeight!.bold).toBe(1000);
    expect(issues.some((i) => i.severity === "warning")).toBe(true);
  });

  it("accepts safe fontFamily stacks into null-proto maps", () => {
    const { theme, issues } = validateTheme({
      name: "type",
      fontFamily: {
        sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
      },
    });

    expect(theme).toBeDefined();
    const fontFamily = (theme as FacetTheme).fontFamily!;
    expect(fontFamily.sans).toBe('system-ui, -apple-system, "Segoe UI", sans-serif');
    expect(fontFamily.mono).toBe("ui-monospace, SFMono-Regular, Menlo, monospace");
    expect(Object.getPrototypeOf(fontFamily)).toBeNull();
    expect(hasError(issues)).toBe(false);
  });

  it("refuses unsafe fontFamily values as errors", () => {
    const hostile: unknown[] = [
      { name: "x", fontFamily: { sans: "url(https://evil/font.woff2)" } },
      { name: "x", fontFamily: { sans: "var(--font)" } },
      { name: "x", fontFamily: { sans: "javascript:alert(1)" } },
      { name: "x", fontFamily: { sans: "sans-serif;background:red" } },
      { name: "x", fontFamily: { sans: "serif\x00mono" } },
      { name: "x", fontFamily: { sans: "@import evil" } },
      { name: "x", fontFamily: { sans: 123 } },
    ];

    for (const doc of hostile) {
      const result = validateTheme(doc);
      expect(result.theme, JSON.stringify(doc)).toBeUndefined();
      expect(hasError(result.issues), JSON.stringify(doc)).toBe(true);
    }
  });

  it("drops unknown and forbidden fontFamily keys while keeping valid tokens", () => {
    const input = JSON.parse(
      '{"name":"x","fontFamily":{"mono":"Menlo, monospace","display":"Papyrus","__proto__":"serif","constructor":"serif","prototype":"serif"}}',
    );

    const { theme, issues } = validateTheme(input);

    expect(theme).toBeDefined();
    const fontFamily = (theme as FacetTheme).fontFamily!;
    expect(fontFamily.mono).toBe("Menlo, monospace");
    expect(Object.getPrototypeOf(fontFamily)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(fontFamily, "display")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(fontFamily, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(fontFamily, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(fontFamily, "prototype")).toBe(false);
    expect(issues.filter((i) => i.severity === "warning").length).toBeGreaterThanOrEqual(4);
    expect(hasError(issues)).toBe(false);
  });

  it("warns (never rejects) on a low-contrast pair, naming the pair and ratio", () => {
    const { theme, issues } = validateTheme({
      name: "x",
      color: { fg: "#777777", bg: "#888888" },
    });
    expect(theme).toBeDefined();
    const warning = issues.find(
      (i) =>
        i.severity === "warning" &&
        i.message.includes("fg") &&
        i.message.includes("bg") &&
        /\d\.\d\d/.test(i.message),
    );
    expect(warning).toBeDefined();
    expect(hasError(issues)).toBe(false);
  });

  it("warns on a partial override whose EFFECTIVE pair is low-contrast (dark bg only)", () => {
    // Overriding only `bg` to black leaves the default `fg` (#1a1d23) rendering
    // on it — an effective ratio far below 4.5. The check overlays the default
    // for the un-overridden member, so this must warn even though only one of the
    // pair is present in the document.
    const { theme, issues } = validateTheme({ name: "dark", color: { bg: "#000000" } });
    expect(theme).toBeDefined();
    const warning = issues.find(
      (i) =>
        i.severity === "warning" &&
        i.message.includes("fg") &&
        i.message.includes("bg") &&
        i.message.toLowerCase().includes("contrast"),
    );
    expect(warning).toBeDefined();
  });

  it("does not warn when every EFFECTIVE pair is high-contrast", () => {
    // All pair members are overridden to high-contrast values, so no pair — not
    // even one measured against a default partner — falls below the floor.
    const { theme, issues } = validateTheme({
      name: "x",
      color: {
        fg: "#ffffff",
        "fg-muted": "#cccccc",
        bg: "#000000",
        accent: "#000000",
        "accent-fg": "#ffffff",
      },
    });
    expect(theme).toBeDefined();
    expect(issues.some((i) => i.message.toLowerCase().includes("contrast"))).toBe(false);
  });

  it("warns on low-contrast hsl() and named-color pairs", () => {
    const hsl = validateTheme({
      name: "hsl-theme",
      color: { fg: "hsl(0, 0%, 50%)", bg: "hsl(0, 0%, 50%)" },
    });
    expect(hsl.theme).toBeDefined();
    expect(hsl.issues.some((i) => i.message.toLowerCase().includes("contrast"))).toBe(true);

    const named = validateTheme({ name: "named", color: { fg: "gray", bg: "gray" } });
    expect(named.theme).toBeDefined();
    expect(named.issues.some((i) => i.message.toLowerCase().includes("contrast"))).toBe(true);
  });

  it("drops unknown token and group keys with a warning but keeps the document", () => {
    const { theme, issues } = validateTheme({
      name: "x",
      color: { accent: "#abcdef", bogusToken: "#fff" },
      bogusGroup: { anything: 1 },
    });
    expect(theme).toBeDefined();
    expect((theme as FacetTheme).color!.accent).toBe("#abcdef");
    expect(Object.prototype.hasOwnProperty.call((theme as FacetTheme).color!, "bogusToken")).toBe(
      false,
    );
    expect(issues.filter((i) => i.severity === "warning").length).toBeGreaterThanOrEqual(2);
    expect(hasError(issues)).toBe(false);
  });

  it("never echoes an over-long group key into an issue string (caps it)", () => {
    const bigKey = "z".repeat(10_000_000);
    const { issues } = validateTheme({ name: "x", color: { [bigKey]: "#fff" } });
    expect(issues.some((i) => i.message.includes("<key too long>"))).toBe(true);
    // The raw 10MB key never reaches the issue text (would flood operator logs).
    expect(issues.some((i) => i.message.includes(bigKey))).toBe(false);
  });

  it("never echoes a control/escape-sequence group key into an issue string", () => {
    const escKey = "\x1b[31maccent";
    const { issues } = validateTheme({ name: "x", color: { [escKey]: "#fff" } });
    expect(issues.some((i) => i.message.includes("<unprintable key>"))).toBe(true);
    // The raw escape sequence never reaches operator terminals via the issue.
    expect(issues.some((i) => i.message.includes(escKey))).toBe(false);
  });

  it("caps the per-document issues array so a junk-key group cannot balloon it", () => {
    const group: Record<string, string> = {};
    for (let i = 0; i < 100_000; i++) group[`k${String(i)}`] = "#fff";
    const { issues } = validateTheme({ name: "x", color: group });
    // 64 real issues + a single suppression tail entry.
    expect(issues.length).toBeLessThanOrEqual(65);
    expect(issues[issues.length - 1]?.message).toContain("further issues suppressed");
  });

  it("rejects a missing or malformed name as an error", () => {
    for (const doc of [
      {},
      { name: 7 },
      { name: "" },
      { name: "has space" },
      { name: "a".repeat(65) },
    ]) {
      const result = validateTheme(doc);
      expect(result.theme, JSON.stringify(doc)).toBeUndefined();
      expect(hasError(result.issues)).toBe(true);
    }
  });

  it("never throws on junk input and reports an error", () => {
    for (const junk of [null, undefined, 42, "str", [], true, NaN]) {
      let result: ReturnType<typeof validateTheme> | undefined;
      expect(() => {
        result = validateTheme(junk);
      }).not.toThrow();
      expect(result!.theme).toBeUndefined();
      expect(hasError(result!.issues)).toBe(true);
    }
  });

  it("never throws on an object whose property accessor throws (hostile getter)", () => {
    // A live in-process document (MemoryAssets, a DB adapter) can hand in a
    // proxy/getter that throws on read — the "NEVER throws" contract must hold.
    const throwers: unknown[] = [
      {
        name: "x",
        get color() {
          throw new Error("boom");
        },
      },
      {
        get name() {
          throw new Error("boom");
        },
      },
    ];
    for (const doc of throwers) {
      let result: ReturnType<typeof validateTheme> | undefined;
      expect(() => {
        result = validateTheme(doc);
      }).not.toThrow();
      expect(result!.theme).toBeUndefined();
      expect(hasError(result!.issues)).toBe(true);
    }
  });

  it("round-trips a valid partial document", () => {
    const doc = {
      name: "midnight",
      description: "dark theme",
      color: { bg: "#000000", fg: "#ffffff", accent: "rgb(80, 70, 229)" },
      space: { md: "16px" },
      fontWeight: { bold: 700 },
      ratio: { wide: "16 / 9" },
    };
    const { theme, issues } = validateTheme(doc);
    expect(theme).toBeDefined();
    const t = theme as FacetTheme;
    expect(t.name).toBe("midnight");
    expect(t.description).toBe("dark theme");
    expect(t.color!.bg).toBe("#000000");
    expect(t.color!.accent).toBe("rgb(80, 70, 229)");
    expect(t.space!.md).toBe("16px");
    expect(t.fontWeight!.bold).toBe(700);
    expect(t.ratio!.wide).toBe("16 / 9");
    expect(hasError(issues)).toBe(false);
  });

  it("still refuses a document whose error issue is raised AFTER the issue cap fills", () => {
    // 70 junk keys (each a warning) exceed MAX_ISSUES, so the error issue from
    // the bad `fg` value is dropped from the retained list — but the refusal must
    // still fire (tracked by `everError`, not a scan of the capped list).
    const color: Record<string, unknown> = {};
    for (let i = 0; i < 70; i++) color[`junk${String(i)}`] = "#fff";
    color["fg"] = "url(javascript:alert(1))"; // dangerous value → error
    const result = validateTheme({ name: "x", color });
    expect(result.theme).toBeUndefined();
    // The error may not even appear in the retained list — the point is refusal.
    expect(result.issues.length).toBeLessThanOrEqual(65);

    // Control document: the same error value with NO junk keys is refused too.
    const control = validateTheme({ name: "x", color: { fg: "url(javascript:alert(1))" } });
    expect(control.theme).toBeUndefined();
    expect(hasError(control.issues)).toBe(true);
  });

  it("treats a C1 control char (single-byte CSI U+009B) in a key as unprintable, in a value as unsafe", () => {
    const csiKey = "\u009b31mEVIL"; // U+009B single-byte CSI introducer
    const keyDoc = validateTheme({ name: "x", color: { [csiKey]: "#fff" } });
    expect(keyDoc.issues.some((i) => i.message.includes("<unprintable key>"))).toBe(true);
    // The raw C1 byte never reaches the operator-facing issue string.
    expect(keyDoc.issues.some((i) => i.message.includes(csiKey))).toBe(false);

    // A value carrying a C1 control char (U+0085 NEL) is refused as an error.
    const valueDoc = validateTheme({ name: "x", color: { fg: "#fff\u0085f" } });
    expect(valueDoc.theme).toBeUndefined();
    expect(hasError(valueDoc.issues)).toBe(true);
    expect(valueDoc.issues.some((i) => i.message.includes("control character"))).toBe(true);
  });

  // Pins the theme\u2192boundedDescription wiring (label "theme" + MAX_DESCRIPTION_LENGTH
  // cap); the shared truncate/reject logic is also covered on the composition path,
  // but that coverage is label-agnostic and wouldn't catch a wrong label/cap here.
  it("drops a non-string description with a labelled warning", () => {
    const { theme, issues } = validateTheme({ name: "x", description: 123 });
    expect(theme?.description).toBeUndefined();
    expect(issues.some((i) => i.message === "theme description is not a string; ignored")).toBe(
      true,
    );
  });

  it("truncates an over-cap description to MAX_DESCRIPTION_LENGTH with a labelled warning", () => {
    const { theme, issues } = validateTheme({
      name: "x",
      description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1),
    });
    expect(theme?.description?.length).toBe(MAX_DESCRIPTION_LENGTH);
    expect(issues.some((i) => i.message === "theme description truncated to 200 characters")).toBe(
      true,
    );
  });

  it("preserves component recipes with token-only style bundles", () => {
    const { theme, issues } = validateTheme({
      name: "brand",
      shadow: { md: "0 12px 30px rgba(0, 0, 0, 0.15)" },
      recipes: {
        button: {
          primary: {
            box: { bg: "accent", pad: "md", radius: "lg", border: true, shadow: "md" },
            text: { color: "accent-fg", weight: "semibold" },
          },
        },
        chart: {
          line: {
            box: { bg: "surface", pad: "sm", radius: "md" },
            text: { color: "fg-muted", size: "sm" },
          },
        },
        media: {
          hero: {
            media: { radius: "lg", width: "full", ratio: "wide" },
          },
        },
      },
    });

    expect(theme).toBeDefined();
    expect(hasError(issues)).toBe(false);
    expect(theme?.shadow?.md).toBe("0 12px 30px rgba(0, 0, 0, 0.15)");
    expect(theme?.recipes?.button?.primary?.box).toEqual({
      bg: "accent",
      pad: "md",
      radius: "lg",
      border: true,
      shadow: "md",
    });
    expect(theme?.recipes?.button?.primary?.text).toEqual({
      color: "accent-fg",
      weight: "semibold",
    });
    expect(theme?.recipes?.media?.hero?.media).toEqual({
      radius: "lg",
      width: "full",
      ratio: "wide",
    });
    expect(Object.getPrototypeOf(theme?.recipes?.button)).toBeNull();
  });

  it("validates token-only recipe parts", () => {
    const input = JSON.parse(`{
      "name": "brand",
      "recipes": {
        "field": {
          "default": {
            "field": { "width": "full" },
            "parts": {
              "label": {
                "text": { "color": "fg-muted", "size": "sm", "weight": "medium" }
              },
              "control": {
                "box": { "bg": "surface", "pad": "sm", "radius": "md", "border": true }
              },
              "icon": {
                "box": { "bg": "#fff", "pad": "huge", "width": "auto", "border": "yes" },
                "text": { "color": "var(--danger)", "size": "sm" },
                "style": { "color": "red" }
              },
              "customRawPart": {
                "box": { "bg": "accent" }
              },
              "__proto__": {
                "box": { "bg": "danger" }
              }
            }
          }
        }
      }
    }`);
    Object.defineProperty(input.recipes.field.default.parts, "body", {
      enumerable: true,
      get() {
        throw new Error("hostile part");
      },
    });

    const { theme, issues } = validateTheme(input);

    expect(theme).toBeDefined();
    expect(hasError(issues)).toBe(false);
    expect(theme?.recipes?.field?.default?.field).toEqual({ width: "full" });
    const parts = theme?.recipes?.field?.default?.parts;
    expect(parts?.label?.text).toEqual({
      color: "fg-muted",
      size: "sm",
      weight: "medium",
    });
    expect(parts?.control?.box).toEqual({
      bg: "surface",
      pad: "sm",
      radius: "md",
      border: true,
    });
    expect(parts?.icon?.box).toEqual({ width: "auto" });
    expect(parts?.icon?.text).toEqual({ size: "sm" });
    expect(Object.prototype.hasOwnProperty.call(parts ?? {}, "customRawPart")).toBe(false);
    expect(parts?.body).toBeUndefined();
    expect(Object.getPrototypeOf(parts)).toBeNull();
    expect(issues.filter((i) => i.severity === "warning").length).toBeGreaterThanOrEqual(6);
  });

  it("drops invalid component recipe tokens and raw CSS values with warnings", () => {
    const { theme, issues } = validateTheme({
      name: "brand",
      recipes: {
        button: {
          primary: {
            box: {
              bg: "#ffffff",
              pad: "huge",
              shadow: "floating",
              width: "full",
              border: "yes",
            },
            text: {
              color: "accent",
              size: "massive",
              family: "sans",
            },
          },
          "bad variant": {
            box: { bg: "accent" },
          },
        },
        script: {
          default: {
            box: { bg: "accent" },
          },
        },
      },
    });

    expect(theme).toBeDefined();
    expect(hasError(issues)).toBe(false);
    expect(theme?.recipes?.button?.primary?.box).toEqual({ width: "full" });
    expect(theme?.recipes?.button?.primary?.text).toEqual({
      color: "accent",
      family: "sans",
    });
    expect(theme?.recipes?.button?.["bad variant"]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(theme?.recipes ?? {}, "script")).toBe(false);
    expect(issues.filter((i) => i.severity === "warning").length).toBeGreaterThanOrEqual(5);
  });

  it("accepts metric, stat, and every catalog-advertised component recipe variant", () => {
    const recipes: Record<string, Record<string, { box: { bg: "surface" } }>> = {};
    const defaultComponents = DEFAULT_CATALOG.components ?? [];
    for (const component of defaultComponents) {
      const variants = component.variants ?? ["default"];
      recipes[component.type] = Object.fromEntries(
        variants.map((variant) => [variant, { box: { bg: "surface" } }]),
      );
    }
    recipes.stat = { default: { box: { bg: "surface" } }, success: { box: { bg: "surface" } } };

    const { theme, issues } = validateTheme({ name: "component-recipes", recipes });

    expect(theme).toBeDefined();
    expect(hasError(issues)).toBe(false);
    for (const component of defaultComponents) {
      for (const variant of component.variants ?? ["default"]) {
        expect(theme?.recipes?.[component.type]?.[variant]?.box).toEqual({ bg: "surface" });
      }
    }
    expect(theme?.recipes?.metric?.default?.box).toEqual({ bg: "surface" });
    expect(theme?.recipes?.stat?.success?.box).toEqual({ bg: "surface" });
    for (const component of defaultComponents) {
      expect((RECIPE_COMPONENTS as readonly string[]).includes(component.type)).toBe(true);
    }
  });

  it("keeps structural composition definitions out of style recipes under canonical names", () => {
    const { theme, issues } = validateTheme({
      name: "structural-recipes",
      recipes: {
        metric: {
          default: {
            box: { bg: "surface", pad: "sm" },
            root: "root",
            nodes: {
              root: { id: "root", type: "text", value: "not a recipe" },
            },
            slots: { title: "Title" },
            [["component", "Definitions"].join("")]: [{ name: "not-a-recipe" }],
            compositions: [{ name: "not-a-recipe" }],
          },
        },
      },
    });

    expect(theme).toBeDefined();
    expect(hasError(issues)).toBe(false);
    expect(theme?.recipes?.metric?.default).toEqual({ box: { bg: "surface", pad: "sm" } });
    const recipe = theme?.recipes?.metric?.default ?? {};
    expect(Object.prototype.hasOwnProperty.call(recipe, "root")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(recipe, "nodes")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(recipe, "slots")).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(recipe, ["component", "Definitions"].join("")),
    ).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(recipe, "compositions")).toBe(false);
    expect(issues.filter((issue) => issue.severity === "warning").length).toBeGreaterThanOrEqual(5);

    // DC-012: the theme surface (validator + this suite) carries canonical
    // composition naming only. The legacy token is spelled split so this
    // hygiene check cannot match its own source.
    const legacyNaming = new RegExp(["st", "amp"].join(""), "i");
    expect(readFileSync(new URL("./theme.ts", import.meta.url), "utf8")).not.toMatch(legacyNaming);
    expect(readFileSync(new URL("./theme.test.ts", import.meta.url), "utf8")).not.toMatch(
      legacyNaming,
    );
  });
});
