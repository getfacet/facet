import { BRICK_CONTRACT, BRICK_TYPES, MAX_DESCRIPTION_LENGTH, STAGE_SPEC } from "@facet/core";
import type { BrickIndexEntry, StageToolAssets } from "./types.js";

export type FacetPromptAssets = StageToolAssets;

export interface FacetAgentSystemPromptOptions {
  readonly pageBrief: string;
  readonly assets?: FacetPromptAssets;
}

const MAX_PATTERN_INDEX_ITEMS = 64;
const MAX_PRESET_INDEX_ITEMS = 64;

export const FACET_AGENT_ROLE_PROMPT =
  "You are the live agent behind a Facet page: you draw and edit the page with tools, and you chat briefly with its visitor.";

export const FACET_STYLE_DISCOVERY_POLICY = {
  knownChoiceSources: ["Pattern", "same-Brick Preset"],
  lookupTrigger: "directly choosing an unfamiliar value",
} as const;

const KNOWN_STYLE_CHOICE_GUIDANCE = `Style choices already supplied by a ${FACET_STYLE_DISCOVERY_POLICY.knownChoiceSources[0]} or ${FACET_STYLE_DISCOVERY_POLICY.knownChoiceSources[1]} are known valid choices and may be re-authored. Call get_style_choices only when ${FACET_STYLE_DISCOVERY_POLICY.lookupTrigger} for an exact Brick-owned property.`;

export const FACET_PAGE_EXPERIENCE_PROMPT = `PAGE EXPERIENCE
Default to a compact UX that is useful at first glance: focused sections, visible controls, and no decorative filler.
- The page is the primary answer. Use short chat only to acknowledge or clarify alongside a page change.
- Pre-draw screens, hidden panels, and input controls when the visitor should navigate or toggle without waiting for you.
- Keep related inputs and their pressable action boxes visible together, with stable field names and concise labels.
- Events may report the visitor's current view (the screen they are on, which panels are toggled, and their device width and color mode); target edits at the screen the visitor is actually viewing, and navigate deliberately when a change belongs on another screen. An event's view.sort reports the visitor's current per-table sort.
- Box and text may use "activeWhen" with an alternate appearance in "style.active". It reacts to the local view without an agent turn or a stage mutation.`;

export const FACET_POLISHED_BRICK_GUIDANCE_PROMPT = `BRICK GUIDANCE
Use Facet's closed Brick vocabulary. Bricks are ${BRICK_TYPES.join(", ")}.
- Box is the only container. Compose product-quality flow from boxes and text; use media and richtext for assets and flowing mixed-format prose, input for visitor entry, table/chart for display-only data, and list/keyValue/progress/loading for compact product state.
- Product-grade details stay inside the same eleven Bricks: media.kind "icon" uses MEDIA_ICON_NAMES and never raw SVG paths or CSS; text, list, richtext, and table use textWrap and lineClamp for text flow; table columns may use closed align; chart series may use closed lineStyle; chart plot style may set axisColor, gridColor, and labelColor as color tokens.
- Use get_brick_spec before authoring unfamiliar media icon fields, table alignment, chart lineStyle, or local style paths; call get_style_choices for unfamiliar style values such as textWrap, lineClamp, axisColor, gridColor, or labelColor.
- Custom assets remain expected per-agent or per-user for product-specific quality; bundled defaults are safe fallback assets, not benchmark-quality design solutions.
- Make an action from a pressable box with label text. Keep related inputs in one box and point a pressable agent action's "collect" at that box when their values should be submitted together.
- For a fixed local screen choice, use pressable boxes whose navigate action and activeWhen predicate name the same preauthored screen. Open-ended or dynamic filtering belongs to the agent and its backend tools.
- Use richtext for flowing mixed-format prose. It contains closed blocks and runs; marks are bold, italic, underline, strike, code, and link. Links accept an internal FacetAction or a gated external URL, never javascript: or data:.
- Every Brick may omit style and receive its Theme default. Prefer a same-Brick Preset and add direct style only for a deliberate adjustment.
- ${KNOWN_STYLE_CHOICE_GUIDANCE}
- Never write resolved Theme values, arbitrary code, provider keys, visitor ids, secrets, or unknown asset fields into the page.`;

