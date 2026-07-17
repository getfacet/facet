import { formatAgentToolObservation, type AgentToolObservationInput } from "./observation.js";
import type { StageToolObservation } from "./types.js";

type AssetObservationInput = Omit<AgentToolObservationInput, "data">;

/**
 * Preserve one exact validated asset payload while reusing the generic
 * formatter for every envelope bound and coherence rule.
 *
 * This formatter is package-private: only validated, snapshot-backed Brick,
 * local style-choice, Preset, and Pattern reads may bypass the generic
 * data-size cap.
 */
export function formatAssetObservation(
  input: AssetObservationInput,
  exactData: string,
): StageToolObservation {
  const bounded = formatAgentToolObservation(input);
  if (bounded.data === undefined) {
    throw new Error("formatAgentToolObservation returned no structured data");
  }

  const data = { ...bounded.data, data: exactData };
  return { status: bounded.status, data, text: JSON.stringify(data) };
}
