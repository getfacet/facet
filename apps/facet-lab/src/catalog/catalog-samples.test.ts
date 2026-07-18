import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import { BRICK_TYPES, validateAuthorTree, type FacetPattern } from "@facet/core";
import { describe, expect, it } from "vitest";

import { BRICK_SAMPLE_CONSTRUCTORS } from "./catalog-brick-samples.js";
import { PACKAGE_CATALOG_SOURCE, createCatalogModel } from "./catalog-model.js";
import { createCatalogSamples } from "./catalog-samples.js";

describe("createCatalogSamples", () => {
  it("derives all package assets without a Lab roster", () => {
    expect(Object.keys(BRICK_SAMPLE_CONSTRUCTORS)).toEqual(BRICK_TYPES);

    const model = createCatalogModel();
    const samples = createCatalogSamples();
    const previewItems = model.categories
      .flatMap(({ items }) => items)
      .filter(({ kind }) => kind === "brick" || kind === "preset" || kind === "pattern");

    expect(samples.map(({ itemId }) => itemId)).toEqual(previewItems.map(({ id }) => id));
    expect(samples.every(({ status }) => status === "render")).toBe(true);

    for (const sample of samples) {
      if (sample.status !== "render") continue;
      expect(validateAuthorTree(sample.tree, DEFAULT_THEME).issues, sample.itemId).toEqual([]);
      if (sample.kind === "brick") {
        expect(
          new TextEncoder().encode(JSON.stringify(sample.tree)).byteLength,
        ).toBeLessThanOrEqual(2 * 1024);
      }
      if (sample.kind === "preset") {
        expect(sample.tree.nodes[sample.nodeId]?.style?.preset).toBe(sample.preset);
      }
    }

    const patternSamples = samples.filter(
      (sample) => sample.status === "render" && sample.kind === "pattern",
    );
    const basePattern = DEFAULT_PATTERNS[0];
    if (basePattern === undefined) throw new Error("Expected at least one default Pattern.");
    expect(patternSamples).toHaveLength(DEFAULT_PATTERNS.length);
    expect(patternSamples[0]?.tree).toEqual({
      root: basePattern.root,
      nodes: basePattern.nodes,
      ...(basePattern.screens === undefined ? {} : { screens: basePattern.screens }),
      ...(basePattern.entry === undefined ? {} : { entry: basePattern.entry }),
      ...(basePattern.data === undefined ? {} : { data: basePattern.data }),
    });

    const injectedPattern: FacetPattern = {
      ...basePattern,
      name: "injected-preview",
    };
    const injected = createCatalogSamples({
      ...PACKAGE_CATALOG_SOURCE,
      patterns: [...DEFAULT_PATTERNS, injectedPattern],
    });
    expect(injected.at(-1)).toMatchObject({
      status: "render",
      itemId: "pattern:injected-preview",
      kind: "pattern",
    });
  });

  it("isolates an invalid package item as a diagnostic without hiding healthy previews", () => {
    const basePattern = DEFAULT_PATTERNS[0];
    if (basePattern === undefined) throw new Error("Expected at least one default Pattern.");
    const brokenPattern: FacetPattern = {
      ...basePattern,
      name: "broken-preview",
      root: "missing",
    };
    const samples = createCatalogSamples({
      ...PACKAGE_CATALOG_SOURCE,
      patterns: [...DEFAULT_PATTERNS, brokenPattern],
    });
    const broken = samples.find(({ itemId }) => itemId === "pattern:broken-preview");

    expect(broken).toMatchObject({
      status: "diagnostic",
      itemId: "pattern:broken-preview",
      kind: "pattern",
    });
    expect(samples.filter(({ status }) => status === "render")).toHaveLength(
      BRICK_TYPES.length +
        Object.values(DEFAULT_THEME.presets ?? {}).reduce(
          (total, presets) => total + Object.keys(presets ?? {}).length,
          0,
        ) +
        DEFAULT_PATTERNS.length,
    );
  });
});
