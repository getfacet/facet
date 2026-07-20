import { validateRunEvidence } from "../shared/evidence-schema.js";
import { cloneBoundedJson } from "../shared/redaction.js";
import {
  MAX_CAPABILITY_MODELS,
  MAX_EVIDENCE_BUNDLE_BYTES,
  MAX_JSON_REQUEST_BYTES,
  MAX_RETAINED_RUNS,
  MIN_RETAINED_RUNS,
  RUN_MODES,
  RUN_STATUSES,
  type JsonValue,
  type ProviderName,
  type RunConfiguration,
  type RunEvidenceV1,
  type RunMode,
  type RunStatus,
} from "../shared/run-contract.js";
import type { LabCapabilities } from "./run-config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
export interface BrowserCreatedRun {
  readonly runId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  readonly generation: number;
  readonly status: "queued";
  readonly streamUrl: string;
  readonly evidenceUrl: string;
}

export interface BrowserRunFilters {
  readonly limit?: number;
  readonly status?: RunStatus;
  readonly provider?: ProviderName;
  readonly mode?: RunMode;
}

export interface BrowserArtifact {
  readonly mediaType: "image/png" | "application/json" | "text/plain";
  readonly data: Uint8Array;
}

export interface LabApiClientOptions {
  readonly fetchImpl?: typeof fetch;
}

export interface LabApiRequestOptions {
  readonly signal?: AbortSignal;
}

export interface LabApiClient {
  getCatalog(): Promise<JsonValue>;
  getCapabilities(): Promise<LabCapabilities>;
  getAssets(options?: LabApiRequestOptions): Promise<JsonValue>;
  createRun(configuration: RunConfiguration): Promise<BrowserCreatedRun>;
  listRuns(filters?: BrowserRunFilters): Promise<readonly RunEvidenceV1[]>;
  getRun(runId: string): Promise<RunEvidenceV1>;
  cancelRun(runId: string): Promise<JsonValue>;
  exportRun(runId: string): Promise<string>;
  importRun(bundle: string): Promise<JsonValue>;
  evaluateRun(runId: string, request: unknown): Promise<JsonValue>;
  captureRun(runId: string): Promise<JsonValue>;
  getArtifact(runId: string, artifactId: string): Promise<BrowserArtifact>;
}

export class LabApiError extends Error {
  readonly status: number;
  readonly code: "invalid-response" | "request-failed" | "response-too-large";

  constructor(status: number, code: LabApiError["code"], message: string) {
    super(message);
    this.name = "LabApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function boundedModelList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_CAPABILITY_MODELS &&
    value.every(
      (model) =>
        typeof model === "string" &&
        model.length >= 1 &&
        model.length <= 200 &&
        model.trim() === model &&
        !hasControlCharacter(model),
    )
  );
}

function providerCapability(value: unknown, provider: ProviderName): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, ["provider", "available", "models", "defaultModel"]) &&
    value.provider === provider &&
    typeof value.available === "boolean" &&
    boundedModelList(value.models) &&
    typeof value.defaultModel === "string" &&
    value.models.includes(value.defaultModel)
  );
}

function decodeCapabilities(value: unknown): LabCapabilities | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["deterministic", "providers", "bounds", "dataDirectory", "retention"]) ||
    !isRecord(value.deterministic) ||
    !isRecord(value.providers)
  ) {
    return undefined;
  }
  const deterministic = value.deterministic;
  if (
    !exactKeys(deterministic, ["mode", "provider", "available", "models", "defaultModel"]) ||
    deterministic.mode !== "deterministic" ||
    deterministic.provider !== "openai" ||
    deterministic.available !== true ||
    !boundedModelList(deterministic.models) ||
    typeof deterministic.defaultModel !== "string" ||
    !deterministic.models.includes(deterministic.defaultModel) ||
    !exactKeys(value.providers, ["openai", "anthropic"]) ||
    !providerCapability(value.providers.openai, "openai") ||
    !providerCapability(value.providers.anthropic, "anthropic")
  ) {
    return undefined;
  }
  if (
    !isRecord(value.bounds) ||
    !exactKeys(value.bounds, ["maxHistory", "screenshotConditions"]) ||
    !Number.isSafeInteger(value.bounds.maxHistory) ||
    Number(value.bounds.maxHistory) < 1 ||
    Number(value.bounds.maxHistory) > 100 ||
    !Number.isSafeInteger(value.bounds.screenshotConditions) ||
    Number(value.bounds.screenshotConditions) < 1 ||
    Number(value.bounds.screenshotConditions) > 100 ||
    typeof value.dataDirectory !== "string" ||
    value.dataDirectory.length === 0 ||
    value.dataDirectory.length > 200 ||
    !Number.isSafeInteger(value.retention) ||
    Number(value.retention) < MIN_RETAINED_RUNS ||
    Number(value.retention) > MAX_RETAINED_RUNS
  ) {
    return undefined;
  }
  const openai = value.providers.openai as Record<string, unknown>;
  const anthropic = value.providers.anthropic as Record<string, unknown>;
  return Object.freeze({
    deterministic: Object.freeze({
      mode: "deterministic",
      provider: "openai",
      available: true,
      models: Object.freeze([...(deterministic.models as readonly string[])]),
      defaultModel: deterministic.defaultModel,
    }),
    providers: Object.freeze({
      openai: Object.freeze({
        provider: "openai",
        available: openai.available as boolean,
        models: Object.freeze([...(openai.models as readonly string[])]),
        defaultModel: openai.defaultModel as string,
      }),
      anthropic: Object.freeze({
        provider: "anthropic",
        available: anthropic.available as boolean,
        models: Object.freeze([...(anthropic.models as readonly string[])]),
        defaultModel: anthropic.defaultModel as string,
      }),
    }),
    bounds: Object.freeze({
      maxHistory: Number(value.bounds.maxHistory),
      screenshotConditions: Number(value.bounds.screenshotConditions),
    }),
    dataDirectory: value.dataDirectory,
    retention: Number(value.retention),
  });
}

