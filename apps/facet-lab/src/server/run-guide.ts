import type { ScenarioConstraint, OfficialScenario } from "../scenarios/scenarios.js";
import { MAX_PROMPT_CODE_UNITS, MAX_RUN_GUIDE_CODE_UNITS } from "../shared/run-contract.js";

export interface RunGuideOptions {
  readonly scenario: Pick<OfficialScenario, "id" | "name" | "prompt">;
  readonly prompt: string;
  readonly constraint: ScenarioConstraint | null;
}

function constraintInstruction(constraint: ScenarioConstraint | null): string {
  if (constraint === null) return "No additional asset constraint is active.";
  if (constraint.kind === "brick") {
    return `Demonstrate the exact ${JSON.stringify(constraint.brick)} Brick where appropriate.`;
  }
  if (constraint.kind === "pattern") {
    return `Inspect and adapt the exact ${JSON.stringify(constraint.name)} Pattern.`;
  }
  return `Use the exact ${JSON.stringify(constraint.name)} Preset owned by the ${JSON.stringify(constraint.brick)} Brick.`;
}

/** Builds the bounded operator guide passed to the public reference agent. */
export function buildRunGuide(options: RunGuideOptions): string {
  if (options.prompt.trim().length === 0 || options.prompt.length > MAX_PROMPT_CODE_UNITS) {
    throw new Error(`run prompt must contain 1–${String(MAX_PROMPT_CODE_UNITS)} code units`);
  }

  const guide = [
    "You are running inside Facet Lab. Author only validated Facet Bricks and patches.",
    `Scenario: ${options.scenario.name} (${options.scenario.id}).`,
    `Official scenario brief: ${options.scenario.prompt}`,
    `Run prompt: ${options.prompt}`,
    `Constraint: ${constraintInstruction(options.constraint)}`,
    "Keep the result concise and faithful to the requested scenario state.",
  ].join("\n");

  if (guide.length > MAX_RUN_GUIDE_CODE_UNITS) {
    throw new Error(`run guide exceeded ${String(MAX_RUN_GUIDE_CODE_UNITS)} code units`);
  }
  return guide;
}
