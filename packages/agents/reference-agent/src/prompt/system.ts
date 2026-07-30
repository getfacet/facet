import { FACET_PROMPT_KIT, FACET_TOOL_SPECS } from "@facet/agent-tools";
import type { FacetToolSpec } from "@facet/agent-tools";

/** Built-in sample brief used when the deployer passes no `--guide`. */
export const DEFAULT_GUIDE = `# Northstar Studio live intake page

Build a compact page for Northstar Studio, an AI product-planning assistant
that helps founders turn a rough idea into a focused launch plan.

- On first contact, render a concise hero and a short intake path.
- Keep the page focused on clarifying the goal, first workflow, and next
  experiment.
- When the visitor interacts, update the page through declarative markup and
  keep final prose short.`;

export function buildSystem(guide: string): string {
  const pageBrief =
    typeof guide === "string" && guide.trim().length > 0 ? guide.trim() : DEFAULT_GUIDE;
  return `${FACET_PROMPT_KIT}\n\nPAGE BRIEF\n${pageBrief}`;
}

export const TOOLS: readonly FacetToolSpec[] = FACET_TOOL_SPECS;
