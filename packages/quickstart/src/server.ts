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
import type { FacetAgent, FacetTheme, FacetTree } from "@facet/core";
import { MemoryStageStore, withInitialStage, type Sink, type StageStore } from "@facet/runtime";
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
  /**
   * Operator themes (validated by the caller) inlined into the shell as
   * `window.__FACET_THEMES__` for the page to hand `StageRenderer`. Absent/empty
   * ⇒ the shell is byte-identical to today's (no injected script).
   */
  readonly themes?: readonly FacetTheme[];
  /**
   * A seedable initial tree (validated by the caller) — wraps the stage store
   * with `withInitialStage` so a fresh session opens on it before the first
   * agent turn. Absent ⇒ today's model-first paint.
   */
  readonly initialStage?: FacetTree;
  /** Override where `/app.js` streams from (tests inject a fixture bundle). */
  readonly pageBundlePath?: string;
}

/** Loopback default for the public wrapper (see `QuickstartServerOptions.host`). */
const DEFAULT_PUBLIC_HOST = "127.0.0.1";

export interface RunningQuickstart {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * The HTML shell. When operator themes are present they ship inline as a
 * `window.__FACET_THEMES__` global (Decision 2 boot seam) — the JSON has `<`
 * escaped to `<` so a hostile `</script>` in a theme description can't break
 * out of the script context (defense in depth; `validateTheme` already refuses
 * `<` in values, but descriptions are freer text). No/empty themes ⇒ no script,
 * byte-identical to the no-assets boot.
 */
function shellHtml(themes?: readonly FacetTheme[]): string {
  const themeScript =
    themes !== undefined && themes.length > 0
      ? `<script>window.__FACET_THEMES__ = ${JSON.stringify(themes).replace(/</g, "\\u003c")}</script>`
      : "";
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Facet</title>${themeScript}</head>
<body><div id="root"></div><script type="module" src="/app.js"></script></body>
</html>`;
}

// Served AS JAVASCRIPT (not HTML) when the bundle is missing: /app.js is loaded
// via <script type="module">, so a text/html body is refused by the browser's
// strict MIME check and the deployer just gets a blank page. This injects the
// build hint into #root so the fix is actually visible.
const MISSING_BUNDLE_JS = `document.getElementById("root").textContent =
  "Facet quickstart: the browser bundle is not built yet. Run  pnpm --filter @facet/quickstart build  and reload (the server is already live).";
console.error("[facet-quickstart] browser bundle not built — run: pnpm --filter @facet/quickstart build");`;

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
    // Fail-safe: /app.js is a module script — serve the hint AS JS so the
    // browser runs it and shows the build message (an HTML body would be
    // MIME-refused, leaving a blank page).
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    res.end(MISSING_BUNDLE_JS);
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
    // Never forward the internal server's `Access-Control-Allow-Origin: *` to
    // the browser: the served page is same-origin, so it needs no CORS, and a
    // permissive ACAO would let any site READ a visitor's /stream. Dropping it
    // (plus the same-origin guard below) closes the cross-origin read.
    if (!dropHost && lower.startsWith("access-control-")) continue;
    out[name] = value;
  }
  return out;
}

/**
 * True if a browser request comes from a DIFFERENT origin than the page it
 * serves (the `Origin` host ≠ the `Host` it was sent to). No `Origin` header
 * (a top-level navigation, curl, a server-side client) is treated as same-site
 * — the threat is specifically a browser on another site POSTing here. Compares
 * host:port so it works on localhost, a LAN IP, or a custom host alike.
 */
function isCrossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) return false;
  const host = req.headers.host;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // malformed Origin ⇒ reject
  }
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * When bound to loopback (the default), the `Host` header must be a loopback
 * name. This defeats DNS rebinding — where `attacker.com` is rebound to
 * `127.0.0.1` so its origin and the Host match and the Origin check alone would
 * pass. A deployer who opted into a non-loopback `host` has accepted network
 * exposure (and is expected to add their own auth), so we don't second-guess it.
 */
function isDisallowedHost(req: IncomingMessage, boundHost: string): boolean {
  if (!LOOPBACK_HOSTNAMES.has(boundHost)) return false; // opt-in exposure, deployer's call
  const header = req.headers.host;
  if (typeof header !== "string") return true;
  const hostname = header.replace(/:\d+$/, "").toLowerCase();
  return !LOOPBACK_HOSTNAMES.has(hostname);
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
    res.end(shellHtml(options.themes));
    return;
  }
  if (req.method === "GET" && pathname === "/app.js") {
    serveBundle(res, options.pageBundlePath);
    return;
  }
  // The protocol routes (/event, /stream, /health) are unauthenticated and
  // /event spends the deployer's provider key. Reject cross-origin BROWSER
  // requests (a malicious site the deployer visits POSTing here in a loop, or
  // reading /stream) AND non-loopback Host headers (DNS rebinding) — the served
  // page is same-origin on a loopback host and unaffected.
  if (isCrossOrigin(req) || isDisallowedHost(req, options.host ?? DEFAULT_PUBLIC_HOST)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("request refused");
    return;
  }
  proxy(req, res, internalPort);
}

/** Boot the internal loopback facet server on a random high port, retrying on
 * collisions (the server.test.ts bind-retry pattern). */
async function bootInternalServer(
  options: QuickstartServerOptions,
): Promise<{ server: FacetServer; port: number }> {
  // Seed a fresh session from the initial tree (Decision 4) by wrapping the
  // store with `withInitialStage`. With no initialStage we leave `stageStore`
  // untouched so the runtime's own default applies — today's boot exactly.
  const stageStore =
    options.initialStage !== undefined
      ? withInitialStage(options.stageStore ?? new MemoryStageStore(), options.initialStage)
      : options.stageStore;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const server = createFacetServer({
      port,
      host: "127.0.0.1",
      agentToken: randomUUID(),
      agentId: options.agentId,
      agent: options.agent,
      ...(options.sink !== undefined ? { sink: options.sink } : {}),
      ...(stageStore !== undefined ? { stageStore } : {}),
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
