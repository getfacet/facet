import { CAPTURE_MATRIX } from "../evaluation/capture-matrix.js";
import { type ViewportName, VIEWPORTS } from "../shared/run-contract.js";
import { type ReferenceBenchmarkId, REFERENCE_BENCHMARK_IDS } from "./reference-benchmarks.js";

export const REFERENCE_BENCHMARK_SNAPSHOT_VIEWPORTS = Object.freeze([...VIEWPORTS]);

export type ReferenceBenchmarkSnapshotAvailability = "available" | "unavailable";

export type ReferenceBenchmarkSnapshotMediaType =
  "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";

export interface ReferenceBenchmarkViewportSnapshot {
  readonly availability: "available";
  readonly benchmarkId: ReferenceBenchmarkId;
  readonly viewport: ViewportName;
  readonly viewportLabel: string;
  readonly width: number;
  readonly height: number;
  readonly src: `/reference-benchmarks/${string}`;
  readonly mediaType: ReferenceBenchmarkSnapshotMediaType;
  readonly alt: string;
  readonly sourceLabel: string;
  readonly notes: readonly string[];
}

export interface ReferenceBenchmarkUnavailableSnapshot {
  readonly availability: "unavailable";
  readonly benchmarkId: string;
  readonly viewport: ViewportName;
  readonly viewportLabel: string;
  readonly width: number;
  readonly height: number;
  readonly reason: string;
}

export type ReferenceBenchmarkSnapshot =
  ReferenceBenchmarkViewportSnapshot | ReferenceBenchmarkUnavailableSnapshot;

interface ReferenceBenchmarkSnapshotDefinition {
  readonly src: `/reference-benchmarks/${string}`;
  readonly mediaType: ReferenceBenchmarkSnapshotMediaType;
  readonly width?: number;
  readonly height?: number;
  readonly alt: string;
  readonly sourceLabel: string;
  readonly notes: readonly string[];
}

const MAX_REFERENCE_SNAPSHOT_SOURCE_LENGTH = 180;

const VIEWPORT_LABELS: Readonly<Record<ViewportName, string>> = {
  mobile: "Mobile",
  tablet: "Tablet",
  desktop: "Desktop",
};

const VIEWPORT_DIMENSIONS: Readonly<
  Record<ViewportName, { readonly width: number; readonly height: number }>
> = Object.freeze(
  Object.fromEntries(
    CAPTURE_MATRIX.filter((condition) => condition.colorMode === "light").map((condition) => [
      condition.viewport,
      Object.freeze({ width: condition.width, height: condition.height }),
    ]),
  ) as Record<ViewportName, { readonly width: number; readonly height: number }>,
);

const REFERENCE_BENCHMARK_SNAPSHOT_REGISTRY: Partial<
  Record<ReferenceBenchmarkId, Partial<Record<ViewportName, ReferenceBenchmarkSnapshotDefinition>>>
