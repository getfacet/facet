import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import { BRICK_CONTRACT, BRICK_TYPES, STYLE_VALUE_CONTRACT, type FacetPattern } from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  PACKAGE_CATALOG_SOURCE,
  createCatalogModel,
  type CatalogBrickItem,
  type CatalogCategoryId,
  type CatalogModel,
} from "./catalog-model.js";

function itemsIn(model: CatalogModel, categoryId: CatalogCategoryId) {
  return model.categories.find(({ id }) => id === categoryId)?.items ?? [];
}

function brickItemsIn(model: CatalogModel): readonly CatalogBrickItem[] {
  return itemsIn(model, "bricks").filter((item): item is CatalogBrickItem => item.kind === "brick");
}

describe("createCatalogModel", () => {
  it("derives all package assets without a Lab roster", () => {
    const model = createCatalogModel();

    expect(model.totals).toEqual({
      bricks: 11,
      presets: 43,
      patterns: 17,
      tokenValues: 106,
      fixedChoices: 39,
    });

    expect(brickItemsIn(model).map(({ id }) => id)).toEqual(
      BRICK_TYPES.map((brick) => `brick:${brick}`),
    );
    expect(brickItemsIn(model).map(({ definition }) => definition)).toEqual(
      BRICK_TYPES.map((brick) => BRICK_CONTRACT[brick]),
    );
    expect(brickItemsIn(model).map(({ defaultStyle }) => defaultStyle)).toEqual(
      BRICK_TYPES.map((brick) => DEFAULT_THEME.defaults[brick]),
    );
    expect(itemsIn(model, "presets").map(({ id }) => id)).toEqual(
      Object.entries(DEFAULT_THEME.presets ?? {}).flatMap(([brick, presets]) =>
        Object.keys(presets ?? {}).map((preset) => `preset:${brick}:${preset}`),
      ),
    );
    expect(itemsIn(model, "presets").map(({ definition }) => definition)).toEqual(
      Object.values(DEFAULT_THEME.presets ?? {}).flatMap((presets) => Object.values(presets ?? {})),
    );
    expect(itemsIn(model, "patterns").map(({ id }) => id)).toEqual(
      DEFAULT_PATTERNS.map(({ name }) => `pattern:${name}`),
    );
    expect(itemsIn(model, "patterns").map(({ definition }) => definition)).toEqual(
      DEFAULT_PATTERNS,
    );
    expect(itemsIn(model, "token-values").map(({ id }) => id)).toEqual(
      Object.entries(STYLE_VALUE_CONTRACT.tokens).flatMap(([domain, definition]) =>
        definition.values.map(({ name }) => `token:${domain}:${String(name)}`),
      ),
    );
    expect(itemsIn(model, "fixed-choices").map(({ id }) => id)).toEqual(
      Object.entries(STYLE_VALUE_CONTRACT.fixed).flatMap(([domain, definition]) =>
        definition.values.map(({ name }) => `fixed:${domain}:${String(name)}`),
      ),
    );
    expect(model.diagnostics).toEqual([]);

    const basePattern = DEFAULT_PATTERNS[0];
    if (basePattern === undefined) throw new Error("Expected at least one default Pattern.");
    const injectedPattern: FacetPattern = {
      ...basePattern,
      name: "injected-pattern",
    };
    const injected = createCatalogModel({
      ...PACKAGE_CATALOG_SOURCE,
      patterns: [...DEFAULT_PATTERNS, injectedPattern],
    });

    expect(injected.totals.patterns).toBe(model.totals.patterns + 1);
    expect(itemsIn(injected, "patterns").at(-1)).toMatchObject({
      id: "pattern:injected-pattern",
      definition: injectedPattern,
    });
  });

  it("keeps every catalog category explicit when its package source is empty", () => {
    const model = createCatalogModel({
      ...PACKAGE_CATALOG_SOURCE,
      brickTypes: [],
      brickContract: {},
      styleValueContract: { tokens: {}, fixed: {} },
      theme: { ...DEFAULT_THEME, presets: {} },
      patterns: [],
    });

    expect(model.categories.map(({ id }) => id)).toEqual([
      "bricks",
      "presets",
      "patterns",
      "token-values",
      "fixed-choices",
    ]);
    expect(model.categories.every(({ items }) => items.length === 0)).toBe(true);
  });
});
