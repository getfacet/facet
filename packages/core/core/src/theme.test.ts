import { describe, expect, it } from "vitest";

import type { FacetCatalog } from "./catalog.js";
import { FACET_FOUNDATION_TOKEN_NAMES, FACET_SEMANTIC_TOKEN_NAMES } from "./theme-contract.js";
import { themeToCssVars, validateTheme, validateThemeExtensionDeclarations } from "./theme.js";
import type { FacetTheme, ThemeValidationResult } from "./theme.js";

function fixedValues(
  table: Readonly<Record<string, readonly string[]>>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(table).map(([group, tokens]) => [
      group,
      Object.fromEntries(tokens.map((token) => [token, `${group}-${token}`])),
    ]),
  );
}

function completeTheme(): FacetTheme {
  return {
    foundation: fixedValues(FACET_FOUNDATION_TOKEN_NAMES) as FacetTheme["foundation"],
    semantic: fixedValues(FACET_SEMANTIC_TOKEN_NAMES) as FacetTheme["semantic"],
  };
}

function accepted(result: ThemeValidationResult): FacetTheme {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected theme acceptance, got ${result.code}`);
  expect(Object.keys(result).sort()).toEqual(["ok", "theme"]);
  return result.theme;
}

function rejected(result: ThemeValidationResult, code: string, at: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected theme rejection");
  expect(Object.keys(result).sort()).toEqual(["at", "code", "detail", "ok"]);
  expect(result.code).toBe(code);
  expect(result.at).toBe(at);
  expect(result.detail.length).toBeGreaterThan(0);
}

const RECIPE_CATALOG: FacetCatalog = Object.freeze({
  components: Object.freeze([
    Object.freeze({
      tag: "Screen",
      whenToUse: "Root screen.",
      props: Object.freeze({
        name: Object.freeze({
          type: "string",
          required: true,
          guidance: "Screen name.",
        }),
      }),
      content: { mode: "children" as const },
      themeRecipe: Object.freeze({
        tokens: Object.freeze({ background: "color", contentGap: "length" }),
      }),
    }),
    Object.freeze({
      tag: "Button",
      whenToUse: "Trigger an action.",
      props: Object.freeze({
        label: Object.freeze({ type: "string", guidance: "Button label." }),
      }),
      content: { mode: "none" as const },
      themeRecipe: Object.freeze({
        tokens: Object.freeze({ primaryBg: "color", radius: "length" }),
      }),
    }),
  ]),
});

describe("Facet Design Contract v1 theme validation", () => {
  it("accepts a complete foundation and semantic theme", () => {
    const theme = accepted(validateTheme(completeTheme()));
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.foundation)).toBe(true);
    expect(Object.isFrozen(theme.foundation.palette)).toBe(true);
    expect(theme.foundation.palette.brand500).toBe("palette-brand500");
    expect(theme.semantic.text.default).toBe("text-default");
  });

  it("rejects the retired flat token groups instead of accepting aliases", () => {
    rejected(
      validateTheme({
        color: { background: "#fff" },
        space: { md: "1rem" },
      }),
      "unknown_token_group",
      "color",
    );
  });

  it("rejects missing, unknown, and unsafe values deterministically", () => {
    const missing = completeTheme() as unknown as Record<
      string,
      Record<string, Record<string, string>>
    >;
    delete missing["foundation"]?.["palette"]?.["brand500"];
    rejected(validateTheme(missing), "missing_token", "foundation.palette.brand500");

    const unknown = completeTheme() as unknown as Record<
      string,
      Record<string, Record<string, string>>
    >;
    unknown["semantic"]!["text"]!["brand"] = "#f0f";
    rejected(validateTheme(unknown), "unknown_token_name", "semantic.text.brand");

    const unsafe = completeTheme() as unknown as Record<
      string,
      Record<string, Record<string, string>>
    >;
    unsafe["semantic"]!["text"]!["default"] = "url(https://example.test/a.png)";
    rejected(validateTheme(unsafe), "token_value_not_allowed", "semantic.text.default");
  });

  it("validates declared recipe and extension values and projects stable CSS variables", () => {
    const extensions = acceptedExtensions([
      { namespace: "chart", tokens: { seriesA: "color", seriesB: "color" } },
    ]);
    const theme = accepted(
      validateTheme(
        {
          ...completeTheme(),
          recipes: {
            screen: { background: "#ffffff", contentGap: "1rem" },
            button: { primaryBg: "#335cff", radius: "0.5rem" },
          },
          extensions: {
            chart: { seriesA: "#3454d1", seriesB: "#0f7b4f" },
          },
        },
        { catalog: RECIPE_CATALOG, extensions },
      ),
    );
    const vars = themeToCssVars(theme, { catalog: RECIPE_CATALOG, extensions });
    expect(vars["--facet-foundation-palette-brand500"]).toBe("palette-brand500");
    expect(vars["--facet-semantic-text-default"]).toBe("text-default");
    expect(vars["--facet-recipe-button-primary-bg"]).toBe("#335cff");
    expect(vars["--facet-ext-chart-series-a"]).toBe("#3454d1");
  });

  it("rejects omitted or undeclared recipe values for the active catalog", () => {
    rejected(
      validateTheme(completeTheme(), { catalog: RECIPE_CATALOG }),
      "missing_token_group",
      "recipes",
    );

    rejected(
      validateTheme(
        {
          ...completeTheme(),
          recipes: {
            screen: { background: "#fff", contentGap: "1rem" },
            button: { primaryBg: "#335cff", radius: "0.5rem", ghost: "#000" },
          },
        },
        { catalog: RECIPE_CATALOG },
      ),
      "unknown_token_name",
      "recipes.button.ghost",
    );
  });

  it("rejects recipe namespaces that collide in an unvalidated catalog option", () => {
    const catalog = Object.freeze({
      components: Object.freeze([
        Object.freeze({
          tag: "MetricCard",
          whenToUse: "Show one metric.",
          props: Object.freeze({}),
          content: { mode: "none" },
          themeRecipe: Object.freeze({ tokens: Object.freeze({ accent: "color" }) }),
        }),
        Object.freeze({
          tag: "Metric-Card",
          whenToUse: "Show one metric.",
          props: Object.freeze({}),
          content: { mode: "none" },
          themeRecipe: Object.freeze({ tokens: Object.freeze({ accent: "color" }) }),
        }),
      ]),
    }) as unknown as FacetCatalog;

    rejected(
      validateTheme(
        {
          ...completeTheme(),
          recipes: { "metric-card": { accent: "#335cff" } },
        },
        { catalog },
      ),
      "duplicate_theme_recipe_namespace",
      "catalog.components[1].tag",
    );
    expect(
      themeToCssVars(
        {
          ...completeTheme(),
          recipes: { "metric-card": { accent: "#335cff" } },
        } as FacetTheme,
        { catalog },
      ),
    ).toEqual({});
  });

  it("rejects undeclared extension values", () => {
    rejected(
      validateTheme({ ...completeTheme(), extensions: { chart: { seriesA: "#3454d1" } } }),
      "unknown_extension_namespace",
      "extensions.chart",
    );
  });

  it("is total for hostile input and projection omits values it cannot read", () => {
    expect(validateTheme(null).ok).toBe(false);
    expect(() =>
      validateTheme({
        get foundation(): unknown {
          throw new Error("boom");
        },
      }),
    ).not.toThrow();
    expect(() => themeToCssVars(null as unknown as FacetTheme)).not.toThrow();
    expect(themeToCssVars(null as unknown as FacetTheme)).toEqual({});
  });
});

describe("theme extension declarations", () => {
  it("accepts and freezes declared extension namespaces", () => {
    const extensions = acceptedExtensions([
      { namespace: "chart", tokens: { seriesA: "color", emphasisWidth: "length" } },
    ]);
    expect(extensions).toEqual([
      { namespace: "chart", tokens: { emphasisWidth: "length", seriesA: "color" } },
    ]);
    expect(Object.isFrozen(extensions)).toBe(true);
    expect(Object.isFrozen(extensions[0])).toBe(true);
    expect(Object.isFrozen(extensions[0]?.tokens)).toBe(true);
  });

  it("rejects reserved namespaces and projected collisions", () => {
    expect(
      validateThemeExtensionDeclarations([{ namespace: "semantic", tokens: {} }]),
    ).toMatchObject({
      ok: false,
      code: "reserved_theme_extension_namespace",
      at: "themeExtensions[0].namespace",
    });
    expect(
      validateThemeExtensionDeclarations([
        { namespace: "brandTone", tokens: {} },
        { namespace: "brand-tone", tokens: {} },
      ]),
    ).toMatchObject({
      ok: false,
      code: "duplicate_theme_extension_namespace",
      at: "themeExtensions[1].namespace",
    });
  });

  it("rejects invalid token names, duplicate projected token names, and unknown kinds", () => {
    expect(
      validateThemeExtensionDeclarations([
        { namespace: "chart", tokens: { "bad token": "color" } },
      ]),
    ).toMatchObject({
      ok: false,
      code: "invalid_theme_extension_token",
    });
    expect(
      validateThemeExtensionDeclarations([
        { namespace: "chart", tokens: { seriesA: "color", "series-a": "color" } },
      ]),
    ).toMatchObject({
      ok: false,
      code: "duplicate_theme_extension_token",
    });
    expect(
      validateThemeExtensionDeclarations([{ namespace: "chart", tokens: { seriesA: "gradient" } }]),
    ).toMatchObject({
      ok: false,
      code: "invalid_theme_extension_token_kind",
    });
  });
});

function acceptedExtensions(
  value: unknown,
): readonly import("./theme.js").FacetThemeExtensionDeclaration[] {
  const result = validateThemeExtensionDeclarations(value);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected extension acceptance, got ${result.code}`);
  return result.extensions;
}
