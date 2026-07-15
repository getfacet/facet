/**
 * Layers 1 and 2 of the reference-agent prompt: the Facet stage vocabulary,
 * tool workflow, operator assets, and deployer page brief.
 */
import { FACET_STAGE_TOOL_SPECS, buildFacetAgentSystemPrompt } from "@facet/agent-tools";
import type { FacetCatalog, FacetComposition, FacetTheme } from "@facet/core";

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
- Author any rows more than one view reuses once in the tree's "data" warehouse
  and bind views to it by name with "from" rather than repeating rows inline —
  for example a small milestones dataset shown as both a table and a chart that
  bind to the same dataset name, so updating it once refreshes both.
- Pre-draw two screens, "home" and "process", with an in-page navigation control
  between them. The process screen should show a short ordered flow:
  visitor shares context, assistant reshapes the page, next actions become
  clearer.
- When the visitor chats, update this page to match their request. Prefer small
  incremental edits that reuse existing node ids. Use chat only as a short
  acknowledgement alongside the page change.`;

/** Operator assets injected into prompt layer 2: themes offered to the model by
 * NAME and concrete native references it may inspect read-only by name. */
export interface PromptAssets {
  readonly themes: readonly FacetTheme[];
  readonly compositions: readonly FacetComposition[];
  readonly catalog?: FacetCatalog;
}

/** Layers 1 and 2: vocabulary, tool workflow, optional assets, and page brief. */
export function buildSystem(guide: string, assets?: PromptAssets): string {
  return buildFacetAgentSystemPrompt(
    assets === undefined ? { pageBrief: guide } : { pageBrief: guide, assets },
  );
}

/** Compatibility export for the stage tools the model drives. */
export const TOOLS: readonly ToolSpec[] = FACET_STAGE_TOOL_SPECS;
