import { DEFAULT_THEME } from "@facet/assets";
import { validateAuthorTree, type FacetTheme, type FacetTree } from "@facet/core";

import {
  REFERENCE_BENCHMARK_CUSTOM_ASSETS,
  validateReferenceBenchmarkCustomAssets,
  type ReferenceBenchmarkCustomAssets,
  type ReferenceBenchmarkDensity,
} from "../scenarios/reference-benchmark-custom-assets.js";
import {
  REFERENCE_BENCHMARK_IDS,
  REFERENCE_BENCHMARK_GAP_CATEGORIES,
  type ReferenceBenchmark,
  type ReferenceBenchmarkGapCategory,
  type ReferenceBenchmarkId,
} from "../scenarios/reference-benchmarks.js";

export type PresentedReferenceBenchmarkStatus = "render" | "diagnostic";
export type PresentedReferenceBenchmarkQualityStatus =
  | "product-grade-candidate"
  | "needs-design-qa"
  | "blocked-by-gaps";

export interface PresentedReferenceBenchmarkDiagnostic {
  readonly message: string;
  readonly severity: "error";
}

export interface PresentedReferenceBenchmarkSource {
  readonly label: string;
  readonly url: string;
  readonly useFor: string;
}

export interface PresentedReferenceBenchmarkGap {
  readonly category: ReferenceBenchmarkGapCategory;
  readonly severity: "watch" | "blocking";
  readonly summary: string;
}

export interface PresentedReferenceBenchmarkRender {
  readonly status: "render";
  readonly id: string;
  readonly name: string;
  readonly serviceType: string;
  readonly goal: string;
  readonly tree: FacetTree;
  readonly theme: FacetTheme;
  readonly assetSource: "custom" | "fallback";
  readonly assetThemeName: string;
  readonly assetDensity?: ReferenceBenchmarkDensity;
  readonly assetNotes: readonly string[];
  readonly bricks: readonly string[];
  readonly presets: readonly string[];
  readonly patterns: readonly string[];
  readonly sources: readonly PresentedReferenceBenchmarkSource[];
  readonly targetNotes: readonly string[];
  readonly qaChecklist: readonly string[];
  readonly gaps: readonly PresentedReferenceBenchmarkGap[];
  readonly qualityStatus: PresentedReferenceBenchmarkQualityStatus;
  readonly qualityLabel: string;
  readonly qualitySummary: string;
  readonly blockingGapCount: number;
  readonly watchGapCount: number;
}

export interface PresentedReferenceBenchmarkDiagnosticItem {
  readonly status: "diagnostic";
  readonly id: string;
  readonly name: string;
  readonly diagnostics: readonly PresentedReferenceBenchmarkDiagnostic[];
}

export type PresentedReferenceBenchmark =
  PresentedReferenceBenchmarkRender | PresentedReferenceBenchmarkDiagnosticItem;

export interface ReferenceBenchmarkPresentation {
  readonly items: readonly PresentedReferenceBenchmark[];
  readonly selected: PresentedReferenceBenchmark | null;
  readonly selectedId: string | null;
  readonly total: number;
  readonly renderable: number;
  readonly diagnostics: number;
  readonly productGradeCandidates: number;
  readonly needsDesignQa: number;
  readonly blockedByGaps: number;
  readonly blockingGaps: number;
  readonly watchGaps: number;
}

export interface PresentReferenceBenchmarksInput {
  readonly benchmarks: readonly unknown[];
  readonly selectedId?: string;
  readonly theme?: FacetTheme;
  readonly customAssets?: Partial<Record<ReferenceBenchmarkId, ReferenceBenchmarkCustomAssets>>;
}

const MAX_TEXT = 1_000;
const MAX_URL = 2_000;
const MAX_BENCHMARKS = 12;
const MAX_REFERENCE_SOURCES = 6;
const MAX_STRING_LIST_ITEMS = 24;
const MAX_EXPECTED_BRICKS = 11;
const MAX_EXPECTED_PRESETS = 32;
const MAX_EXPECTED_PATTERNS = 16;
const MAX_GAPS = 16;
const MAX_ASSET_NOTES = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function customAssetsFromMap(value: unknown, benchmarkId: ReferenceBenchmarkId): unknown {
  if (!isRecord(value)) return undefined;
  return value[benchmarkId];
}

