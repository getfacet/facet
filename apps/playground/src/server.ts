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
import { createFacetServer } from "@facet/server";
import { FileSink, FileStageStore } from "@facet/runtime";
import { page, text } from "@facet/kit";
import { generatePage } from "./generator.js";

// The offline face — built from presets, shown to a fresh visitor when no agent
// is connected (instead of a blank page).
const OFFLINE_FACE: FacetTree = page(
  [
    text("Nova is offline right now", { size: "2xl", weight: "bold", align: "center" }),
    text("This page's agent isn't connected — check back soon.", {
      color: "fg-muted",
      align: "center",
    }),
  ],
  { pad: "2xl" },
);

const PORT = 5291;
// llm (default) | echo (fast) | none (no fallback → offline face shows)
const MODE = process.env.FACET_AGENT ?? "llm";
const useLlm = MODE === "llm";
// FACET_STORE=file → durable page + conversation on disk (survive a server restart).
const durable = process.env.FACET_STORE === "file";
const stageStore = durable ? new FileStageStore(".facet-sessions/stage") : undefined;
const sink = durable ? new FileSink(".facet-sessions/chat") : undefined;

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
      h: {
        id: "h",
        type: "text",
        value: "What should this page be?",
        style: { size: "2xl", weight: "bold" },
      },
      p: {
        id: "p",
        type: "text",
        value:
          'Type a request below — e.g. "a landing page for a bakery" — and I\'ll build it live.',
        style: { color: "fg-muted", align: "center" },
      },
    },
  };
}

const agent = defineAgent(async ({ event, session, stage }) => {
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
    stage.say(
      `echo: ${event.text} (current page: ${String(Object.keys(session.stage.nodes).length)} nodes)`,
    );
    return;
  }
  try {
    const { tree, issues } = await generatePage(event.text, session.stage);
    stage.render(tree);
    stage.say(
      issues.length === 0
        ? "Here's your page."
        : `Built (repaired ${String(issues.length)} issue(s)).`,
    );
  } catch (error) {
    stage.say(
      `Sorry — generation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

// This agent is the IN-PROCESS FALLBACK. If an external agent connects at
// /agent/stream (see `pnpm --filter @facet/playground agent`), it takes over.
void createFacetServer({
  port: PORT,
  agentId: "live",
  offlineFace: OFFLINE_FACE,
  ...(MODE === "none" ? {} : { agent }),
  ...(stageStore !== undefined ? { stageStore } : {}),
  ...(sink !== undefined ? { sink } : {}),
})
  .listen()
  .then(() => {
    console.log(`Facet live server → http://localhost:${String(PORT)}  (fallback agent: ${MODE})`);
  });
