import { DEFAULT_THEME } from "@facet/assets";
import {
  validateAuthorTree,
  validatePatternList,
  validateTheme,
  type FacetTree,
} from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  REFERENCE_BENCHMARK_CUSTOM_ASSETS,
  customAssetsForBenchmark,
  validateReferenceBenchmarkCustomAssets,
} from "./reference-benchmark-custom-assets.js";
import { AMA2_BENCHMARK_THEME } from "./reference-benchmark-assets-ama2.js";
import { REFERENCE_BENCHMARKS } from "./reference-benchmarks.js";

function px(value: string): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)px$/u.exec(value);
  if (match === null) throw new Error(`Expected px token, got ${value}`);
  return Number(match[1]);
}

function benchmarkFixture(id: string): FacetTree {
  const benchmark = REFERENCE_BENCHMARKS.find((candidate) => candidate.id === id);
  if (benchmark === undefined) throw new Error(`Missing benchmark ${id}`);
  return benchmark.fixture;
}

function usedPresets(tree: FacetTree): ReadonlySet<string> {
  const presets = new Set<string>();
  for (const node of Object.values(tree.nodes)) {
    const preset = node.style?.preset;
    if (preset !== undefined) presets.add(`${node.type}:${preset}`);
  }
  return presets;
}

function nodePreset(tree: FacetTree, id: string): string | undefined {
  const preset = tree.nodes[id]?.style?.preset;
  return typeof preset === "string" ? preset : undefined;
}

describe("reference benchmark custom assets", () => {
  it("validates benchmark-specific custom assets", () => {
    expect(Object.keys(REFERENCE_BENCHMARK_CUSTOM_ASSETS).sort()).toEqual([
      "ama2-messages-app",
      "ama2-public-landing",
      "coupang-product-listing",
      "google-search-console-performance",
      "linktree-selena-gomez",
      "supabase-table-editor",
    ]);

    for (const assets of Object.values(REFERENCE_BENCHMARK_CUSTOM_ASSETS)) {
      const result = validateReferenceBenchmarkCustomAssets(assets);
      expect(result.issues, assets.benchmarkId).toEqual([]);
      expect(result.assets?.theme.name, assets.benchmarkId).toBe(assets.benchmarkId);
      expect(validateTheme(assets.theme).theme, assets.benchmarkId).toBeDefined();
      expect(validatePatternList(assets.patterns, assets.theme).issues, assets.benchmarkId).toEqual(
        [],
      );
      expect(assets.patterns.length, assets.benchmarkId).toBeGreaterThanOrEqual(2);
      for (const pattern of assets.patterns) {
        expect(pattern.name, assets.benchmarkId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      }
    }
  });

  it("diagnoses malformed custom asset bundles without throwing", () => {
    expect(() => validateReferenceBenchmarkCustomAssets(null)).not.toThrow();
    const nullResult = validateReferenceBenchmarkCustomAssets(null);
    expect(nullResult.assets).toBeUndefined();
    expect(nullResult.issues).toEqual([
      { benchmarkId: "unknown", message: "Custom asset bundle is malformed." },
    ]);

    const malformed = validateReferenceBenchmarkCustomAssets({
      benchmarkId: "supabase-table-editor",
      theme: { ...DEFAULT_THEME, name: "invalid theme" },
      patterns: "not patterns",
      density: "wide",
      notes: [],
    });

    expect(malformed.assets).toBeUndefined();
    expect(malformed.issues.map(({ message }) => message).join("\n")).toMatch(
      /Custom theme is invalid|Custom patterns are invalid|density|notes/u,
    );
  });

  it("validates benchmark fixtures against their benchmark-specific assets", () => {
    for (const benchmark of REFERENCE_BENCHMARKS) {
      const customAssets = customAssetsForBenchmark(benchmark.id);
      const theme = customAssets?.theme ?? DEFAULT_THEME;
      const validation = validateAuthorTree(benchmark.fixture, theme);
      expect(validation.issues, benchmark.id).toEqual([]);
      expect(validation.omittedErrorCount, benchmark.id).toBe(0);
    }
  });

  it("keeps Supabase dense and AMA2 roomy through theme tokens and presets", () => {
    const supabase = customAssetsForBenchmark("supabase-table-editor");
    const ama2 = customAssetsForBenchmark("ama2-public-landing");
    expect(supabase).toBeDefined();
    expect(ama2).toBeDefined();

    expect(supabase?.density).toBe("dense");
    expect(ama2?.density).toBe("roomy");
    expect(px(supabase?.theme.tokens.space.md ?? "0px")).toBeLessThan(
      px(DEFAULT_THEME.tokens.space.md),
    );
    expect(px(ama2?.theme.tokens.space.xl ?? "0px")).toBeGreaterThan(
      px(DEFAULT_THEME.tokens.space.xl),
    );
    expect(px(supabase?.theme.tokens.fontSize.md ?? "0px")).toBeLessThan(
      px(DEFAULT_THEME.tokens.fontSize.md),
    );
    expect(px(ama2?.theme.tokens.fontSize["3xl"] ?? "0px")).toBeGreaterThan(
      px(DEFAULT_THEME.tokens.fontSize["3xl"]),
    );

    expect(supabase?.theme.presets?.box?.appShell).toBeDefined();
    expect(supabase?.theme.presets?.table?.dataGrid).toBeDefined();
    expect(ama2?.theme.presets?.box?.heroBand).toBeDefined();
    expect(ama2?.theme.presets?.box?.ctaPrimary).toBeDefined();
  });

  it("authors Supabase and AMA2 fixtures from their custom presets", () => {
    const supabasePresets = usedPresets(benchmarkFixture("supabase-table-editor"));
    expect([...supabasePresets]).toEqual(
      expect.arrayContaining([
        "box:appShell",
        "box:topbar",
        "box:sidebar",
        "box:toolbar",
        "box:controlPill",
        "text:consoleLabel",
        "text:consoleStrong",
        "table:dataGrid",
      ]),
    );

    const ama2Presets = usedPresets(benchmarkFixture("ama2-public-landing"));
    expect([...ama2Presets]).toEqual(
      expect.arrayContaining([
        "box:landingShell",
        "box:navBar",
        "box:heroBand",
        "box:sectionBand",
        "box:heroActions",
        "box:ctaPrimary",
        "box:ctaSecondary",
        "box:featureCard",
        "box:showcasePanel",
        "text:navLink",
        "text:heroBrand",
        "text:heroTitle",
        "text:heroBody",
        "text:sectionTitle",
        "media:productMock",
      ]),
    );
  });

  it("guards against the AMA2 benchmark regressions seen in visual QA", () => {
    const ama2 = benchmarkFixture("ama2-public-landing");
    const serialized = JSON.stringify(ama2);

    expect(serialized).not.toContain("ama2-aurora-backdrop");
    expect(serialized).not.toContain('"fontSize":"4xl"');
    expect(nodePreset(ama2, "ama2-hero")).toBe("heroBand");
    expect(nodePreset(ama2, "ama2-hero-actions")).toBe("heroActions");
    expect(nodePreset(ama2, "ama2-primary-cta")).toBe("ctaPrimary");
    expect(nodePreset(ama2, "ama2-secondary-cta")).toBe("ctaSecondary");
    expect(nodePreset(ama2, "ama2-title-brand")).toBe("heroBrand");
    expect(nodePreset(ama2, "ama2-title-main")).toBe("heroTitle");
    expect(nodePreset(ama2, "ama2-title-line-two")).toBe("heroTitle");
    expect(px(AMA2_BENCHMARK_THEME.tokens.fontSize["4xl"])).toBeLessThanOrEqual(68);
  });
});
