import { MAX_DESCRIPTION_LENGTH, STAGE_SPEC, isValidThemeName } from "@facet/core";
import type { StageToolAssets } from "./types.js";

export type FacetPromptAssets = StageToolAssets;

export interface FacetAgentSystemPromptOptions {
  readonly pageBrief: string;
  readonly assets?: FacetPromptAssets;
}

const MAX_PROMPT_ASSET_ITEMS = 1024;
const MAX_PROMPT_STAMP_SLOTS = 64;

export const FACET_AGENT_ROLE_PROMPT =
  "You are the live agent behind a Facet page: you draw and edit the page with tools, and you chat briefly with its visitor.";

export const FACET_PAGE_EXPERIENCE_PROMPT = `PAGE EXPERIENCE
Build a compact UX that is useful at first glance: focused sections, visible controls, and no decorative filler.
- The page is the primary answer. Use short chat only to acknowledge or clarify alongside a page change.
- Pre-draw screens, hidden panels, and form controls when the visitor should navigate or toggle without waiting for you.
- Keep forms and their submit controls visible together, with stable field names and concise labels.`;

export const FACET_STATE_EDITING_PROMPT = `STATE EDITING
Use an edit-before-append strategy: edit before you append, reuse existing node ids, and change the smallest node that satisfies the request.
- Use render_page only for the first paint or a major restructure.
- Use set_node, append_node, remove_node, use_stamp, or set_theme for incremental edits.
- Reuse existing node ids so updates replace the right content instead of duplicating old sections.
- Never describe a page change in prose when you can make the change with a stage tool.`;

export const FACET_TOOL_PLAYBOOK_PROMPT = `TOOL PLAYBOOK
You build and edit the page by calling Facet stage tools.
- render_page: first paint, empty/near-empty current stage, or a major information architecture restructure.
- set_node: replace or update one existing node by id.
- append_node: add one new node under an existing box parent.
- remove_node: delete a node that no longer belongs.
- use_stamp: expand an advertised stamp by name, filling slot params with strings.
- set_theme: choose an advertised theme by name only.
- inspect_stage / inspect_node: inspect before editing when the current structure or ids are unclear.
- say: send a short chat line; do not use chat as a substitute for the requested page edit.
You may call several tools in one turn. When the visible page reflects the request and you have sent any needed short chat, stop.`;

export const FACET_TOOL_RESULT_CONTRACT_PROMPT = `TOOL RESULT CONTRACT
Use structured outcome recovery. Every tool result is JSON; read status, outcome, visible_to_visitor, warnings, and next_action before deciding you are done.
- applied_visible: the stage changed and the visitor can see the relevant change.
- applied_not_visible: the stage changed but the visitor cannot see the relevant node yet. Do not claim completion; attach it to a visible box, navigate to it, or inspect_stage.
- applied_with_warnings: the stage changed but validation or folding dropped or sanitized something. Inspect or retry if the warning affects the request.
- pending: no patch was emitted yet. Define the missing child node(s) before claiming completion.
- rejected: no patch was emitted. Follow next_action and retry.
- no_stage_change: inspect/say did not mutate the stage. This is only enough when no page change was required.
Do not claim completion unless the requested page change has an applied_visible result, or you intentionally only needed a no_stage_change tool such as inspect or say.`;

export const FACET_ASSET_PRIVACY_PROMPT = `ASSET PRIVACY
Operator assets are offered as metadata only. Use theme names, stamp names, descriptions, and stamp slot names; never copy theme CSS values, stamp node JSON, provider keys, visitor ids, secrets, or unknown asset fields into the prompt or page.`;

export const FACET_PAGE_BRIEF_HEADING = "PAGE BRIEF";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assetArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_PROMPT_ASSET_ITEMS) : [];
}

function assetName(value: unknown): string | undefined {
  return typeof value === "string" && isValidThemeName(value) ? value : undefined;
}

function assetDescription(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > MAX_DESCRIPTION_LENGTH ? value.slice(0, MAX_DESCRIPTION_LENGTH) : value;
}

function themeLine(theme: unknown): string | undefined {
  if (!isRecord(theme)) return undefined;
  const name = assetName(theme["name"]);
  if (name === undefined) return undefined;
  const description = assetDescription(theme["description"]);
  return description !== undefined ? `- ${name}: ${description}` : `- ${name}`;
}

function themesSection(themes: readonly unknown[]): string | undefined {
  const lines = themes.flatMap((theme) => {
    const line = themeLine(theme);
    return line === undefined ? [] : [line];
  });
  if (lines.length === 0) return undefined;
  return [
    "THEMES",
    "Themes you may select by NAME with the set_theme tool. Names and descriptions only; never write CSS values.",
    lines.join("\n"),
  ].join("\n\n");
}

function stampLine(stamp: unknown): string | undefined {
  if (!isRecord(stamp)) return undefined;
  const name = assetName(stamp["name"]);
  if (name === undefined) return undefined;
  const description = assetDescription(stamp["description"]);
  const head = description !== undefined ? `- ${name}: ${description}` : `- ${name}`;
  const rawSlots = stamp["slots"];
  const slotNames = isRecord(rawSlots)
    ? Object.keys(rawSlots).filter(isValidThemeName).slice(0, MAX_PROMPT_STAMP_SLOTS)
    : [];
  const slots = slotNames.length > 0 ? slotNames.join(", ") : "(none)";
  return `${head}\n  slots: ${slots}`;
}

function stampsSection(stamps: readonly unknown[]): string | undefined {
  const entries = stamps.flatMap((stamp) => {
    const entry = stampLine(stamp);
    return entry === undefined ? [] : [entry];
  });
  if (entries.length === 0) return undefined;
  return [
    "STAMPS",
    "Reusable stamps you may expand with the use_stamp tool. Pick a listed name, pass string params for its slots, and choose at.parent; do not copy stamp JSON or invent stamp ids.",
    entries.join("\n\n"),
  ].join("\n\n");
}

export function buildFacetAgentSystemPrompt(options: FacetAgentSystemPromptOptions): string {
  const sections = [
    FACET_AGENT_ROLE_PROMPT,
    STAGE_SPEC,
    FACET_PAGE_EXPERIENCE_PROMPT,
    FACET_STATE_EDITING_PROMPT,
    FACET_TOOL_PLAYBOOK_PROMPT,
    FACET_TOOL_RESULT_CONTRACT_PROMPT,
    FACET_ASSET_PRIVACY_PROMPT,
  ];

  const themes = assetArray(options.assets?.themes);
  const themeBlock = themesSection(themes);
  if (themeBlock !== undefined) sections.push(themeBlock);

  const stamps = assetArray(options.assets?.stamps);
  const stampBlock = stampsSection(stamps);
  if (stampBlock !== undefined) sections.push(stampBlock);

  sections.push(`${FACET_PAGE_BRIEF_HEADING}\n\n${options.pageBrief}`);
  return sections.join("\n\n");
}
