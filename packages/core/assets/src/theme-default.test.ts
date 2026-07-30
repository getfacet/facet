import { readFileSync } from "node:fs";

import { themeToCssVars, validateTheme } from "@facet/core";
import type { FacetTheme } from "@facet/core";
import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "./theme-default.js";

/**
 * The token-name contract is closed in both directions, so a default theme is
 * only correct if it fills it **exactly**: 9 groups, 37 names, no more and no
 * fewer. These tests therefore assert the shape by walking the value rather than
 * by trusting `validateTheme` alone — a token added to `@facet/core` without a
 * default supplied here has to fail loudly at this seam, not silently later in a
 * renderer reading a variable that was never projected.
 */

/** Every token in the theme as `group.token` / value pairs, walked from the value. */
function tokenEntries(theme: FacetTheme): ReadonlyArray<readonly [string, string]> {
  return Object.entries(theme).flatMap(([group, tokens]) =>
    Object.entries(tokens as Record<string, string>).map(
      ([token, value]) => [`${group}.${token}`, value] as const,
    ),
  );
}

/** One owned module's source, comments stripped, so prose cannot satisfy or trip a check. */
function sourceWithoutComments(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[^\n]*?\/\/[^\n]*$/gm, " ");
}

/** Every module specifier the source imports from, in source order. */
function importSpecifiers(source: string): readonly string[] {
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
}

const MODULE_SOURCE = sourceWithoutComments("./theme-default.ts");

describe("DEFAULT_THEME fills the core token contract exactly", () => {
  it("validates against the core contract", () => {
    const result = validateTheme(DEFAULT_THEME);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`${result.code} at ${result.at}: ${result.detail}`);
    }
    expect(result.theme).toEqual(DEFAULT_THEME);
  });

  it("declares the nine required token groups, in contract order", () => {
    expect(Object.keys(DEFAULT_THEME)).toEqual([
      "color",
      "space",
      "radius",
      "borderWidth",
      "shadow",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
    ]);
  });

  it("supplies exactly the thirty-seven token names, walked from the value", () => {
    expect(tokenEntries(DEFAULT_THEME).map(([name]) => name)).toEqual([
      "color.background",
      "color.surface",
      "color.border",
      "color.text",
      "color.textMuted",
      "color.accent",
      "color.onAccent",
      "color.success",
      "color.warning",
      "color.danger",
      "space.xs",
      "space.sm",
      "space.md",
      "space.lg",
      "space.xl",
      "radius.sm",
      "radius.md",
      "radius.lg",
      "radius.full",
      "borderWidth.thin",
      "borderWidth.thick",
      "shadow.sm",
      "shadow.md",
      "shadow.lg",
      "fontFamily.sans",
      "fontFamily.mono",
      "fontSize.xs",
      "fontSize.sm",
      "fontSize.md",
      "fontSize.lg",
      "fontSize.xl",
      "fontWeight.regular",
      "fontWeight.medium",
      "fontWeight.bold",
      "lineHeight.tight",
      "lineHeight.normal",
      "lineHeight.relaxed",
    ]);
    expect(tokenEntries(DEFAULT_THEME)).toHaveLength(37);
  });

  it("gives every token a non-empty string value", () => {
    for (const [name, value] of tokenEntries(DEFAULT_THEME)) {
      expect(typeof value, name).toBe("string");
      expect(value.trim().length, name).toBeGreaterThan(0);
    }
  });

  it("projects to thirty-seven prefixed custom properties", () => {
    const vars = themeToCssVars(DEFAULT_THEME);
    const names = Object.keys(vars);
    expect(names).toHaveLength(37);
    for (const name of names) {
      expect(name.startsWith("--facet-"), name).toBe(true);
    }
    // The one projection the trusted React components read by its kebab-cased
    // name; if a default for it ever went missing this row would disappear.
    expect(vars["--facet-color-text-muted"]).toBe(DEFAULT_THEME.color.textMuted);
  });
});

describe("DEFAULT_THEME is frozen, plain data", () => {
  it("freezes the theme and every token group", () => {
    expect(Object.isFrozen(DEFAULT_THEME)).toBe(true);
    for (const [group, tokens] of Object.entries(DEFAULT_THEME)) {
      expect(Object.isFrozen(tokens), group).toBe(true);
    }
  });

  it("holds no accessor, so repeat reads are byte-identical", () => {
    for (const [group, tokens] of Object.entries(DEFAULT_THEME)) {
      for (const token of Object.keys(tokens as Record<string, string>)) {
        const descriptor = Object.getOwnPropertyDescriptor(tokens, token);
        expect(descriptor?.get, `${group}.${token}`).toBeUndefined();
        expect(descriptor?.writable, `${group}.${token}`).toBe(false);
      }
    }
    expect(JSON.stringify(DEFAULT_THEME)).toBe(JSON.stringify(DEFAULT_THEME));
    expect(themeToCssVars(DEFAULT_THEME)).toEqual(themeToCssVars(DEFAULT_THEME));
  });
});

describe("the default theme module carries no runtime dependency", () => {
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
