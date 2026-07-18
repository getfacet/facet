import {
  MAX_EVIDENCE_BUNDLE_BYTES,
  MAX_EVIDENCE_DEPTH,
  MAX_EVIDENCE_NODES,
  type JsonObject,
  type JsonValue,
} from "./run-contract.js";

export const REDACTION_MARKER = "[REDACTED]";

export type ProjectionErrorCode =
  "cyclic" | "invalid-bound" | "non-json" | "too-deep" | "too-large" | "too-many-nodes";

export interface ProjectionError {
  readonly code: ProjectionErrorCode;
  readonly path: string;
  readonly message: string;
}

export type BoundedJsonProjection =
  | { readonly ok: true; readonly value: JsonValue; readonly bytes: number }
  | { readonly ok: false; readonly error: ProjectionError };

type ProjectionFailure = Extract<BoundedJsonProjection, { readonly ok: false }>;

export interface RedactionOptions {
  readonly canaries?: readonly string[];
  readonly maxBytes?: number;
  readonly artifactBytes?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

interface ResolvedProjectionOptions {
  readonly maxBytes: number;
  readonly artifactBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly canaries: readonly string[];
}

interface ProjectionState {
  readonly options: ResolvedProjectionOptions;
  readonly redact: boolean;
  readonly active: WeakSet<object>;
  nodes: number;
  measuredBytes: number;
}

type WalkResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly error: ProjectionError };

const SECRET_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "headers",
  "apikey",
  "xapikey",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "clientsecret",
  "password",
  "passwd",
  "privatekey",
  "rawkey",
  "providerbody",
  "providerresponse",
  "stack",
  "stacktrace",
  "environment",
  "env",
]);

const SECRET_KEY_SUFFIXES = [
  "authorization",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "password",
  "passwd",
  "privatekey",
  "stacktrace",
] as const;

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  /\bsk-[A-Za-z0-9_-]{12,}\b/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\bAIza[0-9A-Za-z_-]{20,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,100000}?-----END [A-Z ]*PRIVATE KEY-----/gu,
] as const;

const encoder = new TextEncoder();

function failure(code: ProjectionErrorCode, path: string, message: string): WalkResult {
  return { ok: false, error: { code, path, message } };
}

function projectionFailure(
  code: ProjectionErrorCode,
  path: string,
  message: string,
): ProjectionFailure {
  return { ok: false, error: { code, path, message } };
}

