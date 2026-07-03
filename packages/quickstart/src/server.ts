/**
 * The quickstart's public HTTP face (spec Decision 3): a thin wrapper server
 * that serves the HTML shell + prebuilt browser bundle itself and PROXIES every
 * protocol route to an internal `createFacetServer` — `@facet/server`'s route
 * table stays untouched.
 *
 * Containment (reviewer P1, all three parts):
 * - the internal facet server binds `host: "127.0.0.1"` on a random high port,
 *   so it is loopback-only and never reachable from the network;
 * - it gets a random per-boot `agentToken` — defense in depth even on loopback;
 * - the wrapper answers 404 for `/agent/*` and never proxies it: quickstart's
 *   brain is in-process, external dial-in is an advanced jack out of scope.
 *
 * The proxy pipes both directions (never buffers) so SSE survives, forwards the
 * request method + headers (hop-by-hop excluded, `host` dropped) so
 * `Last-Event-ID` resume and `Content-Type` cross the hop, and passes response
 * status + headers through unchanged.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FacetAgent } from "@facet/core";
import type { Sink, StageStore } from "@facet/runtime";
import { createFacetServer, type FacetServer } from "@facet/server";

export interface QuickstartServerOptions {
  /** Public port the wrapper listens on (the one printed to the deployer). */
  readonly port: number;
  /**
   * Bind address for the PUBLIC wrapper. Defaults to `127.0.0.1` (loopback) —
   * the quickstart is a local first-run tool and its `/event` route is
   * unauthenticated and drives paid provider calls, so it must not be reachable
   * from the network by default. Pass `"0.0.0.0"` to opt into LAN/public
   * exposure (add your own auth + rate limiting first).
   */
  readonly host?: string;
  readonly agentId: string;
  readonly agent: FacetAgent;
  /** Shared with the built-in agent so prompt layer ③ reads real history. */
  readonly sink?: Sink;
  readonly stageStore?: StageStore;
  /** Override where `/app.js` streams from (tests inject a fixture bundle). */
  readonly pageBundlePath?: string;
}

/** Loopback default for the public wrapper (see `QuickstartServerOptions.host`). */
const DEFAULT_PUBLIC_HOST = "127.0.0.1";

export interface RunningQuickstart {
  readonly url: string;
  close(): Promise<void>;
}

const SHELL_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Facet</title></head>
<body><div id="root"></div><script type="module" src="/app.js"></script></body>
</html>`;

const MISSING_BUNDLE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Facet</title></head>
<body>
<p>The quickstart page bundle has not been built yet. Run
<code>pnpm --filter @facet/quickstart build</code> and reload — the protocol
routes are already live.</p>
</body>
</html>`;

/**
 * Where the prebuilt browser bundle lives. Explicit override first; otherwise
 * two candidates relative to THIS module's location — `../dist/page/app.js`
 * when running from `src/` (dev) and `./page/app.js` when running from the
 * published `dist/` — first that exists wins. `undefined` means "not built".
 */
function resolveBundlePath(override: string | undefined): string | undefined {
  if (override !== undefined) return existsSync(override) ? override : undefined;
  const candidates = [
    new URL("../dist/page/app.js", import.meta.url),
    new URL("./page/app.js", import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}

function serveBundle(res: ServerResponse, override: string | undefined): void {
  const bundlePath = resolveBundlePath(override);
  if (bundlePath === undefined) {
    // Fail-safe: name the fix instead of 404ing into a blank page.
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(MISSING_BUNDLE_HTML);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
  const stream = createReadStream(bundlePath);
  stream.on("error", (error) => {
    // Headers are already out — nothing safe to write; sever so the browser retries.
    console.error("[facet-quickstart] bundle stream failed:", error);
    res.destroy();
  });
  // Browser aborted mid-stream (e.g. reload spam) ⇒ destroy the source fd,
  // mirroring the proxy leg's cleanup (pipe unpipes but never destroys source).
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

/** Hop-by-hop headers (RFC 9110 §7.6.1) never cross a proxy hop. */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "trailers",
]);

function filterHeaders(headers: IncomingHttpHeaders, dropHost: boolean): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower.startsWith("proxy-")) continue;
    if (dropHost && lower === "host") continue;
    out[name] = value;
  }
  return out;
}

