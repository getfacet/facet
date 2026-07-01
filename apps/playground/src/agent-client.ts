/**
 * A demo EXTERNAL agent — a separate process that dials into the Facet server as
 * the brain for agentId="live". It holds an outbound SSE stream for events and
 * POSTs control back. This proves the agent no longer has to be co-located with
 * the server (customer segments 2 & 3). Swap the logic here for a local Claude
 * (the bridge, A3) and nothing else changes.
 *
 *   pnpm --filter @facet/playground serve      # start the server (terminal 1)
 *   pnpm --filter @facet/playground agent      # start this agent (terminal 2)
 *
 * FACET_AGENT=echo for a fast no-LLM agent.
 */
import {
  EMPTY_TREE,
  type ClientEvent,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
} from "@facet/core";
import { defineAgent } from "@facet/agent";
import { generatePage } from "./generator.js";

const SERVER = "http://localhost:5291";
const AGENT_ID = "live";
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

interface EventFrame {
  readonly type: "event";
  readonly requestId: number;
  readonly visitorId: string;
  readonly event: ClientEvent;
}

async function onEvent(frame: EventFrame): Promise<void> {
  const session: FacetSession = {
    agentId: AGENT_ID,
    visitor: { visitorId: frame.visitorId },
    stage: EMPTY_TREE,
  };
  const messages: readonly ServerMessage[] = await logic(frame.event, session);
  await fetch(`${SERVER}/agent/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId: AGENT_ID, requestId: frame.requestId, messages }),
  });
  console.log(`↩ answered ${frame.event.kind} for ${frame.visitorId} (${messages.length} msg)`);
}

async function main(): Promise<void> {
  console.log(`External agent connecting to ${SERVER} as "${AGENT_ID}" (${useLlm ? "LLM" : "echo"})…`);
  const response = await fetch(`${SERVER}/agent/stream?agentId=${AGENT_ID}`, {
    headers: { Accept: "text/event-stream" },
  });
  if (response.body === null) throw new Error("no stream body");
  console.log("● connected — waiting for visitor events.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frameText = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const dataLine = frameText.split("\n").find((line) => line.startsWith("data:"));
      if (dataLine === undefined) continue;
      const parsed: unknown = JSON.parse(dataLine.slice("data:".length).trim());
      if (typeof parsed === "object" && parsed !== null && (parsed as { type?: string }).type === "event") {
        void onEvent(parsed as EventFrame);
      }
    }
  }
  console.log("stream closed.");
}

void main();
