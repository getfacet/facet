import {
  MAX_PATCH_OPS,
  validateAuthorTree,
  validatePatternList,
  validateTheme,
  type FacetTheme,
} from "@facet/core";

import {
  ARTIFACT_KINDS,
  ARTIFACT_MEDIA_TYPES,
  ASSET_SOURCES,
  CHECK_STATUSES,
  COLOR_MODES,
  EVIDENCE_RECORD_KINDS,
  EVIDENCE_RECORD_SOURCES,
  EVIDENCE_SCHEMA_VERSION,
  FRAME_DISPOSITIONS,
  FRAME_SOURCES,
  MAX_ASSET_DOCUMENT_BYTES,
  MAX_DIAGNOSTIC_ITEM_BYTES,
  MAX_EVIDENCE_BUNDLE_BYTES,
  MAX_EVIDENCE_DEPTH,
  MAX_EVIDENCE_ITEMS_PER_RUN,
  MAX_EVIDENCE_NODES,
  MAX_MODEL_CODE_UNITS,
  MAX_PROMPT_CODE_UNITS,
  MAX_RUN_GUIDE_CODE_UNITS,
  PROVIDERS,
  RUN_MODES,
  RUN_STATUSES,
  VIEWPORTS,
  VISUAL_EVALUATION_STATUSES,
  VISUAL_EVALUATORS,
  VISUAL_VERDICTS,
  WARNING_CLASSIFICATIONS,
  type JsonObject,
  type JsonValue,
  type RunEvidenceV1,
} from "./run-contract.js";
import {
  cloneBoundedJson,
  redactForCapture,
  redactForExport,
  type BoundedJsonProjection,
  type ProjectionErrorCode,
  type RedactionOptions,
} from "./redaction.js";

export type EvidenceValidationErrorCode =
  | ProjectionErrorCode
  | "empty-input"
  | "invalid-field"
  | "invalid-root"
  | "malformed-json"
  | "missing-field"
  | "unknown-field"
  | "unsupported-version";

export interface EvidenceValidationError {
  readonly code: EvidenceValidationErrorCode;
  readonly path: string;
  readonly message: string;
}

export type EvidenceValidationResult =
  | {
      readonly ok: true;
      readonly value: RunEvidenceV1;
      readonly bytes: number;
      readonly documentBytes: number;
      readonly artifactBytes: number;
    }
  | { readonly ok: false; readonly error: EvidenceValidationError };

export interface TrustedEvidenceRetention {
  readonly accepted: boolean;
  readonly value: RunEvidenceV1;
  readonly validation: EvidenceValidationResult;
}

const TOP_LEVEL_FIELDS = [
  "schemaVersion",
  "run",
  "assets",
  "initialTree",
  "finalTree",
  "records",
  "frames",
  "checkpoints",
  "viewCheckpoints",
  "providerUsage",
  "warnings",
  "checks",
  "visualEvaluations",
  "artifacts",
] as const;

