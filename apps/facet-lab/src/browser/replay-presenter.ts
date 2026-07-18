import type { FacetTree, ViewSnapshot } from "@facet/core";

import {
  COMPARISON_DIMENSIONS,
  compareRuns,
  type ComparisonCell,
  type ComparisonDimension,
} from "../runs/compare.js";
import { replayRun, type ReplayIssue } from "../runs/replay.js";
import type { ColorMode, RunEvidenceV1, ViewportName } from "../shared/run-contract.js";

export type ReplayAllowedAction = "scrub";

export interface ReplayStepView {
  readonly index: number;
  readonly label: string;
  readonly ordinal: number | null;
  readonly stageVersion: number;
  readonly disposition: "initial" | "applied" | "say-only-stale";
  readonly tree: FacetTree;
  readonly says: readonly string[];
  readonly digest: string;
  readonly digestMatchesEvidence: boolean;
  readonly initialView: ViewSnapshot | null;
  readonly viewOrdinal: number | null;
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
  readonly rendererKey: string;
}

export interface ReplayPresentation {
  readonly state: "loading" | "empty" | "ready" | "error";
  readonly statusMessage: string;
  readonly providerFree: true;
  readonly allowedActions: readonly ReplayAllowedAction[];
  readonly runId: string | null;
  readonly steps: readonly ReplayStepView[];
  readonly selected: ReplayStepView | null;
  readonly issues: readonly ReplayIssue[];
  readonly finalTreeMatchesEvidence: boolean | null;
}

export type ComparisonGapKind = "render" | "evidence" | "provenance";

export interface ComparisonGap {
  readonly kind: ComparisonGapKind;
  readonly message: string;
}

export interface ComparisonRenderView {
  readonly availability: "available" | "unavailable";
  readonly tree: FacetTree | null;
  readonly reason: string | null;
}

export interface ComparisonEvidenceView {
  readonly availability: "available" | "unavailable";
  readonly itemCount: number;
  readonly reason: string | null;
}

export interface ComparisonColumnView {
  readonly runId: string;
  readonly status: string;
  readonly scenarioId: string;
  readonly provider: string;
  readonly model: string;
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
  readonly render: ComparisonRenderView;
  readonly evidence: ComparisonEvidenceView;
  readonly gaps: readonly ComparisonGap[];
}

export type PresentedComparisonCell = ComparisonCell & {
  readonly display: string;
  readonly gapKind: ComparisonGapKind;
};

export interface ComparisonRowView {
  readonly dimension: ComparisonDimension;
  readonly label: string;
  readonly cells: readonly PresentedComparisonCell[];
}

export interface ComparisonPresentation {
  readonly state: "loading" | "empty" | "ready" | "error";
  readonly statusMessage: string;
  readonly providerFree: true;
  readonly immutable: true;
  readonly allowedActions: readonly [];
  readonly columns: readonly ComparisonColumnView[];
  readonly rows: readonly ComparisonRowView[];
}

const DIMENSION_LABELS: Readonly<Record<ComparisonDimension, string>> = {
  status: "Status",
  createdAt: "Created",
  startedAt: "Started",
  completedAt: "Completed",
  mode: "Mode",
  provider: "Provider",
  model: "Model",
  scenarioId: "Scenario",
  prompt: "Prompt",
  constraint: "Constraint",
  viewport: "Viewport",
  colorMode: "Color mode",
  assetDigest: "Asset digest",
  assetSource: "Asset source",
  importedFromRunId: "Imported from",
  finalTreeDigest: "Final tree digest",
  inputTokens: "Input tokens",
  outputTokens: "Output tokens",
};

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function emptyReplay(
  state: "loading" | "empty" | "error",
  statusMessage: string,
): ReplayPresentation {
  return Object.freeze({
    state,
    statusMessage,
    providerFree: true,
    allowedActions: Object.freeze([] as const),
    runId: null,
    steps: Object.freeze([]),
    selected: null,
    issues: Object.freeze([]),
    finalTreeMatchesEvidence: null,
  });
}

function latestView(
  replay: ReturnType<typeof replayRun>,
  ordinal: number | null,
): (typeof replay.viewCheckpoints)[number] | undefined {
  if (ordinal === null) return undefined;
  let selected: (typeof replay.viewCheckpoints)[number] | undefined;
  for (const checkpoint of replay.viewCheckpoints) {
    if (
      checkpoint.ordinal <= ordinal &&
      (selected === undefined || checkpoint.ordinal > selected.ordinal)
    ) {
      selected = checkpoint;
    }
  }
  return selected;
}

