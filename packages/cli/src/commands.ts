import { Stage } from "@facet/agent";
import type { FacetNode, FacetTree, ServerMessage } from "@facet/core";

function parseJson<T>(value: string | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`invalid JSON for ${what}`);
  }
}

/**
 * Turns a `facet` command + args into the stage messages to send. Pure and
 * testable; throws a descriptive Error on bad input (the CLI turns that into a
 * clean exit).
 */
export function buildMessages(
  command: string | undefined,
  rest: string[],
): readonly ServerMessage[] {
  const stage = new Stage();
  switch (command) {
    case "render":
      stage.render(parseJson<FacetTree>(rest[0], "tree"));
      break;
    case "set":
      stage.set(parseJson<FacetNode>(rest[0], "node"));
      break;
    case "append":
      if (rest[0] === undefined) throw new Error("append needs a parent id");
      stage.append(rest[0], parseJson<FacetNode>(rest[1], "node"));
      break;
    case "remove":
      if (rest[0] === undefined) throw new Error("remove needs a node id");
      stage.remove(rest[0]);
      break;
    case "say":
      stage.say(rest.join(" "));
      break;
    default:
      throw new Error(`unknown command "${command ?? ""}" (render|set|append|remove|say)`);
  }
  return stage.flush();
}
