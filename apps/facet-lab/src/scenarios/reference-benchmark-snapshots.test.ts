import { describe, expect, it } from "vitest";

import {
  REFERENCE_BENCHMARK_SNAPSHOT_VIEWPORTS,
  projectReferenceBenchmarkSnapshot,
  validateReferenceBenchmarkSnapshotSource,
} from "./reference-benchmark-snapshots.js";

describe("reference benchmark snapshots", () => {
  it("projects viewport reference snapshots without raw Facet document styles", () => {
    const snapshot = projectReferenceBenchmarkSnapshot({
      benchmarkId: "google-search-console-performance",
      viewport: "desktop",
    });

    expect(snapshot).toMatchObject({
      availability: "available",
      benchmarkId: "google-search-console-performance",
      viewport: "desktop",
      viewportLabel: "Desktop",
      width: 1440,
      height: 900,
      src: "/reference-benchmarks/google-search-console-performance-desktop.svg",
      mediaType: "image/svg+xml",
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/rawStyle|css|facetDocumentStyle/u);
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
        "/reference-benchmarks/google-search-console-performance-desktop.svg",
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
