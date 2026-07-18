import { DEFAULT_THEME } from "@facet/assets";
import { foldPatchIntoStage, type FacetTree } from "@facet/core";
import { describe, expect, it } from "vitest";

import { OFFICIAL_SCENARIOS } from "../scenarios/scenarios.js";
import {
  CONTRACT_CHECK_IDS,
  evaluateContract,
  type ContractEvaluationInput,
} from "./contract-evaluator.js";

function finalFixtureTree(): FacetTree {
  const scenario = OFFICIAL_SCENARIOS[0];
  if (scenario === undefined) throw new Error("Expected an official scenario.");
  let tree: FacetTree | undefined;
  for (const step of scenario.fixture.providerSteps) {
    if (step.output.kind === "render") tree = step.output.tree;
    else if (tree !== undefined) tree = foldPatchIntoStage(tree, step.output.patches).tree;
  }
  if (tree === undefined) throw new Error("Expected a rendered fixture tree.");
  return tree;
}

function passingInput(): ContractEvaluationInput {
  const scenario = OFFICIAL_SCENARIOS[0];
  const pattern = scenario?.expectedAssets.patterns[0];
  if (scenario === undefined || pattern === undefined) throw new Error("Expected scenario assets.");
  return {
    scenario,
    theme: DEFAULT_THEME,
    finalTree: finalFixtureTree(),
    availableAssets: scenario.expectedAssets,
    usedAssets: scenario.expectedAssets,
    observedActionNames: scenario.expectedOutcomes.actionNames,
    stageMutations: scenario.expectedOutcomes.stageMutations,
    constraint: { kind: "pattern", name: pattern },
    trace: {
      prompt: true,
      assetReads: true,
      toolCalls: true,
      validation: true,
      stageVersions: true,
    },
    view: { viewport: "desktop", colorMode: "light" },
  };
}

describe("evaluateContract", () => {
  it("keeps advisory visual evidence out of the contract verdict", () => {
    const passing = evaluateContract(passingInput());

    expect(passing.verdict).toBe("pass");
    expect(passing.checks.map(({ id }) => id)).toEqual(CONTRACT_CHECK_IDS);
    expect(passing.checks.every(({ blocking, status }) => blocking && status === "pass")).toBe(
      true,
    );
    expect(passing.blockingFailureIds).toEqual([]);
    expect(Object.isFrozen(passing)).toBe(true);
    expect(Object.isFrozen(passing.checks)).toBe(true);

    const failed = evaluateContract({
      ...passingInput(),
      usedAssets: { bricks: ["box"], presets: [], patterns: [] },
      observedActionNames: [],
      stageMutations: 0,
      trace: {
        prompt: true,
        assetReads: false,
        toolCalls: false,
        validation: true,
        stageVersions: false,
      },
    });

    expect(failed.verdict).toBe("fail");
    expect(failed.blockingFailureIds).toEqual([
      "scenario-assets",
      "scenario-interactions",
      "scenario-mutations",
      "asset-constraint",
      "trace-completeness",
    ]);
    expect(failed.checks.filter(({ status }) => status !== "pass")).toEqual([
      expect.objectContaining({
        id: "scenario-assets",
        status: "fail",
        details: "Required scenario assets were not observed.",
      }),
      expect.objectContaining({
        id: "scenario-interactions",
        status: "fail",
        details: "Required scenario interactions were not observed.",
      }),
      expect.objectContaining({
        id: "scenario-mutations",
        status: "fail",
        details: "The scenario did not produce enough accepted stage mutations.",
      }),
      expect.objectContaining({
        id: "asset-constraint",
        status: "fail",
        details: "The requested asset constraint was not used.",
      }),
      expect.objectContaining({
        id: "trace-completeness",
        status: "fail",
        details: "Required correlated trace evidence is incomplete.",
      }),
    ]);
  });

  it("fails closed on invalid trees, unavailable constraints, and missing view provenance", () => {
    const input = passingInput();
    const result = evaluateContract({
      ...input,
      finalTree: { root: "missing", nodes: {} },
      availableAssets: { bricks: [], presets: [], patterns: [] },
      view: null,
    });

    expect(result.verdict).toBe("fail");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "stage-validity", status: "fail" }),
        expect.objectContaining({
          id: "asset-constraint",
          status: "fail",
          details: "The requested asset constraint is unavailable.",
        }),
        expect.objectContaining({ id: "view-provenance", status: "unavailable" }),
      ]),
    );
  });
});