function safeRelativePath(value: unknown, expectedPath: string): value is string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return false;
  }
  try {
    const url = new URL(value, "http://facet-lab.invalid");
    return url.origin === "http://facet-lab.invalid" && url.pathname === expectedPath;
  } catch {
    return false;
  }
}

function decodeCreatedRun(value: unknown): BrowserCreatedRun | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "runId",
      "sessionId",
      "visitorId",
      "generation",
      "status",
      "streamUrl",
      "evidenceUrl",
    ]) ||
    typeof value.runId !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.visitorId !== "string" ||
    !UUID.test(value.runId) ||
    !UUID.test(value.sessionId) ||
    !UUID.test(value.visitorId) ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1 ||
    value.status !== "queued" ||
    !safeRelativePath(value.streamUrl, "/stream") ||
    !safeRelativePath(value.evidenceUrl, `/api/runs/${value.runId}/evidence`)
  ) {
    return undefined;
  }
  const stream = new URL(value.streamUrl, "http://facet-lab.invalid");
  if (
    stream.searchParams.size !== 1 ||
    stream.searchParams.get("visitorId") !== value.visitorId ||
    stream.hash !== ""
  ) {
    return undefined;
  }
  return value as unknown as BrowserCreatedRun;
}

function validRunId(runId: string): void {
  if (!UUID.test(runId)) throw new Error("invalid run id");
}

function validArtifactId(artifactId: string): void {
  if (!ARTIFACT_ID.test(artifactId)) throw new Error("invalid artifact id");
}

function isArtifactMediaType(value: string | undefined): value is BrowserArtifact["mediaType"] {
  return value === "image/png" || value === "application/json" || value === "text/plain";
}

function jsonHeaders(): Readonly<Record<string, string>> {
  return { "content-type": "application/json" };
}

async function readBoundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximum)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new LabApiError(
      response.status,
      "response-too-large",
      "Lab response exceeded its bound.",
    );
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel().catch(() => undefined);
        throw new LabApiError(
          response.status,
          "response-too-large",
          "Lab response exceeded its bound.",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function decodeText(bytes: Uint8Array, status: number): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LabApiError(status, "invalid-response", "Lab returned invalid UTF-8.");
  }
}

function encodeJsonBody(body: unknown, maximum: number): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(body);
  } catch {
    throw new Error("request body must be JSON");
  }
  if (new TextEncoder().encode(encoded).byteLength > maximum) {
    throw new Error("request body exceeded its bound");
  }
  return encoded;
}

function query(filters: BrowserRunFilters): string {
  const parameters = new URLSearchParams();
  const limit = filters.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("invalid run limit");
  parameters.set("limit", String(limit));
  if (filters.status !== undefined) {
    if (!RUN_STATUSES.includes(filters.status)) throw new Error("invalid run status");
    parameters.set("status", filters.status);
  }
  if (filters.provider !== undefined) parameters.set("provider", filters.provider);
  if (filters.mode !== undefined) {
    if (!RUN_MODES.includes(filters.mode)) throw new Error("invalid run mode");
    parameters.set("mode", filters.mode);
  }
  return parameters.toString();
}

