import { createHash, randomUUID } from "node:crypto";

import {
  projectRunEvidenceForCapture,
  projectRunEvidenceForExport,
  validateRunEvidence,
} from "../shared/evidence-schema.js";
import { redactForExport } from "../shared/redaction.js";
import {
  MAX_EVIDENCE_BUNDLE_BYTES,
  type ArtifactManifestEntryV1,
  type RunEvidenceV1,
} from "../shared/run-contract.js";
import { computeAssetDigest } from "./asset-snapshot.js";

export const EVIDENCE_BUNDLE_SCHEMA_VERSION = 1 as const;

export interface EvidenceArtifact {
  readonly id: string;
  readonly data: Uint8Array;
}

interface EncodedArtifact {
  readonly id: string;
  readonly data: string;
}

interface EvidenceBundlePayloadV1 {
  readonly schemaVersion: 1;
  readonly evidence: RunEvidenceV1;
  readonly artifacts: readonly EncodedArtifact[];
}

interface EvidenceBundleV1 extends EvidenceBundlePayloadV1 {
  readonly digest: string;
}

export type EvidenceBundleErrorCode =
  | "artifact-mismatch"
  | "digest-mismatch"
  | "invalid-artifact"
  | "invalid-evidence"
  | "invalid-envelope"
  | "malformed-json"
  | "secret-artifact"
  | "too-large"
  | "unsupported-version";

export interface EvidenceBundleError {
  readonly code: EvidenceBundleErrorCode;
  readonly message: string;
}

export type EvidenceBundleExportResult =
  | {
      readonly ok: true;
      readonly json: string;
      readonly bytes: number;
      readonly digest: string;
      readonly evidence: RunEvidenceV1;
      readonly artifacts: readonly EvidenceArtifact[];
    }
  | { readonly ok: false; readonly error: EvidenceBundleError };

export type EvidenceBundleDecodeResult =
  | {
      readonly ok: true;
      readonly evidence: RunEvidenceV1;
      readonly artifacts: readonly EvidenceArtifact[];
      readonly digest: string;
    }
  | { readonly ok: false; readonly error: EvidenceBundleError };

export interface EvidenceBundleOptions {
  readonly canaries?: readonly string[];
}

export interface EvidenceBundleImportOptions extends EvidenceBundleOptions {
  readonly runId?: string;
  readonly sessionId?: string;
  readonly visitorId?: string;
  readonly now?: () => string;
}

function failure(
  code: EvidenceBundleErrorCode,
  message: string,
): { readonly ok: false; readonly error: EvidenceBundleError } {
  return { ok: false, error: { code, message } };
}

function sha256(data: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length && required.every((key) => Object.hasOwn(value, key));
}

function payloadDigest(payload: EvidenceBundlePayloadV1): string {
  return sha256(JSON.stringify(payload));
}

function cloneArtifact(artifact: EvidenceArtifact): EvidenceArtifact {
  return Object.freeze({ id: artifact.id, data: new Uint8Array(artifact.data) });
}

function artifactHasSecret(data: Uint8Array, canaries: readonly string[]): boolean {
  const text = Buffer.from(data).toString("utf8");
  const redacted = redactForExport(text, {
    canaries,
    maxBytes: MAX_EVIDENCE_BUNDLE_BYTES,
  });
  return !redacted.ok || redacted.value !== text;
}

