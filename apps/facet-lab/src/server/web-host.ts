import { randomBytes, randomInt } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import {
  createServer,
  request as createHttpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, isAbsolute, relative, resolve, win32 } from "node:path";

import { createFacetServer, type FacetServer, type FacetServerOptions } from "@facet/server";

import {
  DEFAULT_LAB_MAX_BODY_BYTES,
  LabHttpError,
  assertLoopbackBind,
  inspectLabRequest,
  readBoundedBody,
} from "./http-security.js";

const MAX_REGISTERED_VISITORS = 10_000;
const MAX_VISITOR_ID_CHARS = 200;
const INNER_PORT_MIN = 20_000;
const INNER_PORT_MAX_EXCLUSIVE = 60_000;
const INNER_PORT_ATTEMPTS = 20;

export interface LabVisitorRegistry {
  register(visitorId: string): void;
  unregister(visitorId: string): void;
  has(visitorId: string): boolean;
  values(): readonly string[];
}

function validVisitorId(visitorId: string): boolean {
  return (
    visitorId.length > 0 &&
    visitorId.length <= MAX_VISITOR_ID_CHARS &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(visitorId)
  );
}

export function createLabVisitorRegistry(): LabVisitorRegistry {
  const visitors = new Set<string>();
  return {
    register(visitorId) {
      if (!validVisitorId(visitorId)) throw new Error("invalid Facet Lab visitor id");
      if (!visitors.has(visitorId) && visitors.size >= MAX_REGISTERED_VISITORS) {
        throw new Error("Facet Lab visitor registry is full");
      }
      visitors.add(visitorId);
    },
    unregister(visitorId) {
      visitors.delete(visitorId);
    },
    has: (visitorId) => visitors.has(visitorId),
    values: () => Object.freeze([...visitors]),
  };
}

export interface StartedLabInnerServer {
  readonly server: FacetServer;
  readonly baseUrl: string;
  readonly agentToken: string;
}

export async function startLabInnerServer(
  options: Omit<FacetServerOptions, "port" | "host" | "agentToken">,
): Promise<StartedLabInnerServer> {
  const agentToken = randomBytes(32).toString("hex");
  let lastError: unknown;
  for (let attempt = 0; attempt < INNER_PORT_ATTEMPTS; attempt += 1) {
    const port = randomInt(INNER_PORT_MIN, INNER_PORT_MAX_EXCLUSIVE);
    const server = createFacetServer({
      ...options,
      port,
      host: "127.0.0.1",
      agentToken,
    });
    try {
      await server.listen();
      return { server, baseUrl: `http://127.0.0.1:${String(port)}`, agentToken };
    } catch (error: unknown) {
      lastError = error;
      await server.close().catch(() => undefined);
    }
  }
  throw new Error("Facet Lab could not bind its private inner server", { cause: lastError });
}

export interface LabWebHostOptions {
  readonly innerBaseUrl: string;
  readonly visitors: LabVisitorRegistry;
  readonly apiHandler?: (request: LabWebHostApiRequest) => void | Promise<void>;
  readonly isKnownApiPath?: (pathname: string) => boolean;
  readonly staticRoot?: string;
  readonly host?: string;
  readonly port?: number;
  readonly maxBodyBytes?: number;
  readonly apiMaxBodyBytes?: number;
  readonly apiImportMaxBodyBytes?: number;
}

export interface LabWebHostApiRequest {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly maxBodyBytes: number;
}

export interface LabWebHostListening {
  readonly baseUrl: string;
  readonly host: string;
  readonly port: number;
}

export interface LabWebHost {
  listen(): Promise<LabWebHostListening>;
  close(): Promise<void>;
}

function singleHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requestMetadata(req: IncomingMessage) {
  return {
    method: req.method,
    target: req.url,
    host: singleHeader(req.headers.host),
    origin: singleHeader(req.headers.origin),
    contentLength: singleHeader(req.headers["content-length"]),
  };
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(text);
}

function safeError(error: unknown): { readonly status: number; readonly message: string } {
  if (error instanceof LabHttpError) return { status: error.status, message: error.message };
  return { status: 400, message: "invalid request" };
}

function visitorFromBody(body: Buffer): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const visitor = Reflect.get(parsed, "visitor");
    if (typeof visitor !== "object" || visitor === null || Array.isArray(visitor)) return undefined;
    const visitorId = Reflect.get(visitor, "visitorId");
    return typeof visitorId === "string" && validVisitorId(visitorId) ? visitorId : undefined;
  } catch {
    return undefined;
  }
}

function proxyHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const forwarded: IncomingHttpHeaders = {};
  const contentType = singleHeader(headers["content-type"]);
  const lastEventId = singleHeader(headers["last-event-id"]);
  if (contentType !== undefined) forwarded["content-type"] = contentType;
  if (lastEventId !== undefined) forwarded["last-event-id"] = lastEventId;
  return forwarded;
}

function copyProxyResponseHeaders(source: IncomingHttpHeaders): IncomingHttpHeaders {
  const copied: IncomingHttpHeaders = {};
  for (const name of ["content-type", "cache-control", "connection"] as const) {
    const value = source[name];
    if (value !== undefined) copied[name] = value;
  }
  copied["x-content-type-options"] = "nosniff";
  return copied;
}

function proxyToInner(
  req: IncomingMessage,
  res: ServerResponse,
  innerBaseUrl: URL,
  body: Buffer | undefined,
  activeRequests: Set<ClientRequest>,
): void {
  const target = new URL(req.url ?? "/", innerBaseUrl);
  const upstream = createHttpRequest(
    target,
    {
      method: req.method,
      headers: {
        ...proxyHeaders(req.headers),
        ...(body === undefined ? {} : { "content-length": String(body.byteLength) }),
      },
    },
    (upstreamResponse) => {
      res.writeHead(
        upstreamResponse.statusCode ?? 502,
        copyProxyResponseHeaders(upstreamResponse.headers),
      );
      upstreamResponse.pipe(res);
    },
  );
  activeRequests.add(upstream);
  upstream.once("close", () => activeRequests.delete(upstream));
  upstream.once("error", () => {
    if (!res.headersSent) sendText(res, 502, "inner Facet server unavailable");
    else res.destroy();
  });
  res.once("close", () => upstream.destroy());
  if (body !== undefined) upstream.write(body);
  upstream.end();
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

function staticHeaders(contentType: string): IncomingHttpHeaders {
  return {
    "content-type": contentType,
    "cache-control": contentType.startsWith("text/html") ? "no-store" : "public, max-age=3600",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

/** Rejects parent and cross-volume relative results on every host platform. */
export function staticPathEscapesRoot(relativePath: string): boolean {
  return (
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("..\\")
  );
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  staticRoot: string | undefined,
): Promise<void> {
  if (staticRoot === undefined || (req.method !== "GET" && req.method !== "HEAD")) {
    sendText(res, 404, "not found");
    return;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, "invalid path");
    return;
  }
  if (decoded.includes("\0")) {
    sendText(res, 400, "invalid path");
    return;
  }
  const requestedPath = decoded.startsWith("/") ? decoded.slice(1) : decoded;
  const requestedExtension = extname(requestedPath).toLowerCase();
  const relativePath = decoded === "/" || requestedExtension === "" ? "index.html" : requestedPath;
  const candidate = resolve(staticRoot, relativePath);
  const fromRoot = relative(staticRoot, candidate);
  if (staticPathEscapesRoot(fromRoot)) {
    sendText(res, 404, "not found");
    return;
  }
  try {
    const [canonicalRoot, canonicalCandidate] = await Promise.all([
      realpath(staticRoot),
      realpath(candidate),
    ]);
    const canonicalRelative = relative(canonicalRoot, canonicalCandidate);
    if (staticPathEscapesRoot(canonicalRelative)) {
      throw new Error("static symlink escaped root");
    }
    const info = await stat(canonicalCandidate);
    if (!info.isFile()) throw new Error("not a file");
    const content = await readFile(canonicalCandidate);
    const contentType =
      CONTENT_TYPES[extname(canonicalCandidate).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { ...staticHeaders(contentType), "content-length": String(content.length) });
    if (req.method === "HEAD") res.end();
    else res.end(content);
  } catch {
    sendText(res, 404, "not found");
  }
}

function authorityFor(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${String(port)}` : `${host}:${String(port)}`;
}

export function createLabWebHost(options: LabWebHostOptions): LabWebHost {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 5293;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_LAB_MAX_BODY_BYTES;
  const apiMaxBodyBytes = options.apiMaxBodyBytes ?? maxBodyBytes;
  const apiImportMaxBodyBytes = options.apiImportMaxBodyBytes ?? apiMaxBodyBytes;
  assertLoopbackBind(host);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("invalid Lab port");
  for (const maximum of [maxBodyBytes, apiMaxBodyBytes, apiImportMaxBodyBytes]) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new Error("Facet Lab body limits must be positive safe integers");
    }
  }
  const innerBaseUrl = new URL(options.innerBaseUrl);
  if (innerBaseUrl.protocol !== "http:" || innerBaseUrl.username || innerBaseUrl.password) {
    throw new Error("Facet Lab inner server must be a local HTTP origin");
  }
  assertLoopbackBind(innerBaseUrl.hostname);
  if (innerBaseUrl.pathname !== "/" || innerBaseUrl.search || innerBaseUrl.hash) {
    throw new Error("Facet Lab inner server must be an origin without a path");
  }
  const staticRoot = options.staticRoot === undefined ? undefined : resolve(options.staticRoot);
  const activeRequests = new Set<ClientRequest>();
  let authority: string | undefined;

  const server: Server = createServer((req, res) => {
    if (authority === undefined) {
      sendText(res, 503, "Facet Lab is starting");
      return;
    }
    const metadata = requestMetadata(req);
    const inspected = inspectLabRequest(
      { ...metadata, contentLength: undefined },
      {
        authority,
        maxBodyBytes: Math.max(maxBodyBytes, apiMaxBodyBytes, apiImportMaxBodyBytes),
      },
    );
    if (!inspected.ok) {
      sendText(res, inspected.status, inspected.message);
      return;
    }
    const requestBodyMaximum =
      inspected.pathname === "/api/runs/import"
        ? apiImportMaxBodyBytes
        : inspected.pathname === "/api" || inspected.pathname.startsWith("/api/")
          ? apiMaxBodyBytes
          : maxBodyBytes;
    const isApiRequest = inspected.pathname === "/api" || inspected.pathname.startsWith("/api/");
    const unknownApiPath = isApiRequest && options.isKnownApiPath?.(inspected.pathname) === false;
    if (!unknownApiPath) {
      const bounded = inspectLabRequest(metadata, { authority, maxBodyBytes: requestBodyMaximum });
      if (!bounded.ok) {
        sendText(res, bounded.status, bounded.message);
        return;
      }
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (isApiRequest) {
      if (options.apiHandler === undefined) {
        sendText(res, 404, "not found");
        return;
      }
      void Promise.resolve(
        options.apiHandler({
          request: req,
          response: res,
          url: inspected.url,
          maxBodyBytes: requestBodyMaximum,
        }),
      ).catch(() => {
        if (!res.headersSent) sendText(res, 500, "API request failed safely");
        else res.destroy();
      });
      return;
    }
    if (req.method === "GET" && inspected.pathname === "/health") {
      sendText(res, 200, "ok");
      return;
    }
    if (req.method === "GET" && inspected.pathname === "/stream") {
      const visitorId = inspected.url.searchParams.get("visitorId");
      if (visitorId === null || !validVisitorId(visitorId)) {
        sendText(res, 400, "invalid visitor");
        return;
      }
      if (!options.visitors.has(visitorId)) {
        sendText(res, 403, "visitor not registered");
        return;
      }
      proxyToInner(req, res, innerBaseUrl, undefined, activeRequests);
      return;
    }
    if (
      req.method === "POST" &&
      (inspected.pathname === "/event" || inspected.pathname === "/record")
    ) {
      if (!singleHeader(req.headers["content-type"])?.startsWith("application/json")) {
        sendText(res, 415, "application/json required");
        return;
      }
      void readBoundedBody(req, maxBodyBytes)
        .then((body) => {
          const visitorId = visitorFromBody(body);
          if (visitorId === undefined) {
            sendText(res, 400, "invalid visitor");
          } else if (!options.visitors.has(visitorId)) {
            sendText(res, 403, "visitor not registered");
          } else {
            proxyToInner(req, res, innerBaseUrl, body, activeRequests);
          }
        })
        .catch((error: unknown) => {
          const safe = safeError(error);
          sendText(res, safe.status, safe.message);
        });
      return;
    }
    if (
      inspected.pathname === "/stream" ||
      inspected.pathname === "/event" ||
      inspected.pathname === "/record"
    ) {
      sendText(res, 405, "method not allowed");
      return;
    }
    void serveStatic(req, res, inspected.pathname, staticRoot);
  });

  return {
    listen: () =>
      new Promise((resolveListening, reject) => {
        const onError = (error: Error): void => reject(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.removeListener("error", onError);
          const address = server.address();
          if (address === null || typeof address === "string") {
            reject(new Error("Facet Lab could not determine its listening address"));
            return;
          }
          authority = authorityFor(host, address.port);
          resolveListening({ baseUrl: `http://${authority}`, host, port: address.port });
        });
      }),
    close: () =>
      new Promise((resolveClose, reject) => {
        for (const request of activeRequests) request.destroy();
        server.close((error) => (error ? reject(error) : resolveClose()));
        server.closeAllConnections?.();
      }),
  };
}