/** Projects immutable replay snapshots. It accepts no provider, transport, mutation, or import callback. */
export function presentReplay(
  evidence: RunEvidenceV1 | null | undefined,
  selectedIndex?: number,
): ReplayPresentation {
  if (evidence === undefined) return emptyReplay("loading", "Loading replay evidence…");
  if (evidence === null) return emptyReplay("empty", "No replay evidence is available.");

  try {
    const replay = replayRun(evidence);
    const steps = replay.snapshots.map((snapshot, index): ReplayStepView => {
      const view = latestView(replay, snapshot.ordinal);
      return Object.freeze({
        index,
        label:
          snapshot.ordinal === null
            ? "Initial stage"
            : `Evidence ${String(snapshot.ordinal)} · stage ${String(snapshot.stageVersion)}`,
        ordinal: snapshot.ordinal,
        stageVersion: snapshot.stageVersion,
        disposition: snapshot.disposition,
        tree: snapshot.tree,
        says: snapshot.says,
        digest: snapshot.digest,
        digestMatchesEvidence: snapshot.digestMatchesEvidence,
        initialView: view?.initialView ?? null,
        viewOrdinal: view?.ordinal ?? null,
        viewport: view?.viewport ?? evidence.run.viewport,
        colorMode: view?.colorMode ?? evidence.run.colorMode,
        rendererKey: `${evidence.run.runId}:${String(evidence.run.generation)}:${String(index)}:${String(view?.ordinal ?? "none")}`,
      });
    });
    const index =
      selectedIndex === undefined
        ? Math.max(0, steps.length - 1)
        : Math.min(Math.max(0, Math.trunc(selectedIndex)), Math.max(0, steps.length - 1));
    return deepFreeze({
      state: "ready" as const,
      statusMessage: `${String(steps.length)} immutable replay checkpoints available.`,
      providerFree: true as const,
      allowedActions: ["scrub"] as const,
      runId: replay.runId,
      steps,
      selected: steps[index] ?? null,
      issues: replay.issues,
      finalTreeMatchesEvidence: replay.finalTreeMatchesEvidence,
    });
  } catch {
    return emptyReplay("error", "Replay evidence could not be projected safely.");
  }
}

function evidenceItemCount(run: RunEvidenceV1): number {
  return (
    run.records.length +
    run.frames.length +
    run.checkpoints.length +
    run.viewCheckpoints.length +
    run.warnings.length +
    run.checks.length +
    run.visualEvaluations.length +
    run.artifacts.length +
    (run.providerUsage === null ? 0 : 1)
  );
}

function dimensionGapKind(dimension: ComparisonDimension): ComparisonGapKind {
  if (dimension === "finalTreeDigest") return "render";
  if (dimension === "inputTokens" || dimension === "outputTokens") return "evidence";
  return "provenance";
}

function presentCell(
  cell: ComparisonCell,
  dimension: ComparisonDimension,
): PresentedComparisonCell {
  return cell.availability === "available"
    ? Object.freeze({ ...cell, display: String(cell.value), gapKind: dimensionGapKind(dimension) })
    : Object.freeze({ ...cell, display: "Not recorded", gapKind: dimensionGapKind(dimension) });
}

function comparisonColumn(run: RunEvidenceV1): ComparisonColumnView {
  const replay = replayRun(run);
  const count = evidenceItemCount(run);
  const gaps: ComparisonGap[] = [];
  if (run.finalTree === null) {
    gaps.push({ kind: "render", message: "No final rendered tree was recorded." });
  }
  if (count === 0) {
    gaps.push({
      kind: "evidence",
      message: "No trace, view, evaluation, or artifact evidence was recorded.",
    });
  }
  if (
    run.run.startedAt === null ||
    run.run.completedAt === null ||
    run.run.importedFromRunId === null
  ) {
    gaps.push({
      kind: "provenance",
      message: "One or more optional provenance fields were not recorded.",
    });
  }
  return deepFreeze({
    runId: run.run.runId,
    status: run.run.status,
    scenarioId: run.run.scenarioId,
    provider: run.run.provider,
    model: run.run.model,
    viewport: run.run.viewport,
    colorMode: run.run.colorMode,
    render:
      run.finalTree === null
        ? { availability: "unavailable" as const, tree: null, reason: "not-recorded" }
        : { availability: "available" as const, tree: replay.finalTree, reason: null },
    evidence:
      count === 0
        ? { availability: "unavailable" as const, itemCount: 0, reason: "not-recorded" }
        : { availability: "available" as const, itemCount: count, reason: null },
    gaps,
  });
}

function emptyComparison(
  state: "loading" | "empty" | "error",
  statusMessage: string,
): ComparisonPresentation {
  return Object.freeze({
    state,
    statusMessage,
    providerFree: true,
    immutable: true,
    allowedActions: Object.freeze([] as const),
    columns: Object.freeze([]),
    rows: Object.freeze([]),
  });
}

/** Read-only 2–4 run projection; the returned presentation retains no mutation capabilities. */
export function presentComparison(
  runs: readonly RunEvidenceV1[] | null | undefined,
): ComparisonPresentation {
  if (runs === undefined) return emptyComparison("loading", "Loading comparison evidence…");
  if (runs === null || runs.length === 0) {
    return emptyComparison("empty", "Select between two and four immutable runs.");
  }
  const compared = compareRuns(runs);
  if (!compared.ok) return emptyComparison("error", compared.error.message);

  try {
    const columns = runs.map(comparisonColumn);
    const rows = COMPARISON_DIMENSIONS.map((dimension): ComparisonRowView =>
      Object.freeze({
        dimension,
        label: DIMENSION_LABELS[dimension],
        cells: Object.freeze(
          compared.comparison.dimensions[dimension].map((cell) => presentCell(cell, dimension)),
        ),
      }),
    );
    return deepFreeze({
      state: "ready" as const,
      statusMessage: `${String(columns.length)} immutable runs compared.`,
      providerFree: true as const,
      immutable: true as const,
      allowedActions: [] as const,
      columns,
      rows,
    });
  } catch {
    return emptyComparison("error", "Comparison evidence could not be projected safely.");
  }
}
