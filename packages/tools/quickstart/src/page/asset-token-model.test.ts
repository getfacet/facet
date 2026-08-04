import { readFileSync } from "node:fs";

import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import {
  FACET_THEME_CONTRACT,
  facetThemeToKebabCase,
  themeTokenRef,
  themeTokenVar,
} from "@facet/core";
import type { FacetThemeGroupSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_CSS_VARS,
  DEFAULT_THEME_TOKEN_ROWS,
  deriveDefaultThemeTokenRows,
  type AssetTokenRow,
} from "./asset-token-model.js";

function contractPaths(
  layer: "foundation" | "semantic",
  groups: readonly FacetThemeGroupSpec[],
): readonly string[] {
  return groups.flatMap((group) =>
    group.tokens.map((token) => `${layer}.${group.name}.${token.name}`),
  );
}

function recipePaths(): readonly string[] {
  return DEFAULT_CATALOG.components.flatMap((spec) => {
    const namespace = facetThemeToKebabCase(spec.tag);
    return Object.keys(spec.themeRecipe?.tokens ?? {}).map(
      (token) => `recipe.${namespace}.${token}`,
    );
  });
}

function rowMap(rows: readonly AssetTokenRow[]): ReadonlyMap<string, AssetTokenRow> {
  return new Map(rows.map((row) => [row.path, row]));
}

describe("asset token model", () => {
  it("derives foundation semantic and recipe token rows from the default assets", () => {
    const rows = deriveDefaultThemeTokenRows();
    const expectedPaths = [
      ...contractPaths("foundation", FACET_THEME_CONTRACT.foundation),
      ...contractPaths("semantic", FACET_THEME_CONTRACT.semantic),
      ...recipePaths(),
    ];

    expect(rows.map((row) => row.path)).toEqual(expectedPaths);

    const byPath = rowMap(rows);
    expect(byPath.get("foundation.palette.brand500")).toMatchObject({
      layer: "foundation",
      group: "palette",
      token: "brand500",
      kind: "color",
      value: DEFAULT_THEME.foundation.palette.brand500,
      cssVariable: themeTokenVar({ layer: "foundation", group: "palette", token: "brand500" }),
      cssReference: themeTokenRef({ layer: "foundation", group: "palette", token: "brand500" }),
      visual: { kind: "color", value: DEFAULT_THEME.foundation.palette.brand500 },
    });
    expect(byPath.get("semantic.focus.ringWidth")).toMatchObject({
      layer: "semantic",
      group: "focus",
      token: "ringWidth",
      kind: "length",
      value: DEFAULT_THEME.semantic.focus.ringWidth,
      visual: { kind: "length", value: DEFAULT_THEME.semantic.focus.ringWidth },
    });
    expect(byPath.get("recipe.button.primaryBg")).toMatchObject({
      layer: "recipe",
      namespace: "button",
      token: "primaryBg",
      kind: "color",
      value: DEFAULT_THEME.recipes?.button?.primaryBg,
      cssVariable: themeTokenVar({ layer: "recipe", namespace: "button", token: "primaryBg" }),
      cssReference: themeTokenRef({ layer: "recipe", namespace: "button", token: "primaryBg" }),
      visual: {
        kind: "color",
        value: DEFAULT_THEME.recipes?.button?.primaryBg,
        referencedVariables: ["--facet-semantic-action-primary-bg"],
      },
    });

    for (const spec of DEFAULT_CATALOG.components) {
      const namespace = facetThemeToKebabCase(spec.tag);
      const recipeRows = rows.filter(
        (row): row is Extract<AssetTokenRow, { readonly layer: "recipe" }> =>
          row.layer === "recipe" && row.namespace === namespace,
      );
      expect(
        recipeRows.map((row) => [row.token, row.kind]),
        spec.tag,
      ).toEqual(Object.entries(spec.themeRecipe?.tokens ?? {}));
      expect(
        recipeRows.map((row) => row.value),
        spec.tag,
      ).toEqual(
        Object.keys(spec.themeRecipe?.tokens ?? {}).map(
          (token) => DEFAULT_THEME.recipes?.[namespace]?.[token],
        ),
      );
    }
  });

  it("exposes frozen default rows for page rendering", () => {
    expect(DEFAULT_THEME_TOKEN_ROWS).toEqual(deriveDefaultThemeTokenRows());
    expect(Object.isFrozen(DEFAULT_THEME_TOKEN_ROWS)).toBe(true);
    for (const row of DEFAULT_THEME_TOKEN_ROWS) {
      expect(Object.isFrozen(row), row.path).toBe(true);
      expect(Object.isFrozen(row.visual), row.path).toBe(true);
      expect(Object.isFrozen(row.visual.referencedVariables), row.path).toBe(true);
    }
  });

  it("exposes the projected theme variables needed by recipe visual samples", () => {
    for (const row of DEFAULT_THEME_TOKEN_ROWS) {
      for (const variable of row.visual.referencedVariables) {
        expect(DEFAULT_THEME_CSS_VARS[variable], `${row.path} references ${variable}`).toBeTypeOf(
          "string",
        );
      }
    }
  });

  it("imports only public asset/core surfaces and no transport APIs", () => {
    const source = readFileSync(new URL("./asset-token-model.ts", import.meta.url), "utf8");
    const importSpecifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    );

    expect(new Set(importSpecifiers)).toEqual(new Set(["@facet/assets", "@facet/core"]));
    expect(source).not.toMatch(
      /\b(?:fetch|SseTransport|LocalTransport|StageRenderer|useFacet|sendEvent|sendMessage)\b/,
    );
    expect(source).not.toMatch(/["']@facet\/(?:server|client|runtime|react|agent-client)["']/);
  });
});
