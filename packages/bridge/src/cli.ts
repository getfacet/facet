#!/usr/bin/env node
import { createBridge } from "./bridge.js";
import { BRIDGE_DEFAULTS } from "./defaults.js";
import { parseBridgePort, parseContinuity, parseMaxConcurrent, parseRunner } from "./env.js";

/**
 * `facet-bridge` — point a local coding agent at a Facet link.
 *
 * Config via env:
 *   FACET_SERVER      server URL             (default http://localhost:5291)
 *   FACET_AGENT_ID    which link to own       (default live)
 *   FACET_RUNNER      spawn | persistent      (default spawn) — what owns the brain process
 *   FACET_CONTINUITY  oneshot | resume        (default resume; spawn runner) — does a spawn remember across events
 *   FACET_BRAIN       brain CLI to run        (default claude; e.g. codex; spawn runner)
 *   FACET_MODEL       model for persistent    (optional; persistent runner)
 *   FACET_AGENT_TOKEN  shared secret for the server's /agent/* channel (optional)
 *   FACET_BRIDGE_PORT  local cmd port         (default 5292; spawn runner)
 *   FACET_MAX_CONCURRENT  max brains at once   (default 4; spawn runner)
 *
 * A bad enum/number value (e.g. `FACET_RUNNER=persistant`) fails fast with a
 * clear error and exit 1 — it never silently falls back to a default.
 */
const serverUrl = process.env["FACET_SERVER"] ?? BRIDGE_DEFAULTS.serverUrl;
const agentId = process.env["FACET_AGENT_ID"] ?? BRIDGE_DEFAULTS.agentId;
const command = process.env["FACET_BRAIN"] ?? "claude";
const model = process.env["FACET_MODEL"];
const token = process.env["FACET_AGENT_TOKEN"];

let runner: "spawn" | "persistent";
let continuity: "oneshot" | "resume";
let bridgePort: number | undefined;
let maxConcurrent: number | undefined;
try {
  runner = parseRunner(process.env["FACET_RUNNER"]) ?? "spawn";
  continuity = parseContinuity(process.env["FACET_CONTINUITY"]) ?? "resume";
  bridgePort = parseBridgePort(process.env["FACET_BRIDGE_PORT"]);
  maxConcurrent = parseMaxConcurrent(process.env["FACET_MAX_CONCURRENT"]);
} catch (error) {
  console.error(`[facet-bridge] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

createBridge({
  serverUrl,
  agentId,
  runner,
  continuity,
  command,
  ...(model !== undefined ? { model } : {}),
  ...(token !== undefined ? { token } : {}),
  ...(bridgePort !== undefined ? { bridgePort } : {}),
  ...(maxConcurrent !== undefined ? { maxConcurrent } : {}),
  onStatus: (status) =>
    console.log(status === "connected" ? "● bridge connected" : "○ disconnected"),
  onEvent: (kind, visitorId, changes) =>
    console.log(`↩ ${kind} for ${visitorId} → ${String(changes)} change(s)`),
});

const detail =
  runner === "persistent"
    ? `persistent${model !== undefined ? ` (${model})` : ""}`
    : `${command} (${continuity})`;
console.log(`facet-bridge → server ${serverUrl}, link "${agentId}", brain ${detail}`);
