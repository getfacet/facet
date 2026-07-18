import type { VisualEvaluationV1 } from "../shared/run-contract.js";

export const MAX_VISUAL_SUMMARY_CODE_UNITS = 2_000;
export const MAX_VISUAL_ARTIFACT_IDS = 64;
export const MAX_VISUAL_EVALUATION_VERSIONS = 100;
const MAX_VISUAL_ID_CODE_UNITS = 200;

export const VISUAL_EVIDENCE_REASON_MESSAGES = {
  "not-requested": "Visual evidence was not requested.",
  "capture-unavailable": "Visual capture was unavailable.",
  "judge-unavailable": "Visual judge was unavailable.",
  "capture-failed": "Visual capture failed before producing evidence.",
  "judge-failed": "Visual judge failed before producing a verdict.",
} as const;
export type VisualEvidenceReason = keyof typeof VISUAL_EVIDENCE_REASON_MESSAGES;

export type VisualEvidenceErrorCode =
  "duplicate-id" | "invalid-record" | "too-large" | "version-limit";

export interface VisualEvidenceError {
  readonly code: VisualEvidenceErrorCode;
  readonly message: string;
}

export type VisualEvidenceAppendResult =
  | {
      readonly ok: true;
      readonly version: number;
      readonly record: VisualEvaluationV1;
      readonly history: readonly VisualEvaluationV1[];
    }
  | { readonly ok: false; readonly error: VisualEvidenceError };

function fail(code: VisualEvidenceErrorCode, message: string): VisualEvidenceAppendResult {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (allowEmpty || value.length > 0) &&
    value.trim() === value
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function artifactIds(
  value: unknown,
):
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly tooLarge: boolean } {
  if (!Array.isArray(value)) return { ok: false, tooLarge: false };
  if (value.length > MAX_VISUAL_ARTIFACT_IDS) return { ok: false, tooLarge: true };
  const ids: string[] = [];
  const unique = new Set<string>();
  for (const id of value) {
    if (!isBoundedString(id, MAX_VISUAL_ID_CODE_UNITS) || unique.has(id)) {
      return { ok: false, tooLarge: false };
    }
    unique.add(id);
    ids.push(id);
  }
  return { ok: true, value: Object.freeze(ids) };
}

function parseAvailable(value: Record<string, unknown>): VisualEvaluationV1 | VisualEvidenceError {
  if (
    !hasExactKeys(value, [
      "id",
      "evaluator",
      "status",
      "verdict",
      "summary",
      "artifactIds",
      "createdAt",
    ]) ||
    !isBoundedString(value["id"], MAX_VISUAL_ID_CODE_UNITS) ||
    (value["evaluator"] !== "human" && value["evaluator"] !== "vision") ||
    value["status"] !== "available" ||
    (value["verdict"] !== "pass" && value["verdict"] !== "fail") ||
    !isTimestamp(value["createdAt"])
  ) {
    return { code: "invalid-record", message: "Visual evidence record is invalid." };
  }
  if (
    typeof value["summary"] !== "string" ||
    value["summary"].length > MAX_VISUAL_SUMMARY_CODE_UNITS
  ) {
    return { code: "too-large", message: "Visual evidence exceeded its size bound." };
  }
  if (!isBoundedString(value["summary"], MAX_VISUAL_SUMMARY_CODE_UNITS, true)) {
    return { code: "invalid-record", message: "Visual evidence record is invalid." };
  }
  const artifacts = artifactIds(value["artifactIds"]);
  if (!artifacts.ok) {
    return artifacts.tooLarge
      ? { code: "too-large", message: "Visual evidence exceeded its size bound." }
      : { code: "invalid-record", message: "Visual evidence record is invalid." };
  }
  return Object.freeze({
    schemaVersion: 1,
    id: value["id"],
    evaluator: value["evaluator"],
    status: "available",
    verdict: value["verdict"],
    advisory: true,
    summary: value["summary"],
    artifactIds: artifacts.value,
    createdAt: value["createdAt"],
  });
}

function isReason(value: unknown): value is VisualEvidenceReason {
  return typeof value === "string" && Object.hasOwn(VISUAL_EVIDENCE_REASON_MESSAGES, value);
}

function reasonMatchesStatus(
  status: "unavailable" | "failed",
  reason: VisualEvidenceReason,
): boolean {
  return status === "unavailable"
    ? reason === "not-requested" ||
        reason === "capture-unavailable" ||
        reason === "judge-unavailable"
    : reason === "capture-failed" || reason === "judge-failed";
}

function parseNonAvailable(
  value: Record<string, unknown>,
): VisualEvaluationV1 | VisualEvidenceError {
  if (
    !hasExactKeys(value, ["id", "evaluator", "status", "reason", "artifactIds", "createdAt"]) ||
    !isBoundedString(value["id"], MAX_VISUAL_ID_CODE_UNITS) ||
    (value["evaluator"] !== "human" && value["evaluator"] !== "vision") ||
    (value["status"] !== "unavailable" && value["status"] !== "failed") ||
    !isReason(value["reason"]) ||
    !reasonMatchesStatus(value["status"], value["reason"]) ||
    !isTimestamp(value["createdAt"])
  ) {
    return { code: "invalid-record", message: "Visual evidence record is invalid." };
  }
  const artifacts = artifactIds(value["artifactIds"]);
  if (!artifacts.ok) {
    return artifacts.tooLarge
      ? { code: "too-large", message: "Visual evidence exceeded its size bound." }
      : { code: "invalid-record", message: "Visual evidence record is invalid." };
  }
  return Object.freeze({
    schemaVersion: 1,
    id: value["id"],
    evaluator: value["evaluator"],
    status: value["status"],
    verdict: null,
    advisory: true,
    summary: VISUAL_EVIDENCE_REASON_MESSAGES[value["reason"]],
    artifactIds: artifacts.value,
    createdAt: value["createdAt"],
  });
}

function isVisualEvidenceError(
  value: VisualEvaluationV1 | VisualEvidenceError,
): value is VisualEvidenceError {
  return "code" in value;
}

export function appendVisualEvaluation(
  history: readonly VisualEvaluationV1[],
  input: unknown,
): VisualEvidenceAppendResult {
  if (history.length >= MAX_VISUAL_EVALUATION_VERSIONS) {
    return fail("version-limit", "Visual evidence version limit was reached.");
  }
  if (!isRecord(input)) return fail("invalid-record", "Visual evidence record is invalid.");
  const parsed = input["status"] === "available" ? parseAvailable(input) : parseNonAvailable(input);
  if (isVisualEvidenceError(parsed)) return { ok: false, error: parsed };
  if (history.some(({ id }) => id === parsed.id)) {
    return fail("duplicate-id", "Visual evidence id already exists.");
  }
  const nextHistory = Object.freeze([...history, parsed]);
  return Object.freeze({
    ok: true,
    version: nextHistory.length,
    record: parsed,
    history: nextHistory,
  });
}