> = Object.freeze({
  "supabase-table-editor": Object.freeze({
    desktop: Object.freeze({
      src: "/reference-benchmarks/supabase-table-editor-desktop.png",
      mediaType: "image/png",
      alt: "Supabase table editor reference at desktop viewport.",
      sourceLabel: "User-provided Supabase table editor screenshot crop",
      notes: Object.freeze([
        "Static Lab reference snapshot cropped from the owner-provided screenshot.",
        "Browser chrome and transient hover UI are out of scope; the crop focuses on table editor density, sidebar, toolbar, grid, and empty state.",
      ]),
    }),
  }),
  "ama2-public-landing": Object.freeze({
    desktop: Object.freeze({
      src: "/reference-benchmarks/ama2-public-landing-desktop.png",
      mediaType: "image/png",
      alt: "AMA2 public landing page reference at desktop viewport.",
      sourceLabel: "Playwright capture of AMA2 public landing page",
      notes: Object.freeze([
        "Static Lab reference snapshot captured at the desktop viewport.",
        "Used for first-fold hero, navigation, CTA rhythm, and brand gradient comparison.",
      ]),
    }),
  }),
  "ama2-messages-app": Object.freeze({
    desktop: Object.freeze({
      src: "/reference-benchmarks/ama2-messages-app-desktop.png",
      mediaType: "image/png",
      alt: "AMA2 messages app reference at desktop viewport.",
      sourceLabel: "Redacted user-provided AMA2 messages app screenshot crop",
      notes: Object.freeze([
        "Static Lab reference snapshot cropped from the owner-provided screenshot with private row content masked.",
        "Used for app-shell, sidebar, participant filters, redacted message-row density, avatar stack, and selected-navigation comparison.",
      ]),
    }),
  }),
  "coupang-product-listing": Object.freeze({
    desktop: Object.freeze({
      src: "/reference-benchmarks/coupang-product-listing-desktop.png",
      mediaType: "image/png",
      alt: "Coupang product listing reference at desktop viewport.",
      sourceLabel: "User-provided Coupang product-listing screenshot crop",
      notes: Object.freeze([
        "Static Lab reference snapshot cropped from the owner-provided screenshot.",
        "Browser chrome, extension UI, and transient popovers are out of scope; the crop focuses on marketplace header, filter rail, product grid, price, delivery, and rating hierarchy.",
      ]),
    }),
  }),
  "linktree-selena-gomez": Object.freeze({
    mobile: Object.freeze({
      src: "/reference-benchmarks/linktree-selena-gomez-mobile.png",
      mediaType: "image/png",
      width: 390,
      height: 1_936,
      alt: "Selena Gomez Linktree reference at mobile viewport.",
      sourceLabel: "User-provided Linktree mobile screenshot",
      notes: Object.freeze([
        "Static Lab reference snapshot from the owner-provided mobile screenshot.",
        "Used for centered profile header, dense link stack, horizontal shop shelves, repeated section rhythm, and long-page mobile comparison.",
      ]),
    }),
  }),
  "google-search-console-performance": Object.freeze({
    desktop: Object.freeze({
      src: "/reference-benchmarks/google-search-console-performance-desktop.png",
      mediaType: "image/png",
      alt: "Google Search Console performance dashboard reference at desktop viewport.",
      sourceLabel: "User-provided Google Search Console screenshot crop",
      notes: Object.freeze([
        "Static Lab reference snapshot cropped from the owner-provided screenshot.",
        "Used for metric-card row, comparison chart, dual-scale visual treatment, filter chips, sidebar, and query table comparison.",
      ]),
    }),
  }),
});

function isReferenceBenchmarkId(value: string): value is ReferenceBenchmarkId {
  return (REFERENCE_BENCHMARK_IDS as readonly string[]).includes(value);
}

export function validateReferenceBenchmarkSnapshotSource(
  source: string,
): source is `/reference-benchmarks/${string}` {
  if (source.length === 0 || source.length > MAX_REFERENCE_SNAPSHOT_SOURCE_LENGTH) {
    return false;
  }
  if (!source.startsWith("/reference-benchmarks/")) return false;
  if (
    source.includes("..") ||
    source.includes("//") ||
    source.includes("\\") ||
    /\s/u.test(source)
  ) {
    return false;
  }
  return /^\/reference-benchmarks\/[a-z0-9][a-z0-9-]*\.(?:png|jpe?g|webp|svg)$/u.test(source);
}

function unavailableSnapshot(
  benchmarkId: string,
  viewport: ViewportName,
): ReferenceBenchmarkUnavailableSnapshot {
  const dimensions = VIEWPORT_DIMENSIONS[viewport];
  return Object.freeze({
    availability: "unavailable",
    benchmarkId,
    viewport,
    viewportLabel: VIEWPORT_LABELS[viewport],
    width: dimensions.width,
    height: dimensions.height,
    reason: "No Lab-owned reference snapshot is registered for this benchmark and viewport.",
  });
}

export function projectReferenceBenchmarkSnapshot({
  benchmarkId,
  viewport,
}: {
  readonly benchmarkId: string;
  readonly viewport: ViewportName;
}): ReferenceBenchmarkSnapshot {
  if (!isReferenceBenchmarkId(benchmarkId)) {
    return unavailableSnapshot(benchmarkId, viewport);
  }
  const definition = REFERENCE_BENCHMARK_SNAPSHOT_REGISTRY[benchmarkId]?.[viewport];
  if (definition === undefined || !validateReferenceBenchmarkSnapshotSource(definition.src)) {
    return unavailableSnapshot(benchmarkId, viewport);
  }
  const dimensions = VIEWPORT_DIMENSIONS[viewport];
  return Object.freeze({
    availability: "available",
    benchmarkId,
    viewport,
    viewportLabel: VIEWPORT_LABELS[viewport],
    width: definition.width ?? dimensions.width,
    height: definition.height ?? dimensions.height,
    src: definition.src,
    mediaType: definition.mediaType,
    alt: definition.alt,
    sourceLabel: definition.sourceLabel,
    notes: Object.freeze([...definition.notes]),
  });
}