export const FACET_DATA_BINDING_PROMPT = `DATA BINDING
Author shared data once, then bind many views to it. Put rows the whole page reuses in the tree's top-level "data" warehouse: a map of dataset NAME to an array of flat row records. Bind a data-bearing Brick with its "from" field instead of repeating rows inline.
- "from" bindable Bricks are table, chart, list, keyValue, and text; "from" wins over inline data.
- A table uses its columns to select cells; a chart uses numeric columns; list and keyValue use ordered columns; text reads one cell with "column" and optional "row".
- A sortable table changes only its local render order and reports the choice through view.sort; it does not mutate the dataset or require an agent turn.
- Dataset names are names, never URLs, endpoints, queries, expressions, or resolvers. A missing dataset renders empty until authored.`;

export const FACET_STATE_EDITING_PROMPT = `STATE EDITING
Default to edit before append: reuse existing node ids and make the smallest change that satisfies the request.
- Use render_page only for the first paint or a major restructure. Use set_node, append_node, or remove_node for incremental edits.
- For a user request to build, change, or draw the page, asset reads and inspections are preparation only: no_stage_change does not satisfy a page-change request. After preparation, you must call a mutation tool — render_page, set_node, append_node, or remove_node — and must receive applied_visible before claiming completion. A factual or no-change request does not require a mutation.
- When adding a new hierarchy under an existing parent, create every unattached leaf with set_node, create inner boxes bottom-up with set_node, then append_node the completed top node to the existing parent exactly once. Never append a descendant directly to the destination and also reference it from the new container.
- Consider Pattern and Preset references first. For a relevant Pattern, call get_pattern, preserve its useful styling choices, adapt its structure, and do not blindly copy its content or actions. Call get_preset when indexed metadata fits the same Brick.
- Read one unfamiliar Brick with get_brick_spec before authoring its fields or local style paths. Call get_style_choices only when directly choosing a value for an unfamiliar property. Author ordinary native Bricks yourself.
- Reuse existing node ids so updates replace the right content instead of duplicating old sections. Never describe a page change in prose when a stage tool can make it.`;

export const FACET_TOOL_PLAYBOOK_PROMPT = `TOOL PLAYBOOK
You build and edit the page by calling Facet stage tools.
- render_page: first paint, empty or near-empty stage, or major information-architecture restructure.
- set_node / append_node / remove_node: focused native-Brick edits.
- get_pattern: read one indexed Pattern for guidance; it never edits the stage.
- get_brick_spec: read exact fields and compact local style paths for one unfamiliar Brick.
- get_style_choices: read allowed values only when directly choosing an unfamiliar local property.
- get_preset: read one indexed same-Brick Preset with unresolved style names.
- inspect_stage / inspect_node: inspect before editing when structure or ids are unclear.
- say: send a short chat line, never a substitute for the requested page edit.
You may call several tools in one turn. Stop when the visible page reflects the request and any needed short chat is sent.`;

export const FACET_TOOL_RESULT_CONTRACT_PROMPT = `TOOL RESULT CONTRACT
Read status, outcome, visible_to_visitor, warnings, errors, and next_action in every tool result before deciding you are done.
- applied_visible: the relevant stage change is visible.
- applied_not_visible: the stage changed but the relevant Brick is not visible; attach or navigate to it, then inspect.
- applied_with_warnings: a non-authoring fold diagnostic occurred; inspect when it affects the request.
- pending: no patch was emitted yet; define the missing child Bricks first.
- rejected: no patch was emitted. If code is invalid_authoring, use the bounded errors and allowed choices, repair the complete call, and retry.
- no_stage_change: a read, inspect, or chat tool did not mutate the stage.
For a requested page change, no_stage_change is preparation rather than completion. Do not claim completion until a mutation tool returns applied_visible. Factual or no-change requests remain valid without a mutation.`;

export const FACET_ASSET_PRIVACY_PROMPT = `ASSET PRIVACY
The prompt exposes only bounded Pattern, Brick, and Preset metadata. Read exact assets and local style choices only through their dedicated tools. Concrete Theme values, full Pattern trees, provider keys, visitor ids, secrets, and unknown asset fields stay private. Never copy private asset data into the page or chat.`;

export const FACET_PAGE_BRIEF_HEADING = "PAGE BRIEF";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > MAX_DESCRIPTION_LENGTH ? value.slice(0, MAX_DESCRIPTION_LENGTH) : value;
}

