/**
 * Local bridge — connects a local Claude Code to a Facet server so it can OWN a
 * page from your laptop (customer segment 2). It:
 *   1. dials into the server via @facet/agent-client (SSE + POST, NAT-safe),
 *   2. runs a small local HTTP endpoint the `facet` CLI posts changes to,
 *   3. drives the local Claude to answer each visitor event, letting Claude call
 *      `facet render/append/say` to change the page.
 *
 * Two equal CONNECTION METHODS (pick with FACET_METHOD, neither is a fallback):
 *   - oneshot : a fresh `claude -p` per event (stateless, simplest)
 *   - session : `claude -p` then `--resume <id>` per event (keeps conversation
 *               + page context across events — the stateful method, see step B)
 * FACET_METHOD=manual opens a short window instead of spawning Claude, so the
 * CLI→bridge→server→browser path can be tested by hand.
 *
 *   pnpm --filter @facet/playground serve                       # server
 *   pnpm --filter @facet/playground bridge                      # this bridge
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ClientEvent, FacetSession, FacetTree, ServerMessage } from "@facet/core";
import { connectAgent } from "@facet/agent-client";

const SERVER = "http://localhost:5291";
const BRIDGE_PORT = 5292;
const BRIDGE_URL = `http://localhost:${String(BRIDGE_PORT)}`;
const METHOD = process.env.FACET_METHOD ?? "oneshot";
const CLI_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "cli",
  "src",
  "cli.ts",
);

const buffers = new Map<string, ServerMessage[]>();
let counter = 0;
const sessionIds = new Map<string, string>(); // visitorId -> claude session id (session method)

// A `facet` shim on PATH so Claude can just run `facet …`.
const shimDir = mkdtempSync(join(tmpdir(), "facet-bin-"));
writeFileSync(join(shimDir, "facet"), `#!/bin/sh\nexec tsx ${CLI_PATH} "$@"\n`);
chmodSync(join(shimDir, "facet"), 0o755);

// Local endpoint the `facet` CLI posts changes to.
createServer((req, res) => {
  if (req.method === "POST" && req.url === "/cmd") {
    let body = "";
    req.on("data", (c) => (body += String(c)));
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
}).listen(BRIDGE_PORT);

function promptFor(event: ClientEvent, stage: FacetTree): string {
  const spec = `You control a live web page via the \`facet\` command. Change the page by running:
  facet render '<tree-json>'   facet append <parentId> '<node-json>'   facet set '<node-json>'   facet remove <id>   facet say <text>
Nodes: box {id,type:"box",children:[ids],style?,onPress?} · text {id,type:"text",value,style?} · image · field.
box is the only container (bordered box=card, box+onPress=button). Style values are tokens: gap/pad(xs..2xl), color(fg,fg-muted,surface,accent,accent-fg,…), size(xs..3xl), weight, radius, direction(row|col). Run facet commands now; do not print anything else.`;
  const current = `The page THIS visitor currently sees (a Facet stage tree): ${JSON.stringify(stage)}`;
  if (event.kind === "visit") {
    return `${spec}\n\nA visitor just arrived. Render a short welcome page with \`facet render\`.`;
  }
  if (event.kind === "message") {
    return `${spec}\n\n${current}\n\nThe visitor said: "${event.text}". MODIFY the current page — prefer \`facet append\`/\`set\`/\`remove\` on existing node ids to change just what's needed (only \`facet render\` a fresh page if they ask for something totally new). Optionally \`facet say\` a short reply.`;
  }
  return `${spec}\n\n${current}\n\nThe visitor pressed "${event.action.name}". React with facet commands on the current page.`;
}

function runClaude(prompt: string, visitorId: string, token: string): Promise<void> {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      FACET_BRIDGE_URL: BRIDGE_URL,
      FACET_EVENT: token,
      PATH: `${shimDir}:${process.env.PATH ?? ""}`,
    };
    const resume = METHOD === "session" ? sessionIds.get(visitorId) : undefined;
    const args = ["-p", prompt, "--output-format", "json", "--dangerously-skip-permissions"];
    if (resume !== undefined) args.push("--resume", resume);
    let out = "";
    const child = spawn("claude", args, { env });
    child.stdout.on("data", (c) => (out += String(c)));
    child.on("error", () => resolve());
    child.on("close", () => {
      if (METHOD === "session") {
        try {
          const id = (JSON.parse(out) as { session_id?: string }).session_id;
          if (typeof id === "string") sessionIds.set(visitorId, id);
        } catch {
          /* ignore */
        }
      }
      resolve();
    });
  });
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function drive(event: ClientEvent, session: FacetSession): Promise<readonly ServerMessage[]> {
  const token = String((counter += 1));
  buffers.set(token, []);
  const visitorId = session.visitor.visitorId;
  if (METHOD === "manual") {
    console.log(
      `\n[manual] event=${event.kind} token=${token} — run e.g.:\n  FACET_BRIDGE_URL=${BRIDGE_URL} FACET_EVENT=${token} tsx ${CLI_PATH} say "hi"\n`,
    );
    await delay(6000);
  } else {
    await runClaude(promptFor(event, session.stage), visitorId, token);
  }
  const messages = buffers.get(token) ?? [];
  buffers.delete(token);
  console.log(`↩ ${event.kind} for ${visitorId} → ${String(messages.length)} change(s)`);
  return messages;
}

connectAgent({
  serverUrl: SERVER,
  agentId: "live",
  agent: drive,
  onStatus: (s) =>
    console.log(s === "connected" ? "● bridge connected to server" : "○ disconnected"),
});

console.log(`Facet bridge (method=${METHOD}) — local cmd endpoint ${BRIDGE_URL}, cli ${CLI_PATH}`);
