import { describe, expect, it } from "vitest";

import { REFERENCE_BENCHMARKS } from "../scenarios/reference-benchmarks.js";
import {
  presentReferenceBenchmarks,
  type PresentedReferenceBenchmark,
} from "./reference-benchmark-presenter.js";
import {
  REFERENCE_COMPARISON_CLASSIFICATIONS,
  presentReferenceComparison,
} from "./reference-comparison-presenter.js";

function selectedBenchmark(id: string): PresentedReferenceBenchmark | null {
  return presentReferenceBenchmarks({ benchmarks: REFERENCE_BENCHMARKS, selectedId: id }).selected;
}

describe("reference comparison presenter", () => {
  it("presents side-by-side comparison metadata with closed classification buckets", () => {
    const comparison = presentReferenceComparison({
      selected: selectedBenchmark("google-search-console-performance"),
      viewport: "desktop",
      classification: "minor-drift",
    });

    expect(REFERENCE_COMPARISON_CLASSIFICATIONS).toEqual([
      "unresolved",
      "matches-reference",
      "minor-drift",
      "major-drift",
      "blocked",
    ]);
    expect(comparison).toMatchObject({
      status: "ready",
      benchmark: {
        id: "google-search-console-performance",
        name: "Google Search Console performance",
      },
      viewport: {
        name: "desktop",
        label: "Desktop",
        width: 1440,
        height: 900,
      },
      reference: {
        availability: "available",
        src: "/reference-benchmarks/google-search-console-performance-desktop.svg",
      },
      facet: {
        availability: "available",
        colorMode: "light",
      },
      classification: {
        value: "minor-drift",
        label: "Minor drift",
      },
    });
  });

  it("keeps the Facet side available when a reference image is missing", () => {
    const comparison = presentReferenceComparison({
      selected: selectedBenchmark("supabase-table-editor"),
      viewport: "desktop",
      classification: "matches-reference",
    });

    expect(comparison.status).toBe("ready");
    expect(comparison.reference.availability).toBe("unavailable");
    expect(comparison.facet).toMatchObject({ availability: "available" });
    expect(comparison.diagnostics).toEqual([
      "No Lab-owned reference snapshot is registered for this benchmark and viewport.",
    ]);
  });

  it("falls back to unresolved when the classification is invalid", () => {
    const comparison = presentReferenceComparison({
      selected: selectedBenchmark("google-search-console-performance"),
      viewport: "desktop",
      classification: "looks-good",
    });

    expect(comparison.classification).toMatchObject({
      value: "unresolved",
      label: "Unresolved",
    });
  });

  it("returns unavailable comparison metadata for null or diagnostic benchmark input", () => {
    const nullComparison = presentReferenceComparison({
      selected: null,
      viewport: "desktop",
    });

    expect(nullComparison).toMatchObject({
      status: "unavailable",
      benchmark: { id: "unavailable", name: "Unavailable" },
      facet: {
        availability: "unavailable",
        reason: "No renderable Facet benchmark is selected.",
      },
    });

    const diagnosticComparison = presentReferenceComparison({
      selected: {
        status: "diagnostic",
        id: "broken",
        name: "Broken fixture",
        diagnostics: [{ severity: "error", message: "Fixture is invalid." }],
      },
      viewport: "mobile",
      classification: "blocked",
    });

    expect(diagnosticComparison).toMatchObject({
      status: "unavailable",
      benchmark: { id: "broken", name: "Broken fixture" },
      viewport: { name: "mobile", width: 390, height: 844 },
      reference: { availability: "unavailable" },
      classification: { value: "blocked" },
      diagnostics: ["Fixture is invalid."],
    });
  });
});