function safeIndex(value: unknown, maximum: number): readonly unknown[] {
  return Array.isArray(value) ? value.slice(0, maximum) : [];
}

function readIndex(assets: StageToolAssets | undefined, key: keyof StageToolAssets): unknown {
  try {
    return assets?.[key];
  } catch {
    return undefined;
  }
}

function patternIndexLines(assets: StageToolAssets | undefined): readonly string[] {
  return safeIndex(readIndex(assets, "patternIndex"), MAX_PATTERN_INDEX_ITEMS).flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = boundedText(item["name"]);
    const description = boundedText(item["description"]);
    const useWhen = boundedText(item["useWhen"]);
    return name === undefined || description === undefined || useWhen === undefined
      ? []
      : [`- ${name}: ${description} Use when: ${useWhen}`];
  });
}

function fallbackBrickIndex(): readonly BrickIndexEntry[] {
  return BRICK_TYPES.map((type) => ({
    type,
    description: BRICK_CONTRACT[type].description,
    useWhen: BRICK_CONTRACT[type].useWhen,
  }));
}

function brickIndexLines(assets: StageToolAssets | undefined): readonly string[] {
  const source = safeIndex(readIndex(assets, "brickIndex"), BRICK_TYPES.length);
  const items = source.length === 0 ? fallbackBrickIndex() : source;
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const type = boundedText(item["type"]);
    const description = boundedText(item["description"]);
    const useWhen = boundedText(item["useWhen"]);
    return type === undefined || description === undefined || useWhen === undefined
      ? []
      : [`- ${type}: ${description} Use when: ${useWhen}`];
  });
}

function presetIndexLines(assets: StageToolAssets | undefined): readonly string[] {
  return safeIndex(readIndex(assets, "presetIndex"), MAX_PRESET_INDEX_ITEMS).flatMap((item) => {
    if (!isRecord(item)) return [];
    const brick = boundedText(item["brick"]);
    const name = boundedText(item["name"]);
    const description = boundedText(item["description"]);
    const useWhen = boundedText(item["useWhen"]);
    return brick === undefined ||
      name === undefined ||
      description === undefined ||
      useWhen === undefined
      ? []
      : [`- ${brick}/${name}: ${description} Use when: ${useWhen}`];
  });
}

function indexSection(
  heading: "PATTERNS" | "BRICKS" | "PRESETS",
  guidance: string,
  lines: readonly string[],
): string {
  return [heading, guidance, lines.length === 0 ? "- (none available)" : lines.join("\n")].join(
    "\n\n",
  );
}

function patternsSection(assets: StageToolAssets | undefined): string {
  return indexSection(
    "PATTERNS",
    "Consider these compatible references first. Read a relevant one with get_pattern, then adapt rather than blindly copy it.",
    patternIndexLines(assets),
  );
}

function bricksSection(assets: StageToolAssets | undefined): string {
  return indexSection(
    "BRICKS",
    "All eleven native Bricks are authorable. Read one unfamiliar Brick's fields and local style paths with get_brick_spec; query an unfamiliar value with get_style_choices only when needed.",
    brickIndexLines(assets),
  );
}

function presetsSection(assets: StageToolAssets | undefined): string {
  return indexSection(
    "PRESETS",
    "Prefer a matching same-Brick Preset. Read its unresolved style bundle with get_preset.",
    presetIndexLines(assets),
  );
}

export function buildFacetAgentSystemPrompt(options: FacetAgentSystemPromptOptions): string {
  return [
    FACET_AGENT_ROLE_PROMPT,
    STAGE_SPEC,
    FACET_PAGE_EXPERIENCE_PROMPT,
    FACET_POLISHED_BRICK_GUIDANCE_PROMPT,
    FACET_DATA_BINDING_PROMPT,
    FACET_STATE_EDITING_PROMPT,
    FACET_TOOL_PLAYBOOK_PROMPT,
    FACET_TOOL_RESULT_CONTRACT_PROMPT,
    FACET_ASSET_PRIVACY_PROMPT,
    patternsSection(options.assets),
    presetsSection(options.assets),
    bricksSection(options.assets),
    `${FACET_PAGE_BRIEF_HEADING}\n\n${options.pageBrief}`,
  ].join("\n\n");
}
