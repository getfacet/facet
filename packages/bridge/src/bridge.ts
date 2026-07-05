import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ClientEvent, FacetAgent, FacetSession, FacetTree, ServerMessage } from "@facet/core";
import { createLruMap, createSemaphore, createSerialQueue, STAGE_SPEC } from "@facet/core";
import type { CmdFrame } from "@facet/core";
import { connectAgent } from "@facet/agent-client";
import { createPersistentDriver } from "./persistent.js";
import { BRIDGE_DEFAULTS } from "./defaults.js";
import { safeEnv } from "./env.js";

/** Cap on the spawn-runner per-visitor `--resume` session-id map (LRU eviction). */
const MAX_SESSION_IDS = 500;

/** Default ceiling on spawn-runner brain CLIs running at once, across all visitors. */
const DEFAULT_MAX_CONCURRENT = 4;

/**
 * The local bridge lets a coding agent on your machine (Claude Code, Codex, …)
 * OWN a Facet link. It dials into a Facet server (SSE + POST, NAT-safe), and for
 * each visitor event it runs your local agent, exposing a `facet` command the
 * agent calls to change the page (`facet render/append/set/remove/say`).
 *
 * Two shipped runners: `spawn` runs the agent per event (with `continuity`
 * `oneshot` for a stateless child each time, or `resume` which `--resume`s the
 * same conversation so context carries across events); `persistent` keeps one
 * always-on Claude session (Agent SDK) that owns the link.
 */
export interface BridgeOptions {
  /** Facet server to dial into. Default `http://localhost:5291`. */
  readonly serverUrl?: string;
  /** Which link (agent id) to own. Default `live`. */
  readonly agentId?: string;
  /**
   * What owns the brain process:
   * - `spawn` (default): run a CLI (`claude`/`codex`) per event — works with any CLI.
   * - `persistent`: one always-on Claude session (Agent SDK) owns the link.
   */
  readonly runner?: "spawn" | "persistent";
  /**
   * Whether a spawned brain remembers earlier events (spawn runner):
   * - `oneshot`: a fresh, stateless child per event.
   * - `resume` (default): `--resume` the visitor's prior conversation so context
   *   carries across events.
   */
  readonly continuity?: "oneshot" | "resume";
  /** The brain CLI to run, e.g. `claude` or `codex`. Default `claude`. (spawn runner) */
  readonly command?: string;
  /** Model for the persistent session (Agent SDK). Optional. */
  readonly model?: string;
  /** Shared secret for the server's `/agent/*` channel, if it requires one. */
  readonly token?: string;
  /** Extra args passed to the brain command before the prompt. */
  readonly commandArgs?: readonly string[];
  /** Local port the `facet` CLI posts changes to. Default `5292`. */
  readonly bridgePort?: number;
  /** Kill a spawned brain CLI after this long (ms) so a hung child can't wedge a visitor. Default 180000. */
  readonly brainTimeoutMs?: number;
  /** Max spawn-runner brain CLIs running at once, across all visitors (FIFO queue beyond it). Default 4. (spawn runner) */
  readonly maxConcurrent?: number;
  readonly onStatus?: (status: "connected" | "disconnected") => void;
  readonly onEvent?: (kind: string, visitorId: string, changes: number) => void;
}

export interface Bridge {
  close(): void;
}