export function createLabApiClient(options: LabApiClientOptions = {}): LabApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  const read = async (
    path: string,
    init?: RequestInit,
    maximum = MAX_JSON_REQUEST_BYTES,
  ): Promise<unknown> => {
    const response = await fetchImpl(path, { credentials: "same-origin", ...init });
    const text = decodeText(await readBoundedBytes(response, maximum), response.status);
    if (!response.ok)
      throw new LabApiError(response.status, "request-failed", "Lab request failed.");
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new LabApiError(
        response.status,
        "invalid-response",
        "Lab returned an invalid response.",
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new LabApiError(response.status, "invalid-response", "Lab returned malformed JSON.");
    }
  };

  const jsonValue = async (
    path: string,
    init?: RequestInit,
    maximum?: number,
  ): Promise<JsonValue> => {
    const candidate = await read(path, init, maximum);
    const bounded = cloneBoundedJson(candidate, { maxBytes: maximum ?? MAX_JSON_REQUEST_BYTES });
    if (!bounded.ok)
      throw new LabApiError(200, "invalid-response", "Lab returned invalid bounded JSON.");
    return bounded.value;
  };

  const evidence = async (path: string): Promise<RunEvidenceV1> => {
    const candidate = await read(path, undefined, MAX_EVIDENCE_BUNDLE_BYTES);
    const validated = validateRunEvidence(candidate);
    if (!validated.ok)
      throw new LabApiError(200, "invalid-response", "Lab returned invalid evidence.");
    return validated.value;
  };

  const mutation = (
    path: string,
    body: unknown,
    requestMaximum = MAX_JSON_REQUEST_BYTES,
    responseMaximum = requestMaximum,
    options?: LabApiRequestOptions,
  ): Promise<JsonValue> =>
    jsonValue(
      path,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: encodeJsonBody(body, requestMaximum),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      },
      responseMaximum,
    );

  const client: LabApiClient = {
    getCatalog: () => jsonValue("/api/catalog"),
    async getCapabilities() {
      const decoded = decodeCapabilities(await read("/api/capabilities"));
      if (decoded === undefined)
        throw new LabApiError(200, "invalid-response", "Lab capabilities are invalid.");
      return decoded;
    },
    getAssets: (options) =>
      jsonValue(
        "/api/assets",
        options?.signal === undefined ? undefined : { signal: options.signal },
        MAX_EVIDENCE_BUNDLE_BYTES,
      ),
    async createRun(configuration: RunConfiguration) {
      const decoded = decodeCreatedRun(
        await read("/api/runs", {
          method: "POST",
          headers: jsonHeaders(),
          body: encodeJsonBody(configuration, MAX_JSON_REQUEST_BYTES),
        }),
      );
      if (decoded === undefined)
        throw new LabApiError(200, "invalid-response", "Created run identity is invalid.");
      return decoded;
    },
    async listRuns(filters = {}) {
      const candidate = await read(
        `/api/runs?${query(filters)}`,
        undefined,
        MAX_EVIDENCE_BUNDLE_BYTES,
      );
      if (!Array.isArray(candidate) || candidate.length > 100) {
        throw new LabApiError(200, "invalid-response", "Run history is invalid.");
      }
      return Object.freeze(
        candidate.map((item) => {
          const validated = validateRunEvidence(item);
          if (!validated.ok)
            throw new LabApiError(200, "invalid-response", "Run history is invalid.");
          return validated.value;
        }),
      );
    },
    getRun(runId: string) {
      validRunId(runId);
      return evidence(`/api/runs/${runId}`);
    },
    cancelRun(runId: string) {
      validRunId(runId);
      return mutation(`/api/runs/${runId}/cancel`, {});
    },
    async exportRun(runId: string) {
      validRunId(runId);
      const response = await fetchImpl(`/api/runs/${runId}/export`, { credentials: "same-origin" });
      const text = decodeText(
        await readBoundedBytes(response, MAX_EVIDENCE_BUNDLE_BYTES),
        response.status,
      );
      if (!response.ok)
        throw new LabApiError(response.status, "request-failed", "Lab request failed.");
      return text;
    },
    importRun(bundle: string) {
      if (new TextEncoder().encode(bundle).byteLength > MAX_EVIDENCE_BUNDLE_BYTES) {
        throw new Error("evidence bundle exceeded its bound");
      }
      return jsonValue(
        "/api/runs/import",
        { method: "POST", headers: jsonHeaders(), body: bundle },
        MAX_JSON_REQUEST_BYTES,
      );
    },
    evaluateRun(runId: string, request: unknown) {
      validRunId(runId);
      return mutation(`/api/runs/${runId}/evaluations`, request);
    },
    captureRun(runId: string) {
      validRunId(runId);
      return mutation(`/api/runs/${runId}/captures`, {});
    },
    async getArtifact(runId: string, artifactId: string) {
      validRunId(runId);
      validArtifactId(artifactId);
      const response = await fetchImpl(`/api/runs/${runId}/artifacts/${artifactId}`, {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new LabApiError(response.status, "request-failed", "Lab request failed.");
      const mediaType = response.headers.get("content-type")?.split(";", 1)[0];
      if (!isArtifactMediaType(mediaType)) {
        throw new LabApiError(
          response.status,
          "invalid-response",
          "Artifact media type is invalid.",
        );
      }
      const data = await readBoundedBytes(response, MAX_EVIDENCE_BUNDLE_BYTES);
      return { mediaType, data };
    },
  };
  return Object.freeze(client);
}
