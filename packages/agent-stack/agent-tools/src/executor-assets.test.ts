import { DEFAULT_CATALOG, type FacetComposition, type FacetTree } from "@facet/core";
import { describe, expect, it } from "vitest";
import { selectCompositionReferences } from "./composition-references.js";
import { executeStageTool } from "./executor.js";

const SHADOW: FacetTree = {
  root: "stage-root",
  nodes: {
    "stage-root": { id: "stage-root", type: "box", children: ["existing"] },
    existing: { id: "existing", type: "text", value: "Existing stage copy" },
  },
};

const HERO_REFERENCE: FacetComposition = {
  name: "hero",
  metadata: {
    description: "A compact hero reference.",
    category: "marketing",
    variants: ["compact"],
    repeatable: false,
    followUpEdits: ["Replace the example copy."],
  },
  root: "hero-root",
  nodes: {
    "hero-root": { id: "hero-root", type: "box", children: ["hero-copy"] },
    "hero-copy": { id: "hero-copy", type: "text", value: "Try Facet" },
  },
};

function expectZeroStageEffects(result: ReturnType<typeof executeStageTool>): void {
  expect(result.messages).toEqual([]);
  expect(result.patches).toEqual([]);
  expect(result.changedNodeIds).toEqual([]);
  expect(result.patchCount).toBe(0);
  expect(result.summary).toBe("no stage changes");
  expect(result.shadow).toBe(SHADOW);
}

describe("composition asset executor", () => {
  it("returns exact composition without stage effects", () => {
    const selected = selectCompositionReferences([HERO_REFERENCE]);
    const expected = selected[0];
    expect(expected).toBeDefined();

    const result = executeStageTool(
      { name: "get_composition", input: { name: "hero" } },
      { shadow: SHADOW, assets: { compositions: selected } },
    );

    expect(result.status).toBe("ok");
    expectZeroStageEffects(result);
    expect(result.issues).toEqual([]);
    expect(result.observation.data).toMatchObject({
      tool: "get_composition",
      status: "ok",
      outcome: "no_stage_change",
      applied: false,
      stage_changed: false,
      visible_to_visitor: false,
      patch_count: 0,
      changed_node_ids: [],
      data: expect.any(String),
    });
    const serialized = result.observation.data?.data;
    expect(serialized).toBeDefined();
    expect(JSON.parse(serialized ?? "null")).toEqual(expected);
  });

  it("rejects malformed input with no stage effects", () => {
    const hostileInput = Object.defineProperty({}, "name", {
      enumerable: true,
      get() {
        throw new Error("hostile name getter");
      },
    });
    const inputs: readonly unknown[] = [
      undefined,
      {},
      { name: "" },
      { name: 42 },
      { name: "hero", at: { parent: "stage-root" } },
      { name: "hero", params: {} },
      hostileInput,
    ];

    for (const input of inputs) {
      const result = executeStageTool(
        { name: "get_composition", input },
        { shadow: SHADOW, assets: { compositions: [HERO_REFERENCE] } },
      );
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("invalid_input");
      expectZeroStageEffects(result);
    }
  });

  it("rejects unknown disallowed and malformed references with no stage effects", () => {
    const disallowCatalog = {
      ...DEFAULT_CATALOG,
      compositions: { mode: "allow", names: [] },
    } as const;
    const malformedReference = {
      name: "broken",
      metadata: { description: "Missing root." },
      root: "missing",
      nodes: {},
    } as unknown as FacetComposition;
    const cases = [
      {
        name: "missing",
        assets: { compositions: [HERO_REFERENCE] },
      },
      {
        name: "hero",
        assets: { compositions: [HERO_REFERENCE], catalog: disallowCatalog },
      },
      {
        name: "broken",
        assets: { compositions: [malformedReference] },
      },
      {
        name: "hero",
        assets: {
          compositions: [HERO_REFERENCE],
          catalog: null as unknown as typeof DEFAULT_CATALOG,
        },
      },
    ] as const;

    for (const { name, assets } of cases) {
      const result = executeStageTool(
        { name: "get_composition", input: { name } },
        { shadow: SHADOW, assets },
      );
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("invalid_composition");
      expectZeroStageEffects(result);
    }
  });

  it("is deterministic across repeated reads", () => {
    const context = { shadow: SHADOW, assets: { compositions: [HERO_REFERENCE] } } as const;
    const call = { name: "get_composition", input: { name: "hero" } } as const;

    const first = executeStageTool(call, context);
    const second = executeStageTool(call, context);

    expect(first).toEqual(second);
    expectZeroStageEffects(first);
    expectZeroStageEffects(second);
  });
});