function boundedString(value: unknown, maximum = MAX_TEXT): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function benchmarkIdOf(value: unknown): ReferenceBenchmarkId | undefined {
  return typeof value === "string" && (REFERENCE_BENCHMARK_IDS as readonly string[]).includes(value)
    ? (value as ReferenceBenchmarkId)
    : undefined;
}

function diagnostic(message: string): PresentedReferenceBenchmarkDiagnostic {
  return Object.freeze({ message, severity: "error" });
}

function diagnosticItem(
  id: string,
  name: string,
  diagnostics: readonly PresentedReferenceBenchmarkDiagnostic[],
): PresentedReferenceBenchmarkDiagnosticItem {
  return Object.freeze({
    status: "diagnostic",
    id,
    name,
    diagnostics: Object.freeze([...diagnostics]),
  });
}

function safeStringList(
  value: unknown,
  field: string,
  maximumItems = MAX_STRING_LIST_ITEMS,
): readonly string[] | string {
  if (!Array.isArray(value) || value.length === 0) return `${field} must be a non-empty array.`;
  if (value.length > maximumItems) return `${field} exceeds the ${String(maximumItems)} item cap.`;
  const projected: string[] = [];
  for (const item of value) {
    if (!boundedString(item)) return `${field} contains an invalid entry.`;
    projected.push(item);
  }
  return Object.freeze(projected);
}

function safeSources(value: unknown): readonly PresentedReferenceBenchmarkSource[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return "referenceSources must be a non-empty array.";
  }
  if (value.length > MAX_REFERENCE_SOURCES) {
    return `referenceSources exceeds the ${String(MAX_REFERENCE_SOURCES)} item cap.`;
  }
  const sources: PresentedReferenceBenchmarkSource[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !boundedString(item.label, 160) ||
      !boundedString(item.url, MAX_URL) ||
      !/^https:\/\/[^ ]+$/u.test(item.url) ||
      !boundedString(item.useFor, 240)
    ) {
      return "referenceSources contains an invalid source.";
    }
    sources.push(Object.freeze({ label: item.label, url: item.url, useFor: item.useFor }));
  }
  return Object.freeze(sources);
}

function safeGaps(value: unknown): readonly PresentedReferenceBenchmarkGap[] | string {
  if (!Array.isArray(value) || value.length === 0) return "gaps must be a non-empty array.";
  if (value.length > MAX_GAPS) return `gaps exceeds the ${String(MAX_GAPS)} item cap.`;
  const gaps: PresentedReferenceBenchmarkGap[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !boundedString(item.category, 80) ||
      !REFERENCE_BENCHMARK_GAP_CATEGORIES.includes(
        item.category as ReferenceBenchmarkGapCategory,
      ) ||
      (item.severity !== "watch" && item.severity !== "blocking") ||
      !boundedString(item.summary, 500)
    ) {
      return "gaps contains an invalid gap.";
    }
    gaps.push(
      Object.freeze({
        category: item.category as ReferenceBenchmarkGapCategory,
        severity: item.severity,
        summary: item.summary,
      }),
    );
  }
  return Object.freeze(gaps);
}

function productGradeQuality(gaps: readonly PresentedReferenceBenchmarkGap[]): {
  readonly status: PresentedReferenceBenchmarkQualityStatus;
  readonly label: string;
  readonly summary: string;
  readonly blockingGapCount: number;
  readonly watchGapCount: number;
} {
  const blockingGapCount = gaps.filter((gap) => gap.severity === "blocking").length;
  const watchGapCount = gaps.filter((gap) => gap.severity === "watch").length;
  if (blockingGapCount > 0) {
    return Object.freeze({
      status: "blocked-by-gaps",
      label: "Blocked by fidelity gaps",
      summary: `Not product-grade: ${String(blockingGapCount)} blocking gap(s) and ${String(
        watchGapCount,
      )} watch gap(s) remain after successful rendering.`,
      blockingGapCount,
      watchGapCount,
    });
  }
  if (watchGapCount > 0) {
    return Object.freeze({
      status: "needs-design-qa",
      label: "Needs design QA",
      summary: `Not product-grade yet: rendering succeeds, but ${String(
        watchGapCount,
      )} watch gap(s) still require side-by-side reference QA.`,
      blockingGapCount,
      watchGapCount,
    });
  }
  return Object.freeze({
    status: "product-grade-candidate",
    label: "Product-grade candidate",
    summary:
      "Product-grade candidate: no known fidelity gaps are recorded, pending final human screenshot review.",
    blockingGapCount,
    watchGapCount,
  });
}

