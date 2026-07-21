import type { FacetTheme, FacetTree } from "@facet/core";

import {
  projectReferenceBenchmarkSnapshot,
  type ReferenceBenchmarkSnapshot,
} from "../scenarios/reference-benchmark-snapshots.js";
import { type ColorMode, type ViewportName } from "../shared/run-contract.js";
import type {
  PresentedReferenceBenchmark,
  PresentedReferenceBenchmarkDiagnostic,
  PresentedReferenceBenchmarkRender,
} from "./reference-benchmark-presenter.js";

export const REFERENCE_COMPARISON_CLASSIFICATIONS = [
  "unresolved",
  "matches-reference",
  "minor-drift",
  "major-drift",
  "blocked",
] as const;

export type ReferenceComparisonClassification =
  (typeof REFERENCE_COMPARISON_CLASSIFICATIONS)[number];

export interface ReferenceComparisonClassificationOption {
  readonly value: ReferenceComparisonClassification;
  readonly label: string;
  readonly summary: string;
}

export interface PresentedReferenceComparisonViewport {
  readonly name: ViewportName;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export interface PresentedReferenceComparisonBenchmark {
  readonly id: string;
  readonly name: string;
  readonly qualityLabel: string;
  readonly qualitySummary: string;
}

export interface PresentedReferenceComparisonFacetAvailable {
  readonly availability: "available";
  readonly tree: FacetTree;
  readonly theme: FacetTheme;
  readonly colorMode: ColorMode;
}

export interface PresentedReferenceComparisonFacetUnavailable {
  readonly availability: "unavailable";
  readonly reason: string;
}

export type PresentedReferenceComparisonFacet =
  PresentedReferenceComparisonFacetAvailable | PresentedReferenceComparisonFacetUnavailable;

export interface PresentedReferenceComparison {
  readonly status: "ready" | "unavailable";
  readonly benchmark: PresentedReferenceComparisonBenchmark;
  readonly viewport: PresentedReferenceComparisonViewport;
  readonly reference: ReferenceBenchmarkSnapshot;
  readonly facet: PresentedReferenceComparisonFacet;
  readonly classification: ReferenceComparisonClassificationOption;
  readonly classificationOptions: readonly ReferenceComparisonClassificationOption[];
  readonly diagnostics: readonly string[];
}

export interface PresentReferenceComparisonInput {
  readonly selected: PresentedReferenceBenchmark | null;
  readonly viewport: ViewportName;
  readonly colorMode?: ColorMode;
  readonly classification?: unknown;
}

const CLASSIFICATION_OPTIONS: Readonly<
  Record<ReferenceComparisonClassification, ReferenceComparisonClassificationOption>
> = Object.freeze({
  unresolved: Object.freeze({
    value: "unresolved",
    label: "Unresolved",
    summary: "No visual judgment has been recorded for this viewport yet.",
  }),
  "matches-reference": Object.freeze({
    value: "matches-reference",
    label: "Matches reference",
    summary: "The Facet render is close enough to the captured reference for this pass.",
  }),
  "minor-drift": Object.freeze({
    value: "minor-drift",
    label: "Minor drift",
    summary: "The surface is usable but still has polish differences worth tracking.",
  }),
  "major-drift": Object.freeze({
    value: "major-drift",
    label: "Major drift",
    summary: "The render departs materially from the reference and needs design work.",
  }),
  blocked: Object.freeze({
    value: "blocked",
    label: "Blocked",
    summary: "The current Brick/renderer vocabulary cannot represent the reference adequately.",
  }),
});

export const REFERENCE_COMPARISON_CLASSIFICATION_OPTIONS: readonly ReferenceComparisonClassificationOption[] =
  Object.freeze(REFERENCE_COMPARISON_CLASSIFICATIONS.map((value) => CLASSIFICATION_OPTIONS[value]));

function isReferenceComparisonClassification(
  value: unknown,
): value is ReferenceComparisonClassification {
  return (
    typeof value === "string" &&
    (REFERENCE_COMPARISON_CLASSIFICATIONS as readonly string[]).includes(value)
  );
}

function classificationOption(value: unknown): ReferenceComparisonClassificationOption {
  return CLASSIFICATION_OPTIONS[isReferenceComparisonClassification(value) ? value : "unresolved"];
}

function viewportProjection(
  snapshot: ReferenceBenchmarkSnapshot,
): PresentedReferenceComparisonViewport {
  return Object.freeze({
    name: snapshot.viewport,
    label: snapshot.viewportLabel,
    width: snapshot.width,
    height: snapshot.height,
  });
}

function diagnosticMessages(
  diagnostics: readonly PresentedReferenceBenchmarkDiagnostic[],
): readonly string[] {
  return Object.freeze(diagnostics.map((diagnostic) => diagnostic.message));
}

function availableComparison(
  selected: PresentedReferenceBenchmarkRender,
  viewport: ViewportName,
  colorMode: ColorMode,
  classification: unknown,
): PresentedReferenceComparison {
  const reference = projectReferenceBenchmarkSnapshot({ benchmarkId: selected.id, viewport });
  const diagnostics =
    reference.availability === "unavailable"
      ? Object.freeze([reference.reason])
      : Object.freeze([]);
  return Object.freeze({
    status: "ready",
    benchmark: Object.freeze({
      id: selected.id,
      name: selected.name,
      qualityLabel: selected.qualityLabel,
      qualitySummary: selected.qualitySummary,
    }),
    viewport: viewportProjection(reference),
    reference,
    facet: Object.freeze({
      availability: "available",
      tree: selected.tree,
      theme: selected.theme,
      colorMode,
    }),
    classification: classificationOption(classification),
    classificationOptions: REFERENCE_COMPARISON_CLASSIFICATION_OPTIONS,
    diagnostics,
  });
}

function unavailableComparison(
  selected: PresentedReferenceBenchmark | null,
  viewport: ViewportName,
  classification: unknown,
): PresentedReferenceComparison {
  const benchmark =
    selected === null
      ? Object.freeze({
          id: "unavailable",
          name: "Unavailable",
          qualityLabel: "Unavailable",
          qualitySummary: "No renderable Facet benchmark is selected.",
        })
      : Object.freeze({
          id: selected.id,
          name: selected.name,
          qualityLabel: "Unavailable",
          qualitySummary: "This benchmark is diagnostic-only and cannot render a Facet surface.",
        });
  const diagnostics =
    selected === null
      ? Object.freeze(["No renderable Facet benchmark is selected."])
      : selected.status === "diagnostic"
        ? diagnosticMessages(selected.diagnostics)
        : Object.freeze([]);
  const reference = projectReferenceBenchmarkSnapshot({ benchmarkId: benchmark.id, viewport });
  return Object.freeze({
    status: "unavailable",
    benchmark,
    viewport: viewportProjection(reference),
    reference,
    facet: Object.freeze({
      availability: "unavailable",
      reason: "No renderable Facet benchmark is selected.",
    }),
    classification: classificationOption(classification),
    classificationOptions: REFERENCE_COMPARISON_CLASSIFICATION_OPTIONS,
    diagnostics,
  });
}

export function presentReferenceComparison({
  selected,
  viewport,
  colorMode = "light",
  classification,
}: PresentReferenceComparisonInput): PresentedReferenceComparison {
  if (selected === null || selected.status === "diagnostic") {
    return unavailableComparison(selected, viewport, classification);
  }
  return availableComparison(selected, viewport, colorMode, classification);
}
