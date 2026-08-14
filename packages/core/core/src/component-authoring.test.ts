import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { componentSemanticSignals, validateComponentAuthoring } from "./component-authoring.js";

const valid = {
  layout: {
    role: "layout",
    layoutPurpose: "responsive_grid",
    responsiveBehavior: "Reflows columns into one reading order on narrow containers.",
  },
  display: {
    role: "display",
    informationTypes: ["metric", "trend"],
    visualEmphasis: "primary",
  },
  action: {
    role: "action",
    interactionTypes: ["submit", "confirm"],
  },
  task: {
    role: "task",
    userIntents: ["compare_options", "choose_option"],
    outcomes: ["The visitor understands the meaningful differences.", "The visitor can choose."],
  },
} as const;

describe("component authoring metadata", () => {
  it("accepts, freezes, and preserves each exact role contract", () => {
    for (const [role, input] of Object.entries(valid)) {
      const result = validateComponentAuthoring(input);
      expect(result).toMatchObject({ ok: true, authoring: input });
      if (!result.ok) continue;
      expect(result.authoring.role).toBe(role);
      expect(Object.isFrozen(result.authoring)).toBe(true);
      for (const value of Object.values(result.authoring)) {
        if (Array.isArray(value)) expect(Object.isFrozen(value)).toBe(true);
      }
    }
  });

  it("derives only compact role-specific semantic signals", () => {
    expect(componentSemanticSignals(valid.layout)).toEqual(["responsive_grid"]);
    expect(componentSemanticSignals(valid.display)).toEqual(["metric", "trend"]);
    expect(componentSemanticSignals(valid.action)).toEqual(["submit", "confirm"]);
    expect(componentSemanticSignals(valid.task)).toEqual(["compare_options", "choose_option"]);
    expect(Object.isFrozen(componentSemanticSignals(valid.task))).toBe(true);
  });

  it.each([
    [null, "authoring_not_an_object", "authoring"],
    [{}, "invalid_authoring_role", "authoring.role"],
    [{ ...valid.layout, role: "container" }, "invalid_authoring_role", "authoring.role"],
    [{ ...valid.layout, extra: true }, "unknown_authoring_key", "authoring.extra"],
    [
      { ...valid.layout, layoutPurpose: "not valid" },
      "invalid_layout_purpose",
      "authoring.layoutPurpose",
    ],
    [
      { ...valid.layout, responsiveBehavior: "" },
      "invalid_responsive_behavior",
      "authoring.responsiveBehavior",
    ],
    [
      { ...valid.display, informationTypes: [] },
      "invalid_information_types",
      "authoring.informationTypes",
    ],
    [
      { ...valid.display, informationTypes: ["metric", "metric"] },
      "duplicate_information_type",
      "authoring.informationTypes[1]",
    ],
    [
      { ...valid.display, visualEmphasis: "loud" },
      "invalid_visual_emphasis",
      "authoring.visualEmphasis",
    ],
    [
      { ...valid.action, interactionTypes: ["not valid"] },
      "invalid_interaction_type",
      "authoring.interactionTypes[0]",
    ],
    [{ ...valid.task, userIntents: [] }, "invalid_user_intents", "authoring.userIntents"],
    [{ ...valid.task, outcomes: [] }, "invalid_outcomes", "authoring.outcomes"],
    [{ ...valid.task, outcomes: [""] }, "invalid_outcome", "authoring.outcomes[0]"],
    [
      { ...valid.task, outcomes: ["The visitor can choose.", "The visitor can choose."] },
      "duplicate_outcome",
      "authoring.outcomes[1]",
    ],
  ])("rejects %j as %s at %s", (input, code, at) => {
    const result = validateComponentAuthoring(input);
    expect(result.ok ? ["accepted", ""] : [result.code, result.at]).toEqual([code, at]);
  });

  it("enforces every authoring-specific count and text bound", () => {
    const tooManySignals = Array.from(
      { length: BOUNDS.componentAuthoringSignals + 1 },
      (_, index) => `signal_${String(index)}`,
    );
    const tooManyOutcomes = Array.from(
      { length: BOUNDS.componentAuthoringOutcomes + 1 },
      (_, index) => `Outcome ${String(index)}`,
    );
    const tooLong = "x".repeat(BOUNDS.componentAuthoringGuidanceChars + 1);

    expect(
      validateComponentAuthoring({ ...valid.action, interactionTypes: tooManySignals }),
    ).toMatchObject({
      ok: false,
      code: "too_many_interaction_types",
    });
    expect(validateComponentAuthoring({ ...valid.task, outcomes: tooManyOutcomes })).toMatchObject({
      ok: false,
      code: "too_many_outcomes",
    });
    expect(
      validateComponentAuthoring({ ...valid.layout, responsiveBehavior: tooLong }),
    ).toMatchObject({
      ok: false,
      code: "responsive_behavior_too_long",
    });
    expect(validateComponentAuthoring({ ...valid.task, outcomes: [tooLong] })).toMatchObject({
      ok: false,
      code: "outcome_too_long",
    });
  });

  it("is total for a hostile nested getter", () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "role", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(validateComponentAuthoring(hostile)).toEqual({
      ok: false,
      code: "authoring_read_failed",
      at: "authoring",
      detail: "Reading authoring metadata threw; it must be plain data.",
    });
  });
});
