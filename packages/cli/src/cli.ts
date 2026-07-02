#!/usr/bin/env node
/**
 * `facet` — the agent's action surface for its page, as a terminal command.
 *
 * A running agent (e.g. a local Claude Code) changes the page by invoking these
 * commands, exactly as it edits files:
 *
 *   facet render '<tree-json>'          # replace the whole stage
 *   facet set '<node-json>'             # insert/replace one node
 *   facet append <parentId> '<node-json>'  # add a child (a card, a button…)
 *   facet remove <nodeId>               # remove a node
 *   facet screens '<map-json>' <entry>  # set the named screens map + entry screen
 *   facet say <text…>                   # send a chat message
 *
 * Each command is a thin wrapper over @facet/agent's Stage. It POSTs the
 * resulting change to the LOCAL bridge (FACET_BRIDGE_URL), which forwards it to
 * the Facet server over the agent connection. FACET_EVENT ties the command to
 * the visitor event currently being handled.
 */
import type { ServerMessage } from "@facet/core";
import type { CmdFrame } from "./commands.js";
import { buildMessages } from "./commands.js";

// Re-export the cli→bridge wire contract so the bridge can import it via the
// bare `@facet/cli` specifier (the sanctioned bin entry) rather than a deep path.
export type { CmdFrame } from "./commands.js";

const bridgeUrl = process.env.FACET_BRIDGE_URL;
const eventToken = process.env.FACET_EVENT ?? "";

function fail(message: string, code = 2): never {
  console.error(`facet: ${message}`);
  process.exit(code);
}

async function main(): Promise<void> {
  if (bridgeUrl === undefined) {
    fail("FACET_BRIDGE_URL is not set — run this inside a Facet bridge session");
  }
  const [command, ...rest] = process.argv.slice(2);
  let messages: readonly ServerMessage[];
  try {
    messages = buildMessages(command, rest);
  } catch (error) {
    fail(error instanceof Error ? error.message : "bad command");
  }

  const frame: CmdFrame = { token: eventToken, messages };
  const response = await fetch(`${bridgeUrl}/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(frame),
  }).catch(() => undefined);

  if (response === undefined || !response.ok) {
    fail(`could not reach the bridge at ${bridgeUrl}`, 1);
  }
  console.log(`facet: ${command} ok`);
}

void main();