function validBound(value: number, allowZero: boolean): boolean {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function resolveOptions(options: RedactionOptions): ProjectionFailure | ResolvedProjectionOptions {
  const maxBytes = options.maxBytes ?? MAX_EVIDENCE_BUNDLE_BYTES;
  const artifactBytes = options.artifactBytes ?? 0;
  const maxDepth = options.maxDepth ?? MAX_EVIDENCE_DEPTH;
  const maxNodes = options.maxNodes ?? MAX_EVIDENCE_NODES;
  if (
    !validBound(maxBytes, false) ||
    !validBound(artifactBytes, true) ||
    !validBound(maxDepth, true) ||
    !validBound(maxNodes, false)
  ) {
    return projectionFailure("invalid-bound", "$", "Projection bounds must be safe integers.");
  }
  if (artifactBytes >= maxBytes) {
    return projectionFailure(
      "too-large",
      "$",
      "Artifact bytes leave no room for the evidence document.",
    );
  }
  return {
    maxBytes,
    artifactBytes,
    maxDepth,
    maxNodes,
    canaries: (options.canaries ?? []).filter((canary) => canary.length > 0),
  };
}

function isProjectionFailure(
  value: ProjectionFailure | ResolvedProjectionOptions,
): value is ProjectionFailure {
  return "ok" in value && value.ok === false;
}

function addMeasuredBytes(state: ProjectionState, value: string, path: string): WalkResult | null {
  state.measuredBytes += encoder.encode(value).byteLength;
  if (state.measuredBytes + state.options.artifactBytes > state.options.maxBytes) {
    return failure("too-large", path, "Evidence exceeds the configured byte budget.");
  }
  return null;
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return (
    SECRET_KEYS.has(normalized) || SECRET_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function redactString(value: string, canaries: readonly string[]): string {
  let redacted = value;
  for (const canary of canaries) redacted = redacted.split(canary).join(REDACTION_MARKER);
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, REDACTION_MARKER);
  return redacted;
}

function walkPrimitive(value: unknown, path: string, state: ProjectionState): WalkResult | null {
  if (value === null || typeof value === "boolean") return { ok: true, value };
  if (typeof value === "string") {
    const projected = state.redact ? redactString(value, state.options.canaries) : value;
    const sizeFailure = addMeasuredBytes(state, projected, path);
    return sizeFailure ?? { ok: true, value: projected };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return failure("non-json", path, "Numbers must be finite.");
    return { ok: true, value };
  }
  return null;
}

function walk(value: unknown, path: string, depth: number, state: ProjectionState): WalkResult {
  state.nodes += 1;
  if (state.nodes > state.options.maxNodes) {
    return failure("too-many-nodes", path, "Evidence exceeds the node budget.");
  }
  if (depth > state.options.maxDepth) {
    return failure("too-deep", path, "Evidence exceeds the nesting-depth budget.");
  }

  const primitive = walkPrimitive(value, path, state);
  if (primitive !== null) return primitive;
  if (typeof value !== "object" || value === null) {
    return failure("non-json", path, "Evidence must contain JSON values only.");
  }
  if (state.active.has(value)) return failure("cyclic", path, "Evidence cannot be cyclic.");
  state.active.add(value);

  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        return failure("non-json", path, "Symbol properties are not JSON evidence.");
      }
      for (const key of Object.keys(value)) {
        if (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length) {
          return failure("non-json", `${path}.${key}`, "Array properties must be JSON indices.");
        }
      }
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined) {
          return failure(
            "non-json",
            `${path}[${String(index)}]`,
            "Sparse arrays are not JSON evidence.",
          );
        }
        if (!("value" in descriptor)) {
          return failure(
            "non-json",
            `${path}[${String(index)}]`,
            "Accessor properties are not JSON evidence.",
          );
        }
        const item = walk(descriptor.value, `${path}[${String(index)}]`, depth + 1, state);
        if (!item.ok) return item;
        output.push(item.value);
      }
      return { ok: true, value: output };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return failure("non-json", path, "Evidence objects must be plain JSON objects.");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return failure("non-json", path, "Symbol properties are not JSON evidence.");
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || descriptor.enumerable !== true) continue;
      const childPath = `${path}.${key}`;
      if (!("value" in descriptor)) {
        return failure("non-json", childPath, "Accessor properties are not JSON evidence.");
      }
      if (state.redact && isSecretKey(key)) continue;
      const keySizeFailure = addMeasuredBytes(state, key, childPath);
      if (keySizeFailure !== null) return keySizeFailure;
      const item = walk(descriptor.value, childPath, depth + 1, state);
      if (!item.ok) return item;
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: item.value,
        writable: true,
      });
    }
    return { ok: true, value: output as JsonObject };
  } catch {
    return failure("non-json", path, "Evidence could not be safely inspected.");
  } finally {
    state.active.delete(value);
  }
}

function project(
  value: unknown,
  options: RedactionOptions,
  redact: boolean,
): BoundedJsonProjection {
  const resolved = resolveOptions(options);
  if (isProjectionFailure(resolved)) return resolved;
  const state: ProjectionState = {
    options: resolved,
    redact,
    active: new WeakSet<object>(),
    nodes: 0,
    measuredBytes: 0,
  };
  const result = walk(value, "$", 0, state);
  if (!result.ok) return result;

  try {
    const serialized = JSON.stringify(result.value);
    const bytes = encoder.encode(serialized).byteLength;
    if (bytes + resolved.artifactBytes > resolved.maxBytes) {
      return projectionFailure("too-large", "$", "Evidence exceeds the configured byte budget.");
    }
    return { ok: true, value: result.value, bytes };
  } catch {
    return projectionFailure("non-json", "$", "Evidence could not be serialized safely.");
  }
}

/** Clone JSON without invoking getters or accepting cycles, exotic objects, or unbounded input. */
export function cloneBoundedJson(
  value: unknown,
  options: RedactionOptions = {},
): BoundedJsonProjection {
  return project(value, options, false);
}

/** First pass: project and recursively redact evidence at capture time. */
export function redactForCapture(
  value: unknown,
  options: RedactionOptions = {},
): BoundedJsonProjection {
  return project(value, options, true);
}

/** Second pass: independently project and redact evidence immediately before export. */
export function redactForExport(
  value: unknown,
  options: RedactionOptions = {},
): BoundedJsonProjection {
  return project(value, options, true);
}
