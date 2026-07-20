import type { FacetPattern, FacetTheme, FacetTree, JsonPatchOperation } from "@facet/core";

/** The only persisted Facet Lab run-evidence schema version. */
export const EVIDENCE_SCHEMA_VERSION = 1 as const;

export const MAX_PROMPT_CODE_UNITS = 20_000;
export const MAX_MODEL_CODE_UNITS = 200;
export const MAX_CAPABILITY_MODELS = 100;
export const MAX_RUN_GUIDE_CODE_UNITS = 20_000;
export const MAX_JSON_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_EVIDENCE_BUNDLE_BYTES = 32 * 1024 * 1024;
export const MIN_RUN_EVIDENCE_RESERVE_BYTES = 8 * 1024 * 1024;
export const MAX_ASSET_BUNDLE_BYTES = MAX_EVIDENCE_BUNDLE_BYTES - MIN_RUN_EVIDENCE_RESERVE_BYTES;
export const MAX_ASSET_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_DIAGNOSTIC_ITEM_BYTES = 1024 * 1024;
export const MAX_EVIDENCE_ITEMS_PER_RUN = 10_000;
export const MAX_EVIDENCE_DEPTH = 32;
export const MAX_EVIDENCE_NODES = 250_000;
export const DEFAULT_RETAINED_RUNS = 500;
export const MIN_RETAINED_RUNS = 1;
export const MAX_RETAINED_RUNS = 5_000;
export const MIN_COMPARISON_RUNS = 2;
export const MAX_COMPARISON_RUNS = 4;

export const RUN_STATUSES = [
  "queued",
  "running",
  "complete",
  "failed",
  "cancelled",
  "incomplete",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_MODES = ["deterministic", "provider"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const PROVIDERS = ["openai", "anthropic"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const VIEWPORTS = ["mobile", "tablet", "desktop"] as const;
export type ViewportName = (typeof VIEWPORTS)[number];

export const COLOR_MODES = ["light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const ASSET_SOURCES = ["default", "imported"] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

export const EVIDENCE_RECORD_KINDS = ["ui-in", "diagnostic", "overflow", "status"] as const;
export type EvidenceRecordKind = (typeof EVIDENCE_RECORD_KINDS)[number];

export const EVIDENCE_RECORD_SOURCES = ["browser", "server", "agent", "provider", "lab"] as const;
export type EvidenceRecordSource = (typeof EVIDENCE_RECORD_SOURCES)[number];

export const FRAME_SOURCES = ["live", "late"] as const;
export type FrameSource = (typeof FRAME_SOURCES)[number];

export const FRAME_DISPOSITIONS = ["applied", "say-only-stale"] as const;
export type FrameDisposition = (typeof FRAME_DISPOSITIONS)[number];

export const WARNING_CLASSIFICATIONS = [
  "validation",
  "provider",
  "replay",
  "visual",
  "overflow",
  "security",
] as const;
export type WarningClassification = (typeof WARNING_CLASSIFICATIONS)[number];

export const CHECK_STATUSES = ["pass", "fail", "unavailable"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const VISUAL_EVALUATION_STATUSES = ["available", "unavailable", "failed"] as const;
export type VisualEvaluationStatus = (typeof VISUAL_EVALUATION_STATUSES)[number];

export const VISUAL_VERDICTS = ["pass", "fail"] as const;
export type VisualVerdict = (typeof VISUAL_VERDICTS)[number];

export const VISUAL_EVALUATORS = ["human", "vision"] as const;
export type VisualEvaluator = (typeof VISUAL_EVALUATORS)[number];

export const ARTIFACT_KINDS = ["screenshot", "trace", "evidence", "evaluation"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_MEDIA_TYPES = ["image/png", "application/json", "text/plain"] as const;
export type ArtifactMediaType = (typeof ARTIFACT_MEDIA_TYPES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface RunConfiguration {
  readonly mode: RunMode;
  readonly provider: ProviderName;
  readonly model: string;
  readonly scenarioId: string;
  readonly prompt: string;
  readonly constraint: string | null;
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
}

export interface RunProvenanceV1 extends RunConfiguration {
  readonly runId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  readonly generation: number;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly assetDigest: string;
  readonly assetSource: AssetSource;
  readonly importedFromRunId: string | null;
}

export interface AssetSnapshotEvidenceV1 {
  readonly digest: string;
  readonly source: AssetSource;
  readonly theme: FacetTheme;
  readonly patterns: readonly FacetPattern[];
}

export interface EvidenceRecordV1 {
  readonly kind: EvidenceRecordKind;
  readonly runId: string;
  readonly turnId: string | null;
  readonly generation: number;
  readonly ordinal: number;
  readonly timestamp: string;
  readonly source: EvidenceRecordSource;
  readonly truncated: boolean;
  readonly overflow: boolean;
  readonly data: JsonValue;
}

export interface AcceptedFrameEvidenceV1 {
  readonly runId: string;
  readonly turnId: string;
  readonly generation: number;
  readonly ordinal: number;
  readonly timestamp: string;
  readonly source: FrameSource;
  readonly stageVersion: number;
  readonly patches: readonly JsonPatchOperation[];
  readonly says: readonly string[];
  readonly disposition: FrameDisposition;
  readonly postFoldTreeDigest: string;
}

export interface StageCheckpointV1 {
  readonly ordinal: number;
  readonly stageVersion: number;
  readonly treeDigest: string;
  readonly tree: FacetTree;
}

export interface ViewCheckpointV1 {
  readonly ordinal: number;
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
  readonly view: JsonValue;
}

export interface ProviderUsageEvidenceV1 {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ClassifiedWarningV1 {
  readonly code: string;
  readonly classification: WarningClassification;
  readonly message: string;
  readonly ordinal: number | null;
}

export interface ContractCheckV1 {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly blocking: boolean;
  readonly details: string | null;
}

export interface VisualEvaluationV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly evaluator: VisualEvaluator;
  readonly status: VisualEvaluationStatus;
  readonly verdict: VisualVerdict | null;
  readonly advisory: true;
  readonly summary: string;
  readonly artifactIds: readonly string[];
  readonly createdAt: string;
}

export interface ArtifactCaptureProvenanceV1 {
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
  readonly stageVersion: number | null;
  readonly ordinal: number;
}

export interface ArtifactManifestEntryV1 {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly mediaType: ArtifactMediaType;
  readonly bytes: number;
  readonly digest: string;
  readonly capture: ArtifactCaptureProvenanceV1;
}

/**
 * The complete persisted evidence document. Empty arrays are valid and mean
 * that the corresponding optional observation/evaluation category had no
 * entries. Required identity and provenance strings are never empty.
 */
export interface RunEvidenceV1 {
  readonly schemaVersion: 1;
  readonly run: RunProvenanceV1;
  readonly assets: AssetSnapshotEvidenceV1;
  readonly initialTree: FacetTree;
  readonly finalTree: FacetTree | null;
  readonly records: readonly EvidenceRecordV1[];
  readonly frames: readonly AcceptedFrameEvidenceV1[];
  readonly checkpoints: readonly StageCheckpointV1[];
  readonly viewCheckpoints: readonly ViewCheckpointV1[];
  readonly providerUsage: ProviderUsageEvidenceV1 | null;
  readonly warnings: readonly ClassifiedWarningV1[];
  readonly checks: readonly ContractCheckV1[];
  readonly visualEvaluations: readonly VisualEvaluationV1[];
  readonly artifacts: readonly ArtifactManifestEntryV1[];
}
