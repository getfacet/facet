import {
  COLOR_MODES,
  MAX_EVIDENCE_BUNDLE_BYTES,
  MAX_JSON_REQUEST_BYTES,
  MAX_MODEL_CODE_UNITS,
  MAX_PROMPT_CODE_UNITS,
  PROVIDERS,
  RUN_MODES,
  RUN_STATUSES,
  VIEWPORTS,
  type RunConfiguration,
  type RunEvidenceV1,
  type RunMode,
  type RunStatus,
} from "../shared/run-contract.js";
import { MAX_ASSET_BUNDLE_BYTES } from "./asset-snapshot.js";
import { LabHttpError, readBoundedBody } from "./http-security.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const SSE_CONTENT_TYPE = "text/event-stream; charset=utf-8";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const DOWNLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const TERMINAL_STATUSES = new Set<RunStatus>(["complete", "failed", "cancelled", "incomplete"]);

export interface LabApiRequest {
  readonly method: string;
  readonly target: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
}

export interface LabApiArtifact {
  readonly mediaType: "image/png" | "application/json" | "text/plain";
  readonly data: Uint8Array;
  readonly downloadName?: string;
}

export interface LabRunListFilters {
  readonly limit: number;
  readonly status?: RunStatus;
  readonly provider?: "openai" | "anthropic";
  readonly mode?: RunMode;
}

export interface CreatedLabRun {
  readonly runId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  readonly generation: number;
  readonly status: "queued";
  readonly streamUrl: string;
  readonly evidenceUrl: string;
}

export interface LabApiBackend {
  getCatalog(): unknown | Promise<unknown>;
  getCapabilities(): unknown | Promise<unknown>;
  getAssets(): unknown | Promise<unknown>;
  selectDefaultAssets(): unknown | Promise<unknown>;
  importAssets(bundle: unknown): unknown | Promise<unknown>;
  createRun(configuration: RunConfiguration): CreatedLabRun | Promise<CreatedLabRun>;
  listRuns(filters: LabRunListFilters): unknown | Promise<unknown>;
  getRun(runId: string): RunEvidenceV1 | undefined | Promise<RunEvidenceV1 | undefined>;
  cancelRun(runId: string): unknown | Promise<unknown>;
  exportRun(runId: string): string | undefined | Promise<string | undefined>;
  importRun(bundle: string): unknown | Promise<unknown>;
  evaluateRun(runId: string, request: unknown): unknown | Promise<unknown>;
  captureRun(runId: string): unknown | Promise<unknown>;
  getArtifact(
    runId: string,
    artifactId: string,
  ): LabApiArtifact | undefined | Promise<LabApiArtifact | undefined>;
  readEvidence(runId: string): RunEvidenceV1 | undefined | Promise<RunEvidenceV1 | undefined>;
}

export type LabApiBody = unknown | Uint8Array | AsyncIterable<string>;

export interface LabApiResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: LabApiBody;
}

export interface CreateLabApiRoutesOptions {
  readonly backend: LabApiBackend;
  readonly heartbeatMs?: number;
}

export interface LabApiRoutes {
  handle(request: LabApiRequest): Promise<LabApiResponse>;
}

/** A fixed, non-reflecting domain validation failure returned as HTTP 400. */
export class LabApiValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LabApiValidationError";
    this.code = code;
  }
}

export type NodeLabApiHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

interface RouteFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly allow?: string;
}

type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: LabApiResponse };

function json(
  status: number,
  body: unknown,
  extra: Readonly<Record<string, string>> = {},
): LabApiResponse {
  return {
    status,
    headers: Object.freeze({
      "content-type": JSON_CONTENT_TYPE,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    }),
    body,
  };
}

function fail(failure: RouteFailure): LabApiResponse {
  return json(
    failure.status,
    { error: { code: failure.code, message: failure.message } },
    failure.allow === undefined ? {} : { allow: failure.allow },
  );
}

