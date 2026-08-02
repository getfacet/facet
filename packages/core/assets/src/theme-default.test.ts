import { readFileSync } from "node:fs";

import {
  FACET_THEME_CONTRACT,
  facetThemeToKebabCase,
  themeToCssVars,
  validateTheme,
} from "@facet/core";
import type { FacetTheme } from "@facet/core";
import { describe, expect, it } from "vitest";

import { DEFAULT_CATALOG } from "./catalog.js";
import { DEFAULT_THEME } from "./theme-default.js";

function flattenLayer(
  layer: Readonly<Record<string, Readonly<Record<string, string>>>>,
): readonly string[] {
  return Object.entries(layer).flatMap(([group, tokens]) =>
    Object.keys(tokens).map((token) => `${group}.${token}`),
  );
}

function sourceWithoutComments(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[^\n]*?\/\/[^\n]*$/gm, " ");
}

function importSpecifiers(source: string): readonly string[] {
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
}

const MODULE_SOURCE = sourceWithoutComments("./theme-default.ts");
const FOUNDATION_TOKEN_NAMES = Object.freeze(
  Object.fromEntries(
    FACET_THEME_CONTRACT.foundation.map((group) => [
      group.name,
      group.tokens.map((token) => token.name),
    ]),
  ),
) as Readonly<Record<string, readonly string[]>>;
const SEMANTIC_TOKEN_NAMES = Object.freeze(
  Object.fromEntries(
    FACET_THEME_CONTRACT.semantic.map((group) => [
      group.name,
      group.tokens.map((token) => token.name),
    ]),
  ),
) as Readonly<Record<string, readonly string[]>>;

describe("DEFAULT_THEME fills the core token contract exactly", () => {
  it("validates against foundation, semantic, and default catalog recipes", () => {
    const result = validateTheme(DEFAULT_THEME, { catalog: DEFAULT_CATALOG });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`${result.code} at ${result.at}: ${result.detail}`);
    expect(result.theme).toEqual(DEFAULT_THEME);
  });

  it("declares the required foundation and semantic groups in contract order", () => {
    expect(Object.keys(DEFAULT_THEME.foundation)).toEqual(Object.keys(FOUNDATION_TOKEN_NAMES));
    expect(Object.keys(DEFAULT_THEME.semantic)).toEqual(Object.keys(SEMANTIC_TOKEN_NAMES));
  });

  it("fills every required foundation and semantic token", () => {
    expect(flattenLayer(DEFAULT_THEME.foundation)).toEqual(
      Object.entries(FOUNDATION_TOKEN_NAMES).flatMap(([group, tokens]) =>
        tokens.map((token) => `${group}.${token}`),
      ),
    );
    expect(flattenLayer(DEFAULT_THEME.semantic)).toEqual(
      Object.entries(SEMANTIC_TOKEN_NAMES).flatMap(([group, tokens]) =>
        tokens.map((token) => `${group}.${token}`),
      ),
    );
  });

  it("fills the Default Recipe Contract v1 for all thirteen components", () => {
    expect(Object.keys(DEFAULT_THEME.recipes ?? {})).toEqual([
      "screen",
      "stack",
      "row",
      "grid",
      "modal",
      "card",
      "empty",
      "text",
      "metric",
      "badge",
      "button",
      "field",
      "table",
    ]);
    for (const spec of DEFAULT_CATALOG.components) {
      const namespace = facetThemeToKebabCase(spec.tag);
      expect(Object.keys(DEFAULT_THEME.recipes?.[namespace] ?? {}), spec.tag).toEqual(
        Object.keys(spec.themeRecipe?.tokens ?? {}),
      );
    }
  });

  it("projects prefixed custom properties for core and default recipe tokens", () => {
    const vars = themeToCssVars(DEFAULT_THEME, { catalog: DEFAULT_CATALOG });
    expect(vars["--facet-foundation-palette-brand500"]).toBe("#6366f1");
    expect(vars["--facet-semantic-text-muted"]).toBe("#475569");
    expect(vars["--facet-recipe-button-primary-bg"]).toBe(
      "var(--facet-semantic-action-primary-bg)",
    );
    expect(Object.keys(vars).every((name) => name.startsWith("--facet-"))).toBe(true);
  });
});

describe("DEFAULT_THEME is frozen, plain data", () => {
  it("freezes the theme and every nested token group", () => {
    expect(Object.isFrozen(DEFAULT_THEME)).toBe(true);
    for (const layer of [DEFAULT_THEME.foundation, DEFAULT_THEME.semantic, DEFAULT_THEME.recipes]) {
      expect(Object.isFrozen(layer)).toBe(true);
      for (const [group, tokens] of Object.entries(layer ?? {})) {
        expect(Object.isFrozen(tokens), group).toBe(true);
      }
    }
  });

  it("holds no accessor and round-trips as JSON", () => {
    for (const layer of [DEFAULT_THEME.foundation, DEFAULT_THEME.semantic, DEFAULT_THEME.recipes]) {
      for (const [group, tokens] of Object.entries(layer ?? {})) {
        for (const token of Object.keys(tokens as Record<string, string>)) {
          const descriptor = Object.getOwnPropertyDescriptor(tokens, token);
          expect(descriptor?.get, `${group}.${token}`).toBeUndefined();
          expect(descriptor?.writable, `${group}.${token}`).toBe(false);
        }
      }
    }
    expect(JSON.parse(JSON.stringify(DEFAULT_THEME)) as FacetTheme).toEqual(DEFAULT_THEME);
    expect(themeToCssVars(DEFAULT_THEME, { catalog: DEFAULT_CATALOG })).toEqual(
      themeToCssVars(DEFAULT_THEME, { catalog: DEFAULT_CATALOG }),
    );
  });
});

describe("the default theme module carries no runtime dependency outside core", () => {
  it("imports from @facet/core and nothing else", () => {
    const specifiers = importSpecifiers(MODULE_SOURCE);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).toBe("@facet/core");
    }
    expect(MODULE_SOURCE).not.toMatch(/\bimport\s+["']/);
    expect(MODULE_SOURCE).not.toMatch(/\brequire\s*\(/);
  });

  it("imports no React and no node builtin, asserted over the source", () => {
    expect(MODULE_SOURCE).not.toMatch(/react/i);
    expect(MODULE_SOURCE).not.toMatch(/["']node:/);
    expect(MODULE_SOURCE).not.toMatch(/\bfrom\s+["'](?:fs|path|url|os|crypto|process)["']/);
    expect(MODULE_SOURCE).not.toMatch(/\bprocess\s*\./);
  });

  it("touches no DOM global and no nondeterministic source", () => {
    expect(MODULE_SOURCE).not.toMatch(/\b(?:document|window|navigator|globalThis)\s*[.[]/);
    expect(MODULE_SOURCE).not.toMatch(/\bMath\.random\b|\bDate\.now\b|\bnew Date\b/);
  });

  it("carries no NUL byte in either owned file", () => {
    const nul = String.fromCharCode(0);
    for (const fileName of ["./theme-default.ts", "./theme-default.test.ts"]) {
      const raw = readFileSync(new URL(fileName, import.meta.url), "utf8");
      expect(raw.includes(nul), fileName).toBe(false);
    }
  });
});
