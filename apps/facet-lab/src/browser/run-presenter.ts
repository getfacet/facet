import {
  RUN_STATUSES,
  type CheckStatus,
  type ContractCheckV1,
  type EvidenceRecordV1,
  type JsonObject,
  type JsonValue,
  type ProviderName,
  type RunEvidenceV1,
  type RunMode,
  type RunStatus,
  type VisualEvaluationV1,
} from "../shared/run-contract.js";

const REDACTION_MARKER = "[REDACTED]";
const ASSET_TOOL_NAMES = new Set([
  "get_brick_spec",
  "get_style_choices",
  "get_preset",
  "get_pattern",
]);
const TERMINAL_STATUSES = new Set<RunStatus>(["complete", "failed", "cancelled", "incomplete"]);

export type RunAction = "inspect" | "cancel" | "export" | "capture" | "evaluate";

export interface RunHistoryFilters {
  readonly status?: RunStatus;
  readonly provider?: ProviderName;
  readonly mode?: RunMode;
  readonly query?: string;
}

export interface RunHistoryRow {
  readonly runId: string;
  readonly generation: number;
  readonly status: RunStatus;
  readonly statusLabel: string;
  readonly scenarioId: string;
  readonly mode: RunMode;
  readonly provider: ProviderName;
  readonly model: string;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly actions: readonly RunAction[];
}

export interface RunHistoryPresentation {
  readonly rows: readonly RunHistoryRow[];
  readonly total: number;
  readonly visible: number;
  readonly emptyLabel: string;
}

export type TraceItemKind =
  | "prompt"
  | "asset"
  | "ui-in"
  | "provider"
  | "tool"
  | "usage"
  | "patch"
  | "stage"
  | "status"
  | "warning"
  | "overflow";
export type TraceItemState = "available" | "truncated" | "redacted" | "overflow";
export type TraceItemPhase = "call" | "result" | null;

export interface TraceItemPresentation {
  readonly id: string;
  readonly kind: TraceItemKind;
  readonly ordinal: number | null;
  readonly timestamp: string | null;
  readonly turnId: string | null;
  readonly correlationId: string | null;
  readonly phase: TraceItemPhase;
  readonly label: string;
  readonly summary: string;
  readonly state: TraceItemState;
}

