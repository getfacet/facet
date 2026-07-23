import { DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";

import { REFERENCE_BENCHMARKS } from "../scenarios/reference-benchmarks.js";
import {
  presentReferenceBenchmarks,
  projectReferenceBenchmark,
} from "./reference-benchmark-presenter.js";

describe("reference benchmark presenter", () => {
  it("projects validated benchmark metadata and selects the requested target", () => {
    const presentation = presentReferenceBenchmarks({
      benchmarks: REFERENCE_BENCHMARKS,
      selectedId: "commerce-product-checkout",
    });

    expect(presentation).toMatchObject({
      total: 11,
      renderable: 11,
      diagnostics: 0,
      selectedId: "commerce-product-checkout",
    });
    expect(presentation.selected).toMatchObject({
      status: "render",
      id: "commerce-product-checkout",
      name: "Commerce product and checkout",
    });
    if (presentation.selected?.status !== "render") throw new Error("Expected render projection.");
    expect(presentation.selected.bricks).toContain("media");
    expect(presentation.selected.presets).toContain("primaryAction box");
    expect(presentation.selected.patterns).toContain("form");
    expect(presentation.selected.sources[0]?.url).toMatch(/^https:\/\//u);
    expect(presentation.selected.gaps.map(({ category }) => category)).toContain(
      "brick-vocabulary",
    );
  });

  it("does not treat renderable as product-grade", () => {
    const presentation = presentReferenceBenchmarks({
      benchmarks: REFERENCE_BENCHMARKS,
      selectedId: "google-search-console-performance",
    });

    expect(presentation.renderable).toBe(11);
    expect(presentation.productGradeCandidates).toBe(0);
    // box-layout-foundation cleared the last two blocking gaps (the Supabase
    // app-shell gap and the Linktree carousel gap), so the corpus now holds zero
    // blocking gaps; every renderable benchmark still keeps watch gaps and stays
    // needs-design-qa rather than product-grade.
    expect(presentation.blockedByGaps).toBe(0);
    expect(presentation.needsDesignQa).toBeGreaterThan(0);
    expect(presentation.blockingGaps).toBe(0);
    expect(presentation.watchGaps).toBeGreaterThan(0);

    // analytics-data-surface cleared GSC's blocking chart gaps: the benchmark now
    // classifies as needs-design-qa (watch gaps only), never product-grade.
    expect(presentation.selected).toMatchObject({
      status: "render",
      id: "google-search-console-performance",
      qualityStatus: "needs-design-qa",
      qualityLabel: "Needs design QA",
    });
    if (presentation.selected?.status !== "render") throw new Error("Expected render projection.");
    expect(presentation.selected.qualitySummary).toMatch(/Not product-grade/u);
    expect(presentation.selected.blockingGapCount).toBe(0);
    expect(presentation.selected.watchGapCount).toBeGreaterThan(0);
  });

  it("renders reference benchmarks with benchmark-specific custom assets", () => {
    const supabase = presentReferenceBenchmarks({
      benchmarks: REFERENCE_BENCHMARKS,
      selectedId: "supabase-table-editor",
    }).selected;
    const ama2 = presentReferenceBenchmarks({
      benchmarks: REFERENCE_BENCHMARKS,
      selectedId: "ama2-public-landing",
    }).selected;

    if (supabase?.status !== "render" || ama2?.status !== "render") {
      throw new Error("Expected custom benchmark render projections.");
    }

    expect(supabase.assetSource).toBe("custom");
    expect(supabase.assetThemeName).toBe("supabase-table-editor");
    expect(supabase.assetDensity).toBe("dense");
    expect(supabase.patterns).toContain("supabase-shell");
    expect(supabase.assetNotes.join(" ")).toContain("tighter space");
    expect(supabase.theme.tokens.space.md).toBe("10px");

    expect(ama2.assetSource).toBe("custom");
    expect(ama2.assetThemeName).toBe("ama2-public-landing");
    expect(ama2.assetDensity).toBe("roomy");
    expect(ama2.patterns).toContain("ama2-hero");
    expect(ama2.assetNotes.join(" ")).toContain("larger space");
    expect(ama2.theme.tokens.fontSize["3xl"]).toBe("56px");
  });

  it("diagnoses invalid benchmark-specific custom assets without throwing", () => {
    const invalid = projectReferenceBenchmark(REFERENCE_BENCHMARKS[0], DEFAULT_THEME, {
      "supabase-table-editor": {
        benchmarkId: "supabase-table-editor",
        theme: { ...DEFAULT_THEME, name: "invalid theme" },
        patterns: [],
        density: "dense",
        notes: ["Invalid test bundle."],
      },
    });

    expect(invalid.status).toBe("diagnostic");
    if (invalid.status !== "diagnostic") throw new Error("Expected diagnostic projection.");
    expect(invalid.diagnostics.map(({ message }) => message).join("\n")).toMatch(
      /Custom theme is invalid|Custom patterns are invalid/u,
    );
  });

  it("returns bounded diagnostics for invalid fixtures and unsafe metadata", () => {
    const invalid = projectReferenceBenchmark({
      ...REFERENCE_BENCHMARKS[0],
      fixture: null,
      referenceSources: [{ label: "Unsafe", url: "javascript:alert(1)", useFor: "bad" }],
    });

    expect(invalid.status).toBe("diagnostic");
    if (invalid.status !== "diagnostic") throw new Error("Expected diagnostic projection.");
    expect(invalid.diagnostics.map(({ message }) => message).join("\n")).toMatch(
      /fixture is invalid|referenceSources/u,
    );
  });

  it("does not throw when the benchmark custom asset map is malformed", () => {
    type CustomAssetsInput = NonNullable<
      Parameters<typeof presentReferenceBenchmarks>[0]["customAssets"]
    >;
    const malformedCustomAssets = null as unknown as CustomAssetsInput;

    expect(() =>
      presentReferenceBenchmarks({
        benchmarks: REFERENCE_BENCHMARKS,
        customAssets: malformedCustomAssets,
      }),
    ).not.toThrow();

    const presentation = presentReferenceBenchmarks({
      benchmarks: REFERENCE_BENCHMARKS,
      selectedId: "supabase-table-editor",
      customAssets: malformedCustomAssets,
    });

    expect(presentation.selected).toMatchObject({
      status: "diagnostic",
      id: "supabase-table-editor",
    });
  });

  it("bounds diagnostic fallbacks and oversized metadata arrays", () => {
    const invalid = projectReferenceBenchmark({
      ...REFERENCE_BENCHMARKS[0],
      id: "x".repeat(2_000),
      name: "y".repeat(2_000),
      targetNotes: Array.from({ length: 25 }, (_, index) => `Note ${String(index)}`),
    });

    expect(invalid).toMatchObject({
      status: "diagnostic",
      id: "unknown",
      name: "Unavailable",
    });
    if (invalid.status !== "diagnostic") throw new Error("Expected diagnostic projection.");
    expect(invalid.diagnostics.map(({ message }) => message).join("\n")).toMatch(
      /targetNotes exceeds/u,
    );

    const presentation = presentReferenceBenchmarks({
      benchmarks: Array.from({ length: 20 }, () => REFERENCE_BENCHMARKS[0]),
    });
    expect(presentation.total).toBe(12);
  });

  it("does not throw on cyclic or deeply malformed candidate data", () => {
    const opsBenchmark = REFERENCE_BENCHMARKS.find(({ id }) => id === "ops-issue-console");
    if (opsBenchmark === undefined) throw new Error("Expected ops issue benchmark.");
    const cyclic: Record<string, unknown> = { ...opsBenchmark, fixture: {} };
    cyclic.fixture = cyclic;

    expect(() => projectReferenceBenchmark(cyclic, DEFAULT_THEME)).not.toThrow();
    expect(projectReferenceBenchmark(cyclic, DEFAULT_THEME)).toMatchObject({
      status: "diagnostic",
      id: "ops-issue-console",
    });
    expect(projectReferenceBenchmark({ id: "x" })).toMatchObject({ status: "diagnostic" });
  });
});