function badRequest(code = "invalid-request", message = "Request did not match the API schema.") {
  return fail({ status: 400, code, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function byteLength(value: string | Uint8Array): number {
  return typeof value === "string" ? new TextEncoder().encode(value).byteLength : value.byteLength;
}

function bodyText(value: string | Uint8Array): string {
  return typeof value === "string"
    ? value
    : new TextDecoder("utf-8", { fatal: true }).decode(value);
}

function parseJsonBody(request: LabApiRequest, maxBytes = MAX_JSON_REQUEST_BYTES): JsonParseResult {
  if (request.body === undefined) return { ok: false, response: badRequest("missing-body") };
  if (byteLength(request.body) > maxBytes) {
    return {
      ok: false,
      response: fail({
        status: 413,
        code: "body-too-large",
        message: "Request body is too large.",
      }),
    };
  }
  try {
    const value: unknown = JSON.parse(bodyText(request.body));
    return { ok: true, value };
  } catch {
    return { ok: false, response: badRequest("malformed-json", "Request JSON is malformed.") };
  }
}

function noQuery(url: URL): LabApiResponse | undefined {
  return url.searchParams.size === 0 ? undefined : badRequest("unknown-query");
}

function emptyObjectBody(request: LabApiRequest): JsonParseResult {
  const parsed = parseJsonBody(request);
  if (!parsed.ok) return parsed;
  return isRecord(parsed.value) && exactKeys(parsed.value, [])
    ? parsed
    : { ok: false, response: badRequest("invalid-body") };
}

function boundedString(value: unknown, max: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (allowEmpty || value.length > 0) &&
    value.trim() === value
  );
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

function runConfiguration(value: unknown): RunConfiguration | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "mode",
      "provider",
      "model",
      "scenarioId",
      "prompt",
      "constraint",
      "viewport",
      "colorMode",
    ]) ||
    !isOneOf(value["mode"], RUN_MODES) ||
    !isOneOf(value["provider"], PROVIDERS) ||
    !boundedString(value["model"], MAX_MODEL_CODE_UNITS) ||
    !boundedString(value["scenarioId"], 200) ||
    !boundedString(value["prompt"], MAX_PROMPT_CODE_UNITS, true) ||
    (value["constraint"] !== null && !boundedString(value["constraint"], 1_000)) ||
    !isOneOf(value["viewport"], VIEWPORTS) ||
    !isOneOf(value["colorMode"], COLOR_MODES)
  ) {
    return undefined;
  }
  return {
    mode: value["mode"],
    provider: value["provider"],
    model: value["model"],
    scenarioId: value["scenarioId"],
    prompt: value["prompt"],
    constraint: value["constraint"],
    viewport: value["viewport"],
    colorMode: value["colorMode"],
  };
}

function validRunId(value: string): boolean {
  return UUID.test(value);
}

function methodNotAllowed(allow: string): LabApiResponse {
  return fail({ status: 405, code: "method-not-allowed", message: "Method not allowed.", allow });
}

function parseListFilters(url: URL): LabRunListFilters | undefined {
  const allowed = new Set(["limit", "status", "provider", "mode"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) return undefined;
  if ([...allowed].some((key) => url.searchParams.getAll(key).length > 1)) return undefined;
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  const status = url.searchParams.get("status");
  const provider = url.searchParams.get("provider");
  const mode = url.searchParams.get("mode");
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (status !== null && !isOneOf(status, RUN_STATUSES)) ||
    (provider !== null && !isOneOf(provider, PROVIDERS)) ||
    (mode !== null && !isOneOf(mode, RUN_MODES))
  ) {
    return undefined;
  }
  return {
    limit,
    ...(status === null ? {} : { status }),
    ...(provider === null ? {} : { provider }),
    ...(mode === null ? {} : { mode }),
  };
}