/** Pipe one request through to the internal facet server — both directions
 * streamed, never buffered, so `/stream`'s SSE frames flow as they are written. */
function proxy(req: IncomingMessage, res: ServerResponse, internalPort: number): void {
  const proxyReq = httpRequest(
    {
      host: "127.0.0.1",
      port: internalPort,
      method: req.method ?? "GET",
      path: req.url ?? "/",
      headers: filterHeaders(req.headers, true),
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, filterHeaders(proxyRes.headers, false));
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("bad gateway");
    } else {
      res.destroy();
    }
    console.error(
      "[facet-quickstart] proxy request failed:",
      error instanceof Error ? error.message : String(error),
    );
  });
  // Browser gone (e.g. an SSE tab closed) ⇒ sever the internal leg too, so the
  // facet server sees the close and prunes its stream set.
  res.on("close", () => proxyReq.destroy());
  req.pipe(proxyReq);
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: QuickstartServerOptions,
  internalPort: number,
): void {
  // Node delivers malformed request-targets (e.g. `//[`) verbatim, and
  // `new URL` throws on them — an unguarded throw here becomes an
  // uncaughtException that crashes the process. Reject them as 400.
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const { pathname } = url;
  // The agent channel is NOT exposed: quickstart's brain is in-process.
  if (pathname === "/agent" || pathname.startsWith("/agent/")) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (req.method === "GET" && pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SHELL_HTML);
    return;
  }
  if (req.method === "GET" && pathname === "/app.js") {
    serveBundle(res, options.pageBundlePath);
    return;
  }
  proxy(req, res, internalPort);
}

/** Boot the internal loopback facet server on a random high port, retrying on
 * collisions (the server.test.ts bind-retry pattern). */
async function bootInternalServer(
  options: QuickstartServerOptions,
): Promise<{ server: FacetServer; port: number }> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const server = createFacetServer({
      port,
      host: "127.0.0.1",
      agentToken: randomUUID(),
      agentId: options.agentId,
      agent: options.agent,
      ...(options.sink !== undefined ? { sink: options.sink } : {}),
      ...(options.stageStore !== undefined ? { stageStore: options.stageStore } : {}),
    });
    try {
      await server.listen();
      return { server, port };
    } catch {
      // EADDRINUSE (or any bind error) — close this server so its agent-channel
      // reaper interval can't keep the process alive, then try another port.
      await server.close().catch(() => {});
    }
  }
  throw new Error("could not bind the internal facet server to a loopback port");
}

export async function startQuickstart(
  options: QuickstartServerOptions,
): Promise<RunningQuickstart> {
  const internal = await bootInternalServer(options);
  const wrapper = createServer((req, res) => handleRequest(req, res, options, internal.port));

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        reject(
          error.code === "EADDRINUSE"
            ? new Error(
                `port ${String(options.port)} is already in use — pass --port <n> to pick another`,
              )
            : error,
        );
      };
      wrapper.once("error", onError);
      wrapper.listen(options.port, options.host ?? DEFAULT_PUBLIC_HOST, () => {
        wrapper.removeListener("error", onError);
        resolve();
      });
    });
  } catch (error) {
    // Don't leak the already-listening internal server when the public bind fails.
    await internal.server.close();
    throw error;
  }

  return {
    url: `http://localhost:${String(options.port)}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wrapper.close((error) => (error !== undefined ? reject(error) : resolve()));
        // Held-open proxied SSE connections would keep close() pending forever.
        wrapper.closeAllConnections();
      });
      await internal.server.close();
    },
  };
}
