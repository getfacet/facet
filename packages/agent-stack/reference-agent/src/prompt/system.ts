/**
 * Layers 1 and 2 of the reference-agent prompt: the Facet stage vocabulary,
 * tool workflow, operator assets, and deployer page brief.
 */
import { TOOLS as AGENT_TOOL_SPECS } from "@facet/agent-tools";
import { STAGE_SPEC } from "@facet/core";
import type { FacetStamp, FacetTheme } from "@facet/core";

import type { ToolSpec } from "../provider.js";

export { FACET_STAGE_TOOL_NAMES, getStageToolSpec } from "@facet/agent-tools";
export type { FacetStageToolName, FacetStageToolSpec, ToolInputByName } from "@facet/agent-tools";

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
    (box, text, media, field) with token styles, so it can't inject scripts or
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
- Use use_stamp to add an advertised reusable stamp by name; pass params for its slots and at.parent for where it should land.
- Use append_node / set_node / remove_node for small, incremental edits — prefer these when refining an existing page, and REUSE existing node ids so you change only what should change.
- Use say for a SHORT chat line, IN ADDITION to a page edit — never instead of one.
- You may call several tools in one turn. When the page reflects the request and you have replied, STOP (make no more tool calls). Never describe the page in prose — build it with tools.`;

/** Operator assets injected into prompt layer 2: themes offered to the model by
 * NAME and stamps it may expand by name. */
export interface PromptAssets {
  readonly themes: readonly FacetTheme[];
  readonly stamps: readonly FacetStamp[];
}

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

function stampsSection(stamps: readonly FacetStamp[]): string | undefined {
  const entries = stamps.map((stamp) => {
    const head =
      stamp.description !== undefined && stamp.description.length > 0
        ? `- ${stamp.name}: ${stamp.description}`
        : `- ${stamp.name}`;
    const slotNames = Object.keys(stamp.slots ?? {});
    const slots = slotNames.length > 0 ? slotNames.join(", ") : "(none)";
    return `${head}\n  slots: ${slots}`;
  });
  if (entries.length === 0) return undefined;
  return [
    "STAMPS",
    "Reusable stamps you may expand with the use_stamp tool. Pick a listed name, pass string params for its slots, and choose at.parent; do not copy stamp JSON or invent stamp ids.",
    entries.join("\n\n"),
  ].join("\n\n");
}

/** Layers 1 and 2: vocabulary, tool workflow, optional assets, and page brief. */
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

/** Compatibility export for the stage tools the model drives. */
export const TOOLS = AGENT_TOOL_SPECS satisfies readonly ToolSpec[];
