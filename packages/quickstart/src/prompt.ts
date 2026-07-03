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
import type { ClientEvent, FacetSession, FacetStamp, FacetTheme, ServerMessage } from "@facet/core";
import type { StoredEvent } from "@facet/runtime";
import type { ToolSpec, TurnMessage } from "./provider.js";

/** How many sink entries (visitor event + agent reply pairs) layer ③ replays. */
export const HISTORY_TURNS = 20;

/** Built-in demo brief used when the deployer passes no `--guide`. It makes the
 * default page a live, self-explaining demo of Facet — drawn by Facet. */
export const DEFAULT_GUIDE = `# A page that explains Facet — drawn by Facet itself

This page IS the demo: you are an LLM drawing it live, per visitor, from Facet's
safe UI bricks. Explain what that means while showing it off. Keep it clear,
concrete, and a little proud.

- On the first visit, paint a hero: a title "Facet" and a one-line pitch like
  "UI your model draws itself — safe, live, and different for every visitor."
- Below it, a card row of the three core ideas:
  - "Safe bricks, not code" — the model composes pages from a few typed bricks
    (box, text, image, field) with token styles, so it can't inject scripts or
    break the layout.
  - "Live & personal" — the page is rebuilt for each visitor and keeps changing
    as they chat; nothing is pre-built.
  - "Only diffs travel" — changes ship as tiny JSON patches applied the same way
    on the server and in the browser, so the two never drift.
- Add a friendly line inviting the visitor to try it, e.g. "Ask me in the chat
  to restyle this page, add a section, or make one just for you."
- Pre-draw two screens — "home" and "how-it-works" — with a navigate box
  between them; on the second screen put a short step list of the
  request → redraw loop (visitor types → model edits the bricks → only the
  patch travels → the page updates live).
- When the visitor chats, ACTUALLY do what they ask to this page, live — that
  is the whole demo. Prefer small incremental edits that reuse existing nodes.`;

const WORKFLOW = `You build and edit the PAGE by CALLING TOOLS. Your primary job is the page, not the chat — a reply of only a chat line, with no page, is wrong.
- ALWAYS draw or update the page with tools. On a "(visit)" event, or whenever CURRENT STAGE is empty/near-empty, you MUST call render_page to paint the full initial page (following the PAGE BRIEF) before you say anything.
- Use render_page to draw the whole page (the first paint, or a big restructure).
- Use append_node / set_node / remove_node for small, incremental edits — prefer these when refining an existing page, and REUSE existing node ids so you change only what should change.
- Use say for a SHORT chat line, IN ADDITION to a page edit — never instead of one.
- You may call several tools in one turn. When the page reflects the request and you have replied, STOP (make no more tool calls). Never describe the page in prose — build it with tools.`;

/** Operator assets injected into prompt layer ② (Decision 6): themes offered
 * to the model by NAME (never a value) and stamps it may copy into the page. */
export interface PromptAssets {
  readonly themes: readonly FacetTheme[];
  readonly stamps: readonly FacetStamp[];
}

/**
 * A stamp whose serialized `{root, nodes}` JSON exceeds this is EXCLUDED from the
 * prompt (with a `console.warn` naming it) rather than blowing the context budget
 * — a quickstart POLICY, not a core rule (invariant #2: mechanism vs policy).
 */
const MAX_STAMP_PROMPT_CHARS = 4000;

/** Layer ② — theme NAMES + one-line descriptions ONLY (never token values). The
 * model selects a theme by name via `set_theme`; an unknown name falls back to
 * the default look. Callers must have validated the documents first. */
function themesSection(themes: readonly FacetTheme[]): string {
  const lines = themes.map((theme) =>
    theme.description !== undefined && theme.description.length > 0
      ? `- ${theme.name}: ${theme.description}`
      : `- ${theme.name}`,
  );
  return [
    "THEMES",
    "Themes you may select by NAME with the set_theme tool — never write CSS values (styles stay tokens); pick only a name from this list, and an unknown name simply falls back to the default look.",
    lines.join("\n"),
  ].join("\n\n");
}

/** Layer ② — reusable brick fragments the model copies into the page. Each is a
 * `{root, nodes}` JSON blob under the mandatory id-prefix copy rule. A fragment
 * larger than `MAX_STAMP_PROMPT_CHARS` is dropped with a warning. Returns
 * `undefined` when no stamp survives, so no empty section is emitted. */
function stampsSection(stamps: readonly FacetStamp[]): string | undefined {
  const entries: string[] = [];
  for (const stamp of stamps) {
    const fragment = JSON.stringify({ root: stamp.root, nodes: stamp.nodes });
    if (fragment.length > MAX_STAMP_PROMPT_CHARS) {
      console.warn(
        `[facet-quickstart] stamp "${stamp.name}" excluded from the prompt: ${String(fragment.length)} chars exceeds MAX_STAMP_PROMPT_CHARS=${String(MAX_STAMP_PROMPT_CHARS)}`,
      );
      continue;
    }
    const head =
      stamp.description !== undefined && stamp.description.length > 0
        ? `- ${stamp.name}: ${stamp.description}`
        : `- ${stamp.name}`;
    entries.push(`${head}\n${fragment}`);
  }
  if (entries.length === 0) return undefined;
  return [
    "STAMPS",
    "Reusable fragments you can copy into the page. To use one, copy its nodes into your patches and prefix EVERY id — the fragment's root id and every child id reference — with a fresh unique instance prefix (like `p1-`) so repeated uses never collide.",
    entries.join("\n\n"),
  ].join("\n\n");
}

/** Layers ① + ②: the stage vocabulary, the tool workflow, optional operator
 * assets (themes + stamps), and the page brief. With no assets (or both arrays
 * empty) the output is byte-identical to the no-assets join (DC-008). */
export function buildSystem(guide: string, assets?: PromptAssets): string {
  const sections: string[] = [
    "You are the live agent behind a Facet page: you draw the page and chat with its visitor.",
    STAGE_SPEC,
    WORKFLOW,
  ];
  const themes = assets?.themes ?? [];
  const stamps = assets?.stamps ?? [];
  if (themes.length > 0) sections.push(themesSection(themes));
  const stampBlock = stamps.length > 0 ? stampsSection(stamps) : undefined;
  if (stampBlock !== undefined) sections.push(stampBlock);
  sections.push(`PAGE BRIEF\n\n${guide}`);
  return sections.join("\n\n");
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
  {
    name: "set_theme",
    description:
      "Restyle the WHOLE page by selecting a theme by NAME. Argument is a name only — one from the THEMES section; never a CSS value or color. Skip this tool entirely when no THEMES are listed. An unknown name simply falls back to the default look.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "A theme name from the THEMES list." } },
      required: ["name"],
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
