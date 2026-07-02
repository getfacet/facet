#!/usr/bin/env node
import { createBridge } from "./bridge.js";

/**
 * `facet-bridge` — point a local coding agent at a Facet link.
 *
 * Config via env:
 *   FACET_SERVER    server URL              (default http://localhost:5291)
 *   FACET_AGENT_ID  which link to own        (default live)
 *   FACET_MODE      spawn | persistent       (default spawn)
 *   FACET_METHOD    oneshot | session        (default session; spawn mode)
 *   FACET_BRAIN     brain CLI to run         (default claude; e.g. codex; spawn mode)
 *   FACET_MODEL     model for persistent     (optional; persistent mode)
 *   FACET_BRIDGE_PORT  local cmd port        (default 5292; spawn mode)
 */
const serverUrl = process.env["FACET_SERVER"] ?? "http://localhost:5291";
const agentId = process.env["FACET_AGENT_ID"] ?? "live";
const mode = process.env["FACET_MODE"] === "persistent" ? "persistent" : "spawn";
const method = process.env["FACET_METHOD"] === "oneshot" ? "oneshot" : "session";
const command = process.env["FACET_BRAIN"] ?? "claude";
const model = process.env["FACET_MODEL"];
const token = process.env["FACET_AGENT_TOKEN"];
const portEnv = process.env["FACET_BRIDGE_PORT"];

createBridge({
  serverUrl,
  agentId,
  mode,
  method,
  command,
  ...(model !== undefined ? { model } : {}),
  ...(token !== undefined ? { token } : {}),
  ...(portEnv !== undefined ? { bridgePort: Number(portEnv) } : {}),
  onStatus: (status) =>
    console.log(status === "connected" ? "● bridge connected" : "○ disconnected"),
  onEvent: (kind, visitorId, changes) =>
    console.log(`↩ ${kind} for ${visitorId} → ${String(changes)} change(s)`),
});

const detail =
  mode === "persistent"
    ? `persistent${model !== undefined ? ` (${model})` : ""}`
    : `${command} (${method})`;
console.log(`facet-bridge → server ${serverUrl}, link "${agentId}", brain ${detail}`);