function reconcileArtifacts(
  manifest: readonly ArtifactManifestEntryV1[],
  artifacts: readonly EvidenceArtifact[],
  canaries: readonly string[],
):
  | { readonly ok: true; readonly artifacts: readonly EvidenceArtifact[] }
  | { readonly ok: false; readonly error: EvidenceBundleError } {
  const byId = new Map<string, EvidenceArtifact>();
  for (const artifact of artifacts) {
    if (artifact.id.length === 0 || byId.has(artifact.id)) {
      return failure("invalid-artifact", "Artifact IDs must be non-empty and unique.");
    }
    byId.set(artifact.id, artifact);
  }
  if (byId.size !== manifest.length) {
    return failure("artifact-mismatch", "Artifact payloads must exactly match the manifest.");
  }

  const ordered: EvidenceArtifact[] = [];
  for (const entry of manifest) {
    const artifact = byId.get(entry.id);
    if (artifact === undefined) {
      return failure("artifact-mismatch", "Artifact payloads must exactly match the manifest.");
    }
    if (artifact.data.byteLength !== entry.bytes || sha256(artifact.data) !== entry.digest) {
      return failure("artifact-mismatch", "Artifact bytes do not match their manifest metadata.");
    }
    if (artifactHasSecret(artifact.data, canaries)) {
      return failure("secret-artifact", "Artifact payload failed the secret scan.");
    }
    ordered.push(cloneArtifact(artifact));
  }
  return { ok: true, artifacts: Object.freeze(ordered) };
}

/** Redact again and encode one exact, content-digested v1 JSON bundle. */
export function exportEvidenceBundle(
  candidate: unknown,
  artifacts: readonly EvidenceArtifact[],
  options: EvidenceBundleOptions = {},
): EvidenceBundleExportResult {
  const projected = projectRunEvidenceForExport(candidate, { canaries: options.canaries ?? [] });
  if (!projected.ok) {
    return failure(
      "invalid-evidence",
      `Evidence failed the export projection (${projected.error.code} at ${projected.error.path}).`,
    );
  }
  const reconciled = reconcileArtifacts(
    projected.value.artifacts,
    artifacts,
    options.canaries ?? [],
  );
  if (!reconciled.ok) return reconciled;

  const encodedArtifacts = reconciled.artifacts.map((artifact) => ({
    id: artifact.id,
    data: Buffer.from(artifact.data).toString("base64"),
  }));
  const payload: EvidenceBundlePayloadV1 = {
    schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
    evidence: projected.value,
    artifacts: encodedArtifacts,
  };
  const digest = payloadDigest(payload);
  const bundle: EvidenceBundleV1 = { ...payload, digest };
  const json = JSON.stringify(bundle);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > MAX_EVIDENCE_BUNDLE_BYTES) {
    return failure("too-large", "Evidence bundle exceeds 32 MiB.");
  }
  return {
    ok: true,
    json,
    bytes,
    digest,
    evidence: projected.value,
    artifacts: reconciled.artifacts,
  };
}

function inputBuffer(input: string | Uint8Array): Buffer | undefined {
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > MAX_EVIDENCE_BUNDLE_BYTES) return undefined;
    return Buffer.from(input, "utf8");
  }
  if (input.byteLength > MAX_EVIDENCE_BUNDLE_BYTES) return undefined;
  return Buffer.from(input);
}

function decodeArtifacts(
  value: unknown,
):
  | { readonly ok: true; readonly artifacts: readonly EvidenceArtifact[] }
  | { readonly ok: false; readonly error: EvidenceBundleError } {
  if (!Array.isArray(value))
    return failure("invalid-envelope", "Bundle artifacts must be an array.");
  const artifacts: EvidenceArtifact[] = [];
  for (const item of value) {
    if (!isPlainObject(item) || !hasExactKeys(item, ["id", "data"])) {
      return failure("invalid-envelope", "Bundle artifact entries are malformed.");
    }
    if (typeof item.id !== "string" || typeof item.data !== "string") {
      return failure("invalid-envelope", "Bundle artifact entries are malformed.");
    }
    const data = Buffer.from(item.data, "base64");
    if (data.toString("base64") !== item.data) {
      return failure("invalid-artifact", "Artifact base64 is malformed.");
    }
    artifacts.push({ id: item.id, data: new Uint8Array(data) });
  }
  return { ok: true, artifacts };
}

