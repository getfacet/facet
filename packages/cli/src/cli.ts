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
 *   facet say <text…>                   # send a chat message
 *
 * Each command is a thin wrapper over @facet/agent's Stage. It POSTs the
 * resulting change to the LOCAL bridge (FACET_BRIDGE_URL), which forwards it to
 * the Facet server over the agent connection. FACET_EVENT ties the command to
 * the visitor event currently being handled.
 */
import { Stage } from "@facet/agent";
import type { FacetNode, FacetTree } from "@facet/core";

const bridgeUrl = process.env.FACET_BRIDGE_URL;
const eventToken = process.env.FACET_EVENT ?? "";

function fail(message: string, code = 2): never {
  console.error(`facet: ${message}`);
  process.exit(code);
}

function parseJson<T>(value: string | undefined, what: string): T {
  if (value === undefined) fail(`missing ${what}`);
  try {
    return JSON.parse(value) as T;
  } catch {
    return fail(`invalid JSON for ${what}`);
  }
}

async function main(): Promise<void> {
  if (bridgeUrl === undefined) {
    fail("FACET_BRIDGE_URL is not set — run this inside a Facet bridge session");
  }
  const [command, ...rest] = process.argv.slice(2);
  const stage = new Stage();

  switch (command) {
    case "render":
      stage.render(parseJson<FacetTree>(rest[0], "tree"));
      break;
    case "set":
      stage.set(parseJson<FacetNode>(rest[0], "node"));
      break;
    case "append":
      if (rest[0] === undefined) fail("append needs a parent id");
      stage.append(rest[0], parseJson<FacetNode>(rest[1], "node"));
      break;
    case "remove":
      if (rest[0] === undefined) fail("remove needs a node id");
      stage.remove(rest[0]);
      break;
    case "say":
      stage.say(rest.join(" "));
      break;
    default:
      fail(`unknown command "${command ?? ""}" (render|set|append|remove|say)`);
  }

  const messages = stage.flush();
  const response = await fetch(`${bridgeUrl}/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: eventToken, messages }),
  }).catch(() => undefined);

  if (response === undefined || !response.ok) {
    fail(`could not reach the bridge at ${bridgeUrl}`, 1);
  }
  console.log(`facet: ${command} ok`);
}

void main();
