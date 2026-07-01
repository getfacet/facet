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
import type { FacetTree } from "@facet/core";
import { defineAgent } from "@facet/agent";
import { connectAgent } from "@facet/agent-client";
import { generatePage } from "./generator.js";

const useLlm = process.env.FACET_AGENT !== "echo";

function welcome(): FacetTree {
  return {
    root: "root",
    nodes: {
      root: {
        id: "root",
        type: "box",
        style: { direction: "col", gap: "md", pad: "2xl", align: "center" },
        children: ["h", "p"],
      },
      h: { id: "h", type: "text", value: "What should this page be?", style: { size: "2xl", weight: "bold" } },
      p: {
        id: "p",
        type: "text",
        value: "Type a request — an external agent (this process) will build it.",
        style: { color: "fg-muted", align: "center" },
      },
    },
  };
}

const logic = defineAgent(async ({ event, stage }) => {
  if (event.kind === "visit") {
    stage.render(welcome());
    return;
  }
  if (event.kind === "action") {
    stage.say(`(you pressed: ${event.action.name})`);
    return;
  }
  if (!useLlm) {
    stage.say(`echo: ${event.text}`);
    return;
  }
  try {
    const { tree, issues } = await generatePage(event.text);
    stage.render(tree);
    stage.say(issues.length === 0 ? "Here's your page." : `Built (repaired ${String(issues.length)}).`);
  } catch (error) {
    stage.say(`generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

connectAgent({
  serverUrl: "http://localhost:5291",
  agentId: "live",
  agent: logic,
  onStatus: (status) => console.log(status === "connected" ? "● connected" : "○ disconnected"),
});

console.log(`External agent starting (${useLlm ? "LLM" : "echo"})…`);
