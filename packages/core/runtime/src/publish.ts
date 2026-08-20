import {
  BOUNDS,
  describeDataValue,
  evaluateCandidateModel,
  isFacetIdentifier,
  measurePublishPayload,
  nextRevision,
  writePath,
  type DataValueDescriptor,
  type DataModel,
  type DataPath,
  type JsonPatchOperation,
  type PayloadEvaluation,
  type StageRevision,
} from "@facet/core";

import type { Session } from "./session.js";
import type { WriteAuthority } from "./turn-gate.js";
import { TurnGate } from "./turn-gate.js";

export type DataPublishDescriptor = DataValueDescriptor;

export type DataPublishResult =
  | {
      readonly ok: true;
      readonly session: Session;
      readonly data: DataModel;
      readonly patches: readonly JsonPatchOperation[];
      readonly stageRevision: StageRevision;
      readonly descriptor: DataPublishDescriptor;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
      readonly currentRevision?: StageRevision;
      readonly bound?: string | null;
      readonly path?: string;
    };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathText(path: DataPath): string {
  return path.join(".");
}

function isArrayValue(value: unknown): value is readonly unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function isDataPath(value: unknown): value is DataPath {
  if (!isArrayValue(value)) {
    return false;
  }
  try {
    if (value.length === 0 || value.length > BOUNDS.dataPathDepth) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        return false;
      }
      const segment = value[index];
      if (!isFacetIdentifier(segment)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function reject(
  code: string,
  at: string,
  detail: string,
): Extract<DataPublishResult, { ok: false }> {
  return { ok: false, code, at, detail };
}

function stale(expectedRevision: StageRevision, currentRevision: StageRevision): DataPublishResult {
  return {
    ok: false,
    code: "stale_revision",
    at: "expectedRevision",
    detail: `The publish expected revision ${expectedRevision}, but the session is at revision ${currentRevision}.`,
    currentRevision,
  };
}

function modelReject(
  result: Extract<PayloadEvaluation, { readonly ok: false }>,
): Extract<DataPublishResult, { ok: false }> {
  return {
    ok: false,
    code: result.reason,
    at: result.path,
    detail:
      result.bound === null
        ? "Published data is not serializable JSON data."
        : `Published data exceeds ${result.bound}.`,
    bound: result.bound,
    path: result.path,
  };
}

function descriptor(path: DataPath, value: unknown): DataPublishDescriptor {
  return describeDataValue(pathText(path), value);
}

function valueAtPath(model: DataModel, path: DataPath): unknown {
  let current: unknown = model;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function commit(
  session: Session,
  data: DataModel,
  publishDescriptor: DataPublishDescriptor,
): Extract<DataPublishResult, { ok: true }> {
  const stageRevision = nextRevision(session.stageRevision);
  const nextSession = Object.freeze({
    ...session,
    data,
    stageRevision,
  });
  const patches = Object.freeze([
    Object.freeze({ op: "replace" as const, path: "/data", value: data }),
  ]);
  return {
    ok: true,
    session: nextSession,
    data,
    patches,
    stageRevision,
    descriptor: publishDescriptor,
  };
}

export function applyDataPublish(
  session: Session,
  path: DataPath,
  value: unknown,
  expectedRevision: StageRevision,
  authority: WriteAuthority,
  gate: TurnGate,
): DataPublishResult {
  if (!gate.present(authority)) {
    return reject("publish_authority_rejected", "authority", "The write authority is not active.");
  }
  if (expectedRevision !== session.stageRevision) {
    return stale(expectedRevision, session.stageRevision);
  }
  if (!isDataPath(path)) {
    return reject("invalid_data_path", "path", "Publish paths must be non-empty named-key paths.");
  }

  const candidate = writePath(session.data, path, value);
  const evaluated = evaluateCandidateModel(candidate);
  if (!evaluated.ok) {
    return modelReject(evaluated);
  }

  if (authority.kind === "turn") {
    const payload = measurePublishPayload(value);
    if (!payload.ok) {
      return modelReject(payload);
    }
  }

  return commit(session, evaluated.model, descriptor(path, valueAtPath(evaluated.model, path)));
}
