/**
 * The live server: the reference @facet/server transport wired to an agent that
 * generates pages from conversation. Talk to it from the browser "Live" tab.
 *
 *   pnpm --filter @facet/playground serve
 *
 * By default the agent uses the LLM (local `claude` CLI). Set FACET_AGENT=echo
 * for a fast, no-LLM smoke agent.
 */
import type { FacetTree } from "@facet/core";
import { defineAgent } from "@facet/agent";
import { FacetRuntime } from "@facet/runtime";
import { createFacetServer } from "@facet/server";
import { generatePage } from "./generator.js";

const PORT = 5291;
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
        value: 'Type a request below — e.g. "a landing page for a bakery" — and I\'ll build it live.',
        style: { color: "fg-muted", align: "center" },
      },
    },
  };
}

const agent = defineAgent(async ({ event, stage }) => {
  if (event.kind === "visit") {
    stage.render(welcome());
    return;
  }
  if (event.kind === "action") {
    stage.say(`(you pressed: ${event.action.name})`);
    return;
  }
  // message
  if (!useLlm) {
    stage.say(`echo: ${event.text}`);
    return;
  }
  try {
    const { tree, issues } = await generatePage(event.text);
    stage.render(tree);
    stage.say(issues.length === 0 ? "Here's your page." : `Built (repaired ${String(issues.length)} issue(s)).`);
  } catch (error) {
    stage.say(`Sorry — generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

const runtime = new FacetRuntime({ agentId: "live", agent });
void createFacetServer({ runtime, port: PORT })
  .listen()
  .then(() => {
    console.log(`Facet live server → http://localhost:${String(PORT)}  (agent: ${useLlm ? "LLM" : "echo"})`);
  });
