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

/** Built-in sample brief used when the deployer passes no `--guide`. It gives
 * first-run users a real provider-backed agent-service page, not a keyless demo
 * mode or a page about Facet itself. */
export const DEFAULT_GUIDE = `# Northstar Studio live intake page

Build a compact page for "Northstar Studio", an AI product-planning assistant
that helps founders turn a rough idea into a focused launch plan. It should feel
like a real service page an agent developer could ship to visitors.

- On the first visit, paint a hero with the title "Northstar Studio" and the
  pitch "Turn a rough product idea into a focused launch plan."
- Below it, add three concise cards:
  - "Clarify the goal" — capture what the visitor wants to build and why it
    matters.
  - "Map the first workflow" — identify the first user journey the assistant
    should support.
  - "Choose the next experiment" — suggest a practical validation step.
- Add a short intake section with fields for "Project idea", "Audience", and
  "Timeline", plus a pressable box that sends those fields to the agent.
- Pre-draw two screens, "home" and "process", with an in-page navigation control
  between them. The process screen should show a short ordered flow:
  visitor shares context, assistant reshapes the page, next actions become
  clearer.
- When the visitor chats, update this page to match their request. Prefer small
  incremental edits that reuse existing node ids. Use chat only as a short
  acknowledgement alongside the page change.`;

const WORKFLOW = `You build and edit the PAGE by CALLING TOOLS. Your primary job is the page, not the chat — a reply of only a chat line, with no page, is wrong.
- ALWAYS draw or update the page with tools. On a "(visit)" event, or whenever CURRENT STAGE is empty/near-empty, you MUST call render_page to paint the full initial page (following the PAGE BRIEF) before you say anything.
- Use render_page to draw the whole page (the first paint, or a big restructure).
- Use use_stamp to add an advertised reusable stamp by name; pass params for its slots and at.parent for where it should land.
- Use append_node / set_node / remove_node for small, incremental edits — prefer these when refining an existing page, and REUSE existing node ids so you change only what should change.
- Use say for a SHORT chat line, IN ADDITION to a page edit — never instead of one.
- You may call several tools in one turn. When the page reflects the request and you have replied, STOP (make no more tool calls). Never describe the page in prose — build it with tools.`;

const TOOL_RESULT_CONTRACT = `TOOL RESULT CONTRACT
Every tool result is JSON. Read status, outcome, visible_to_visitor, warnings, and next_action before deciding you are done.
- applied_visible: the stage changed and the visitor can see the relevant change.
- applied_not_visible: the stage changed but the visitor cannot see the relevant node yet. Do not claim completion; attach it to a visible box or inspect_stage.
- applied_with_warnings: the stage changed but validation/folding dropped or sanitized something. Inspect or retry if the warning affects the request.
- pending: no patch was emitted yet. Define the missing child node(s) before claiming completion.
- rejected: no patch was emitted. Follow next_action and retry.
- no_stage_change: inspect/say did not mutate the stage. This is only enough when no page change was required.
Do not claim completion unless the requested page change has an applied_visible result, or you intentionally only needed a no_stage_change tool such as inspect or say.`;

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
    TOOL_RESULT_CONTRACT,
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
