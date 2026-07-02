/**
 * A demo EXTERNAL agent built on the @facet/agent-client SDK. It dials into the
 * server as the brain for agentId="live" (heartbeat + reconnect handled by the
 * SDK). Swap the `logic` for a local Claude driver (the bridge, A3) and nothing
 * else changes. This is exactly what a segment-3 developer writes.
 *
 *   pnpm --filter @facet/playground serve      # server (terminal 1)
 *   pnpm --filter @facet/playground agent      # this agent (terminal 2)
 *
 * FACET_AGENT=echo for a fast no-LLM agent.
 */
import { connectAgent } from "@facet/agent-client";
import { makeLiveAgent } from "./live-agent.js";

const useLlm = process.env.FACET_AGENT !== "echo";

const logic = makeLiveAgent({
  useLlm,
  welcomeSubtitle: "Type a request — an external agent (this process) will build it.",
});

connectAgent({
  serverUrl: "http://localhost:5291",
  agentId: "live",
  agent: logic,
  onStatus: (status) => console.log(status === "connected" ? "● connected" : "○ disconnected"),
});

console.log(`External agent starting (${useLlm ? "LLM" : "echo"})…`);
