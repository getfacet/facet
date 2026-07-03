/**
 * The quickstart built-in agent's 3-layer prompt (spec Decision 5):
 *
 *   ① `STAGE_SPEC` (the single-source stage vocabulary from `@facet/core`) +
 *     a fixed output contract — one `{"say"?, "tree"?}` JSON object, nothing else;
 *   ② the deployer's guide markdown under a PAGE BRIEF heading;
 *   ③ per-turn messages — the last `HISTORY_TURNS` sink entries as compact
 *     alternating user/assistant lines, then the current event + current stage.
 */
import { STAGE_SPEC } from "@facet/core";
import type { ClientEvent, FacetSession, ServerMessage } from "@facet/core";
import type { StoredEvent } from "@facet/runtime";
import type { ProviderMessage } from "./provider.js";

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

const OUTPUT_CONTRACT = `HOW TO REPLY
Reply with exactly ONE JSON object of the shape {"say"?: string, "tree"?: <stage tree>} — no prose, no markdown code fences, nothing outside the object. "say" is a short chat line shown to the visitor; "tree" is the FULL stage tree to show (it replaces the current stage). Omit "tree" to leave the page as it is.
When refining an existing page, reuse the current node ids and change only what should change — do not rename or rebuild unchanged nodes.
For anything form-like, use "field" nodes plus a pressable box whose onPress is {"kind":"agent","name":"<action>","collect":"<form box id>"} so the typed values arrive on the action event's "fields".`;

/** Layers ① + ②: the stage vocabulary, the output contract, and the page brief. */
export function buildSystem(guide: string): string {
  return [
    "You are the live agent behind a Facet page: you draw the page and chat with its visitor.",
    STAGE_SPEC,
    OUTPUT_CONTRACT,
    `PAGE BRIEF\n\n${guide}`,
  ].join("\n\n");
}

/** One visitor event as a compact user-side line. */
function describeEvent(event: ClientEvent): string {
  switch (event.kind) {
    case "visit":
      return `(visit) visitor=${JSON.stringify(event.visitor)}`;
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
 * Layer ③: the last `HISTORY_TURNS` stored interactions as alternating
 * user/assistant messages, then the final user message = the current event
 * (action events include `fields`, so form submits are visible) + the current
 * stage JSON (so the model refines instead of rebuilding).
 */
export function buildTurnMessages(
  event: ClientEvent,
  session: FacetSession,
  history: readonly StoredEvent[],
): readonly ProviderMessage[] {
  const messages: ProviderMessage[] = [];
  for (const entry of history.slice(-HISTORY_TURNS)) {
    messages.push({ role: "user", content: describeEvent(entry.event) });
    messages.push({ role: "assistant", content: describeReplies(entry.messages) });
  }
  messages.push({
    role: "user",
    content: `${describeEvent(event)}\n\nCURRENT STAGE: ${JSON.stringify(session.stage)}`,
  });
  return messages;
}
