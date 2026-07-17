import type { AuthorValidationResult, FacetTree } from "@facet/core";
import { errorResult } from "./executor-result.js";
import type { AgentToolObservationData, StageToolErrorResult } from "./types.js";

export type AuthorMutationTool = "render_page" | "append_node" | "set_node";

/**
 * Turns Core's bounded strict-author issues into the repair payload returned to
 * an agent. Rejected authoring never becomes a warning or a partial success.
 */
export function authorErrorResult(
  tool: AuthorMutationTool,
  validation: AuthorValidationResult<unknown>,
  shadow: FacetTree,
): StageToolErrorResult {
  const base = errorResult(
    tool,
    "invalid_authoring",
    `error: ${tool} rejected invalid authoring; no changes were applied.`,
    shadow,
    [],
    "Fix the reported paths using their allowed choices, then retry the whole call.",
  );
  const data: AgentToolObservationData = {
    ...base.observation.data,
    errors: validation.issues,
    omitted_error_count: validation.omittedErrorCount,
  } as AgentToolObservationData;
  return {
    ...base,
    observation: {
      status: "error",
      text: JSON.stringify(data),
      data,
    },
  };
}
