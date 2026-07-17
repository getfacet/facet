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
import { createFacetServer } from "@facet/server";
import { FileSink, FileStageStore } from "@facet/runtime/node";
import { page, text } from "./bricks.js";
import { makeLiveAgent } from "./live-agent.js";

// The offline face — built from presets, shown to a fresh visitor when no agent
// is connected (instead of a blank page).
const OFFLINE_FACE: FacetTree = page(
  [
    text("Nova is offline right now", {
      fontSize: "2xl",
      fontWeight: "bold",
      textAlign: "center",
    }),
    text("This page's agent isn't connected — check back soon.", {
      color: "mutedForeground",
      textAlign: "center",
    }),
  ],
  { padding: "2xl" },
);

const PORT = 5291;
// llm (default) | echo (fast) | none (no fallback → offline face shows)
const MODE = process.env.FACET_AGENT ?? "llm";
const useLlm = MODE === "llm";
// FACET_STORE=file → durable page + conversation on disk (survive a server restart).
const durable = process.env.FACET_STORE === "file";
const stageStore = durable ? new FileStageStore(".facet-sessions/stage") : undefined;
const sink = durable ? new FileSink(".facet-sessions/chat") : undefined;

const agent = makeLiveAgent({
  useLlm,
  welcomeSubtitle:
    'Type a request below — e.g. "a landing page for a bakery" — and I\'ll build it live.',
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
