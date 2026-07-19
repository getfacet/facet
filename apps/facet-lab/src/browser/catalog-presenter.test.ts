import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "@facet/assets";

import { createCatalogModel } from "../catalog/catalog-model.js";
import { CATALOG_CATEGORY_ORDER, presentCatalog } from "./catalog-presenter.js";

const catalog = {
  sourceName: "package exports",
  assetDigest: "sha256:catalog",
  categories: [
    {
      id: "bricks",
      label: "Bricks",
      items: [
        {
          id: "brick:text",
          kind: "brick",
          name: "text",
          brick: "text",
          description: "Safe text content",
          definition: { description: "Text Brick" },
          diagnostics: [],
        },
      ],
    },
    {
      id: "presets",
      label: "Presets",
      items: [
        {
          id: "preset:text:heading",
          kind: "preset",
          name: "heading",
          brick: "text",
          definition: DEFAULT_THEME.presets?.text?.heading,
          diagnostics: [],
        },
      ],
    },
    {
      id: "patterns",
      label: "Patterns",
      items: [
        {
          id: "pattern:hero",
          kind: "pattern",
          name: "hero",
          definition: {
            name: "hero",
            root: "root",
            nodes: { root: { id: "root", type: "box", children: [] } },
          },
          diagnostics: [],
        },
        {
          id: "pattern:broken",
          kind: "pattern",
          name: "broken",
          definition: null,
          diagnostics: [
            { itemId: "pattern:broken", severity: "error", message: "Invalid Pattern" },
          ],
        },
      ],
    },
    {
      id: "token-values",
      label: "Token values",
      items: [
        {
          id: "token:color:accent",
          kind: "token",
          name: "accent",
          domain: "color",
          definition: { name: "accent", description: "Accent color" },
          diagnostics: [],
        },
      ],
    },
    {
      id: "fixed-choices",
      label: "Fixed choices",
      items: [
        {
          id: "fixed:direction:row",
          kind: "fixed",
          name: "row",
          domain: "direction",
          definition: { name: "row", description: "Horizontal flow" },
          diagnostics: [],
        },
      ],
    },
  ],
  totals: { bricks: 1, presets: 1, patterns: 2, tokenValues: 1, fixedChoices: 1 },
  diagnostics: [],
};

describe("catalog presenter", () => {
  it("accounts for every asset and item-scoped diagnostic", () => {
    const packageCatalog = createCatalogModel();
    const complete = presentCatalog({
      status: "ready",
      catalog: { ...packageCatalog, assetDigest: "sha256:package" },
    });
    const packageItemCount = packageCatalog.categories.reduce(
      (total, category) => total + category.items.length,
      0,
    );
    expect(complete.totalItems).toBe(packageItemCount);
    expect(complete.accountedItems).toBe(packageItemCount);
    expect(complete.unaccountedItemIds).toEqual([]);
    expect(
      complete.items.every(
        ({ outcome }) => outcome.status === "render" && outcome.previewTree !== null,
      ),
    ).toBe(true);

    const result = presentCatalog({ status: "ready", catalog });

    expect(result.state).toBe("ready");
    expect(result.categories.map(({ id }) => id)).toEqual(CATALOG_CATEGORY_ORDER);
    expect(result.totalItems).toBe(6);
    expect(result.accountedItems).toBe(6);
    expect(result.renderItems + result.diagnosticItems).toBe(result.totalItems);
    expect(result.unaccountedItemIds).toEqual([]);
    expect(result.categories.find(({ id }) => id === "patterns")?.items).toHaveLength(2);
    expect(result.items.find(({ id }) => id === "pattern:broken")?.outcome).toMatchObject({
      status: "diagnostic",
      diagnostics: [{ itemId: "pattern:broken", message: "Invalid Pattern" }],
    });
    expect(
      JSON.stringify(result.items.find(({ id }) => id === "token:color:accent")?.outcome),
    ).toContain('"background":"accent"');
    expect(
      JSON.stringify(result.items.find(({ id }) => id === "fixed:direction:row")?.outcome),
    ).toContain('"direction":"row"');

    const searched = presentCatalog({ status: "ready", catalog, query: "horizontal" });
    expect(searched.visibleItems).toBe(1);
    expect(searched.items[0]?.id).toBe("fixed:direction:row");

    const invalidPreset = presentCatalog({
      status: "ready",
      catalog: {
        ...catalog,
        categories: catalog.categories.map((category) =>
          category.id === "presets"
            ? {
                ...category,
                items: category.items.map((item) => ({ ...item, name: "bad name" })),
              }
            : category,
        ),
      },
    });
    expect(
      invalidPreset.items.find(({ id }) => id === "preset:text:heading")?.outcome,
    ).toMatchObject({
      status: "diagnostic",
      diagnostics: [{ message: "No valid safe preview could be built for this item." }],
    });

    const wrongPresetBrick = presentCatalog({
      status: "ready",
      catalog: {
        ...catalog,
        categories: catalog.categories.map((category) =>
          category.id === "presets"
            ? {
                ...category,
                items: category.items.map((item) => ({ ...item, brick: "box" })),
              }
            : category,
        ),
      },
    });
    expect(
      wrongPresetBrick.items.find(({ id }) => id === "preset:text:heading")?.outcome,
    ).toMatchObject({
      status: "diagnostic",
      diagnostics: [{ message: "No valid safe preview could be built for this item." }],
    });

    const mismatchedFixedChoice = presentCatalog({
      status: "ready",
      catalog: {
        ...catalog,
        categories: catalog.categories.map((category) =>
          category.id === "fixed-choices"
            ? {
                ...category,
                items: category.items.map((item) => ({
                  ...item,
                  definition: { name: "column", description: "Vertical flow" },
                })),
              }
            : category,
        ),
      },
    });
    expect(
      mismatchedFixedChoice.items.find(({ id }) => id === "fixed:direction:row")?.outcome,
    ).toMatchObject({
      status: "diagnostic",
      diagnostics: [{ message: "No valid safe preview could be built for this item." }],
    });

    for (const [categoryId, mismatch] of [
      ["bricks", { brick: "box" }],
      [
        "patterns",
        {
          definition: {
            name: "footer",
            root: "root",
            nodes: { root: { id: "root", type: "box", children: [] } },
          },
        },
      ],
    ] as const) {
      const incoherent = presentCatalog({
        status: "ready",
        catalog: {
          ...catalog,
          categories: catalog.categories.map((category) =>
            category.id === categoryId
              ? {
                  ...category,
                  items: category.items.map((item) => ({ ...item, ...mismatch })),
                }
              : category,
          ),
        },
      });
      expect(
        incoherent.categories.find(({ id }) => id === categoryId)?.items[0]?.outcome,
      ).toMatchObject({
        status: "diagnostic",
        diagnostics: [{ message: "No valid safe preview could be built for this item." }],
      });
    }
  });

  it("keeps loading, empty, and error states explicit", () => {
    expect(presentCatalog({ status: "loading" }).state).toBe("loading");
    expect(presentCatalog({ status: "error", errorMessage: "Catalog unavailable" })).toMatchObject({
      state: "error",
      statusMessage: "Catalog unavailable",
    });
    expect(
      presentCatalog({
        status: "ready",
        catalog: {
          ...catalog,
          categories: catalog.categories.map((category) => ({ ...category, items: [] })),
        },
      }).state,
    ).toBe("empty");
  });
});