/** A `facet` shim on PATH so the spawned agent can just run `facet …`. */
function makeFacetShim(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("@facet/cli/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin?: Record<string, string> };
  const binRel = pkg.bin?.["facet"] ?? "./dist/cli.js";
  const binPath = join(dirname(pkgPath), binRel);
  const runner = binPath.endsWith(".ts") ? "tsx" : "node";
  const shimDir = mkdtempSync(join(tmpdir(), "facet-bin-"));
  // Quote the path — an install dir containing a space would otherwise break
  // every `facet` invocation (the shell would split it into two args).
  writeFileSync(join(shimDir, "facet"), `#!/bin/sh\nexec ${runner} "${binPath}" "$@"\n`);
  chmodSync(join(shimDir, "facet"), 0o755);
  return shimDir;
}

const SPEC = `You control a live web page via the \`facet\` command. Change the page by running:
  facet render '<tree-json>'   facet append <parentId> '<node-json>'   facet set '<node-json>'   facet remove <id>   facet screens '<map-json>' <entry>   facet say <text>

${STAGE_SPEC}

Run facet commands now; do not print anything else.`;

function promptFor(event: ClientEvent, stage: FacetTree): string {
  const current = `The page THIS visitor currently sees (a Facet stage tree): ${JSON.stringify(stage)}`;
  if (event.kind === "visit") {
    return `${SPEC}\n\nA visitor just arrived. Render a short welcome page with \`facet render\`.`;
  }
  if (event.kind === "message") {
    return `${SPEC}\n\n${current}\n\nThe visitor said: "${event.text}". MODIFY the current page — prefer \`facet append\`/\`set\`/\`remove\` on existing node ids to change just what's needed (only \`facet render\` a fresh page if they ask for something totally new). Optionally \`facet say\` a short reply.`;
  }
  // Defense-in-depth parity with persistent.ts's `userText`: a malformed action
  // event (no action object) must not throw while building the prompt. Guard the
  // name the same way both twins do.
  const name = typeof event.action?.name === "string" ? event.action.name : "(unknown)";
  return `${SPEC}\n\n${current}\n\nThe visitor pressed "${name}". React with facet commands on the current page.`;
}

export function createBridge(options: BridgeOptions = {}): Bridge {
  const serverUrl = options.serverUrl ?? BRIDGE_DEFAULTS.serverUrl;
  const agentId = options.agentId ?? BRIDGE_DEFAULTS.agentId;
  const runner = options.runner ?? "spawn";

  let agent: FacetAgent;
  let cleanup: () => void = () => {};

  if (runner === "persistent") {
    const driver = createPersistentDriver(
      options.model !== undefined ? { model: options.model } : {},
    );
    agent = async (event, session) => {
      const messages = await driver.agent(event, session);
      options.onEvent?.(event.kind, session.visitor.visitorId, messages.length);
      return messages;
    };
    cleanup = driver.close;
  } else {
    const spawned = createSpawnAgent(options);
    agent = spawned.agent;
    cleanup = spawned.close;
  }

  const connection = connectAgent({
    serverUrl,
    agentId,
    agent,
    ...(options.token !== undefined ? { token: options.token } : {}),
    ...(options.onStatus !== undefined ? { onStatus: options.onStatus } : {}),
  });

  return {
    close: (): void => {
      connection.close();
      cleanup();
    },
  };
}

/** The spawn-per-event driver: runs a CLI (`claude`/`codex`) for each event. */
function createSpawnAgent(options: BridgeOptions): { agent: FacetAgent; close: () => void } {
  const continuity = options.continuity ?? "resume";
  const command = options.command ?? "claude";
  const bridgePort = options.bridgePort ?? BRIDGE_DEFAULTS.bridgePort;
  const bridgeUrl = `http://localhost:${String(bridgePort)}`;
  const brainTimeoutMs = options.brainTimeoutMs ?? 180_000;

  const shimDir = makeFacetShim();
  const buffers = new Map<string, ServerMessage[]>();
  // Per-visitor `--resume` session ids, bounded so a long-lived bridge serving
  // many one-off visitors can't grow this map without limit. LRU eviction drops
  // the coldest visitor past the cap; a `get`/`set` counts as a touch, keeping
  // active visitors resident.
  const sessionIds = createLruMap<string>(MAX_SESSION_IDS);
  const children = new Set<ReturnType<typeof spawn>>();
  let counter = 0;

  const cmdServer = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/cmd") {
      let body = "";
      req.setEncoding("utf8"); // decode on the stream — chunk-split multibyte chars corrupt otherwise
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { token, messages } = JSON.parse(body) as CmdFrame;
          buffers.get(token)?.push(...messages);
        } catch {
          /* ignore malformed */
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  cmdServer.on("error", (error) => {
    // A port conflict (etc.) must not crash the whole bridge process.
    console.error(`[facet] bridge cmd server error on :${String(bridgePort)}:`, error);
  });
  cmdServer.listen(bridgePort);

  const runBrain = (prompt: string, visitorId: string, token: string): Promise<void> =>
    new Promise((resolve) => {
      // Untrusted visitor text reaches this prompt, so DON'T hand the brain the
      // operator's secrets: pass only a safe env allowlist (+ the facet shim on
      // PATH), never the full process.env.
      const env = safeEnv({
        PATH: `${shimDir}:${process.env.PATH ?? ""}`,
        FACET_BRIDGE_URL: bridgeUrl,
        FACET_EVENT: token,
      });
      // `get` counts as a touch, so an active visitor stays resident (won't be
      // evicted out from under an in-flight `--resume`).
      const resume = continuity === "resume" ? sessionIds.get(visitorId) : undefined;
      const args = [
        ...(options.commandArgs ?? []),
        "-p",
        prompt,
        "--output-format",
        "json",
        // Scope the brain to ONLY the facet CLI — no arbitrary shell/file/network.
        // Replaces --dangerously-skip-permissions so a prompt-injected visitor
        // can't drive the brain into running other commands.
        "--allowedTools",
        "Bash(facet:*)",
      ];
      if (resume !== undefined) args.push("--resume", resume);
      let out = "";
      let settled = false;
      const child = spawn(command, args, { env });
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      // Bound the brain: a hung CLI would otherwise wedge this visitor's serial
      // queue forever. On timeout, kill AND settle immediately — we can't rely on
      // `close` firing, since a descendant that inherited the brain's stdio keeps
      // those pipes open after SIGKILL, so `close` may never arrive. `finish()` is
      // idempotent (the `settled` flag), and if `close` does fire later its parse
      // of any truncated output lands harmlessly in the existing catch.
      const timer = setTimeout(() => {
        if (!settled) {
          console.error(`[facet] brain timed out after ${String(brainTimeoutMs)}ms; killing`);
          child.kill("SIGKILL");
          finish();
        }
      }, brainTimeoutMs);
      timer.unref?.();
      children.add(child);
      // Drop from `children` on `exit` (which SIGKILL guarantees), NOT `close`:
      // a descendant holding the inherited stdio can withhold `close` forever, so
      // keying cleanup on it would leak entries here for repeatedly-hung brains.
      child.on("exit", () => children.delete(child));
      child.stdout.on("data", (chunk) => (out += String(chunk)));
      // Drain stderr — an unconsumed pipe backpressures a chatty child into a
      // permanent wedge (that visitor's queue would never advance).
      child.stderr.resume();
      child.on("error", (error) => {
        // e.g. the brain CLI isn't installed — surface it instead of silently
        // "succeeding" with 0 changes every event. A spawn failure emits `error`
        // (+`close`) but never `exit`, so reclaim the entry here too.
        children.delete(child);
        console.error(`[facet] failed to spawn "${command}":`, error);
        finish();
      });
      child.on("close", () => {
        // A brain settled by the TIMEOUT path may emit `close` minutes later (a
        // descendant can hold the pipes); by then a newer brain may have run, so
        // writing this session id would fork the visitor back to an older
        // conversation branch. Only the un-settled (normal) path records it.
        if (!settled && continuity === "resume") {
          try {
            const id = (JSON.parse(out) as { session_id?: string }).session_id;
            if (typeof id === "string") sessionIds.set(visitorId, id);
          } catch {
            /* no session id in output */
          }
        }
        finish();
      });
    });

  const runOne = async (
    event: ClientEvent,
    session: FacetSession,
  ): Promise<readonly ServerMessage[]> => {
    const token = String((counter += 1));
    buffers.set(token, []);
    await runBrain(promptFor(event, session.stage), session.visitor.visitorId, token);
    const messages = buffers.get(token) ?? [];
    buffers.delete(token);
    options.onEvent?.(event.kind, session.visitor.visitorId, messages.length);
    return messages;
  };

  // Serialize a single visitor's events (no same-visitor race); different
  // visitors run in parallel, but a global semaphore caps how many brains run at
  // once. The cap sits INSIDE the per-visitor serialization so a visitor's own
  // events never reorder while waiting for a slot — only cross-visitor
  // concurrency is bounded. Every brain frees its slot: a normal exit or spawn
  // error settles `runBrain` via the child's close/error handlers, and a timeout
  // settles it directly in the timeout callback (which can't wait on `close`).
  const serialize = createSerialQueue<readonly ServerMessage[]>();
  const limit = createSemaphore(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
  const agent: FacetAgent = (event, session) =>
    serialize(session.visitor.visitorId, () => limit(() => runOne(event, session)));

  return {
    agent,
    close: (): void => {
      cmdServer.close();
      for (const child of children) child.kill("SIGKILL"); // don't abandon in-flight brains
      children.clear();
      rmSync(shimDir, { recursive: true, force: true }); // clean the temp shim dir
    },
  };
}
