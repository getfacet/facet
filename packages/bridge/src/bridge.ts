import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ClientEvent, FacetSession, FacetTree, ServerMessage } from "@facet/core";
import { connectAgent } from "@facet/agent-client";

/**
 * The local bridge lets a coding agent on your machine (Claude Code, Codex, …)
 * OWN a Facet link. It dials into a Facet server (SSE + POST, NAT-safe), and for
 * each visitor event it runs your local agent, exposing a `facet` command the
 * agent calls to change the page (`facet render/append/set/remove/say`).
 *
 * Current model: the agent is SPAWNED per event (stateless `oneshot`, or
 * `session` which `--resume`s the same conversation so context carries across
 * events). A persistent always-on session that owns the link is a future upgrade.
 */
export interface BridgeOptions {
  /** Facet server to dial into. Default `http://localhost:5291`. */
  readonly serverUrl?: string;
  /** Which link (agent id) to own. Default `live`. */
  readonly agentId?: string;
  /** `oneshot` = fresh agent per event; `session` = `--resume` for continuity. Default `session`. */
  readonly method?: "oneshot" | "session";
  /** The brain CLI to run, e.g. `claude` or `codex`. Default `claude`. */
  readonly command?: string;
  /** Extra args passed to the brain command before the prompt. */
  readonly commandArgs?: readonly string[];
  /** Local port the `facet` CLI posts changes to. Default `5292`. */
  readonly bridgePort?: number;
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
  writeFileSync(join(shimDir, "facet"), `#!/bin/sh\nexec ${runner} ${binPath} "$@"\n`);
  chmodSync(join(shimDir, "facet"), 0o755);
  return shimDir;
}

const SPEC = `You control a live web page via the \`facet\` command. Change the page by running:
  facet render '<tree-json>'   facet append <parentId> '<node-json>'   facet set '<node-json>'   facet remove <id>   facet say <text>
Nodes: box {id,type:"box",children:[ids],style?,onPress?} · text {id,type:"text",value,style?} · image · field.
box is the only container (bordered box=card, box+onPress=button). Style values are tokens: gap/pad(xs..2xl), color(fg,fg-muted,surface,accent,accent-fg,…), size(xs..3xl), weight, radius, direction(row|col). Run facet commands now; do not print anything else.`;

function promptFor(event: ClientEvent, stage: FacetTree): string {
  const current = `The page THIS visitor currently sees (a Facet stage tree): ${JSON.stringify(stage)}`;
  if (event.kind === "visit") {
    return `${SPEC}\n\nA visitor just arrived. Render a short welcome page with \`facet render\`.`;
  }
  if (event.kind === "message") {
    return `${SPEC}\n\n${current}\n\nThe visitor said: "${event.text}". MODIFY the current page — prefer \`facet append\`/\`set\`/\`remove\` on existing node ids to change just what's needed (only \`facet render\` a fresh page if they ask for something totally new). Optionally \`facet say\` a short reply.`;
  }
  return `${SPEC}\n\n${current}\n\nThe visitor pressed "${event.action.name}". React with facet commands on the current page.`;
}

export function createBridge(options: BridgeOptions = {}): Bridge {
  const serverUrl = options.serverUrl ?? "http://localhost:5291";
  const agentId = options.agentId ?? "live";
  const method = options.method ?? "session";
  const command = options.command ?? "claude";
  const bridgePort = options.bridgePort ?? 5292;
  const bridgeUrl = `http://localhost:${String(bridgePort)}`;

  const shimDir = makeFacetShim();
  const buffers = new Map<string, ServerMessage[]>();
  const sessionIds = new Map<string, string>();
  let counter = 0;

  const cmdServer = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/cmd") {
      let body = "";
      req.on("data", (chunk) => (body += String(chunk)));
      req.on("end", () => {
        try {
          const { token, messages } = JSON.parse(body) as {
            token: string;
            messages: ServerMessage[];
          };
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
  cmdServer.listen(bridgePort);

  const runBrain = (prompt: string, visitorId: string, token: string): Promise<void> =>
    new Promise((resolve) => {
      const env = {
        ...process.env,
        FACET_BRIDGE_URL: bridgeUrl,
        FACET_EVENT: token,
        PATH: `${shimDir}:${process.env.PATH ?? ""}`,
      };
      const resume = method === "session" ? sessionIds.get(visitorId) : undefined;
      const args = [
        ...(options.commandArgs ?? []),
        "-p",
        prompt,
        "--output-format",
        "json",
        "--dangerously-skip-permissions",
      ];
      if (resume !== undefined) args.push("--resume", resume);
      let out = "";
      const child = spawn(command, args, { env });
      child.stdout.on("data", (chunk) => (out += String(chunk)));
      child.on("error", () => resolve());
      child.on("close", () => {
        if (method === "session") {
          try {
            const id = (JSON.parse(out) as { session_id?: string }).session_id;
            if (typeof id === "string") sessionIds.set(visitorId, id);
          } catch {
            /* no session id in output */
          }
        }
        resolve();
      });
    });

  const drive = async (
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

  const connection = connectAgent({
    serverUrl,
    agentId,
    agent: drive,
    ...(options.onStatus !== undefined ? { onStatus: options.onStatus } : {}),
  });

  return {
    close: (): void => {
      connection.close();
      cmdServer.close();
    },
  };
}