/** Parse, bound, digest-check, schema-check, and redact an untrusted bundle. */
export function decodeEvidenceBundle(
  input: string | Uint8Array,
  options: EvidenceBundleOptions = {},
): EvidenceBundleDecodeResult {
  const bytes = inputBuffer(input);
  if (bytes === undefined) return failure("too-large", "Evidence bundle exceeds 32 MiB.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return failure("malformed-json", "Evidence bundle JSON is malformed.");
  }
  if (
    !isPlainObject(parsed) ||
    !hasExactKeys(parsed, ["schemaVersion", "evidence", "artifacts", "digest"])
  ) {
    return failure("invalid-envelope", "Evidence bundle envelope is malformed.");
  }
  if (parsed.schemaVersion !== EVIDENCE_BUNDLE_SCHEMA_VERSION) {
    return failure("unsupported-version", "Evidence bundle version is unsupported.");
  }
  if (typeof parsed.digest !== "string") {
    return failure("invalid-envelope", "Evidence bundle digest is malformed.");
  }

  const decodedArtifacts = decodeArtifacts(parsed.artifacts);
  if (!decodedArtifacts.ok) return decodedArtifacts;
  const rawValidation = validateRunEvidence(parsed.evidence);
  if (!rawValidation.ok) {
    return failure("invalid-evidence", "Evidence bundle contains invalid evidence.");
  }
  const payload: EvidenceBundlePayloadV1 = {
    schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
    evidence: rawValidation.value,
    artifacts: decodedArtifacts.artifacts.map((artifact) => ({
      id: artifact.id,
      data: Buffer.from(artifact.data).toString("base64"),
    })),
  };
  if (payloadDigest(payload) !== parsed.digest) {
    return failure("digest-mismatch", "Evidence bundle digest does not match its contents.");
  }

  const projected = projectRunEvidenceForCapture(rawValidation.value, {
    canaries: options.canaries ?? [],
  });
  if (!projected.ok) {
    return failure(
      "invalid-evidence",
      `Evidence bundle failed the import projection (${projected.error.code} at ${projected.error.path}).`,
    );
  }
  const reconciled = reconcileArtifacts(
    projected.value.artifacts,
    decodedArtifacts.artifacts,
    options.canaries ?? [],
  );
  if (!reconciled.ok) return reconciled;
  return {
    ok: true,
    evidence: projected.value,
    artifacts: reconciled.artifacts,
    digest: parsed.digest,
  };
}

/** Re-key decoded evidence for provider-free local replay while retaining provenance. */
export function importEvidenceBundle(
  input: string | Uint8Array,
  options: EvidenceBundleImportOptions = {},
): EvidenceBundleDecodeResult {
  const decoded = decodeEvidenceBundle(input, options);
  if (!decoded.ok) return decoded;
  if (
    computeAssetDigest(decoded.evidence.assets.theme, decoded.evidence.assets.patterns) !==
    decoded.evidence.assets.digest
  ) {
    return failure("invalid-evidence", "Evidence asset digest does not match Theme and Patterns.");
  }
  const originalRunId = decoded.evidence.run.runId;
  const runId = options.runId ?? randomUUID();
  const importedWhileActive =
    decoded.evidence.run.status === "queued" || decoded.evidence.run.status === "running";
  const importedCompletion = [
    options.now?.() ?? new Date().toISOString(),
    decoded.evidence.run.createdAt,
    decoded.evidence.run.startedAt,
  ]
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1)!;
  const rewritten: RunEvidenceV1 = {
    ...decoded.evidence,
    run: {
      ...decoded.evidence.run,
      runId,
      sessionId: options.sessionId ?? randomUUID(),
      visitorId: options.visitorId ?? `import-${runId}`,
      importedFromRunId: originalRunId,
      ...(importedWhileActive ? { status: "incomplete", completedAt: importedCompletion } : {}),
    },
    records: decoded.evidence.records.map((record) => ({ ...record, runId })),
    frames: decoded.evidence.frames.map((frame) => ({ ...frame, runId })),
  };
  const validation = projectRunEvidenceForCapture(rewritten, {
    canaries: options.canaries ?? [],
  });
  if (!validation.ok) {
    return failure(
      "invalid-evidence",
      `Imported evidence identity is invalid (${validation.error.code} at ${validation.error.path}).`,
    );
  }
  return {
    ok: true,
    evidence: validation.value,
    artifacts: decoded.artifacts,
    digest: decoded.digest,
  };
}
