import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import { BRICK_TYPES, validateAuthorTree, type BrickType, type FacetTree } from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  REFERENCE_BENCHMARK_AUTHORING_PROTOCOL,
  REFERENCE_BENCHMARKS,
  REFERENCE_BENCHMARK_GAP_CATEGORIES,
  REFERENCE_BENCHMARK_IDS,
  benchmarkUsesBrick,
  referenceBenchmarkById,
} from "./reference-benchmarks.js";
import { customAssetsForBenchmark } from "./reference-benchmark-custom-assets.js";

function nonEmptyBounded(value: string, maximum = 1_000): boolean {
  return value.trim() === value && value.length > 0 && value.length <= maximum;
}

function reachableNodeIds(tree: FacetTree): ReadonlySet<string> {
  const seen = new Set<string>();
  const pending = [tree.root];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const node = tree.nodes[id];
    if (node?.type !== "box") continue;
    if (node.backdrop !== undefined) pending.push(node.backdrop);
    pending.push(...node.children);
  }
  return seen;
}

describe("Facet Lab reference benchmarks", () => {
  it("locks a repeatable human-authored reference-fidelity protocol", () => {
    expect(REFERENCE_BENCHMARK_AUTHORING_PROTOCOL).toHaveLength(5);
    for (const step of REFERENCE_BENCHMARK_AUTHORING_PROTOCOL) {
      expect(nonEmptyBounded(step, 240)).toBe(true);
    }
    expect(REFERENCE_BENCHMARK_AUTHORING_PROTOCOL.join(" ")).toContain("human-authored");
    expect(REFERENCE_BENCHMARK_AUTHORING_PROTOCOL.join(" ")).toContain("side-by-side");
  });

  it("locks eleven real-service benchmark targets with bounded metadata", () => {
    expect(REFERENCE_BENCHMARK_IDS).toEqual([
      "supabase-table-editor",
      "ama2-public-landing",
      "ama2-messages-app",
      "ops-issue-console",
      "admin-billing-settings",
      "coupang-product-listing",
      "commerce-product-checkout",
      "linktree-selena-gomez",
      "link-in-bio-creator",
      "google-search-console-performance",
      "executive-report-brief",
    ]);
    expect(REFERENCE_BENCHMARKS.map(({ id }) => id)).toEqual(REFERENCE_BENCHMARK_IDS);
    expect(new Set(REFERENCE_BENCHMARKS.map(({ id }) => id)).size).toBe(11);

    const seenCategories = new Set<string>();
    for (const benchmark of REFERENCE_BENCHMARKS) {
      expect(benchmark.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      expect(nonEmptyBounded(benchmark.name, 120), benchmark.id).toBe(true);
      expect(nonEmptyBounded(benchmark.serviceType, 120), benchmark.id).toBe(true);
      expect(nonEmptyBounded(benchmark.goal, 500), benchmark.id).toBe(true);
      expect(benchmark.referenceSources.length, benchmark.id).toBeGreaterThan(0);
      for (const source of benchmark.referenceSources) {
        expect(nonEmptyBounded(source.label, 160), benchmark.id).toBe(true);
        expect(source.url, benchmark.id).toMatch(/^https:\/\/[^ ]+$/u);
        expect(nonEmptyBounded(source.useFor, 240), benchmark.id).toBe(true);
      }
      for (const note of benchmark.targetNotes) {
        expect(nonEmptyBounded(note, 500), benchmark.id).toBe(true);
      }
      for (const item of benchmark.qaChecklist) {
        expect(nonEmptyBounded(item, 300), benchmark.id).toBe(true);
      }
      for (const gap of benchmark.gaps) {
        expect(REFERENCE_BENCHMARK_GAP_CATEGORIES).toContain(gap.category);
        expect(["watch", "blocking"]).toContain(gap.severity);
        expect(nonEmptyBounded(gap.summary, 500), benchmark.id).toBe(true);
        seenCategories.add(gap.category);
      }
    }
    expect(seenCategories).toEqual(new Set(REFERENCE_BENCHMARK_GAP_CATEGORIES));
  });

  it("keeps every target fixture inside the closed Facet Brick and benchmark-specific asset contract", () => {
    const knownBricks = new Set<string>(BRICK_TYPES);
    const brandedTreeText =
      /\b(?:Amplitude|Linear|Stripe|Shopify|Linktree|Beacons|Notion|logo)\b/iu;

    for (const benchmark of REFERENCE_BENCHMARKS) {
      const customAssets = customAssetsForBenchmark(benchmark.id);
      const theme = customAssets?.theme ?? DEFAULT_THEME;
      const knownPatterns = new Set(
        (customAssets?.patterns ?? DEFAULT_PATTERNS).map(({ name }) => name),
      );
      const validation = validateAuthorTree(benchmark.fixture, theme);
      expect(validation.issues, benchmark.id).toEqual([]);
      expect(validation.omittedErrorCount, benchmark.id).toBe(0);
      expect(JSON.stringify(benchmark.fixture), benchmark.id).not.toMatch(brandedTreeText);

      const nodes = Object.values(benchmark.fixture.nodes);
      const seenBricks = new Set(nodes.map(({ type }) => type));
      const seenPresets = new Set(
        nodes.flatMap((node) =>
          node.style?.preset === undefined ? [] : [`${node.type}:${node.style.preset}`],
        ),
      );
      expect(
        [...seenBricks].every((brick) => knownBricks.has(brick)),
        benchmark.id,
      ).toBe(true);

      for (const brick of benchmark.expectedAssets.bricks) {
        expect(benchmarkUsesBrick(benchmark, brick), `${benchmark.id}:${brick}`).toBe(true);
      }
      for (const preset of benchmark.expectedAssets.presets) {
        expect(theme.presets?.[preset.brick]?.[preset.name], benchmark.id).toBeDefined();
        expect(seenPresets.has(`${preset.brick}:${preset.name}`), benchmark.id).toBe(true);
      }
      for (const pattern of customAssets?.patterns ?? DEFAULT_PATTERNS) {
        expect(knownPatterns.has(pattern.name), `${benchmark.id}:${pattern.name}`).toBe(true);
      }
    }
  });

  it("uses media icons and classifies residual benchmark gaps", () => {
    expect(REFERENCE_BENCHMARK_GAP_CATEGORIES).toEqual([
      "authoring",
      "asset-guidance",
      "brick-vocabulary",
      "renderer-quality",
    ]);

    const serializedGaps = JSON.stringify(REFERENCE_BENCHMARKS.flatMap(({ gaps }) => gaps));
    expect(serializedGaps).not.toContain("theme-preset");
    expect(serializedGaps).not.toContain("pattern-sample");
    expect(serializedGaps).not.toMatch(/no icon primitive/iu);
    expect(serializedGaps).not.toMatch(/cannot express dashed/iu);

    const seenCategories = new Set(
      REFERENCE_BENCHMARKS.flatMap((benchmark) => benchmark.gaps.map(({ category }) => category)),
    );
    expect(seenCategories).toEqual(new Set(REFERENCE_BENCHMARK_GAP_CATEGORIES));

    for (const benchmark of REFERENCE_BENCHMARKS) {
      for (const gap of benchmark.gaps) {
        expect(REFERENCE_BENCHMARK_GAP_CATEGORIES).toContain(gap.category);
      }
    }
  });

  describe("analytics-data-surface benchmark adoption", () => {
    function nodesOf(id: (typeof REFERENCE_BENCHMARK_IDS)[number]) {
      const benchmark = referenceBenchmarkById(id);
      expect(benchmark, id).toBeDefined();
      return Object.values(benchmark?.fixture.nodes ?? {});
    }

    it("uses the dual-scale chart axis in the GSC comparison fixture", () => {
      const charts = nodesOf("google-search-console-performance").filter(
        (node) => node.type === "chart",
      );
      expect(charts.length).toBeGreaterThan(0);
      const series = charts.flatMap((chart) => (chart.type === "chart" ? [...chart.series] : []));
      expect(series.some((entry) => entry.axis === "secondary")).toBe(true);
      expect(series.some((entry) => entry.axis === undefined || entry.axis === "primary")).toBe(
        true,
      );
    });

    it("uses closed column widths and dividers in the GSC query table", () => {
      const tables = nodesOf("google-search-console-performance").filter(
        (node) => node.type === "table",
      );
      expect(tables.length).toBeGreaterThan(0);
      const columns = tables.flatMap((table) => (table.type === "table" ? [...table.columns] : []));
      expect(columns.some((column) => column.width === "wide")).toBe(true);
      expect(columns.some((column) => column.width === "narrow")).toBe(true);
    });

    it("uses sticky header, grid dividers, widths, and an authored empty label in the Supabase grid", () => {
      const tables = nodesOf("supabase-table-editor").filter((node) => node.type === "table");
      expect(tables.length).toBeGreaterThan(0);
      const grid = tables.find((table) => table.type === "table" && table.rows.length === 0);
      expect(grid).toBeDefined();
      if (grid?.type !== "table") return;
      expect(grid.emptyLabel).toBeDefined();
      expect(grid.style?.stickyHeader).toBe(true);
      expect(grid.style?.dividers).toBe("grid");
      expect(grid.columns.some((column) => column.width !== undefined)).toBe(true);
    });

    it("uses row dividers in the executive report table", () => {
      const tables = nodesOf("executive-report-brief").filter((node) => node.type === "table");
      expect(tables.length).toBeGreaterThan(0);
      expect(
        tables.some((table) => table.type === "table" && table.style?.dividers === "rows"),
      ).toBe(true);
    });

    it("clears or re-scopes the chart/table renderer-quality blocking gap entries", () => {
      const gaps = REFERENCE_BENCHMARKS.flatMap(({ gaps: entries }) => entries);
      expect(
        gaps.filter((gap) => gap.category === "renderer-quality" && gap.severity === "blocking"),
      ).toEqual([]);
      const serialized = JSON.stringify(gaps);
      expect(serialized).not.toMatch(/no dual-axis/iu);
      expect(serialized).not.toMatch(/per-series scale controls/iu);
      expect(serialized).not.toMatch(/cannot express sticky headers/iu);
    });
  });

  describe("box-layout-foundation benchmark adoption", () => {
    function boxStylesOf(id: (typeof REFERENCE_BENCHMARK_IDS)[number]) {
      const benchmark = referenceBenchmarkById(id);
      expect(benchmark, id).toBeDefined();
      return Object.values(benchmark?.fixture.nodes ?? {}).flatMap((node) =>
        node.type === "box" && node.style !== undefined ? [node.style] : [],
      );
    }

    it("authors a rail basis, collapsing split, and bounded scrolling main in the AMA2 messages app", () => {
      const styles = boxStylesOf("ama2-messages-app");
      expect(styles.some((style) => style.basis !== undefined)).toBe(true);
      expect(styles.some((style) => style.collapse === "stack")).toBe(true);
      expect(
        styles.some((style) => style.maxHeight === "screen" && style.scroll === "vertical"),
      ).toBe(true);
    });

    it("authors an app-shell rail, sticky chrome, and bounded main in the Supabase table editor", () => {
      const styles = boxStylesOf("supabase-table-editor");
      expect(styles.some((style) => style.basis !== undefined)).toBe(true);
      expect(styles.some((style) => style.collapse === "stack")).toBe(true);
      expect(
        styles.some((style) => style.maxHeight === "screen" && style.scroll === "vertical"),
      ).toBe(true);
      expect(styles.some((style) => style.sticky === true)).toBe(true);
    });

    it("authors an auto-fit product grid in the Coupang listing", () => {
      const styles = boxStylesOf("coupang-product-listing");
      expect(
        styles.some((style) => style.columns === "auto" && style.itemWidth !== undefined),
      ).toBe(true);
    });

    it("authors an auto-fit feature grid in the AMA2 public landing", () => {
      const styles = boxStylesOf("ama2-public-landing");
      expect(
        styles.some((style) => style.columns === "auto" && style.itemWidth !== undefined),
      ).toBe(true);
    });

    it("authors a horizontal shelf whose children hold their width via basis in the Linktree page", () => {
      const styles = boxStylesOf("linktree-selena-gomez");
      expect(styles.some((style) => style.scroll === "horizontal")).toBe(true);
      expect(styles.some((style) => style.basis !== undefined)).toBe(true);
    });

    it("re-scopes the last app-shell and carousel blocking gaps out of the corpus", () => {
      const gaps = REFERENCE_BENCHMARKS.flatMap(({ gaps: entries }) => entries);
      // The two brick-vocabulary blocking gaps this feature clears are the only
      // blocking entries in the corpus, so it now holds zero blocking gaps.
      expect(gaps.filter((gap) => gap.severity === "blocking")).toEqual([]);

      const serialized = JSON.stringify(gaps);
      expect(serialized).not.toMatch(/app-shell/iu);
      expect(serialized).not.toMatch(/\bsidebar\b/iu);
      expect(serialized).not.toMatch(/split-pane/iu);

      // brick-vocabulary keeps >=1 entry (so seenCategories stays complete) and the
      // carousel gap is re-scoped to watch — a deferred carousel-state gap — not deleted.
      expect(gaps.some((gap) => gap.category === "brick-vocabulary")).toBe(true);
      expect(gaps.some((gap) => gap.severity === "watch" && /carousel/iu.test(gap.summary))).toBe(
        true,
      );
    });
  });

  it("keeps every fixture node reachable from the root", () => {
    for (const benchmark of REFERENCE_BENCHMARKS) {
      const reachable = reachableNodeIds(benchmark.fixture);
      expect([...reachable].sort(), benchmark.id).toEqual(
        Object.keys(benchmark.fixture.nodes).sort(),
      );
    }
  });

  it("covers the complete benchmark surface without mutating official scenario semantics", () => {
    const coveredBricks = new Set<BrickType>();
    for (const benchmark of REFERENCE_BENCHMARKS) {
      expect(referenceBenchmarkById(benchmark.id)).toBe(benchmark);
      for (const brick of benchmark.expectedAssets.bricks) {
        coveredBricks.add(brick);
      }
    }

    expect([...coveredBricks].sort()).toEqual([...BRICK_TYPES].sort());
    expect(referenceBenchmarkById("free-form")).toBeUndefined();
  });
});
