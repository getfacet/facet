import { STAGE_SPEC, type ClientEvent, type FacetTree } from "@facet/core";

interface BridgeEventPromptPolicy {
  readonly currentPagePrefix: string;
  readonly visit: string;
  readonly message: string;
  readonly action: string;
}

const SPAWN_EVENT_POLICY: BridgeEventPromptPolicy = {
  currentPagePrefix: "The page THIS visitor currently sees (a Facet stage tree): ",
  visit: "A visitor just arrived. Render a short welcome page with `facet render`.",
  message:
    "MODIFY the current page — prefer `facet append`/`set`/`remove` on existing node ids to change just what's needed (only `facet render` a fresh page if they ask for something totally new). Optionally `facet say` a short reply.",
  action: "React with facet commands on the current page.",
};

const PERSISTENT_EVENT_POLICY: BridgeEventPromptPolicy = {
  currentPagePrefix: "The visitor's current page: ",
  visit: "A new visitor arrived. Render a welcoming page with the facet tools.",
  message: "Update their page with the facet tools; optionally say() a short reply.",
  action: "React by updating their page with the facet tools.",
};

const SPAWN_SYSTEM_PROMPT = `You control a live web page via the \`facet\` command. Change the page by running:
  facet render '<tree-json>'   facet append <parentId> '<node-json>'   facet set '<node-json>'   facet remove <id>   facet screens '<map-json>' <entry>   facet say <text>

${STAGE_SPEC}

Run facet commands now; do not print anything else.`;

export const PERSISTENT_SYSTEM_PROMPT = `You own a live web page and update it as visitors interact. Use the facet tools to change the page:
- render(tree): replace the whole page with a stage tree
- append(parentId, node): add a node under a parent
- set(node): add or replace a node by id
- remove(id): delete a node
- say(text): send a short chat reply

${STAGE_SPEC}

On a fresh visit, render a page. On a message, prefer append/set/remove to change just what's needed; render a fresh page only for a totally new request. Keep pages polished and complete.`;

/**
 * Render the runner-neutral event envelope once while leaving command policy to
 * each bridge runner. Keeping the action-name guard here prevents the spawn and
 * persistent paths from drifting on malformed input.
 */
function buildBridgeEventPrompt(
  event: ClientEvent,
  stage: FacetTree,
  policy: BridgeEventPromptPolicy,
): string {
  // Preserve the previous eager serialization order, including on visit events.
  const current = `${policy.currentPagePrefix}${JSON.stringify(stage)}`;
  if (event.kind === "visit") return policy.visit;
  if (event.kind === "message") {
    return `${current}\n\nThe visitor said: "${event.text}". ${policy.message}`;
  }

  const name = typeof event.action?.name === "string" ? event.action.name : "(unknown)";
  return `${current}\n\nThe visitor pressed "${name}". ${policy.action}`;
}

export function buildSpawnPrompt(event: ClientEvent, stage: FacetTree): string {
  return `${SPAWN_SYSTEM_PROMPT}\n\n${buildBridgeEventPrompt(event, stage, SPAWN_EVENT_POLICY)}`;
}

export function buildPersistentTurnPrompt(event: ClientEvent, stage: FacetTree): string {
  return buildBridgeEventPrompt(event, stage, PERSISTENT_EVENT_POLICY);
}
