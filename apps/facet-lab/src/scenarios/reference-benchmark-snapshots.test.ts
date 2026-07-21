import { describe, expect, it } from "vitest";

import {
  REFERENCE_BENCHMARK_SNAPSHOT_VIEWPORTS,
  projectReferenceBenchmarkSnapshot,
  validateReferenceBenchmarkSnapshotSource,
} from "./reference-benchmark-snapshots.js";

describe("reference benchmark snapshots", () => {
  it("projects registered viewport reference snapshots without raw Facet document styles", () => {
    const expectations = [
      {
        benchmarkId: "supabase-table-editor",
        viewport: "desktop",
        src: "/reference-benchmarks/supabase-table-editor-desktop.png",
      },
      {
        benchmarkId: "ama2-public-landing",
        viewport: "desktop",
        src: "/reference-benchmarks/ama2-public-landing-desktop.png",
      },
      {
        benchmarkId: "ama2-messages-app",
        viewport: "desktop",
        src: "/reference-benchmarks/ama2-messages-app-desktop.png",
      },
      {
        benchmarkId: "coupang-product-listing",
        viewport: "desktop",
        src: "/reference-benchmarks/coupang-product-listing-desktop.png",
      },
      {
        benchmarkId: "linktree-selena-gomez",
        viewport: "mobile",
        src: "/reference-benchmarks/linktree-selena-gomez-mobile.png",
      },
      {
        benchmarkId: "google-search-console-performance",
        viewport: "desktop",
        src: "/reference-benchmarks/google-search-console-performance-desktop.png",
      },
    ] as const;

    for (const expected of expectations) {
      const snapshot = projectReferenceBenchmarkSnapshot(expected);

      expect(snapshot).toMatchObject({
        availability: "available",
        benchmarkId: expected.benchmarkId,
        viewport: expected.viewport,
        src: expected.src,
        mediaType: "image/png",
      });
      if (expected.benchmarkId === "linktree-selena-gomez") {
        expect(snapshot).toMatchObject({
          width: 390,
          height: 1_936,
        });
      }
      expect(JSON.stringify(snapshot)).not.toMatch(/rawStyle|css|facetDocumentStyle/u);
    }
    expect(REFERENCE_BENCHMARK_SNAPSHOT_VIEWPORTS).toEqual(["mobile", "tablet", "desktop"]);
  });

  it("returns an explicit unavailable state for a valid benchmark without that viewport", () => {
    const snapshot = projectReferenceBenchmarkSnapshot({
      benchmarkId: "google-search-console-performance",
      viewport: "mobile",
    });

    expect(snapshot).toMatchObject({
      availability: "unavailable",
      benchmarkId: "google-search-console-performance",
      viewport: "mobile",
      viewportLabel: "Mobile",
      width: 390,
      height: 844,
      reason: "No Lab-owned reference snapshot is registered for this benchmark and viewport.",
    });
  });

  it("returns unavailable metadata for unknown benchmark ids without throwing", () => {
    const snapshot = projectReferenceBenchmarkSnapshot({
      benchmarkId: "unknown-product",
      viewport: "desktop",
    });

    expect(snapshot).toMatchObject({
      availability: "unavailable",
      benchmarkId: "unknown-product",
      viewport: "desktop",
      reason: "No Lab-owned reference snapshot is registered for this benchmark and viewport.",
    });
  });

  it("accepts only bounded same-origin Lab public paths under reference-benchmarks", () => {
    expect(
      validateReferenceBenchmarkSnapshotSource(
        "/reference-benchmarks/google-search-console-performance-desktop.png",
      ),
    ).toBe(true);

    for (const value of [
      "https://example.com/reference.png",
      "//example.com/reference.png",
      "/reference-benchmarks/../secret.svg",
      "/facet-catalog.svg",
      "/reference-benchmarks/",
      "/reference-benchmarks/google search console.svg",
      `/reference-benchmarks/${"x".repeat(240)}.svg`,
    ]) {
      expect(validateReferenceBenchmarkSnapshotSource(value)).toBe(false);
    }
  });
});
