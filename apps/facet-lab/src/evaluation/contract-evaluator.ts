import { validateAuthorTree, type FacetTheme } from "@facet/core";

import type {
  OfficialScenario,
  ScenarioConstraint,
  ScenarioExpectedAssets,
} from "../scenarios/scenarios.js";
import { COLOR_MODES, VIEWPORTS, type ContractCheckV1 } from "../shared/run-contract.js";

export const CONTRACT_CHECK_IDS = [
  "stage-validity",
  "scenario-assets",
  "scenario-interactions",
  "scenario-mutations",
  "asset-constraint",
  "trace-completeness",
  "view-provenance",
] as const;
export type ContractCheckId = (typeof CONTRACT_CHECK_IDS)[number];

export const MAX_CONTRACT_FACT_ITEMS = 512;
export const MAX_CONTRACT_FACT_CODE_UNITS = 200;

export interface ContractAssetInventory {
  readonly bricks: readonly string[];
  readonly presets: readonly { readonly brick: string; readonly name: string }[];
  readonly patterns: readonly string[];
}

export interface ContractTraceFacts {
  readonly prompt: boolean;
  readonly assetReads: boolean;
  readonly toolCalls: boolean;
  readonly validation: boolean;
  readonly stageVersions: boolean;
}

export interface ContractViewProvenance {
  readonly viewport: string;
  readonly colorMode: string;
}

export interface ContractEvaluationInput {
  readonly scenario: OfficialScenario;
  readonly theme: FacetTheme;
  readonly finalTree: unknown;
  readonly availableAssets: ContractAssetInventory;
  readonly usedAssets: ContractAssetInventory;
  readonly observedActionNames: readonly string[];
  readonly stageMutations: number;
  readonly constraint: ScenarioConstraint | null;
  readonly trace: ContractTraceFacts;
  readonly view: ContractViewProvenance | null;
}

export type ContractVerdict = "pass" | "fail";

export interface ContractEvaluationResult {
  readonly scenarioId: string;
  readonly verdict: ContractVerdict;
  readonly checks: readonly ContractCheckV1[];
  readonly blockingFailureIds: readonly ContractCheckId[];
}

interface InventoryProjection {
  readonly valid: boolean;
  readonly bricks: ReadonlySet<string>;
  readonly presets: ReadonlySet<string>;
  readonly patterns: ReadonlySet<string>;
}

type DeterministicContractCheck = ContractCheckV1 & { readonly id: ContractCheckId };

function isBoundedName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CONTRACT_FACT_CODE_UNITS &&
    value.trim() === value
  );
}

function projectInventory(input: ContractAssetInventory): InventoryProjection {
  if (
    !Array.isArray(input.bricks) ||
    !Array.isArray(input.presets) ||
    !Array.isArray(input.patterns) ||
    input.bricks.length + input.presets.length + input.patterns.length > MAX_CONTRACT_FACT_ITEMS
  ) {
    return { valid: false, bricks: new Set(), presets: new Set(), patterns: new Set() };
  }

  const bricks = new Set<string>();
  const presets = new Set<string>();
  const patterns = new Set<string>();
  for (const brick of input.bricks) {
    if (!isBoundedName(brick)) {
      return { valid: false, bricks: new Set(), presets: new Set(), patterns: new Set() };
    }
    bricks.add(brick);
  }
  for (const preset of input.presets) {
    if (
      typeof preset !== "object" ||
      preset === null ||
      !isBoundedName(preset.brick) ||
      !isBoundedName(preset.name)
    ) {
      return { valid: false, bricks: new Set(), presets: new Set(), patterns: new Set() };
    }
    presets.add(`${preset.brick}:${preset.name}`);
  }
  for (const pattern of input.patterns) {
    if (!isBoundedName(pattern)) {
      return { valid: false, bricks: new Set(), presets: new Set(), patterns: new Set() };
    }
    patterns.add(pattern);
  }
  return { valid: true, bricks, presets, patterns };
}

function hasExpectedAssets(
  expected: ScenarioExpectedAssets,
  observed: InventoryProjection,
): boolean {
  return (
    observed.valid &&
    expected.bricks.every((brick) => observed.bricks.has(brick)) &&
    expected.presets.every(({ brick, name }) => observed.presets.has(`${brick}:${name}`)) &&
    expected.patterns.every((pattern) => observed.patterns.has(pattern))
  );
}

function constraintKey(constraint: ScenarioConstraint): {
  readonly kind: "bricks" | "presets" | "patterns";
  readonly key: string;
} {
  switch (constraint.kind) {
    case "brick":
      return { kind: "bricks", key: constraint.brick };
    case "preset":
      return { kind: "presets", key: `${constraint.brick}:${constraint.name}` };
    case "pattern":
      return { kind: "patterns", key: constraint.name };
  }
}

function inventoryHas(
  inventory: InventoryProjection,
  target: ReturnType<typeof constraintKey>,
): boolean {
  return inventory[target.kind].has(target.key);
}

function check(
  id: ContractCheckId,
  label: string,
  status: ContractCheckV1["status"],
  details: string | null,
): DeterministicContractCheck {
  return Object.freeze({ id, label, status, blocking: true, details });
}