const RUN_FIELDS = [
  "runId",
  "sessionId",
  "visitorId",
  "generation",
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
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const encoder = new TextEncoder();

function fail(
  code: EvidenceValidationErrorCode,
  path: string,
  message: string,
): Extract<EvidenceValidationResult, { readonly ok: false }> {
  return { ok: false, error: { code, path, message } };
}

function fromProjectionFailure(
  result: Extract<BoundedJsonProjection, { readonly ok: false }>,
): Extract<EvidenceValidationResult, { readonly ok: false }> {
  return fail(result.error.code, result.error.path, result.error.message);
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactObject(
  value: JsonValue | undefined,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  if (!isObject(value)) return fail("invalid-field", path, `${path} must be an object.`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return fail("unknown-field", `${path}.${key}`, `Unknown field ${key}.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      return fail("missing-field", `${path}.${key}`, `Missing required field ${key}.`);
    }
  }
  return null;
}

function requireString(
  value: JsonValue | undefined,
  path: string,
  maxCodeUnits: number,
  allowEmpty = false,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  if (
    typeof value !== "string" ||
    value.length > maxCodeUnits ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    return fail(
      "invalid-field",
      path,
      `${path} must be ${allowEmpty ? "a" : "a non-empty"} string of at most ${String(maxCodeUnits)} UTF-16 code units.`,
    );
  }
  return null;
}

function requireNullableString(
  value: JsonValue | undefined,
  path: string,
  maxCodeUnits: number,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  return value === null ? null : requireString(value, path, maxCodeUnits);
}

function requireEnum(
  value: JsonValue | undefined,
  path: string,
  values: readonly string[],
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  if (typeof value !== "string" || !values.includes(value)) {
    return fail("invalid-field", path, `${path} must be one of: ${values.join(", ")}.`);
  }
  return null;
}

function requireBoolean(
  value: JsonValue | undefined,
  path: string,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  return typeof value === "boolean"
    ? null
    : fail("invalid-field", path, `${path} must be boolean.`);
}

function requireInteger(
  value: JsonValue | undefined,
  path: string,
  minimum = 0,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? null
    : fail("invalid-field", path, `${path} must be a safe integer >= ${String(minimum)}.`);
}

function requireNullableInteger(
  value: JsonValue | undefined,
  path: string,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  return value === null ? null : requireInteger(value, path);
}

function requireTimestamp(
  value: JsonValue | undefined,
  path: string,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return fail("invalid-field", path, `${path} must be an ISO-8601 UTC timestamp.`);
  }
  return null;
}

function requireNullableTimestamp(
  value: JsonValue | undefined,
  path: string,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  return value === null ? null : requireTimestamp(value, path);
}

function requireUuid(
  value: JsonValue | undefined,
  path: string,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? null
    : fail("invalid-field", path, `${path} must be a UUID.`);
}

function requireNullableUuid(
  value: JsonValue | undefined,
  path: string,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  return value === null ? null : requireUuid(value, path);
}

function requireArray(
  value: JsonValue | undefined,
  path: string,
  maximum = MAX_EVIDENCE_ITEMS_PER_RUN,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  if (!Array.isArray(value) || value.length > maximum) {
    return fail(
      "invalid-field",
      path,
      `${path} must be an array with at most ${String(maximum)} items.`,
    );
  }
  return null;
}

function serializedBytes(value: JsonValue): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function validateRun(
  run: JsonValue | undefined,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  const objectFailure = requireExactObject(run, "$.run", RUN_FIELDS);
  if (objectFailure !== null || !isObject(run)) return objectFailure;
  const checks = [
    requireUuid(run.runId, "$.run.runId"),
    requireUuid(run.sessionId, "$.run.sessionId"),
    requireString(run.visitorId, "$.run.visitorId", 200),
    requireInteger(run.generation, "$.run.generation", 1),
    requireEnum(run.status, "$.run.status", RUN_STATUSES),
    requireTimestamp(run.createdAt, "$.run.createdAt"),
    requireNullableTimestamp(run.startedAt, "$.run.startedAt"),
    requireNullableTimestamp(run.completedAt, "$.run.completedAt"),
    requireEnum(run.mode, "$.run.mode", RUN_MODES),
    requireEnum(run.provider, "$.run.provider", PROVIDERS),
    requireString(run.model, "$.run.model", MAX_MODEL_CODE_UNITS),
    requireString(run.scenarioId, "$.run.scenarioId", 200),
    requireString(run.prompt, "$.run.prompt", MAX_PROMPT_CODE_UNITS),
    requireNullableString(run.constraint, "$.run.constraint", MAX_RUN_GUIDE_CODE_UNITS),
    requireEnum(run.viewport, "$.run.viewport", VIEWPORTS),
    requireEnum(run.colorMode, "$.run.colorMode", COLOR_MODES),
    requireString(run.assetDigest, "$.run.assetDigest", 200),
    requireEnum(run.assetSource, "$.run.assetSource", ASSET_SOURCES),
    requireNullableUuid(run.importedFromRunId, "$.run.importedFromRunId"),
  ];
  return checks.find((check) => check !== null) ?? null;
}

function validateAssets(
  assets: JsonValue | undefined,
  run: JsonObject,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  const objectFailure = requireExactObject(assets, "$.assets", [
    "digest",
    "source",
    "theme",
    "patterns",
  ]);
  if (objectFailure !== null || !isObject(assets)) return objectFailure;
  const checks = [
    requireString(assets.digest, "$.assets.digest", 200),
    requireEnum(assets.source, "$.assets.source", ASSET_SOURCES),
    isObject(assets.theme)
      ? null
      : fail("invalid-field", "$.assets.theme", "Theme evidence must be an object."),
    requireArray(assets.patterns, "$.assets.patterns"),
  ];
  const firstFailure = checks.find((check) => check !== null) ?? null;
  if (firstFailure !== null) return firstFailure;
  if (assets.digest !== run.assetDigest || assets.source !== run.assetSource) {
    return fail(
      "invalid-field",
      "$.assets",
      "Asset snapshot digest/source must match immutable run provenance.",
    );
  }
  if (assets.theme !== undefined && serializedBytes(assets.theme) > MAX_ASSET_DOCUMENT_BYTES) {
    return fail("too-large", "$.assets.theme", "Theme evidence exceeds 1 MiB.");
  }
  if (Array.isArray(assets.patterns)) {
    for (let index = 0; index < assets.patterns.length; index += 1) {
      const pattern = assets.patterns[index];
      if (!isObject(pattern)) {
        return fail(
          "invalid-field",
          `$.assets.patterns[${String(index)}]`,
          "Pattern evidence must be an object.",
        );
      }
      if (serializedBytes(pattern) > MAX_ASSET_DOCUMENT_BYTES) {
        return fail(
          "too-large",
          `$.assets.patterns[${String(index)}]`,
          "Pattern evidence exceeds 1 MiB.",
        );
      }
    }
  }
  const themeResult = validateTheme(assets.theme);
  if (themeResult.theme === undefined) {
    return fail("invalid-field", "$.assets.theme", "Theme evidence failed strict Core validation.");
  }
  if (!Array.isArray(assets.patterns)) {
    return fail("invalid-field", "$.assets.patterns", "Pattern evidence must be an array.");
  }
  const patternResult = validatePatternList(assets.patterns, themeResult.theme);
  if (patternResult.patterns.length !== assets.patterns.length || patternResult.issues.length > 0) {
    return fail(
      "invalid-field",
      "$.assets.patterns",
      "Pattern evidence failed strict Core validation.",
    );
  }
  return null;
}

function validateTreeEvidence(
  value: JsonValue | undefined,
  path: string,
  theme: FacetTheme,
  nullable: boolean,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  if (nullable && value === null) return null;
  if (!isObject(value) || validateAuthorTree(value, theme).value === undefined) {
    return fail("invalid-field", path, `${path} must be a strictly valid Facet tree.`);
  }
  return null;
}

function validateJsonPointer(
  value: JsonValue | undefined,
  path: string,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  const stringFailure = requireString(value, path, MAX_RUN_GUIDE_CODE_UNITS, true);
  if (stringFailure !== null || typeof value !== "string") return stringFailure;
  if (value !== "" && !value.startsWith("/")) {
    return fail("invalid-field", path, "JSON Pointer must be empty or start with '/'.");
  }
  for (const token of value.slice(1).split("/")) {
    if (/~(?![01])/u.test(token)) {
      return fail("invalid-field", path, "JSON Pointer contains an invalid escape.");
    }
    const decoded = token.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (decoded === "__proto__" || decoded === "prototype" || decoded === "constructor") {
      return fail("invalid-field", path, "JSON Pointer contains a forbidden key.");
    }
  }
  return null;
}

function validatePatchOperation(
  operation: JsonValue | undefined,
  path: string,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  if (!isObject(operation) || typeof operation.op !== "string") {
    return fail("invalid-field", path, "Patch evidence must be an RFC 6902 operation object.");
  }
  const op = operation.op;
  const fields =
    op === "add" || op === "replace" || op === "test"
      ? ["op", "path", "value"]
      : op === "move" || op === "copy"
        ? ["op", "from", "path"]
        : op === "remove"
          ? ["op", "path"]
          : null;
  if (fields === null) return fail("invalid-field", `${path}.op`, "Unknown RFC 6902 operation.");
  const objectFailure = requireExactObject(operation, path, fields);
  if (objectFailure !== null) return objectFailure;
  const pathFailure = validateJsonPointer(operation.path, `${path}.path`);
  if (pathFailure !== null) return pathFailure;
  if (op === "move" || op === "copy") {
    return validateJsonPointer(operation.from, `${path}.from`);
  }
  return null;
}

function validateRecords(
  records: JsonValue | undefined,
  run: JsonObject,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  const arrayFailure = requireArray(records, "$.records");
  if (arrayFailure !== null || !Array.isArray(records)) return arrayFailure;
  let previousOrdinal = -1;
  let overflowCount = 0;
  for (let index = 0; index < records.length; index += 1) {
    const path = `$.records[${String(index)}]`;
    const record = records[index];
    const objectFailure = requireExactObject(record, path, [
      "kind",
      "runId",
      "turnId",
      "generation",
      "ordinal",
      "timestamp",
      "source",
      "truncated",
      "overflow",
      "data",
    ]);
    if (objectFailure !== null || !isObject(record)) return objectFailure;
    const checks = [
      requireEnum(record.kind, `${path}.kind`, EVIDENCE_RECORD_KINDS),
      requireUuid(record.runId, `${path}.runId`),
      requireNullableString(record.turnId, `${path}.turnId`, 200),
      requireInteger(record.generation, `${path}.generation`, 1),
      requireInteger(record.ordinal, `${path}.ordinal`),
      requireTimestamp(record.timestamp, `${path}.timestamp`),
      requireEnum(record.source, `${path}.source`, EVIDENCE_RECORD_SOURCES),
      requireBoolean(record.truncated, `${path}.truncated`),
      requireBoolean(record.overflow, `${path}.overflow`),
    ];
    const firstFailure = checks.find((check) => check !== null) ?? null;
    if (firstFailure !== null) return firstFailure;
    if (record.runId !== run.runId || record.generation !== run.generation) {
      return fail("invalid-field", path, "Record correlation must match its run.");
    }
    if (typeof record.ordinal === "number" && record.ordinal <= previousOrdinal) {
      return fail(
        "invalid-field",
        `${path}.ordinal`,
        "Record ordinals must increase monotonically.",
      );
    }
    previousOrdinal = typeof record.ordinal === "number" ? record.ordinal : previousOrdinal;
    const isOverflow = record.kind === "overflow";
    if (record.overflow !== isOverflow) {
      return fail(
        "invalid-field",
        `${path}.overflow`,
        "Only an overflow record may set overflow=true.",
      );
    }
    if (isOverflow) {
      overflowCount += 1;
      if (index !== records.length - 1 || overflowCount > 1) {
        return fail(
          "invalid-field",
          path,
          "Exactly one overflow record may appear, and it must be last.",
        );
      }
    }
    if (serializedBytes(record) > MAX_DIAGNOSTIC_ITEM_BYTES) {
      return fail("too-large", path, "Evidence record exceeds 1 MiB.");
    }
  }
  if (overflowCount === 1 && run.status !== "incomplete") {
    return fail(
      "invalid-field",
      "$.run.status",
      "A run with overflow evidence must be incomplete.",
    );
  }
  return null;
}

function validateFrames(
  frames: JsonValue | undefined,
  run: JsonObject,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  const arrayFailure = requireArray(frames, "$.frames");
  if (arrayFailure !== null || !Array.isArray(frames)) return arrayFailure;
  let previousOrdinal = -1;
  let previousStageVersion = -1;
  for (let index = 0; index < frames.length; index += 1) {
    const path = `$.frames[${String(index)}]`;
    const frame = frames[index];
    const objectFailure = requireExactObject(frame, path, [
      "runId",
      "turnId",
      "generation",
      "ordinal",
      "timestamp",
      "source",
      "stageVersion",
      "patches",
      "says",
      "disposition",
      "postFoldTreeDigest",
    ]);
    if (objectFailure !== null || !isObject(frame)) return objectFailure;
    const checks = [
      requireUuid(frame.runId, `${path}.runId`),
      requireString(frame.turnId, `${path}.turnId`, 200),
      requireInteger(frame.generation, `${path}.generation`, 1),
      requireInteger(frame.ordinal, `${path}.ordinal`),
      requireTimestamp(frame.timestamp, `${path}.timestamp`),
      requireEnum(frame.source, `${path}.source`, FRAME_SOURCES),
      requireInteger(frame.stageVersion, `${path}.stageVersion`),
      requireArray(frame.patches, `${path}.patches`, MAX_PATCH_OPS),
      requireArray(frame.says, `${path}.says`),
      requireEnum(frame.disposition, `${path}.disposition`, FRAME_DISPOSITIONS),
      requireString(frame.postFoldTreeDigest, `${path}.postFoldTreeDigest`, 200),
    ];
    const firstFailure = checks.find((check) => check !== null) ?? null;
    if (firstFailure !== null) return firstFailure;
    if (frame.runId !== run.runId || frame.generation !== run.generation) {
      return fail("invalid-field", path, "Frame correlation must match its run.");
    }
    if (
      typeof frame.ordinal === "number" &&
      (frame.ordinal <= previousOrdinal ||
        (typeof frame.stageVersion === "number" && frame.stageVersion < previousStageVersion))
    ) {
      return fail("invalid-field", path, "Frame ordinals and stage versions must be monotonic.");
    }
    previousOrdinal = typeof frame.ordinal === "number" ? frame.ordinal : previousOrdinal;
    previousStageVersion =
      typeof frame.stageVersion === "number" ? frame.stageVersion : previousStageVersion;
    if (Array.isArray(frame.patches)) {
      for (let patchIndex = 0; patchIndex < frame.patches.length; patchIndex += 1) {
        const patchFailure = validatePatchOperation(
          frame.patches[patchIndex],
          `${path}.patches[${String(patchIndex)}]`,
        );
        if (patchFailure !== null) return patchFailure;
      }
    }
    if (Array.isArray(frame.says)) {
      for (let sayIndex = 0; sayIndex < frame.says.length; sayIndex += 1) {
        const sayFailure = requireString(
          frame.says[sayIndex],
          `${path}.says[${String(sayIndex)}]`,
          MAX_RUN_GUIDE_CODE_UNITS,
          true,
        );
        if (sayFailure !== null) return sayFailure;
      }
    }
  }
  return null;
}

function validateCheckpoints(
  checkpoints: JsonValue | undefined,
  theme: FacetTheme,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  const arrayFailure = requireArray(checkpoints, "$.checkpoints");
  if (arrayFailure !== null || !Array.isArray(checkpoints)) return arrayFailure;
  let previousOrdinal = -1;
  let previousStageVersion = -1;
  for (let index = 0; index < checkpoints.length; index += 1) {
    const path = `$.checkpoints[${String(index)}]`;
    const checkpoint = checkpoints[index];
    const objectFailure = requireExactObject(checkpoint, path, [
      "ordinal",
      "stageVersion",
      "treeDigest",
      "tree",
    ]);
    if (objectFailure !== null || !isObject(checkpoint)) return objectFailure;
    const checks = [
      requireInteger(checkpoint.ordinal, `${path}.ordinal`),
      requireInteger(checkpoint.stageVersion, `${path}.stageVersion`),
      requireString(checkpoint.treeDigest, `${path}.treeDigest`, 200),
      validateTreeEvidence(checkpoint.tree, `${path}.tree`, theme, false),
    ];
    const firstFailure = checks.find((check) => check !== null) ?? null;
    if (firstFailure !== null) return firstFailure;
    if (
      typeof checkpoint.ordinal === "number" &&
      (checkpoint.ordinal <= previousOrdinal ||
        (typeof checkpoint.stageVersion === "number" &&
          checkpoint.stageVersion < previousStageVersion))
    ) {
      return fail(
        "invalid-field",
        path,
        "Checkpoint ordinals and stage versions must be monotonic.",
      );
    }
    previousOrdinal = typeof checkpoint.ordinal === "number" ? checkpoint.ordinal : previousOrdinal;
    previousStageVersion =
      typeof checkpoint.stageVersion === "number" ? checkpoint.stageVersion : previousStageVersion;
  }
  return null;
}

function validateViewCheckpoints(
  checkpoints: JsonValue | undefined,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  const arrayFailure = requireArray(checkpoints, "$.viewCheckpoints");
  if (arrayFailure !== null || !Array.isArray(checkpoints)) return arrayFailure;
  let previousOrdinal = -1;
  for (let index = 0; index < checkpoints.length; index += 1) {
    const path = `$.viewCheckpoints[${String(index)}]`;
    const checkpoint = checkpoints[index];
    const objectFailure = requireExactObject(checkpoint, path, [
      "ordinal",
      "viewport",
      "colorMode",
      "view",
    ]);
    if (objectFailure !== null || !isObject(checkpoint)) return objectFailure;
    const checks = [
      requireInteger(checkpoint.ordinal, `${path}.ordinal`),
      requireEnum(checkpoint.viewport, `${path}.viewport`, VIEWPORTS),
      requireEnum(checkpoint.colorMode, `${path}.colorMode`, COLOR_MODES),
      isObject(checkpoint.view)
        ? null
        : fail("invalid-field", `${path}.view`, "View checkpoint must be an object."),
    ];
    const firstFailure = checks.find((check) => check !== null) ?? null;
    if (firstFailure !== null) return firstFailure;
    if (typeof checkpoint.ordinal === "number" && checkpoint.ordinal <= previousOrdinal) {
      return fail("invalid-field", `${path}.ordinal`, "View checkpoint ordinals must increase.");
    }
    previousOrdinal = typeof checkpoint.ordinal === "number" ? checkpoint.ordinal : previousOrdinal;
  }
  return null;
}

function validateProviderUsage(
  usage: JsonValue | undefined,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  if (usage === null) return null;
  const objectFailure = requireExactObject(
    usage,
    "$.providerUsage",
    [],
    ["inputTokens", "outputTokens"],
  );
  if (objectFailure !== null || !isObject(usage)) return objectFailure;
  for (const field of ["inputTokens", "outputTokens"] as const) {
    if (Object.hasOwn(usage, field)) {
      const countFailure = requireInteger(usage[field], `$.providerUsage.${field}`);
      if (countFailure !== null) return countFailure;
    }
  }
  return null;
}

function validateWarnings(
  warnings: JsonValue | undefined,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  const arrayFailure = requireArray(warnings, "$.warnings");
  if (arrayFailure !== null || !Array.isArray(warnings)) return arrayFailure;
  for (let index = 0; index < warnings.length; index += 1) {
    const path = `$.warnings[${String(index)}]`;
    const warning = warnings[index];
    const objectFailure = requireExactObject(warning, path, [
      "code",
      "classification",
      "message",
      "ordinal",
    ]);
    if (objectFailure !== null || !isObject(warning)) return objectFailure;
    const firstFailure = [
      requireString(warning.code, `${path}.code`, 200),
      requireEnum(warning.classification, `${path}.classification`, WARNING_CLASSIFICATIONS),
      requireString(warning.message, `${path}.message`, MAX_RUN_GUIDE_CODE_UNITS, true),
      requireNullableInteger(warning.ordinal, `${path}.ordinal`),
    ].find((check) => check !== null);
    if (firstFailure !== undefined) return firstFailure;
  }
  return null;
}

function validateChecks(
  checks: JsonValue | undefined,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  const arrayFailure = requireArray(checks, "$.checks");
  if (arrayFailure !== null || !Array.isArray(checks)) return arrayFailure;
  for (let index = 0; index < checks.length; index += 1) {
    const path = `$.checks[${String(index)}]`;
    const check = checks[index];
    const objectFailure = requireExactObject(check, path, [
      "id",
      "label",
      "status",
      "blocking",
      "details",
    ]);
    if (objectFailure !== null || !isObject(check)) return objectFailure;
    const firstFailure = [
      requireString(check.id, `${path}.id`, 200),
      requireString(check.label, `${path}.label`, 500),
      requireEnum(check.status, `${path}.status`, CHECK_STATUSES),
      requireBoolean(check.blocking, `${path}.blocking`),
      requireNullableString(check.details, `${path}.details`, MAX_RUN_GUIDE_CODE_UNITS),
    ].find((item) => item !== null);
    if (firstFailure !== undefined) return firstFailure;
  }
  return null;
}

function validateVisualEvaluations(
  evaluations: JsonValue | undefined,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  const arrayFailure = requireArray(evaluations, "$.visualEvaluations");
  if (arrayFailure !== null || !Array.isArray(evaluations)) return arrayFailure;
  for (let index = 0; index < evaluations.length; index += 1) {
    const path = `$.visualEvaluations[${String(index)}]`;
    const evaluation = evaluations[index];
    const objectFailure = requireExactObject(evaluation, path, [
      "schemaVersion",
      "id",
      "evaluator",
      "status",
      "verdict",
      "advisory",
      "summary",
      "artifactIds",
      "createdAt",
    ]);
    if (objectFailure !== null || !isObject(evaluation)) return objectFailure;
    const firstFailure = [
      evaluation.schemaVersion === 1
        ? null
        : fail("unsupported-version", `${path}.schemaVersion`, "Unsupported visual schema."),
      requireString(evaluation.id, `${path}.id`, 200),
      requireEnum(evaluation.evaluator, `${path}.evaluator`, VISUAL_EVALUATORS),
      requireEnum(evaluation.status, `${path}.status`, VISUAL_EVALUATION_STATUSES),
      evaluation.verdict === null
        ? null
        : requireEnum(evaluation.verdict, `${path}.verdict`, VISUAL_VERDICTS),
      evaluation.advisory === true
        ? null
        : fail("invalid-field", `${path}.advisory`, "Visual evaluations are advisory only."),
      requireString(evaluation.summary, `${path}.summary`, MAX_RUN_GUIDE_CODE_UNITS, true),
      requireArray(evaluation.artifactIds, `${path}.artifactIds`),
      requireTimestamp(evaluation.createdAt, `${path}.createdAt`),
    ].find((item) => item !== null);
    if (firstFailure !== undefined) return firstFailure;
    if (
      (evaluation.status === "available" && evaluation.verdict === null) ||
      (evaluation.status !== "available" && evaluation.verdict !== null)
    ) {
      return fail(
        "invalid-field",
        `${path}.verdict`,
        "Only available visual evaluations carry a verdict.",
      );
    }
    if (Array.isArray(evaluation.artifactIds)) {
      for (
        let artifactIndex = 0;
        artifactIndex < evaluation.artifactIds.length;
        artifactIndex += 1
      ) {
        const idFailure = requireString(
          evaluation.artifactIds[artifactIndex],
          `${path}.artifactIds[${String(artifactIndex)}]`,
          200,
        );
        if (idFailure !== null) return idFailure;
      }
    }
  }
  return null;
}

function validateArtifacts(
  artifacts: JsonValue | undefined,
):
  | { readonly ok: true; readonly bytes: number; readonly ids: ReadonlySet<string> }
  | Extract<EvidenceValidationResult, { readonly ok: false }> {
  const arrayFailure = requireArray(artifacts, "$.artifacts");
  if (arrayFailure !== null || !Array.isArray(artifacts)) {
    return arrayFailure ?? fail("invalid-field", "$.artifacts", "Artifacts must be an array.");
  }
  let bytes = 0;
  const ids = new Set<string>();
  for (let index = 0; index < artifacts.length; index += 1) {
    const path = `$.artifacts[${String(index)}]`;
    const artifact = artifacts[index];
    const objectFailure = requireExactObject(artifact, path, [
      "id",
      "kind",
      "mediaType",
      "bytes",
      "digest",
      "capture",
    ]);
    if (objectFailure !== null) return objectFailure;
    if (!isObject(artifact)) {
      return fail("invalid-field", path, "Artifact must be an object.");
    }
    const firstFailure = [
      requireString(artifact.id, `${path}.id`, 200),
      requireEnum(artifact.kind, `${path}.kind`, ARTIFACT_KINDS),
      requireEnum(artifact.mediaType, `${path}.mediaType`, ARTIFACT_MEDIA_TYPES),
      requireInteger(artifact.bytes, `${path}.bytes`),
      requireString(artifact.digest, `${path}.digest`, 200),
    ].find((item) => item !== null);
    if (firstFailure !== undefined) return firstFailure;
    if (typeof artifact.id === "string") {
      if (ids.has(artifact.id)) {
        return fail("invalid-field", `${path}.id`, "Artifact IDs must be unique.");
      }
      ids.add(artifact.id);
    }
    if (typeof artifact.bytes === "number") {
      bytes += artifact.bytes;
      if (!Number.isSafeInteger(bytes) || bytes >= MAX_EVIDENCE_BUNDLE_BYTES) {
        return fail("too-large", `${path}.bytes`, "Artifacts exceed the evidence bundle budget.");
      }
    }
    const capturePath = `${path}.capture`;
    const captureFailure = requireExactObject(artifact.capture, capturePath, [
      "viewport",
      "colorMode",
      "stageVersion",
      "ordinal",
    ]);
    if (captureFailure !== null) return captureFailure;
    if (!isObject(artifact.capture)) {
      return fail("invalid-field", capturePath, "Capture provenance must be an object.");
    }
    const provenanceFailure = [
      requireEnum(artifact.capture.viewport, `${capturePath}.viewport`, VIEWPORTS),
      requireEnum(artifact.capture.colorMode, `${capturePath}.colorMode`, COLOR_MODES),
      requireNullableInteger(artifact.capture.stageVersion, `${capturePath}.stageVersion`),
      requireInteger(artifact.capture.ordinal, `${capturePath}.ordinal`),
    ].find((item) => item !== null);
    if (provenanceFailure !== undefined) return provenanceFailure;
  }
  return { ok: true, bytes, ids };
}

function validateVisualArtifactReferences(
  evaluations: JsonValue | undefined,
  artifactIds: ReadonlySet<string>,
): Extract<EvidenceValidationResult, { readonly ok: false }> | null {
  if (!Array.isArray(evaluations)) return null;
  for (let index = 0; index < evaluations.length; index += 1) {
    const evaluation = evaluations[index];
    if (!isObject(evaluation) || !Array.isArray(evaluation.artifactIds)) continue;
    for (let artifactIndex = 0; artifactIndex < evaluation.artifactIds.length; artifactIndex += 1) {
      const artifactId = evaluation.artifactIds[artifactIndex];
      if (typeof artifactId === "string" && !artifactIds.has(artifactId)) {
        return fail(
          "invalid-field",
          `$.visualEvaluations[${String(index)}].artifactIds[${String(artifactIndex)}]`,
          "Visual evaluation references an unknown artifact.",
        );
      }
    }
  }
  return null;
}

/** Validate and detach one exact v1 document. The caller's value is never mutated. */
export function validateRunEvidence(candidate: unknown): EvidenceValidationResult {
  const projection = cloneBoundedJson(candidate, {
    maxBytes: MAX_EVIDENCE_BUNDLE_BYTES,
    maxDepth: MAX_EVIDENCE_DEPTH,
    maxNodes: MAX_EVIDENCE_NODES,
  });
  if (!projection.ok) return fromProjectionFailure(projection);
  if (!isObject(projection.value)) {
    return fail("invalid-root", "$", "Run evidence must be a non-null object.");
  }

  const rootFailure = requireExactObject(projection.value, "$", TOP_LEVEL_FIELDS);
  if (rootFailure !== null) {
    return rootFailure.error.code === "invalid-field"
      ? fail("invalid-root", "$", "Run evidence must be a non-null object.")
      : rootFailure;
  }
  if (projection.value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    return fail(
      "unsupported-version",
      "$.schemaVersion",
      `Only evidence schema version ${String(EVIDENCE_SCHEMA_VERSION)} is supported.`,
    );
  }

  const runFailure = validateRun(projection.value.run);
  if (runFailure !== null) return runFailure;
  if (!isObject(projection.value.run)) {
    return fail("invalid-field", "$.run", "Run provenance must be an object.");
  }
  const assetsFailure = validateAssets(projection.value.assets, projection.value.run);
  if (assetsFailure !== null) return assetsFailure;
  if (!isObject(projection.value.assets)) {
    return fail("invalid-field", "$.assets", "Asset evidence must be an object.");
  }
  const theme = validateTheme(projection.value.assets.theme).theme;
  if (theme === undefined) {
    return fail("invalid-field", "$.assets.theme", "Theme evidence failed strict Core validation.");
  }
  const sequentialChecks = [
    validateTreeEvidence(projection.value.initialTree, "$.initialTree", theme, false),
    validateTreeEvidence(projection.value.finalTree, "$.finalTree", theme, true),
    validateRecords(projection.value.records, projection.value.run),
    validateFrames(projection.value.frames, projection.value.run),
    validateCheckpoints(projection.value.checkpoints, theme),
    validateViewCheckpoints(projection.value.viewCheckpoints),
    validateProviderUsage(projection.value.providerUsage),
    validateWarnings(projection.value.warnings),
    validateChecks(projection.value.checks),
    validateVisualEvaluations(projection.value.visualEvaluations),
  ];
  const firstFailure = sequentialChecks.find((check) => check !== null);
  if (firstFailure !== undefined) return firstFailure;

  const artifacts = validateArtifacts(projection.value.artifacts);
  if (!artifacts.ok) return artifacts;
  const referenceFailure = validateVisualArtifactReferences(
    projection.value.visualEvaluations,
    artifacts.ids,
  );
  if (referenceFailure !== null) return referenceFailure;
  const totalBytes = projection.bytes + artifacts.bytes;
  if (totalBytes > MAX_EVIDENCE_BUNDLE_BYTES) {
    return fail("too-large", "$", "Evidence document plus artifacts exceeds 32 MiB.");
  }

  return {
    ok: true,
    value: projection.value as unknown as RunEvidenceV1,
    bytes: totalBytes,
    documentBytes: projection.bytes,
    artifactBytes: artifacts.bytes,
  };
}

/** Bound text before parsing so malformed or hostile JSON cannot mutate trusted state. */
export function parseRunEvidenceJson(text: string): EvidenceValidationResult {
  if (text.trim().length === 0) return fail("empty-input", "$", "Evidence JSON cannot be empty.");
  if (encoder.encode(text).byteLength > MAX_EVIDENCE_BUNDLE_BYTES) {
    return fail("too-large", "$", "Evidence JSON exceeds 32 MiB.");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(text) as unknown;
  } catch {
    return fail("malformed-json", "$", "Evidence JSON is malformed.");
  }
  return validateRunEvidence(candidate);
}

/** Capture projection: redact once, then require the exact evidence schema. */
export function projectRunEvidenceForCapture(
  candidate: unknown,
  options: RedactionOptions = {},
): EvidenceValidationResult {
  const projection = redactForCapture(candidate, options);
  return projection.ok ? validateRunEvidence(projection.value) : fromProjectionFailure(projection);
}

/** Export projection: independently redact again, then require the exact evidence schema. */
export function projectRunEvidenceForExport(
  candidate: unknown,
  options: RedactionOptions = {},
): EvidenceValidationResult {
  const projection = redactForExport(candidate, options);
  return projection.ok ? validateRunEvidence(projection.value) : fromProjectionFailure(projection);
}

/**
 * Transactional selection primitive: a rejected candidate returns the exact
 * trusted object by identity, while an accepted candidate returns its detached
 * validated projection.
 */
export function retainTrustedEvidence(
  trusted: RunEvidenceV1,
  candidate: unknown,
): TrustedEvidenceRetention {
  const validation = validateRunEvidence(candidate);
  return validation.ok
    ? { accepted: true, value: validation.value, validation }
    : { accepted: false, value: trusted, validation };
}
