import { readFileSync } from "node:fs";

import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import { foldPatchIntoStage, validateAuthorTree, type FacetTree } from "@facet/core";
import { describe, expect, it } from "vitest";

import { LIFECYCLE_FIXTURE, LIFECYCLE_STATE_ORDER } from "./fixtures-state.js";
import {
  FREE_FORM_SCENARIO,
  OFFICIAL_SCENARIO_CAPABILITIES,
  OFFICIAL_SCENARIOS,
  SCENARIO_CONSTRAINT_CASES,
  evaluateScenarioConstraint,
} from "./scenarios.js";

function agentActionNames(tree: FacetTree): readonly string[] {
  return Object.values(tree.nodes).flatMap((node) => {
    if (node.type !== "box") return [];
    return [node.onPress, node.onHold].flatMap((action) =>
      action !== undefined && (action.kind === undefined || action.kind === "agent")
        ? [action.name]
        : [],
    );
  });
}

describe("official Facet Lab scenarios", () => {
  it("covers every official capability and constraint outcome", () => {
    expect(OFFICIAL_SCENARIO_CAPABILITIES).toEqual([
      "marketing",
      "analytics",
      "data-operations",
      "settings-form",
      "documentation",
      "product-list-detail",
      "support-triage",
      "lifecycle",
    ]);
    expect(OFFICIAL_SCENARIOS).toHaveLength(8);
    expect(OFFICIAL_SCENARIOS.map(({ capability }) => capability)).toEqual(
      OFFICIAL_SCENARIO_CAPABILITIES,
    );
    expect(new Set(OFFICIAL_SCENARIOS.map(({ id }) => id)).size).toBe(8);
    expect(new Set(OFFICIAL_SCENARIOS.map(({ fixture }) => fixture.role))).toEqual(
      new Set(["marketing-content", "data-workflow", "product-workflow", "lifecycle-state"]),
    );

    const knownPatterns = new Set(DEFAULT_PATTERNS.map(({ name }) => name));
    for (const scenario of OFFICIAL_SCENARIOS) {
      expect(scenario.prompt.length, scenario.id).toBeGreaterThan(0);
      expect(scenario.fixture.providerSteps[0], scenario.id).toMatchObject({
        phase: "initial",
        output: { kind: "render" },
      });
      expect(
        new Set(scenario.fixture.providerSteps.map(({ phase }) => phase)),
        scenario.id,
      ).toEqual(new Set(["initial", "ui-in", "follow-up"]));

      let tree: FacetTree | undefined;
      const trees: FacetTree[] = [];
      for (const step of scenario.fixture.providerSteps) {
        if (step.output.kind === "render") {
          tree = step.output.tree;
        } else {
          if (tree === undefined) throw new Error(`${scenario.id} patched before rendering.`);
          const folded = foldPatchIntoStage(tree, step.output.patches);
          expect(folded.issues, `${scenario.id}:${step.id}`).toEqual([]);
          expect(folded.mutated, `${scenario.id}:${step.id}`).toBe(true);
          tree = folded.tree;
        }
        const validation = validateAuthorTree(tree, DEFAULT_THEME);
        expect(validation.issues, `${scenario.id}:${step.id}`).toEqual([]);
        expect(validation.omittedErrorCount, `${scenario.id}:${step.id}`).toBe(0);
        trees.push(tree);
      }

      const seenBricks = new Set(
        trees.flatMap((current) => Object.values(current.nodes).map(({ type }) => type)),
      );
      const seenPresets = new Set(
        trees.flatMap((current) =>
          Object.values(current.nodes).flatMap((node) =>
            node.style?.preset === undefined ? [] : [`${node.type}:${node.style.preset}`],
          ),
        ),
      );
      const seenActions = new Set(trees.flatMap(agentActionNames));

      for (const brick of scenario.expectedAssets.bricks) {
        expect(seenBricks.has(brick), `${scenario.id}:${brick}`).toBe(true);
      }
      for (const preset of scenario.expectedAssets.presets) {
        expect(DEFAULT_THEME.presets?.[preset.brick]?.[preset.name], scenario.id).toBeDefined();
        expect(seenPresets.has(`${preset.brick}:${preset.name}`), scenario.id).toBe(true);
      }
      for (const pattern of scenario.expectedAssets.patterns) {
        expect(knownPatterns.has(pattern), `${scenario.id}:${pattern}`).toBe(true);
      }
      for (const actionName of scenario.expectedOutcomes.actionNames) {
        expect(seenActions.has(actionName), `${scenario.id}:${actionName}`).toBe(true);
      }
      expect(scenario.expectedOutcomes.stageMutations).toBe(
        scenario.fixture.providerSteps.length - 1,
      );

      const serialized = JSON.stringify(scenario.fixture);
      expect(serialized).not.toMatch(/<script|javascript:|position\s*:/iu);
    }

    const lifecycle = OFFICIAL_SCENARIOS.find(({ capability }) => capability === "lifecycle");
    expect(lifecycle?.fixture.source).toBe(LIFECYCLE_FIXTURE);
    expect(lifecycle?.expectedOutcomes.states).toEqual(LIFECYCLE_STATE_ORDER);

    expect(FREE_FORM_SCENARIO).toMatchObject({
      id: "free-form",
      official: false,
      fixture: null,
    });
    expect(FREE_FORM_SCENARIO.prompt).toBe("");

    expect(new Set(SCENARIO_CONSTRAINT_CASES.map(({ expected }) => expected))).toEqual(
      new Set(["satisfied", "unmet", "unknown"]),
    );
    for (const constraintCase of SCENARIO_CONSTRAINT_CASES) {
      const scenario = OFFICIAL_SCENARIOS.find(({ id }) => id === constraintCase.scenarioId);
      if (scenario === undefined) throw new Error(`Unknown scenario ${constraintCase.scenarioId}.`);
      expect(
        evaluateScenarioConstraint(scenario, constraintCase.constraint),
        constraintCase.id,
      ).toBe(constraintCase.expected);
    }

    const productSource = readFileSync(new URL("./fixtures-product.ts", import.meta.url), "utf8");
    for (const stateStep of LIFECYCLE_FIXTURE.steps) {
      for (const text of Object.values(stateStep.tree.nodes).flatMap((node) =>
        node.type === "text" ? [node.value] : [],
      )) {
        expect(productSource).not.toContain(text);
      }
    }
  });
});
