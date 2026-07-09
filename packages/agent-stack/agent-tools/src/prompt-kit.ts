import { MAX_DESCRIPTION_LENGTH, STAGE_SPEC, isValidThemeName } from "@facet/core";
import type { StageToolAssets } from "./types.js";

export type FacetPromptAssets = StageToolAssets;

export interface FacetAgentSystemPromptOptions {
  readonly pageBrief: string;
  readonly assets?: FacetPromptAssets;
}

const MAX_PROMPT_ASSET_ITEMS = 1024;
const MAX_PROMPT_STAMP_SLOTS = 64;
const MAX_PROMPT_CATALOG_ITEMS = 64;
const MAX_PROMPT_METADATA_ITEMS = 16;

export const FACET_AGENT_ROLE_PROMPT =
  "You are the live agent behind a Facet page: you draw and edit the page with tools, and you chat briefly with its visitor.";

export const FACET_PAGE_EXPERIENCE_PROMPT = `PAGE EXPERIENCE
Default to a compact UX that is useful at first glance: focused sections, visible controls, and no decorative filler. If an active catalog says compactScreens:false, follow that catalog policy.
- The page is the primary answer. Use short chat only to acknowledge or clarify alongside a page change.
- Pre-draw screens, hidden panels, and form controls when the visitor should navigate or toggle without waiting for you.
- Keep forms and their submit controls visible together, with stable field names and concise labels.`;

export const FACET_STATE_EDITING_PROMPT = `STATE EDITING
Default to an edit-before-append strategy: edit before you append, reuse existing node ids, and change the smallest node that satisfies the request. If an active catalog says editBeforeAppend:false, follow that catalog policy.
- Use render_page only for the first paint or a major restructure.
- Use set_node, append_node, remove_node, use_stamp, or set_theme for incremental edits.
- Reuse existing node ids so updates replace the right content instead of duplicating old sections.
- Never describe a page change in prose when you can make the change with a stage tool.`;

export const FACET_TOOL_PLAYBOOK_PROMPT = `TOOL PLAYBOOK
You build and edit the page by calling Facet stage tools.
- render_page: first paint, empty/near-empty current stage, or a major information architecture restructure.
- set_node: replace or update one existing node by id.
- append_node: add one new node under an existing container parent (box, section, or card).
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
Operator assets are offered as metadata only. Use catalog policy, theme names, stamp names, descriptions, stamp slot names, and whitelisted stamp metadata; never copy theme CSS values, stamp node JSON, provider keys, visitor ids, secrets, slot default values, or unknown asset fields into the prompt or page.`;

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

function assetTextList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const text = assetDescription(item);
      return text === undefined ? [] : [text];
    })
    .slice(0, MAX_PROMPT_METADATA_ITEMS);
}

function assetNameList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const name = assetName(item);
      return name === undefined ? [] : [name];
    })
    .slice(0, MAX_PROMPT_METADATA_ITEMS);
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

function catalogThemeLines(value: unknown): readonly string[] {
  if (!isRecord(value)) return [];
  const lines: string[] = [];
  const active = assetName(value["active"]);
  lines.push(`active theme: ${active ?? "(current)"}`);
  const switchPolicy = value["switchPolicy"] === "allowed" ? "allowed" : "locked";
  lines.push(`switchPolicy: ${switchPolicy}`);
  const allowed = assetNameList(value["allowed"]);
  if (allowed.length > 0) lines.push(`allowed themes: ${allowed.join(", ")}`);
  if (switchPolicy === "locked") {
    lines.push("locked theme guidance: do not call set_theme; keep the active theme.");
  } else {
    lines.push("theme switch guidance: call set_theme only with an allowed theme name.");
  }
  return lines;
}

function catalogBrickLine(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const type = assetName(value["type"]);
  if (type === undefined) return undefined;
  const variants = assetNameList(value["variants"]);
  const guidance = assetDescription(value["guidance"]);
  const variantText = variants.length > 0 ? ` variants: ${variants.join(", ")}` : "";
  const guidanceText = guidance !== undefined ? ` - ${guidance}` : "";
  return `${type}${variantText}${guidanceText}`;
}

function catalogBricksLine(value: unknown): string | undefined {
  const bricks = assetArray(value)
    .flatMap((brick) => {
      const line = catalogBrickLine(brick);
      return line === undefined ? [] : [line];
    })
    .slice(0, MAX_PROMPT_CATALOG_ITEMS);
  return bricks.length > 0 ? `allowed bricks: ${bricks.join("; ")}` : undefined;
}

function catalogStampsLine(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value["mode"] === "all") return "stamp policy: all advertised stamps";
  if (value["mode"] !== "allow") return undefined;
  const names = assetNameList(value["names"]);
  return `stamp policy: allow ${names.length > 0 ? names.join(", ") : "(none)"}`;
}