function expectedAssets(candidate: Record<string, unknown>):
  | {
      readonly bricks: readonly string[];
      readonly presets: readonly string[];
      readonly patterns: readonly string[];
    }
  | string {
  const value = candidate.expectedAssets;
  if (!isRecord(value)) return "expectedAssets must be present.";
  const bricks = safeStringList(value.bricks, "expectedAssets.bricks", MAX_EXPECTED_BRICKS);
  if (typeof bricks === "string") return bricks;
  const patterns = safeStringList(value.patterns, "expectedAssets.patterns", MAX_EXPECTED_PATTERNS);
  if (typeof patterns === "string") return patterns;
  if (!Array.isArray(value.presets)) return "expectedAssets.presets must be an array.";
  if (value.presets.length > MAX_EXPECTED_PRESETS) {
    return `expectedAssets.presets exceeds the ${String(MAX_EXPECTED_PRESETS)} item cap.`;
  }
  const presets: string[] = [];
  for (const preset of value.presets) {
    if (!isRecord(preset) || !boundedString(preset.brick, 80) || !boundedString(preset.name, 120)) {
      return "expectedAssets.presets contains an invalid preset.";
    }
    presets.push(`${preset.name} ${preset.brick}`);
  }
  return Object.freeze({ bricks, presets: Object.freeze(presets), patterns });
}

