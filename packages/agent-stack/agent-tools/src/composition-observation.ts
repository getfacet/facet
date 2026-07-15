import { formatAgentToolObservation, type AgentToolObservationInput } from "./observation.js";
import type { StageToolObservation } from "./types.js";

type CompositionObservationInput = Omit<AgentToolObservationInput, "data">;

/**
 * Preserve a validated composition reference exactly while reusing the generic
 * formatter for every envelope bound and coherence rule.
 *
 * This role-specific formatter is intentionally package-private: the generic
 * public formatter has no data-cap bypass.
 */
export function formatCompositionObservation(
  input: CompositionObservationInput,
  exactData: string,
): StageToolObservation {
  const bounded = formatAgentToolObservation(input);
  if (bounded.data === undefined) {
    throw new Error("formatAgentToolObservation returned no structured data");
  }

  const data = { ...bounded.data, data: exactData };
  return { status: bounded.status, data, text: JSON.stringify(data) };
}
