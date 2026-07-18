import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "@facet/assets";
import { foldPatchIntoStage, validateAuthorTree } from "@facet/core";
import type { FacetTree } from "@facet/core";

import {
  LIFECYCLE_FIXTURE,
  LIFECYCLE_STATE_ORDER,
  LIFECYCLE_STATE_STEPS,
  LIFECYCLE_TRANSITIONS,
} from "./fixtures-state.js";

describe("lifecycle state fixture", () => {
  it("models loading empty error and result as valid ordered states", () => {
    expect(LIFECYCLE_STATE_ORDER).toEqual(["loading", "empty", "error", "result"]);
    expect(LIFECYCLE_STATE_STEPS.map((step) => step.state)).toEqual(LIFECYCLE_STATE_ORDER);
    expect(LIFECYCLE_FIXTURE.role).toBe("lifecycle-state");
    expect(LIFECYCLE_FIXTURE.initialState).toBe("loading");

    for (const step of LIFECYCLE_STATE_STEPS) {
      const validation = validateAuthorTree(step.tree, DEFAULT_THEME);
      expect(validation.issues, step.state).toEqual([]);
      expect(validation.omittedErrorCount, step.state).toBe(0);
      expect(validation.value, step.state).toEqual(step.tree);
      expect(Object.values(step.tree.nodes).every((node) => node.id.length > 0)).toBe(true);
    }

    let stage: FacetTree = LIFECYCLE_STATE_STEPS[0].tree;
    for (const transition of LIFECYCLE_TRANSITIONS) {
      expect(transition.from).toBe(
        LIFECYCLE_STATE_ORDER[LIFECYCLE_STATE_ORDER.indexOf(transition.to) - 1],
      );
      expect(transition.patches).toHaveLength(1);
      expect(transition.patches[0]).toMatchObject({ op: "replace", path: "" });

      const folded = foldPatchIntoStage(stage, transition.patches);
      expect(folded.issues, `${transition.from}->${transition.to}`).toEqual([]);
      expect(folded.mutated).toBe(true);
      expect(folded.rootReplaced).toBe(true);
      expect(folded.tree).toEqual(transition.tree);
      stage = folded.tree;
    }

    expect(stage).toEqual(LIFECYCLE_STATE_STEPS.at(-1)?.tree);
    expect(LIFECYCLE_FIXTURE.steps).toBe(LIFECYCLE_STATE_STEPS);
    expect(LIFECYCLE_FIXTURE.transitions).toBe(LIFECYCLE_TRANSITIONS);
  });
});
