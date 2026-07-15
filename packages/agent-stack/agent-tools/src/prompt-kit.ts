import {
  MAX_DESCRIPTION_LENGTH,
  STAGE_SPEC,
  isValidThemeName,
  type FacetComposition,
} from "@facet/core";
import { selectCompositionReferences } from "./composition-references.js";
import type { StageToolAssets } from "./types.js";

export type FacetPromptAssets = StageToolAssets;

export interface FacetAgentSystemPromptOptions {
  readonly pageBrief: string;
  readonly assets?: FacetPromptAssets;
}

const MAX_PROMPT_ASSET_ITEMS = 1024;
const MAX_PROMPT_CATALOG_ITEMS = 64;
const MAX_PROMPT_METADATA_ITEMS = 16;

export const FACET_AGENT_ROLE_PROMPT =
  "You are the live agent behind a Facet page: you draw and edit the page with tools, and you chat briefly with its visitor.";

export const FACET_PAGE_EXPERIENCE_PROMPT = `PAGE EXPERIENCE
Default to a compact UX that is useful at first glance: focused sections, visible controls, and no decorative filler. If an active catalog says compactScreens:false, follow that catalog policy.
- The page is the primary answer. Use short chat only to acknowledge or clarify alongside a page change.
- Pre-draw screens, hidden panels, and form controls when the visitor should navigate or toggle without waiting for you.
- Keep forms and their submit controls visible together, with stable field names and concise labels.
- Events may report the visitor's current view (the screen they are on, which panels are toggled, and their device width and color scheme); target edits at the screen the visitor is actually viewing, and navigate them deliberately when a change belongs on another screen. An event's view.sort also reports the visitor's current per-table sort (the table's column and direction) so you can read back a sort they set locally.
- A box or text may carry an active look that turns on by itself against the visitor's current view: set "active" to a closed predicate — {"screen":"<screenName>"} (on only while that screen is current) or {"toggled":"<nodeId>"} (on only while that node is locally toggled shown) — plus "activeVariant":"<variantName>" (prefer this) or, as a fallback, an "activeStyle" of theme tokens to fold in when it matches. It is read-only: it re-styles purely on a local navigate/toggle with NO agent turn and writes no data or view-state, and an unknown predicate kind or a dangling screen/nodeId simply keeps the default look.`;

export const FACET_POLISHED_BRICK_GUIDANCE_PROMPT = `COMPONENT GUIDANCE
Use Facet's catalog-guided authoring order: component -> primitive fallback. Prefer intrinsic components with catalog-advertised variants; use primitive box/text/media/input/richtext only as the fallback for custom flow, copy, media, formatted prose, or raw input controls.
- Build product-quality defaults with section, card, button, tabs, nav, table, chart, metric, keyValue, progress, list, form, filterBar, emptyState, and loading when those components are allowed. "stat" is legacy compatibility; prefer metric for new KPI and summary values.
- Use input for raw inputs, button for actions, tabs/nav for local navigation, table/chart for display-only data, form/filterBar for input surfaces, and metric/keyValue/progress/list/emptyState/loading for compact product state before assembling equivalent box/text clusters. Build a status badge or an alert/callout from native components and primitives; for a visual separator there is no divider node, so use a thin bordered or spaced box. There is no standalone search node: for a search box with a submit, compose an input (input:"search") with a button whose onPress "collect" points at the container holding the input, so the typed query reaches you on submit.
- Use richtext for a flowing block of mixed-format prose instead of stitching many text nodes when copy needs inline emphasis or links. A richtext holds "blocks" (paragraph, heading, listItem, quote), each a list of "runs" — a text span with optional inline "marks". Marks are a closed set — bold, italic, underline, strike, code, and link; nothing else. A link mark's "target" is either an internal FacetAction (navigate/agent/toggle, routed through the same dispatch as button) or a gated external URL as { "href": "https://..." } — external hrefs allow only http(s)/protocol-relative/local paths, never javascript: or data:.
- Follow catalog policy while editing: when editBeforeAppend is true, update existing components and variants before appending new primitive clusters.
- Treat component recipes, reference-dataset internals, and concrete theme token values as renderer/operator internals, not stage syntax: never write raw CSS, token values, recipe part names as node fields, provider keys, visitor ids, secrets, or unknown asset fields into the page.`;

export const FACET_DATA_BINDING_PROMPT = `DATA BINDING
Author shared data once, then bind many views to it. Put rows the whole page reuses in the tree's top-level "data" warehouse: a map of dataset NAME -> an array of flat row records (each value a string, number, or boolean; no nested objects). Then bind a data-bearing node to a dataset by NAME with its "from" field instead of repeating the rows inline.
- "from" bindable nodes: table, chart, list, keyValue, metric, stat, and text. Set "from":"<datasetName>" and omit that node's own inline array (or scalar); "from" wins over inline.
- Projection is fixed per node type: a table shows the dataset rows and its own columns[].key pick the cells; a chart draws one series per NUMERIC column; a list and keyValue take the first columns in order; a metric, stat, or text reads ONE cell via "column":"<name>" plus an optional "row":<index> (defaults to 0) — a from-bound text prints that single cell instead of its inline "value".
- A table column may set sortable: true to let the visitor sort that table locally by clicking its header — a pure render-time reorder with no agent turn (it never mutates the dataset); the resulting column and direction ride back on the event's view.sort.
- Update a dataset once (or a single cell) and every node bound to it updates together — the reason to bind rather than duplicate rows.
- "from", "column", and dataset names are plain NAMES, never a URL, endpoint, query, expression, or resolver: there is no fetch, computed column, or formula. A "from" naming a missing dataset simply renders empty until you author that data.`;

