import { isIP } from "node:net";

export const DEFAULT_LAB_MAX_BODY_BYTES = 1024 * 1024;

export class LabHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LabHttpError";
    this.status = status;
  }
}

export interface LabRequestMetadata {
  readonly method: string | undefined;
  readonly target: string | undefined;
  readonly host: string | undefined;
  readonly origin?: string | undefined;
  readonly contentLength?: string | undefined;
}

export interface LabRequestPolicy {
  readonly authority: string;
  readonly maxBodyBytes?: number;
}

export type InspectedLabRequest =
  | { readonly ok: true; readonly pathname: string; readonly url: URL }
  | { readonly ok: false; readonly status: number; readonly message: string };

export function assertLoopbackBind(host: string): void {
  const normalized = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const ipVersion = isIP(normalized);
  if (ipVersion === 0) {
    throw new Error("Facet Lab requires an explicit numeric loopback bind address");
  }
  if (normalized !== "127.0.0.1" && normalized !== "::1") {
    throw new Error("Facet Lab refuses every non-loopback bind address");
  }
}

function rejected(status: number, message: string): InspectedLabRequest {
  return { ok: false, status, message };
}

function parseContentLength(
  raw: string | undefined,
  maxBodyBytes: number,
): InspectedLabRequest | null {
  if (raw === undefined) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) return rejected(400, "invalid content-length");
  const contentLength = Number(raw);
  if (!Number.isSafeInteger(contentLength)) return rejected(400, "invalid content-length");
  return contentLength > maxBodyBytes ? rejected(413, "request body too large") : null;
}

/** Fail-closed authority/origin/target inspection before a request reaches a proxy or file read. */
export function inspectLabRequest(
  request: LabRequestMetadata,
  policy: LabRequestPolicy,
): InspectedLabRequest {
  const maxBodyBytes = policy.maxBodyBytes ?? DEFAULT_LAB_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new Error("Facet Lab maxBodyBytes must be a positive safe integer");
  }
  if (request.host?.toLowerCase() !== policy.authority.toLowerCase()) {
    return rejected(403, "host not allowed");
  }
  if (request.origin !== undefined) {
    let origin: string;
    try {
      origin = new URL(request.origin).origin;
    } catch {
      return rejected(403, "origin not allowed");
    }
    if (origin !== `http://${policy.authority}`) return rejected(403, "origin not allowed");
  }
  const target = request.target ?? "/";
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) {
    return rejected(400, "invalid request target");
  }
  let url: URL;
  try {
    url = new URL(target, `http://${policy.authority}`);
  } catch {
    return rejected(400, "invalid request target");
  }
  if (url.host !== policy.authority) return rejected(400, "invalid request target");
  if (url.pathname === "/agent" || url.pathname.startsWith("/agent/")) {
    return rejected(404, "not found");
  }
  const bodyError = parseContentLength(request.contentLength, maxBodyBytes);
  if (bodyError !== null) return bodyError;
  return { ok: true, pathname: url.pathname, url };
}

function chunkBuffer(chunk: unknown): Buffer {
  if (typeof chunk === "string") return Buffer.from(chunk);
  if (chunk instanceof Uint8Array)
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  throw new LabHttpError(400, "request body contained an unsupported chunk");
}

/** Read an untrusted request body with a hard byte ceiling independent of content-length. */
export async function readBoundedBody(
  source: AsyncIterable<unknown>,
  maxBodyBytes: number = DEFAULT_LAB_MAX_BODY_BYTES,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new Error("Facet Lab maxBodyBytes must be a positive safe integer");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    const buffer = chunkBuffer(chunk);
    total += buffer.byteLength;
    if (total > maxBodyBytes) throw new LabHttpError(413, "request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}
