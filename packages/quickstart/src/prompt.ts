/**
 * The quickstart built-in agent's prompt + tool set (a tool-calling loop, not a
 * single-shot completion):
 *
 *   ① `STAGE_SPEC` (the single-source stage vocabulary from `@facet/core`) + a
 *     short workflow instruction on how to drive the tools;
 *   ② the deployer's guide markdown under a PAGE BRIEF heading;
 *   ③ per-turn messages — recent history + the current event + the current stage.
 *
 * The TOOLS are what the model actually calls each step (append/set/remove a
 * node, render the whole page, say a chat line).
 */
import { STAGE_SPEC } from "@facet/core";
import type { ClientEvent, FacetSession, ServerMessage } from "@facet/core";
import type { StoredEvent } from "@facet/runtime";
import type { ToolSpec, TurnMessage } from "./provider.js";

/** How many sink entries (visitor event + agent reply pairs) layer ③ replays. */
export const HISTORY_TURNS = 20;

/** Built-in demo brief used when the deployer passes no `--guide`. */
export const DEFAULT_GUIDE = `# A personal page for whoever visits

You host a small, friendly personal landing page. Make each visitor feel the
page was drawn just for them.

- On the first visit, paint a warm hero (a title and a one-line welcome), a
  short "what this page can do" card row, and a compact "say hi" form: a name
  field and an email field plus a pressable Send box that collects them.
- Pre-draw two screens — "home" and "about" — with a navigate box between
  them, so visitors can flip screens instantly while you are idle.
- When a visitor chats or submits the form, refine the page live: greet them
  by name, tweak the existing nodes instead of redrawing everything, and keep
  the tone light and personal.`;

const WORKFLOW = `You build and edit the PAGE by CALLING TOOLS. Your primary job is the page, not the chat — a reply of only a chat line, with no page, is wrong.
- ALWAYS draw or update the page with tools. On a "(visit)" event, or whenever CURRENT STAGE is empty/near-empty, you MUST call render_page to paint the full initial page (following the PAGE BRIEF) before you say anything.
- Use render_page to draw the whole page (the first paint, or a big restructure).
- Use append_node / set_node / remove_node for small, incremental edits — prefer these when refining an existing page, and REUSE existing node ids so you change only what should change.
- Use say for a SHORT chat line, IN ADDITION to a page edit — never instead of one.
- You may call several tools in one turn. When the page reflects the request and you have replied, STOP (make no more tool calls). Never describe the page in prose — build it with tools.`;

/** Layers ① + ②: the stage vocabulary, the tool workflow, and the page brief. */
export function buildSystem(guide: string): string {
  return [
    "You are the live agent behind a Facet page: you draw the page and chat with its visitor.",
    STAGE_SPEC,
    WORKFLOW,
    `PAGE BRIEF\n\n${guide}`,
  ].join("\n\n");
}

/** A brick node — validated server-side (validateTree + the fail-safe renderer),
 * so the schema stays permissive and points the model at STAGE_SPEC. */
const NODE_SCHEMA = {
  type: "object",
  description: "A Facet brick node (box | text | image | field) — see the stage format.",
} as const;

/** The tools the model drives — each maps 1:1 onto a Stage operation. */
export const TOOLS: readonly ToolSpec[] = [
  {
    name: "render_page",
    description:
      "Replace the ENTIRE page with a new stage tree. Use for the first paint or a big restructure. Argument: the full stage tree { root, nodes, screens?, entry? }.",
    parameters: {
      type: "object",
      properties: { tree: { type: "object", description: "The full stage tree." } },
      required: ["tree"],
    },
  },
  {
    name: "append_node",
    description:
      "Add ONE node as the last child of the box `parentId`. Use for small incremental additions to the current page.",
    parameters: {
      type: "object",
      properties: { parentId: { type: "string" }, node: NODE_SCHEMA },
      required: ["parentId", "node"],
    },
  },
  {
    name: "set_node",
    description:
      "Insert or replace ONE node by its `id`. Reuse an existing id to tweak that node in place; use a new id to add a standalone node.",
    parameters: {
      type: "object",
      properties: { node: NODE_SCHEMA },
      required: ["node"],
    },
  },
  {
    name: "remove_node",
    description: "Delete ONE node from the page by its id.",
    parameters: {
      type: "object",
      properties: { nodeId: { type: "string" } },
      required: ["nodeId"],
    },
  },
  {
    name: "say",
    description: "Send a short chat message to the visitor.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
];

/** One visitor event as a compact user-side line. */
function describeEvent(event: ClientEvent): string {
  switch (event.kind) {
    case "visit": {
      // Never the visitorId (the unauthenticated session bearer key) — only the
      // non-secret context the model can actually use.
      const { referrer, locale, relationship } = event.visitor;
      return `(visit) context=${JSON.stringify({ referrer, locale, relationship })}`;
    }
    case "message":
      return event.text;
    case "action": {
      const action = event.action;
      if (action.kind === "navigate") return `(action navigate to=${action.to})`;
      if (action.kind === "toggle") return `(action toggle target=${action.target})`;
      const payload = JSON.stringify(action.payload ?? {});
      const fields = JSON.stringify(event.fields ?? {});
      return `(action ${action.name} payload=${payload} fields=${fields})`;
    }
    default:
      // A corrupt/unknown history event.kind must still yield a string, never
      // `undefined` in a prompt message.
      return "(unknown event)";
  }
}

/** The agent's replies to one event as a compact assistant-side line. */
function describeReplies(messages: readonly ServerMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.kind === "say") parts.push(message.text);
  }
  if (messages.some((message) => message.kind === "patch")) parts.push("(page updated)");
  return parts.length > 0 ? parts.join("\n") : "(no reply)";
}

/**
 * Layer ③: the last `limit` stored interactions as alternating user/assistant
 * messages, then the final user message = the current event (action events
 * include `fields`) + the current stage JSON (so the model refines instead of
 * rebuilding). `limit <= 0` replays no history.
 */
export function buildInitialMessages(
  event: ClientEvent,
  session: FacetSession,
  history: readonly StoredEvent[],
  limit: number,
): TurnMessage[] {
  const messages: TurnMessage[] = [];
  const replayed = limit > 0 ? history.slice(-limit) : [];
  for (const entry of replayed) {
    messages.push({ role: "user", content: describeEvent(entry.event) });
    messages.push({ role: "assistant", content: describeReplies(entry.messages) });
  }
  messages.push({
    role: "user",
    content: `${describeEvent(event)}\n\nCURRENT STAGE: ${JSON.stringify(session.stage)}`,
  });
  return messages;
}