export const FACET_STATE_EDITING_PROMPT = `STATE EDITING
Default to an edit-before-append strategy: edit before you append, reuse existing node ids, and change the smallest node that satisfies the request. If an active catalog says editBeforeAppend:false, follow that catalog policy.
- Use render_page only for the first paint or a major restructure.
- Use set_node, append_node, remove_node, or set_theme for incremental edits.
- For a complex UI, you may inspect one advertised reference with get_composition before editing. Skip the read for a simple UI.
- Reuse existing node ids so updates replace the right content instead of duplicating old sections.
- Never describe a page change in prose when you can make the change with a stage tool.`;

export const FACET_TOOL_PLAYBOOK_PROMPT = `TOOL PLAYBOOK
You build and edit the page by calling Facet stage tools.
- render_page: first paint, empty/near-empty current stage, or a major information architecture restructure.
- set_node: replace or update one existing node by id.
- append_node: add one new node under an existing container parent (box, section, card, or form).
- remove_node: delete a node that no longer belongs.
- get_composition: optionally read one advertised reference dataset by name, then author the stage separately with native stage tools. It does not edit the stage; skip it for a simple UI.
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
Operator assets are indexed with catalog policy, theme names and descriptions, and reference-dataset names and descriptions. Inspect a reference only through get_composition, then author ordinary native nodes. Never expose theme CSS values, provider keys, visitor ids, secrets, or unknown asset fields in the prompt or page.`;

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

function catalogComponentLine(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const type = assetName(value["type"]);
  if (type === undefined) return undefined;
  const variants = assetNameList(value["variants"]);
  const guidance = assetDescription(value["guidance"]);
  const variantText = variants.length > 0 ? ` variants: ${variants.join(", ")}` : "";
  const guidanceText = guidance !== undefined ? ` - ${guidance}` : "";
  return `${type}${variantText}${guidanceText}`;
}

function catalogComponentsLine(value: unknown, bricks: unknown): string | undefined {
  const source = assetArray(value).length > 0 ? value : bricks;
  const components = assetArray(source)
    .flatMap((component) => {
      const line = catalogComponentLine(component);
      return line === undefined ? [] : [line];
    })
    .slice(0, MAX_PROMPT_CATALOG_ITEMS);
  return components.length > 0 ? `allowed components: ${components.join("; ")}` : undefined;
}

function catalogCompositionsLine(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value["mode"] === "all") return "composition policy: all advertised compositions";
  if (value["mode"] !== "allow") return undefined;
  const names = assetNameList(value["names"]);
  return `composition policy: allow ${names.length > 0 ? names.join(", ") : "(none)"}`;
}

function catalogPolicyLines(value: unknown): readonly string[] {
  if (!isRecord(value)) return [];
  const lines: string[] = [];
  const order = Array.isArray(value["order"])
    ? value["order"].filter((item): item is string => item === "component" || item === "primitive")
    : [];
  if (order.length > 0) lines.push(`policy order: ${order.join(" -> ")}`);
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
  return `use order: component -> primitive fallback; ${editGuidance}; ${compactGuidance}.`;
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
  const components = catalogComponentsLine(catalog["components"], catalog["bricks"]);
  if (components !== undefined) lines.push(components);
  const compositions = catalogCompositionsLine(catalog["compositions"]);
  if (compositions !== undefined) lines.push(compositions);
  const primitiveFallback =
    catalog["primitiveFallback"] === "discouraged" || catalog["primitiveFallback"] === "allowed"
      ? catalog["primitiveFallback"]
      : undefined;
  if (primitiveFallback !== undefined) lines.push(`primitiveFallback: ${primitiveFallback}`);
  lines.push(...catalogPolicyLines(catalog["policy"]));
  lines.push(catalogUseOrderGuidance(catalog["policy"]));
  return [
    "CATALOG",
    "Active catalog guidance. Use these names and policies only; do not expose catalog internals or theme values.",
    lines.join("\n"),
  ].join("\n\n");
}

function compositionsSection(compositions: readonly FacetComposition[]): string | undefined {
  if (compositions.length === 0) return undefined;
  return [
    "COMPOSITIONS",
    "Reference datasets available by NAME. For a complex UI, you may call get_composition with exactly one listed name, inspect the concrete native nodes, then author the stage separately with native stage tools. The read does not edit the stage; skip it for a simple UI.",
    compositions
      .map((composition) => `- ${composition.name}: ${composition.metadata.description}`)
      .join("\n"),
  ].join("\n\n");
}

export function buildFacetAgentSystemPrompt(options: FacetAgentSystemPromptOptions): string {
  const sections = [
    FACET_AGENT_ROLE_PROMPT,
    STAGE_SPEC,
    FACET_PAGE_EXPERIENCE_PROMPT,
    FACET_POLISHED_BRICK_GUIDANCE_PROMPT,
    FACET_DATA_BINDING_PROMPT,
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

  const compositions = selectCompositionReferences(
    options.assets?.compositions ?? [],
    options.assets?.catalog,
  );
  const compositionBlock = compositionsSection(compositions);
  if (compositionBlock !== undefined) sections.push(compositionBlock);

  sections.push(`${FACET_PAGE_BRIEF_HEADING}\n\n${options.pageBrief}`);
  return sections.join("\n\n");
}
