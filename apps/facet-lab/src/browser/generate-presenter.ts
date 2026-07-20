import {
  FREE_FORM_SCENARIO,
  OFFICIAL_SCENARIOS,
  evaluateScenarioConstraint,
  type OfficialScenario,
  type ScenarioConstraint,
  type ScenarioConstraintOutcome,
} from "../scenarios/scenarios.js";
import type { RunConfiguration } from "../shared/run-contract.js";
import type { BrowserCreatedRun } from "./api-client.js";
import {
  defaultProviderConfiguration,
  validateRunConfiguration,
  type LabCapabilities,
  type RunConfigurationIssue,
  type RunConfigurationIssueCode,
} from "./run-config.js";

export type GenerateScenarioKind = "official" | "free-form";
export type GenerateConstraintOutcome = "autonomous" | "pending" | ScenarioConstraintOutcome;

export type GenerateReadinessIssueCode =
  RunConfigurationIssueCode | "prompt-required" | "constraint-unmet" | "constraint-unavailable";

export interface GenerateReadinessIssue {
  readonly code: GenerateReadinessIssueCode;
  readonly field: RunConfigurationIssue["field"];
  readonly message: string;
}

export interface GenerateReadiness {
  readonly ready: boolean;
  readonly configuration: RunConfiguration | null;
  readonly issues: readonly GenerateReadinessIssue[];
  readonly scenarioKind: GenerateScenarioKind | null;
  readonly constraintOutcome: GenerateConstraintOutcome;
}

export type GenerateScenarioSelection = OfficialScenario | typeof FREE_FORM_SCENARIO | "free-form";

export type RunActivationResult =
  | {
      readonly ok: true;
      readonly activation: number;
      readonly run: BrowserCreatedRun;
    }
  | {
      readonly ok: false;
      readonly reason: "activation-in-flight" | "duplicate-run-identity";
    };

export interface RunActivationGate {
  start(configuration: RunConfiguration): Promise<RunActivationResult>;
  isStarting(): boolean;
}

function readinessIssue(
  code: GenerateReadinessIssueCode,
  field: GenerateReadinessIssue["field"],
  message: string,
): GenerateReadinessIssue {
  return Object.freeze({ code, field, message });
}

export function parseScenarioConstraint(value: string): ScenarioConstraint | null {
  const parts = value.split(":");
  if (parts[0] === "brick" && parts.length === 2 && parts[1] !== "") {
    return Object.freeze({ kind: "brick", brick: parts[1]! });
  }
  if (parts[0] === "pattern" && parts.length === 2 && parts[1] !== "") {
    return Object.freeze({ kind: "pattern", name: parts[1]! });
  }
  if (parts[0] === "preset" && parts.length === 3 && parts[1] !== "" && parts[2] !== "") {
    return Object.freeze({ kind: "preset", brick: parts[1]!, name: parts[2]! });
  }
  return null;
}

function describeConstraint(constraint: ScenarioConstraint): string {
  if (constraint.kind === "brick") return `${constraint.brick} Brick`;
  if (constraint.kind === "pattern") return `${constraint.name} Pattern`;
  return `${constraint.name} ${constraint.brick} Preset`;
}

function selectedScenario(
  scenarioId: string,
  scenarios: readonly OfficialScenario[],
): OfficialScenario | typeof FREE_FORM_SCENARIO | undefined {
  if (scenarioId === FREE_FORM_SCENARIO.id) return FREE_FORM_SCENARIO;
  return scenarios.find(({ id }) => id === scenarioId);
}

export function createGenerateDraft(
  capabilities: LabCapabilities,
  selection: GenerateScenarioSelection = OFFICIAL_SCENARIOS[0]!,
): RunConfiguration {
  const scenario = selection === "free-form" ? FREE_FORM_SCENARIO : selection;
  return Object.freeze({
    ...defaultProviderConfiguration(capabilities),
    scenarioId: scenario.id,
    prompt: scenario.prompt,
    constraint: null,
    viewport: "desktop",
    colorMode: "light",
  });
}

/**
 * Projects all browser-known blockers without weakening the server's authoritative checks.
 * A free-form constraint remains pending until post-run evaluation; an official fixture can
 * explain a known-unmet constraint before spending a provider call.
 */
export function projectGenerateReadiness(
  candidate: RunConfiguration,
  capabilities: LabCapabilities,
  scenarios: readonly OfficialScenario[] = OFFICIAL_SCENARIOS,
): GenerateReadiness {
  const knownScenarioIds = [...scenarios.map(({ id }) => id), FREE_FORM_SCENARIO.id];
  const validation = validateRunConfiguration(candidate, capabilities, knownScenarioIds);
  const issues: GenerateReadinessIssue[] = validation.ok
    ? []
    : validation.issues.map(({ code, field, message }) => readinessIssue(code, field, message));
  const scenario = selectedScenario(candidate.scenarioId, scenarios);
  const scenarioKind =
    scenario === undefined
      ? null
      : scenario.official
        ? ("official" as const)
        : ("free-form" as const);

  if (candidate.prompt.trim().length === 0) {
    issues.push(
      readinessIssue("prompt-required", "prompt", "Enter a prompt before starting the run."),
    );
  }

  let constraintOutcome: GenerateConstraintOutcome = "autonomous";
  if (candidate.constraint !== null) {
    const constraint = parseScenarioConstraint(candidate.constraint);
    if (constraint !== null && scenario !== undefined) {
      if (!scenario.official) {
        constraintOutcome = "pending";
      } else {
        constraintOutcome = evaluateScenarioConstraint(scenario, constraint);
        if (constraintOutcome === "unmet") {
          issues.push(
            readinessIssue(
              "constraint-unmet",
              "constraint",
              `${describeConstraint(constraint)} is not used by the ${scenario.name} scenario. Choose a matching scenario or run autonomously.`,
            ),
          );
        } else if (constraintOutcome === "unknown") {
          issues.push(
            readinessIssue(
              "constraint-unavailable",
              "constraint",
              `${describeConstraint(constraint)} is not available in the package-default assets.`,
            ),
          );
        }
      }
    }
  }

  const ready = validation.ok && issues.length === 0;
  return Object.freeze({
    ready,
    configuration: ready && validation.ok ? validation.value : null,
    issues: Object.freeze(issues),
    scenarioKind,
    constraintOutcome,
  });
}

/**
 * Coalesces only one in-flight UI activation. Once it settles, another deliberate activation
 * must ask the server for a new identity; a repeated identity is rejected before it reaches UI.
 */
export function createRunActivationGate(
  createRun: (configuration: RunConfiguration) => Promise<BrowserCreatedRun>,
): RunActivationGate {
  let starting = false;
  let activation = 0;
  const seenRunIds = new Set<string>();

  return Object.freeze({
    async start(configuration: RunConfiguration): Promise<RunActivationResult> {
      if (starting) return Object.freeze({ ok: false, reason: "activation-in-flight" });
      starting = true;
      activation += 1;
      try {
        const run = await createRun(configuration);
        if (seenRunIds.has(run.runId)) {
          return Object.freeze({ ok: false, reason: "duplicate-run-identity" });
        }
        seenRunIds.add(run.runId);
        return Object.freeze({ ok: true, activation, run });
      } finally {
        starting = false;
      }
    },
    isStarting: () => starting,
  });
}