export interface UsagePresentation {
  readonly state: "available" | "missing";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface TracePresentation {
  readonly items: readonly TraceItemPresentation[];
  readonly usage: UsagePresentation;
  readonly completeness: "complete" | "partial" | "overflow";
  readonly missingKinds: readonly TraceItemKind[];
}

export interface CheckPresentation {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly details: string | null;
}

export interface ContractPresentation {
  readonly verdict: "pass" | "fail" | "unavailable";
  readonly blockingFailureCount: number;
  readonly checks: readonly CheckPresentation[];
  readonly advisoryChecks: readonly CheckPresentation[];
}

export interface VisualItemPresentation {
  readonly id: string;
  readonly evaluator: VisualEvaluationV1["evaluator"];
  readonly state: VisualEvaluationV1["status"];
  readonly verdict: VisualEvaluationV1["verdict"];
  readonly summary: string;
  readonly artifactIds: readonly string[];
  readonly createdAt: string;
}

export interface VisualPresentation {
  readonly state: "missing" | VisualEvaluationV1["status"];
  readonly latestVerdict: VisualEvaluationV1["verdict"];
  readonly advisory: true;
  readonly label: string;
  readonly items: readonly VisualItemPresentation[];
}

export interface ArtifactPresentation {
  readonly id: string;
  readonly kind: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly viewport: string;
  readonly colorMode: string;
  readonly stageVersion: number | null;
}

export interface RunDetailStates {
  readonly completion: "active" | "complete" | "failed" | "cancelled" | "incomplete";
  readonly usage: "available" | "missing";
  readonly visual: "missing" | VisualEvaluationV1["status"];
  readonly redaction: "present" | "none";
  readonly overflow: "present" | "none";
}

export interface RunDetailPresentation {
  readonly runId: string;
  readonly generation: number;
  readonly status: RunStatus;
  readonly statusLabel: string;
  readonly scenarioId: string;
  readonly prompt: string;
  readonly provenance: {
    readonly mode: RunMode;
    readonly provider: ProviderName;
    readonly model: string;
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly viewport: string;
    readonly colorMode: string;
    readonly assetDigest: string;
    readonly assetSource: string;
    readonly importedFromRunId: string | null;
  };
  readonly states: RunDetailStates;
  readonly trace: TracePresentation;
  readonly contract: ContractPresentation;
  readonly visual: VisualPresentation;
  readonly artifacts: readonly ArtifactPresentation[];
  readonly warnings: readonly {
    readonly code: string;
    readonly classification: string;
    readonly message: string;
  }[];
  readonly actions: readonly RunAction[];
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function statusLabel(status: RunStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "incomplete":
      return "Incomplete evidence";
  }
}

function actionsFor(status: RunStatus): readonly RunAction[] {
  return TERMINAL_STATUSES.has(status)
    ? ["inspect", "export", "capture", "evaluate"]
    : ["inspect", "cancel"];
}

function matchesHistory(run: RunEvidenceV1, filters: RunHistoryFilters): boolean {
  if (filters.status !== undefined && run.run.status !== filters.status) return false;
  if (filters.provider !== undefined && run.run.provider !== filters.provider) return false;
  if (filters.mode !== undefined && run.run.mode !== filters.mode) return false;
  const query = filters.query?.trim().toLocaleLowerCase();
  return (
    query === undefined ||
    query.length === 0 ||
    [run.run.runId, run.run.scenarioId, run.run.model].some((value) =>
      value.toLocaleLowerCase().includes(query),
    )
  );
}

export function presentRunHistory(
  runs: readonly RunEvidenceV1[],
  filters: RunHistoryFilters = {},
): RunHistoryPresentation {
  const rows = runs
    .filter((run) => matchesHistory(run, filters))
    .sort((left, right) => {
      const timestamp = right.run.createdAt.localeCompare(left.run.createdAt);
      return timestamp === 0 ? right.run.runId.localeCompare(left.run.runId) : timestamp;
    })
    .map((evidence): RunHistoryRow => ({
      runId: evidence.run.runId,
      generation: evidence.run.generation,
      status: evidence.run.status,
      statusLabel: statusLabel(evidence.run.status),
      scenarioId: evidence.run.scenarioId,
      mode: evidence.run.mode,
      provider: evidence.run.provider,
      model: evidence.run.model,
      createdAt: evidence.run.createdAt,
      completedAt: evidence.run.completedAt,
      actions: actionsFor(evidence.run.status),
    }));
  return deepFreeze({
    rows,
    total: runs.length,
    visible: rows.length,
    emptyLabel: runs.length === 0 ? "No runs have been recorded." : "No runs match these filters.",
  });
}

function recordData(record: EvidenceRecordV1): Readonly<Record<string, JsonValue>> | undefined {
  return isJsonObject(record.data) ? record.data : undefined;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataString(data: Readonly<Record<string, JsonValue>>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

function dataBoolean(data: Readonly<Record<string, JsonValue>>, key: string): boolean {
  return data[key] === true;
}

function dataCount(data: Readonly<Record<string, JsonValue>>, key: string): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function markerState(...values: readonly (string | null | undefined)[]): TraceItemState {
  return values.some((value) => value?.includes(REDACTION_MARKER) === true)
    ? "redacted"
    : "available";
}

function item(
  record: EvidenceRecordV1,
  suffix: string,
  input: Omit<TraceItemPresentation, "id" | "ordinal" | "timestamp" | "turnId" | "state"> & {
    readonly state?: TraceItemState;
  },
): TraceItemPresentation {
  return {
    id: `${String(record.ordinal)}:${suffix}`,
    ordinal: record.ordinal,
    timestamp: record.timestamp,
    turnId: record.turnId,
    state: record.overflow
      ? "overflow"
      : record.truncated
        ? "truncated"
        : (input.state ?? "available"),
    ...input,
  };
}

function recordItems(record: EvidenceRecordV1): readonly TraceItemPresentation[] {
  if (record.kind === "overflow" || record.overflow) {
    return [
      item(record, "overflow", {
        kind: "overflow",
        correlationId: null,
        phase: null,
        label: "Evidence limit reached",
        summary: "Later trace items may be unavailable.",
        state: "overflow",
      }),
    ];
  }
  if (record.kind === "ui-in") {
    return [
      item(record, "ui-in", {
        kind: "ui-in",
        correlationId: null,
        phase: null,
        label: "UI input",
        summary: `Accepted ${record.source} input for the correlated turn.`,
      }),
    ];
  }
  if (record.kind === "status") {
    const status = recordData(record);
    const value = status === undefined ? undefined : dataString(status, "status");
    return [
      item(record, "status", {
        kind: "status",
        correlationId: null,
        phase: null,
        label: "Run status",
        summary:
          value !== undefined && RUN_STATUSES.includes(value as RunStatus) ? value : "updated",
      }),
    ];
  }
  const data = recordData(record);
  if (data === undefined) return [];
  const diagnosticKind = dataString(data, "kind");
  if (diagnosticKind === "provider-attempt") {
    const attempt = dataCount(data, "attempt");
    return [
      item(record, "provider", {
        kind: "provider",
        correlationId: null,
        phase: null,
        label: "Provider attempt",
        summary: attempt === undefined ? "Attempt recorded." : `Attempt ${String(attempt)}.`,
      }),
    ];
  }
  if (diagnosticKind === "tool-call") {
    const callId = dataString(data, "callId") ?? "uncorrelated";
    const name = dataString(data, "name") ?? "unknown-tool";
    const asset = ASSET_TOOL_NAMES.has(name);
    return [
      item(record, "tool-call", {
        kind: asset ? "asset" : "tool",
        correlationId: callId,
        phase: "call",
        label: asset ? `Asset read: ${name}` : `Tool call: ${name}`,
        summary: `Call ${callId}. Input values are intentionally not projected.`,
        state:
          dataBoolean(data, "truncated") || record.truncated
            ? "truncated"
            : markerState(name, callId),
      }),
    ];
  }
  if (diagnosticKind === "tool-result") {
    const callId = dataString(data, "callId") ?? "uncorrelated";
    const outcomes = [
      dataBoolean(data, "mutated") ? "stage mutated" : "no stage mutation",
      dataBoolean(data, "said") ? "message emitted" : "no message emitted",
    ];
    return [
      item(record, "tool-result", {
        kind: "tool",
        correlationId: callId,
        phase: "result",
        label: "Tool result",
        summary: `${callId}: ${outcomes.join(", ")}. Result payload is intentionally not projected.`,
        state:
          dataBoolean(data, "truncated") || record.truncated ? "truncated" : markerState(callId),
      }),
    ];
  }
  if (diagnosticKind === "batch") {
    const usage = data["usage"];
    const usageRecord = usage !== undefined && isJsonObject(usage) ? usage : undefined;
    const inputTokens =
      usageRecord === undefined ? undefined : dataCount(usageRecord, "inputTokens");
    const outputTokens =
      usageRecord === undefined ? undefined : dataCount(usageRecord, "outputTokens");
    return [
      item(record, "usage", {
        kind: "usage",
        correlationId: null,
        phase: null,
        label: "Provider usage batch",
        summary:
          inputTokens === undefined && outputTokens === undefined
            ? "Token usage was not reported for this batch."
            : `${String(inputTokens ?? 0)} input / ${String(outputTokens ?? 0)} output tokens.`,
      }),
    ];
  }
  if (diagnosticKind === "stop") {
    const reason = dataString(data, "reason");
    return [
      item(record, "stop", {
        kind: "status",
        correlationId: null,
        phase: null,
        label: "Agent stopped",
        summary: reason ?? "No stop reason was projected.",
      }),
    ];
  }
  if (diagnosticKind === "overflow") {
    return [
      item(record, "diagnostic-overflow", {
        kind: "overflow",
        correlationId: null,
        phase: null,
        label: "Diagnostic limit reached",
        summary: "Later agent diagnostics may be unavailable.",
        state: "overflow",
      }),
    ];
  }
  return [];
}

export function presentRunTrace(evidence: RunEvidenceV1): TracePresentation {
  const usage: UsagePresentation =
    evidence.providerUsage === null
      ? { state: "missing", inputTokens: null, outputTokens: null }
      : {
          state: "available",
          inputTokens: evidence.providerUsage.inputTokens ?? null,
          outputTokens: evidence.providerUsage.outputTokens ?? null,
        };
  const items: TraceItemPresentation[] = [
    {
      id: "run:prompt",
      kind: "prompt",
      ordinal: null,
      timestamp: evidence.run.createdAt,
      turnId: null,
      correlationId: null,
      phase: null,
      label: "Run prompt",
      summary: evidence.run.prompt,
      state: markerState(evidence.run.prompt),
    },
    {
      id: "run:assets",
      kind: "asset",
      ordinal: null,
      timestamp: evidence.run.createdAt,
      turnId: null,
      correlationId: null,
      phase: null,
      label: "Frozen asset snapshot",
      summary: `${evidence.assets.source} assets ${evidence.assets.digest}; ${String(evidence.assets.patterns.length)} patterns.`,
      state: markerState(evidence.assets.digest),
    },
  ];
  for (const record of evidence.records) items.push(...recordItems(record));
  for (const frame of evidence.frames) {
    const patchSummary =
      frame.patches.length === 0
        ? "No patch operations."
        : frame.patches.map(({ op, path }) => `${op} ${path || "/"}`).join(", ");
    items.push({
      id: `${String(frame.ordinal)}:patch`,
      kind: "patch",
      ordinal: frame.ordinal,
      timestamp: frame.timestamp,
      turnId: frame.turnId,
      correlationId: null,
      phase: null,
      label: `${String(frame.patches.length)} accepted patch operation${frame.patches.length === 1 ? "" : "s"}`,
      summary: patchSummary,
      state: markerState(patchSummary),
    });
    items.push({
      id: `${String(frame.ordinal)}:stage`,
      kind: "stage",
      ordinal: frame.ordinal,
      timestamp: frame.timestamp,
      turnId: frame.turnId,
      correlationId: null,
      phase: null,
      label: `Stage version ${String(frame.stageVersion)}`,
      summary: `${frame.disposition}; ${frame.postFoldTreeDigest}.`,
      state: markerState(frame.postFoldTreeDigest),
    });
  }
  for (const warning of evidence.warnings) {
    items.push({
      id: `warning:${warning.code}:${String(warning.ordinal ?? "run")}`,
      kind: "warning",
      ordinal: warning.ordinal,
      timestamp: null,
      turnId: null,
      correlationId: null,
      phase: null,
      label: `${warning.classification} warning: ${warning.code}`,
      summary: warning.message,
      state: markerState(warning.code, warning.message),
    });
  }
  items.sort((left, right) => {
    if (left.ordinal === null && right.ordinal === null) return left.id.localeCompare(right.id);
    if (left.ordinal === null) return -1;
    if (right.ordinal === null) return 1;
    return left.ordinal === right.ordinal
      ? left.id.localeCompare(right.id)
      : left.ordinal - right.ordinal;
  });
  const required: readonly TraceItemKind[] = ["prompt", "asset", "tool", "patch", "stage", "usage"];
  const present = new Set(items.map(({ kind }) => kind));
  const missingKinds = required.filter((kind) => !present.has(kind));
  if (usage.state === "available") present.add("usage");
  const correctedMissing = required.filter((kind) => !present.has(kind));
  const overflow = items.some(({ state }) => state === "overflow");
  return deepFreeze({
    items,
    usage,
    completeness: overflow ? "overflow" : correctedMissing.length === 0 ? "complete" : "partial",
    missingKinds: correctedMissing.length <= missingKinds.length ? correctedMissing : missingKinds,
  });
}

function checkView(check: ContractCheckV1): CheckPresentation {
  return { id: check.id, label: check.label, status: check.status, details: check.details };
}

function presentContract(checks: readonly ContractCheckV1[]): ContractPresentation {
  const blocking = checks.filter(({ blocking }) => blocking);
  const failures = blocking.filter(({ status }) => status !== "pass");
  const verdict =
    blocking.length === 0
      ? "unavailable"
      : blocking.some(({ status }) => status === "fail")
        ? "fail"
        : blocking.some(({ status }) => status === "unavailable")
          ? "unavailable"
          : "pass";
  return {
    verdict,
    blockingFailureCount: failures.length,
    checks: blocking.map(checkView),
    advisoryChecks: checks.filter(({ blocking }) => !blocking).map(checkView),
  };
}

function presentVisual(evaluations: readonly VisualEvaluationV1[]): VisualPresentation {
  const items = evaluations.map((evaluation): VisualItemPresentation => ({
    id: evaluation.id,
    evaluator: evaluation.evaluator,
    state: evaluation.status,
    verdict: evaluation.verdict,
    summary: evaluation.summary,
    artifactIds: [...evaluation.artifactIds],
    createdAt: evaluation.createdAt,
  }));
  const latest = items.at(-1);
  return {
    state: latest?.state ?? "missing",
    latestVerdict: latest?.verdict ?? null,
    advisory: true,
    label:
      latest === undefined
        ? "Visual evidence was not requested."
        : latest.state === "available"
          ? `Latest visual verdict: ${latest.verdict ?? "unavailable"}.`
          : latest.summary,
    items,
  };
}

function completion(status: RunStatus): RunDetailStates["completion"] {
  if (status === "queued" || status === "running") return "active";
  return status;
}

function knownTextHasRedaction(evidence: RunEvidenceV1): boolean {
  return [
    evidence.run.prompt,
    evidence.run.constraint,
    ...evidence.warnings.flatMap(({ code, message }) => [code, message]),
    ...evidence.checks.flatMap(({ label, details }) => [label, details]),
    ...evidence.visualEvaluations.map(({ summary }) => summary),
  ].some((value) => value?.includes(REDACTION_MARKER) === true);
}

export function presentRunDetail(evidence: RunEvidenceV1): RunDetailPresentation {
  const trace = presentRunTrace(evidence);
  const contract = presentContract(evidence.checks);
  const visual = presentVisual(evidence.visualEvaluations);
  const states: RunDetailStates = {
    completion: completion(evidence.run.status),
    usage: trace.usage.state,
    visual: visual.state,
    redaction: knownTextHasRedaction(evidence) ? "present" : "none",
    overflow: trace.items.some(({ state }) => state === "overflow") ? "present" : "none",
  };
  return deepFreeze({
    runId: evidence.run.runId,
    generation: evidence.run.generation,
    status: evidence.run.status,
    statusLabel: statusLabel(evidence.run.status),
    scenarioId: evidence.run.scenarioId,
    prompt: evidence.run.prompt,
    provenance: {
      mode: evidence.run.mode,
      provider: evidence.run.provider,
      model: evidence.run.model,
      createdAt: evidence.run.createdAt,
      startedAt: evidence.run.startedAt,
      completedAt: evidence.run.completedAt,
      viewport: evidence.run.viewport,
      colorMode: evidence.run.colorMode,
      assetDigest: evidence.run.assetDigest,
      assetSource: evidence.run.assetSource,
      importedFromRunId: evidence.run.importedFromRunId,
    },
    states,
    trace,
    contract,
    visual,
    artifacts: evidence.artifacts.map((artifact): ArtifactPresentation => ({
      id: artifact.id,
      kind: artifact.kind,
      mediaType: artifact.mediaType,
      bytes: artifact.bytes,
      viewport: artifact.capture.viewport,
      colorMode: artifact.capture.colorMode,
      stageVersion: artifact.capture.stageVersion,
    })),
    warnings: evidence.warnings.map(({ code, classification, message }) => ({
      code,
      classification,
      message,
    })),
    actions: actionsFor(evidence.run.status),
  });
}