export function projectReferenceBenchmark(
  candidate: unknown,
  theme: FacetTheme = DEFAULT_THEME,
  customAssetMap: unknown = REFERENCE_BENCHMARK_CUSTOM_ASSETS,
): PresentedReferenceBenchmark {
  const fallbackId =
    isRecord(candidate) && boundedString(candidate.id, 120) ? candidate.id : "unknown";
  const fallbackName =
    isRecord(candidate) && boundedString(candidate.name, 160) ? candidate.name : "Unavailable";
  if (!isRecord(candidate)) {
    return diagnosticItem("unknown", "Unavailable", [diagnostic("Benchmark data is malformed.")]);
  }
  const diagnostics: PresentedReferenceBenchmarkDiagnostic[] = [];
  if (!boundedString(candidate.id, 120)) diagnostics.push(diagnostic("Benchmark id is invalid."));
  if (!boundedString(candidate.name, 160))
    diagnostics.push(diagnostic("Benchmark name is invalid."));
  if (!boundedString(candidate.serviceType, 160)) {
    diagnostics.push(diagnostic("Benchmark service type is invalid."));
  }
  if (!boundedString(candidate.goal, 500))
    diagnostics.push(diagnostic("Benchmark goal is invalid."));

  const benchmarkId = benchmarkIdOf(candidate.id);
  const customAssets =
    benchmarkId === undefined ? undefined : customAssetsFromMap(customAssetMap, benchmarkId);
  const assetValidation =
    customAssets === undefined ? undefined : validateReferenceBenchmarkCustomAssets(customAssets);
  if (assetValidation !== undefined && assetValidation.issues.length > 0) {
    for (const issue of assetValidation.issues) diagnostics.push(diagnostic(issue.message));
  }
  const validatedAssets = assetValidation?.assets;
  const renderTheme = validatedAssets?.theme ?? theme;
  const validation = validateAuthorTree(candidate.fixture, renderTheme);
  const validTree = validation.value;
  if (validTree === undefined || validation.issues.length > 0 || validation.omittedErrorCount > 0) {
    const issueText = validation.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    diagnostics.push(diagnostic(`Benchmark fixture is invalid: ${issueText}`));
  }

  const sources = safeSources(candidate.referenceSources);
  if (typeof sources === "string") diagnostics.push(diagnostic(sources));
  const notes = safeStringList(candidate.targetNotes, "targetNotes");
  if (typeof notes === "string") diagnostics.push(diagnostic(notes));
  const checklist = safeStringList(candidate.qaChecklist, "qaChecklist");
  if (typeof checklist === "string") diagnostics.push(diagnostic(checklist));
  const gaps = safeGaps(candidate.gaps);
  if (typeof gaps === "string") diagnostics.push(diagnostic(gaps));
  const assets = expectedAssets(candidate);
  if (typeof assets === "string") diagnostics.push(diagnostic(assets));
  const assetNotes =
    validatedAssets === undefined
      ? Object.freeze([] as string[])
      : safeStringList(validatedAssets.notes, "customAsset.notes", MAX_ASSET_NOTES);
  if (typeof assetNotes === "string") diagnostics.push(diagnostic(assetNotes));

  if (diagnostics.length > 0) {
    return diagnosticItem(fallbackId, fallbackName, diagnostics);
  }
  if (validTree === undefined) {
    return diagnosticItem(fallbackId, fallbackName, [diagnostic("Benchmark fixture is invalid.")]);
  }
  const projectedGaps = gaps as Exclude<typeof gaps, string>;
  const quality = productGradeQuality(projectedGaps);

  return Object.freeze({
    status: "render",
    id: candidate.id as string,
    name: candidate.name as string,
    serviceType: candidate.serviceType as string,
    goal: candidate.goal as string,
    tree: validTree,
    theme: renderTheme,
    assetSource: validatedAssets === undefined ? "fallback" : "custom",
    assetThemeName: renderTheme.name,
    ...(validatedAssets === undefined ? {} : { assetDensity: validatedAssets.density }),
    assetNotes: assetNotes as Exclude<typeof assetNotes, string>,
    bricks: (assets as Exclude<typeof assets, string>).bricks,
    presets: (assets as Exclude<typeof assets, string>).presets,
    patterns:
      validatedAssets === undefined
        ? (assets as Exclude<typeof assets, string>).patterns
        : Object.freeze(validatedAssets.patterns.map((pattern) => pattern.name)),
    sources: sources as Exclude<typeof sources, string>,
    targetNotes: notes as Exclude<typeof notes, string>,
    qaChecklist: checklist as Exclude<typeof checklist, string>,
    gaps: projectedGaps,
    qualityStatus: quality.status,
    qualityLabel: quality.label,
    qualitySummary: quality.summary,
    blockingGapCount: quality.blockingGapCount,
    watchGapCount: quality.watchGapCount,
  });
}

export function presentReferenceBenchmarks({
  benchmarks,
  selectedId,
  theme = DEFAULT_THEME,
  customAssets = REFERENCE_BENCHMARK_CUSTOM_ASSETS,
}: PresentReferenceBenchmarksInput): ReferenceBenchmarkPresentation {
  const items = Object.freeze(
    benchmarks
      .slice(0, MAX_BENCHMARKS)
      .map((benchmark) => projectReferenceBenchmark(benchmark, theme, customAssets)),
  );
  const renderItems = items.filter((item): item is PresentedReferenceBenchmarkRender => {
    return item.status === "render";
  });
  const selected =
    items.find((item) => item.id === selectedId) ??
    renderItems[0] ??
    items[0] ??
    null;
  return Object.freeze({
    items,
    selected,
    selectedId: selected?.id ?? null,
    total: items.length,
    renderable: renderItems.length,
    diagnostics: items.filter((item) => item.status === "diagnostic").length,
    productGradeCandidates: renderItems.filter(
      (item) => item.qualityStatus === "product-grade-candidate",
    ).length,
    needsDesignQa: renderItems.filter((item) => item.qualityStatus === "needs-design-qa").length,
    blockedByGaps: renderItems.filter((item) => item.qualityStatus === "blocked-by-gaps").length,
    blockingGaps: renderItems.reduce((total, item) => total + item.blockingGapCount, 0),
    watchGaps: renderItems.reduce((total, item) => total + item.watchGapCount, 0),
  });
}

export function defaultReferenceBenchmarkSelection(
  benchmarks: readonly ReferenceBenchmark[],
): string {
  return benchmarks[0]?.id ?? "";
}
