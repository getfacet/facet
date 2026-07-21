import {
  validatePatternList,
  validateTheme,
  type FacetPattern,
  type FacetTheme,
} from "@facet/core";

import { AMA2_BENCHMARK_ASSETS } from "./reference-benchmark-assets-ama2.js";
import {
  AMA2_MESSAGES_ASSETS,
  COUPANG_PRODUCT_LISTING_ASSETS,
  GOOGLE_SEARCH_CONSOLE_ASSETS,
  LINKTREE_SELENA_ASSETS,
} from "./reference-benchmark-assets-real-services.js";
import { SUPABASE_BENCHMARK_ASSETS } from "./reference-benchmark-assets-supabase.js";
import { REFERENCE_BENCHMARK_IDS, type ReferenceBenchmarkId } from "./reference-benchmarks.js";

export type ReferenceBenchmarkDensity = "dense" | "roomy";
type ReferenceBenchmarkIssueId = ReferenceBenchmarkId | "unknown";

export interface ReferenceBenchmarkCustomAssets {
  readonly benchmarkId: ReferenceBenchmarkId;
  readonly theme: FacetTheme;
  readonly patterns: readonly FacetPattern[];
  readonly density: ReferenceBenchmarkDensity;
  readonly notes: readonly [string, ...string[]];
}

export interface ValidatedReferenceBenchmarkCustomAssets extends ReferenceBenchmarkCustomAssets {
  readonly theme: FacetTheme;
  readonly patterns: readonly FacetPattern[];
}

export interface ReferenceBenchmarkCustomAssetIssue {
  readonly benchmarkId: ReferenceBenchmarkIssueId;
  readonly message: string;
}

export interface ReferenceBenchmarkCustomAssetValidation {
  readonly assets?: ValidatedReferenceBenchmarkCustomAssets;
  readonly issues: readonly ReferenceBenchmarkCustomAssetIssue[];
}

export const REFERENCE_BENCHMARK_CUSTOM_ASSETS: Partial<
  Record<ReferenceBenchmarkId, ReferenceBenchmarkCustomAssets>
> = {
  "supabase-table-editor": SUPABASE_BENCHMARK_ASSETS,
  "ama2-public-landing": AMA2_BENCHMARK_ASSETS,
  "ama2-messages-app": AMA2_MESSAGES_ASSETS,
  "coupang-product-listing": COUPANG_PRODUCT_LISTING_ASSETS,
  "linktree-selena-gomez": LINKTREE_SELENA_ASSETS,
  "google-search-console-performance": GOOGLE_SEARCH_CONSOLE_ASSETS,
};

export function customAssetsForBenchmark(
  benchmarkId: ReferenceBenchmarkId,
): ReferenceBenchmarkCustomAssets | undefined {
  return REFERENCE_BENCHMARK_CUSTOM_ASSETS[benchmarkId];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function referenceBenchmarkIdOf(value: unknown): ReferenceBenchmarkId | undefined {
  return typeof value === "string" && (REFERENCE_BENCHMARK_IDS as readonly string[]).includes(value)
    ? (value as ReferenceBenchmarkId)
    : undefined;
}

function densityOf(value: unknown): ReferenceBenchmarkDensity | undefined {
  return value === "dense" || value === "roomy" ? value : undefined;
}

function notesOf(value: unknown): readonly [string, ...string[]] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const notes: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > 1_000) {
      return undefined;
    }
    if (item.trim() !== item) return undefined;
    notes.push(item);
  }
  const first = notes[0];
  if (first === undefined) return undefined;
  return Object.freeze([first, ...notes.slice(1)]);
}

function issue(
  benchmarkId: ReferenceBenchmarkIssueId,
  message: string,
): ReferenceBenchmarkCustomAssetIssue {
  return Object.freeze({ benchmarkId, message });
}

export function validateReferenceBenchmarkCustomAssets(
  assets: unknown,
): ReferenceBenchmarkCustomAssetValidation {
  const issues: ReferenceBenchmarkCustomAssetIssue[] = [];

  if (!isRecord(assets)) {
    return Object.freeze({
      issues: Object.freeze([issue("unknown", "Custom asset bundle is malformed.")]),
    });
  }

  const benchmarkId = referenceBenchmarkIdOf(assets.benchmarkId);
  const issueId = benchmarkId ?? "unknown";
  if (benchmarkId === undefined) {
    issues.push(issue(issueId, "Custom asset benchmarkId is invalid."));
  }

  const density = densityOf(assets.density);
  if (density === undefined) {
    issues.push(issue(issueId, "Custom asset density is invalid."));
  }

  const notes = notesOf(assets.notes);
  if (notes === undefined) {
    issues.push(issue(issueId, "Custom asset notes must be a non-empty bounded string array."));
  }

  const themeResult = validateTheme(assets.theme);
  if (
    themeResult.theme === undefined ||
    themeResult.issues.some((issue) => issue.severity === "error")
  ) {
    const detail = themeResult.issues.map((issue) => issue.message).join("; ");
    issues.push(
      issue(
        issueId,
        detail.length === 0 ? "Custom theme is invalid." : `Custom theme is invalid: ${detail}`,
      ),
    );
  }

  const rawPatterns = assets.patterns;
  const patternResult =
    themeResult.theme === undefined
      ? undefined
      : validatePatternList(rawPatterns, themeResult.theme);
  if (
    !Array.isArray(rawPatterns) ||
    patternResult === undefined ||
    patternResult.issues.length > 0 ||
    patternResult.patterns.length !== rawPatterns.length
  ) {
    const detail = patternResult?.issues.join("; ") ?? "patterns is not an array";
    issues.push(
      issue(
        issueId,
        detail.length === 0
          ? "Custom patterns are invalid."
          : `Custom patterns are invalid: ${detail}`,
      ),
    );
  }

  if (
    issues.length > 0 ||
    benchmarkId === undefined ||
    density === undefined ||
    notes === undefined ||
    themeResult.theme === undefined ||
    patternResult === undefined
  ) {
    return Object.freeze({ issues: Object.freeze(issues) });
  }

  return Object.freeze({
    assets: Object.freeze({
      benchmarkId,
      theme: themeResult.theme,
      density,
      notes,
      patterns: Object.freeze([...patternResult.patterns]),
    }),
    issues: Object.freeze([]),
  });
}