function catalogPolicyLines(value: unknown): readonly string[] {
  if (!isRecord(value)) return [];
  const lines: string[] = [];
  if (Array.isArray(value["order"])) {
    const order = value["order"].filter(
      (item): item is string => item === "stamp" || item === "brick" || item === "primitive",
    );
    if (order.length > 0) lines.push(`policy order: ${order.join(" -> ")}`);
  }
  if (typeof value["editBeforeAppend"] === "boolean") {
    lines.push(`edit-before-append: ${String(value["editBeforeAppend"])}`);
  }
  if (typeof value["compactScreens"] === "boolean") {
    lines.push(`compact screen: ${String(value["compactScreens"])}`);
  }
  if (
    typeof value["maxScreenSections"] === "number" &&
    Number.isInteger(value["maxScreenSections"])
  ) {
    lines.push(`max screen sections: ${String(value["maxScreenSections"])}`);
  }
  return lines;
}

function catalogUseOrderGuidance(policy: unknown): string {
  const editBeforeAppend = isRecord(policy) ? policy["editBeforeAppend"] : undefined;
  const compactScreens = isRecord(policy) ? policy["compactScreens"] : undefined;
  const editGuidance =
    editBeforeAppend === false
      ? "catalog allows append-first edits when appropriate"
      : "edit before you append";
  const compactGuidance =
    compactScreens === false
      ? "catalog allows broader screens when appropriate"
      : "keep each screen compact";
  return `use order: stamp -> high-level brick -> primitive fallback; ${editGuidance}; ${compactGuidance}.`;
}

function catalogSection(catalog: unknown): string | undefined {
  if (!isRecord(catalog)) return undefined;
  const name = assetName(catalog["name"]);
  if (name === undefined) return undefined;
  const description = assetDescription(catalog["description"]);
  const lines = [
    description !== undefined ? `${name}: ${description}` : name,
    ...catalogThemeLines(catalog["theme"]),
  ];
  const bricks = catalogBricksLine(catalog["bricks"]);
  if (bricks !== undefined) lines.push(bricks);
  const stamps = catalogStampsLine(catalog["stamps"]);
  if (stamps !== undefined) lines.push(stamps);
  const primitiveFallback =
    catalog["primitiveFallback"] === "discouraged" || catalog["primitiveFallback"] === "allowed"
      ? catalog["primitiveFallback"]
      : undefined;
  if (primitiveFallback !== undefined) lines.push(`primitiveFallback: ${primitiveFallback}`);
  lines.push(...catalogPolicyLines(catalog["policy"]));
  lines.push(catalogUseOrderGuidance(catalog["policy"]));
  return [
    "CATALOG",
    "Active catalog guidance. Use these names and policies only; do not expose catalog internals, theme values, or stamp JSON.",
    lines.join("\n"),
  ].join("\n\n");
}

function stampMetadataLines(value: unknown): readonly string[] {
  if (!isRecord(value)) return [];
  const lines: string[] = [];
  const category = assetDescription(value["category"]);
  if (category !== undefined) lines.push(`category: ${category}`);
  const useWhen = assetDescription(value["useWhen"]);
  if (useWhen !== undefined) lines.push(`useWhen: ${useWhen}`);
  const avoidWhen = assetDescription(value["avoidWhen"]);
  if (avoidWhen !== undefined) lines.push(`avoidWhen: ${avoidWhen}`);
  const variants = assetTextList(value["variants"]);
  if (variants.length > 0) lines.push(`variants: ${variants.join(", ")}`);
  const tags = assetTextList(value["tags"]);
  if (tags.length > 0) lines.push(`tags: ${tags.join(", ")}`);
  if (typeof value["repeatable"] === "boolean")
    lines.push(`repeatable: ${String(value["repeatable"])}`);
  const preferredParent = value["preferredParent"];
  if (
    preferredParent === "root" ||
    preferredParent === "box" ||
    preferredParent === "section" ||
    preferredParent === "card"
  ) {
    lines.push(`preferredParent: ${preferredParent}`);
  }
  const composedOf = assetTextList(value["composedOf"]);
  if (composedOf.length > 0) lines.push(`composedOf: ${composedOf.join(", ")}`);
  const dataRequirements = assetTextList(value["dataRequirements"]);
  if (dataRequirements.length > 0) lines.push(`dataRequirements: ${dataRequirements.join(", ")}`);
  const followUpEdits = assetTextList(value["followUpEdits"]);
  if (followUpEdits.length > 0) lines.push(`followUpEdits: ${followUpEdits.join(", ")}`);
  return lines;
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
  const metadata = stampMetadataLines(stamp["metadata"]).map((line) => `  ${line}`);
  return [head, `  slots: ${slots}`, ...metadata].join("\n");
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

  const catalogBlock = catalogSection(options.assets?.catalog);
  if (catalogBlock !== undefined) sections.push(catalogBlock);

  const stamps = assetArray(options.assets?.stamps);
  const stampBlock = stampsSection(stamps);
  if (stampBlock !== undefined) sections.push(stampBlock);

  sections.push(`${FACET_PAGE_BRIEF_HEADING}\n\n${options.pageBrief}`);
  return sections.join("\n\n");
}