function stageCheck(input: ContractEvaluationInput): DeterministicContractCheck {
  if (input.finalTree === null || input.finalTree === undefined) {
    return check(
      "stage-validity",
      "Final stage is valid",
      "unavailable",
      "No final stage was available for deterministic validation.",
    );
  }
  const result = validateAuthorTree(input.finalTree, input.theme);
  return result.value === undefined || result.issues.length > 0 || result.omittedErrorCount > 0
    ? check(
        "stage-validity",
        "Final stage is valid",
        "fail",
        "The final stage failed strict Facet validation.",
      )
    : check("stage-validity", "Final stage is valid", "pass", null);
}

function actionCheck(input: ContractEvaluationInput): DeterministicContractCheck {
  if (
    !Array.isArray(input.observedActionNames) ||
    input.observedActionNames.length > MAX_CONTRACT_FACT_ITEMS ||
    !input.observedActionNames.every(isBoundedName)
  ) {
    return check(
      "scenario-interactions",
      "Scenario interactions were observed",
      "fail",
      "Interaction evidence was invalid or exceeded its bound.",
    );
  }
  const observed = new Set(input.observedActionNames);
  return input.scenario.expectedOutcomes.actionNames.every((name) => observed.has(name))
    ? check("scenario-interactions", "Scenario interactions were observed", "pass", null)
    : check(
        "scenario-interactions",
        "Scenario interactions were observed",
        "fail",
        "Required scenario interactions were not observed.",
      );
}

function mutationCheck(input: ContractEvaluationInput): DeterministicContractCheck {
  return Number.isSafeInteger(input.stageMutations) &&
    input.stageMutations >= input.scenario.expectedOutcomes.stageMutations
    ? check("scenario-mutations", "Scenario stage mutations were accepted", "pass", null)
    : check(
        "scenario-mutations",
        "Scenario stage mutations were accepted",
        "fail",
        "The scenario did not produce enough accepted stage mutations.",
      );
}

function constraintCheck(
  input: ContractEvaluationInput,
  available: InventoryProjection,
  used: InventoryProjection,
): DeterministicContractCheck {
  if (input.constraint === null) {
    return check("asset-constraint", "Asset constraint was satisfied", "pass", null);
  }
  if (!available.valid || !used.valid) {
    return check(
      "asset-constraint",
      "Asset constraint was satisfied",
      "fail",
      "Asset constraint evidence was invalid or exceeded its bound.",
    );
  }
  const target = constraintKey(input.constraint);
  if (!inventoryHas(available, target)) {
    return check(
      "asset-constraint",
      "Asset constraint was satisfied",
      "fail",
      "The requested asset constraint is unavailable.",
    );
  }
  return inventoryHas(used, target)
    ? check("asset-constraint", "Asset constraint was satisfied", "pass", null)
    : check(
        "asset-constraint",
        "Asset constraint was satisfied",
        "fail",
        "The requested asset constraint was not used.",
      );
}

function traceCheck(trace: ContractTraceFacts): DeterministicContractCheck {
  return trace.prompt &&
    trace.assetReads &&
    trace.toolCalls &&
    trace.validation &&
    trace.stageVersions
    ? check("trace-completeness", "Correlated trace is complete", "pass", null)
    : check(
        "trace-completeness",
        "Correlated trace is complete",
        "fail",
        "Required correlated trace evidence is incomplete.",
      );
}

function viewCheck(view: ContractViewProvenance | null): DeterministicContractCheck {
  if (view === null) {
    return check(
      "view-provenance",
      "View provenance is available",
      "unavailable",
      "Viewport or color-mode provenance was unavailable.",
    );
  }
  const viewportValid = VIEWPORTS.some((viewport) => viewport === view.viewport);
  const colorModeValid = COLOR_MODES.some((colorMode) => colorMode === view.colorMode);
  return viewportValid && colorModeValid
    ? check("view-provenance", "View provenance is available", "pass", null)
    : check(
        "view-provenance",
        "View provenance is available",
        "fail",
        "Viewport or color-mode provenance was invalid.",
      );
}

export function evaluateContract(input: ContractEvaluationInput): ContractEvaluationResult {
  const available = projectInventory(input.availableAssets);
  const used = projectInventory(input.usedAssets);
  const checks = Object.freeze([
    stageCheck(input),
    hasExpectedAssets(input.scenario.expectedAssets, used)
      ? check("scenario-assets", "Scenario assets were observed", "pass", null)
      : check(
          "scenario-assets",
          "Scenario assets were observed",
          "fail",
          "Required scenario assets were not observed.",
        ),
    actionCheck(input),
    mutationCheck(input),
    constraintCheck(input, available, used),
    traceCheck(input.trace),
    viewCheck(input.view),
  ] satisfies readonly DeterministicContractCheck[]);
  const blockingFailureIds = Object.freeze(
    checks.flatMap(({ id, status }) => (status === "pass" ? [] : [id])),
  );

  return Object.freeze({
    scenarioId: input.scenario.id,
    verdict: blockingFailureIds.length === 0 ? "pass" : "fail",
    checks,
    blockingFailureIds,
  });
}