function parseResumeOrdinal(url: URL, headers: LabApiRequest["headers"]): number | undefined {
  const allowed = new Set(["after"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) return undefined;
  if (url.searchParams.getAll("after").length > 1) return undefined;
  const query = url.searchParams.get("after");
  const header = headers?.["last-event-id"];
  if (query !== null && header !== undefined && query !== header) return undefined;
  const raw = query ?? header ?? "-1";
  if (!/^(?:-1|0|[1-9][0-9]*)$/u.test(raw)) return undefined;
  const ordinal = Number(raw);
  return Number.isSafeInteger(ordinal) ? ordinal : undefined;
}

function sseEvent(event: string, data: unknown, id?: number): string {
  const prefix = id === undefined ? "" : `id: ${String(id)}\n`;
  return `${prefix}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function wait(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const settle = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", settle);
      resolve();
    };
    const timer = setTimeout(settle, milliseconds);
    timer.unref?.();
    signal?.addEventListener("abort", settle, { once: true });
  });
}

async function* evidenceStream(
  backend: LabApiBackend,
  runId: string,
  after: number,
  heartbeatMs: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  let cursor = after;
  for (;;) {
    if (signal?.aborted === true) return;
    const evidence = await backend.readEvidence(runId);
    if (evidence === undefined) return;
    const items = [...evidence.records, ...evidence.frames]
      .filter(({ ordinal }) => ordinal > cursor)
      .sort((left, right) => left.ordinal - right.ordinal);
    for (const item of items) {
      if (item.ordinal <= cursor) continue;
      cursor = item.ordinal;
      yield sseEvent("evidence", item, item.ordinal);
    }
    yield sseEvent("heartbeat", { ordinal: cursor });
    if (TERMINAL_STATUSES.has(evidence.run.status)) {
      yield sseEvent("terminal", { status: evidence.run.status, ordinal: cursor });
      return;
    }
    await wait(heartbeatMs, signal);
  }
}

function safeTarget(target: string): URL | undefined {
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return undefined;
  try {
    const url = new URL(target, "http://facet-lab.invalid");
    return url.origin === "http://facet-lab.invalid" ? url : undefined;
  } catch {
    return undefined;
  }
}

function unsafePath(target: string): boolean {
  const path = target.split("?", 1)[0] ?? target;
  return /(?:\.\.|%2f|%5c|%2e)/iu.test(path);
}

function routeRunPath(pathname: string):
  | {
      readonly runId: string;
      readonly action: "detail" | "cancel" | "evidence" | "export" | "evaluations" | "captures";
    }
  | { readonly runId: string; readonly action: "artifact"; readonly artifactId: string }
  | undefined {
  const segments = pathname.split("/").slice(1);
  if (segments[0] !== "api" || segments[1] !== "runs" || segments[2] === undefined)
    return undefined;
  const runId = segments[2];
  if (segments.length === 3) return { runId, action: "detail" };
  if (segments.length === 4) {
    const action = segments[3];
    if (
      action === "cancel" ||
      action === "evidence" ||
      action === "export" ||
      action === "evaluations" ||
      action === "captures"
    ) {
      return { runId, action };
    }
  }
  if (segments.length === 5 && segments[3] === "artifacts" && segments[4] !== undefined) {
    return { runId, action: "artifact", artifactId: segments[4] };
  }
  return undefined;
}

/** Strict allowlist router. It never reflects request bodies, headers, stack traces, or secrets. */
export function createLabApiRoutes(options: CreateLabApiRoutesOptions): LabApiRoutes {
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1 || heartbeatMs > 60_000) {
    throw new Error("Facet Lab heartbeat must be between 1 and 60000 milliseconds");
  }

  return Object.freeze({
    async handle(request: LabApiRequest): Promise<LabApiResponse> {
      try {
        const url = safeTarget(request.target);
        if (url === undefined) return badRequest("invalid-target");
        if (unsafePath(request.target)) return badRequest("invalid-path");
        const method = request.method.toUpperCase();

        if (url.pathname === "/api/catalog") {
          if (method !== "GET") return methodNotAllowed("GET");
          return noQuery(url) ?? json(200, await options.backend.getCatalog());
        }
        if (url.pathname === "/api/capabilities") {
          if (method !== "GET") return methodNotAllowed("GET");
          return noQuery(url) ?? json(200, await options.backend.getCapabilities());
        }
        if (url.pathname === "/api/assets") {
          if (method !== "GET") return methodNotAllowed("GET");
          return noQuery(url) ?? json(200, await options.backend.getAssets());
        }
        if (url.pathname === "/api/assets/default") {
          if (method !== "POST") return methodNotAllowed("POST");
          const queryFailure = noQuery(url);
          if (queryFailure !== undefined) return queryFailure;
          const parsed = emptyObjectBody(request);
          return parsed.ok
            ? json(200, await options.backend.selectDefaultAssets())
            : parsed.response;
        }
        if (url.pathname === "/api/assets/import") {
          if (method !== "POST") return methodNotAllowed("POST");
          const queryFailure = noQuery(url);
          if (queryFailure !== undefined) return queryFailure;
          const parsed = parseJsonBody(request, MAX_ASSET_BUNDLE_BYTES);
          if (!parsed.ok) return parsed.response;
          if (
            !isRecord(parsed.value) ||
            !exactKeys(parsed.value, ["schemaVersion", "theme", "patterns"])
          ) {
            return badRequest("invalid-asset-bundle");
          }
          return json(200, await options.backend.importAssets(parsed.value));
        }
        if (url.pathname === "/api/runs/import") {
          if (method !== "POST") return methodNotAllowed("POST");
          const queryFailure = noQuery(url);
          if (queryFailure !== undefined) return queryFailure;
          if (request.body === undefined) return badRequest("missing-body");
          if (byteLength(request.body) > MAX_EVIDENCE_BUNDLE_BYTES) {
            return fail({
              status: 413,
              code: "body-too-large",
              message: "Request body is too large.",
            });
          }
          let bundle: string;
          try {
            bundle = bodyText(request.body);
            JSON.parse(bundle);
          } catch {
            return badRequest("invalid-evidence-bundle");
          }
          return json(201, await options.backend.importRun(bundle));
        }
        if (url.pathname === "/api/runs") {
          if (method === "GET") {
            const filters = parseListFilters(url);
            return filters === undefined
              ? badRequest("invalid-query")
              : json(200, await options.backend.listRuns(filters));
          }
          if (method === "POST") {
            const queryFailure = noQuery(url);
            if (queryFailure !== undefined) return queryFailure;
            const parsed = parseJsonBody(request);
            if (!parsed.ok) return parsed.response;
            const configuration = runConfiguration(parsed.value);
            return configuration === undefined
              ? badRequest("invalid-run-configuration")
              : json(201, await options.backend.createRun(configuration));
          }
          return methodNotAllowed("GET, POST");
        }

        const runRoute = routeRunPath(url.pathname);
        if (runRoute !== undefined) {
          if (!validRunId(runRoute.runId)) return badRequest("invalid-run-id");
          if (runRoute.action === "detail") {
            if (method !== "GET") return methodNotAllowed("GET");
            const queryFailure = noQuery(url);
            if (queryFailure !== undefined) return queryFailure;
            const run = await options.backend.getRun(runRoute.runId);
            return run === undefined
              ? fail({ status: 404, code: "run-not-found", message: "Run was not found." })
              : json(200, run);
          }
          if (runRoute.action === "cancel") {
            if (method !== "POST") return methodNotAllowed("POST");
            const queryFailure = noQuery(url);
            if (queryFailure !== undefined) return queryFailure;
            const parsed = emptyObjectBody(request);
            if (!parsed.ok) return parsed.response;
            return json(200, await options.backend.cancelRun(runRoute.runId));
          }
          if (runRoute.action === "export") {
            if (method !== "GET") return methodNotAllowed("GET");
            const queryFailure = noQuery(url);
            if (queryFailure !== undefined) return queryFailure;
            const bundle = await options.backend.exportRun(runRoute.runId);
            return bundle === undefined
              ? fail({ status: 404, code: "run-not-found", message: "Run was not found." })
              : {
                  status: 200,
                  headers: Object.freeze({
                    "content-type": JSON_CONTENT_TYPE,
                    "cache-control": "no-store",
                    "content-disposition": `attachment; filename="facet-lab-${runRoute.runId}.json"`,
                    "x-content-type-options": "nosniff",
                  }),
                  body: bundle,
                };
          }
          if (runRoute.action === "evidence") {
            if (method !== "GET") return methodNotAllowed("GET");
            const after = parseResumeOrdinal(url, request.headers);
            if (after === undefined) return badRequest("invalid-resume-cursor");
            if ((await options.backend.readEvidence(runRoute.runId)) === undefined) {
              return fail({ status: 404, code: "run-not-found", message: "Run was not found." });
            }
            return {
              status: 200,
              headers: Object.freeze({
                "content-type": SSE_CONTENT_TYPE,
                "cache-control": "no-store",
                connection: "keep-alive",
                "x-accel-buffering": "no",
                "x-content-type-options": "nosniff",
              }),
              body: evidenceStream(
                options.backend,
                runRoute.runId,
                after,
                heartbeatMs,
                request.signal,
              ),
            };
          }
          if (runRoute.action === "evaluations") {
            if (method !== "POST") return methodNotAllowed("POST");
            const queryFailure = noQuery(url);
            if (queryFailure !== undefined) return queryFailure;
            const parsed = parseJsonBody(request);
            if (!parsed.ok) return parsed.response;
            if (
              !isRecord(parsed.value) ||
              !(
                (exactKeys(parsed.value, ["kind"]) && parsed.value["kind"] === "recalculate") ||
                (exactKeys(parsed.value, ["kind", "record"]) && parsed.value["kind"] === "advisory")
              )
            ) {
              return badRequest("invalid-evaluation");
            }
            return json(200, await options.backend.evaluateRun(runRoute.runId, parsed.value));
          }
          if (runRoute.action === "captures") {
            if (method !== "POST") return methodNotAllowed("POST");
            const queryFailure = noQuery(url);
            if (queryFailure !== undefined) return queryFailure;
            const parsed = emptyObjectBody(request);
            if (!parsed.ok) return parsed.response;
            return json(200, await options.backend.captureRun(runRoute.runId));
          }
          if (runRoute.action !== "artifact") {
            return fail({ status: 404, code: "not-found", message: "API route was not found." });
          }
          if (method !== "GET") return methodNotAllowed("GET");
          const queryFailure = noQuery(url);
          if (queryFailure !== undefined) return queryFailure;
          if (!ARTIFACT_ID.test(runRoute.artifactId)) return badRequest("invalid-artifact-id");
          const artifact = await options.backend.getArtifact(runRoute.runId, runRoute.artifactId);
          if (artifact === undefined) {
            return fail({
              status: 404,
              code: "artifact-not-found",
              message: "Artifact was not found.",
            });
          }
          const downloadName = artifact.downloadName;
          const disposition =
            downloadName !== undefined && DOWNLOAD_NAME.test(downloadName)
              ? `attachment; filename="${downloadName}"`
              : "attachment";
          return {
            status: 200,
            headers: Object.freeze({
              "content-type": artifact.mediaType,
              "content-length": String(artifact.data.byteLength),
              "content-disposition": disposition,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            }),
            body: new Uint8Array(artifact.data),
          };
        }

        if (url.pathname.startsWith("/api/runs/")) return badRequest("invalid-run-path");
        return fail({ status: 404, code: "not-found", message: "API route was not found." });
      } catch (error: unknown) {
        if (error instanceof LabApiValidationError) {
          return badRequest(error.code, error.message);
        }
        return fail({ status: 500, code: "internal-error", message: "API request failed safely." });
      }
    },
  });
}

function nodeHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function writeNodeBody(
  response: ServerResponse,
  body: Exclude<LabApiBody, AsyncIterable<string>>,
): void {
  if (body instanceof Uint8Array) {
    response.end(body);
    return;
  }
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

function isAsyncBody(body: LabApiBody): body is AsyncIterable<string> {
  return (
    typeof body === "object" &&
    body !== null &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === "function"
  );
}

/** Node adapter for the optional same-origin `/api/*` hook owned by the outer web host. */
export function createNodeLabApiHandler(routes: LabApiRoutes): NodeLabApiHandler {
  return async (request, response): Promise<boolean> => {
    const target = request.url ?? "/";
    const pathname = target.split("?", 1)[0] ?? target;
    if (pathname !== "/api" && !pathname.startsWith("/api/")) return false;

    const method = request.method ?? "GET";
    const abortController = new AbortController();
    response.once("close", () => abortController.abort());
    let body: Buffer | undefined;
    try {
      if (method !== "GET" && method !== "HEAD") {
        const contentType = nodeHeader(request, "content-type");
        if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
          const rejected = fail({
            status: 415,
            code: "json-required",
            message: "Mutations require application/json.",
          });
          response.writeHead(rejected.status, rejected.headers);
          writeNodeBody(response, rejected.body as Exclude<LabApiBody, AsyncIterable<string>>);
          return true;
        }
        const maximum =
          pathname === "/api/runs/import" ? MAX_EVIDENCE_BUNDLE_BYTES : MAX_JSON_REQUEST_BYTES;
        body = await readBoundedBody(request, maximum);
      }

      const result = await routes.handle({
        method,
        target,
        headers: { "last-event-id": nodeHeader(request, "last-event-id") },
        ...(body === undefined ? {} : { body }),
        signal: abortController.signal,
      });
      response.writeHead(result.status, result.headers);
      if (!isAsyncBody(result.body)) {
        writeNodeBody(response, result.body);
        return true;
      }
      for await (const chunk of result.body) {
        if (abortController.signal.aborted) break;
        response.write(chunk);
      }
      response.end();
      return true;
    } catch (error: unknown) {
      const status = error instanceof LabHttpError ? error.status : 400;
      const rejected = fail({
        status,
        code: status === 413 ? "body-too-large" : "invalid-request",
        message: status === 413 ? "Request body is too large." : "Request failed safely.",
      });
      if (!response.headersSent) response.writeHead(rejected.status, rejected.headers);
      if (!response.writableEnded) {
        writeNodeBody(response, rejected.body as Exclude<LabApiBody, AsyncIterable<string>>);
      }
      return true;
    }
  };
}
import type { IncomingMessage, ServerResponse } from "node:http";
