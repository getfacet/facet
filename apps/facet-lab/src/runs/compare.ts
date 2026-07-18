import type { RunEvidenceV1 } from "../shared/run-contract.js";
import { digestReplayTree } from "./replay.js";

export type ComparisonValue = string | number | boolean;

export type ComparisonCell =
  | { readonly availability: "available"; readonly value: ComparisonValue }
  | { readonly availability: "unavailable"; readonly reason: "not-recorded" };

export const COMPARISON_DIMENSIONS = [
  "status",
  "createdAt",
  "startedAt",
  "completedAt",
  "mode",
  "provider",
  "model",
  "scenarioId",
  "prompt",
  "constraint",
  "viewport",
  "colorMode",
  "assetDigest",
  "assetSource",
  "importedFromRunId",
  "finalTreeDigest",
  "inputTokens",
  "outputTokens",
] as const;

export type ComparisonDimension = (typeof COMPARISON_DIMENSIONS)[number];

export interface RunComparison {
  readonly runIds: readonly string[];
  readonly dimensions: Readonly<Record<ComparisonDimension, readonly ComparisonCell[]>>;
}

export type RunComparisonResult =
  | { readonly ok: true; readonly comparison: RunComparison }
  | {
      readonly ok: false;
      readonly error: { readonly code: "run-count"; readonly message: string };
    };

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cell(value: ComparisonValue | null | undefined): ComparisonCell {
  return value === null || value === undefined
    ? { availability: "unavailable", reason: "not-recorded" }
    : { availability: "available", value };
}

function project(run: RunEvidenceV1, dimension: ComparisonDimension): ComparisonCell {
  switch (dimension) {
    case "status":
    case "createdAt":
    case "mode":
    case "provider":
    case "model":
    case "scenarioId":
    case "prompt":
    case "viewport":
    case "colorMode":
    case "assetDigest":
    case "assetSource":
      return cell(run.run[dimension]);
    case "startedAt":
    case "completedAt":
    case "constraint":
    case "importedFromRunId":
      return cell(run.run[dimension]);
    case "finalTreeDigest":
      return cell(run.finalTree === null ? null : digestReplayTree(run.finalTree));
    case "inputTokens":
    case "outputTokens":
      return cell(run.providerUsage?.[dimension]);
  }
}

/** Project 2–4 evidence snapshots without retaining or mutating caller-owned objects. */
export function compareRuns(runs: readonly RunEvidenceV1[]): RunComparisonResult {
  if (runs.length < 2 || runs.length > 4) {
    return deepFreeze({
      ok: false,
      error: { code: "run-count", message: "Comparison requires between 2 and 4 runs." },
    });
  }
  const dimensions = Object.create(null) as Record<ComparisonDimension, readonly ComparisonCell[]>;
  for (const dimension of COMPARISON_DIMENSIONS) {
    dimensions[dimension] = runs.map((run) => project(run, dimension));
  }
  return deepFreeze({
    ok: true,
    comparison: {
      runIds: runs.map(({ run }) => run.runId),
      dimensions,
    },
  });
}
