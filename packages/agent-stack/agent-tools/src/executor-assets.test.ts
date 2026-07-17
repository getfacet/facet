import {
  BRICK_CONTRACT,
  BRICK_TYPES,
  TOKEN_STYLE_VALUE_CONTRACT,
  type FacetPattern,
  type FacetTheme,
  type FacetTree,
} from "@facet/core";
import { describe, expect, it } from "vitest";
import {
  executeGetBrickSpec,
  executeGetPattern,
  executeGetPreset,
  executeGetStyleChoices,
} from "./executor-assets.js";
import type { StageToolAssets, StageToolResult } from "./types.js";

const SHADOW: FacetTree = {
  root: "stage-root",
  nodes: {
    "stage-root": { id: "stage-root", type: "box", children: ["existing"] },
    existing: { id: "existing", type: "text", value: "Existing stage copy" },
  },
};

const PANEL = {
  description: "Reusable panel treatment.",
  useWhen: "Use for a distinct content surface.",
  avoidWhen: "Avoid for ungrouped inline copy.",
  style: { gap: "md", background: "surface", borderRadius: "md" },
} as const;

const NOTICE: FacetPattern = {
  name: "notice",
  description: "A compact notice with a heading.",
  useWhen: "Use when one concise status needs emphasis.",
  root: "notice-root",
  nodes: {
    "notice-root": {
      id: "notice-root",
      type: "box",
      style: { preset: "panel", padding: "lg" },
      children: ["notice-title"],
    },
    "notice-title": { id: "notice-title", type: "text", value: "Ready" },
  },
};

const THEME = {
  name: "test",
  tokens: {
    paint: { light: { color: { accent: "SECRET_CSS_VALUE" } } },
  },
  defaults: {},
  presets: { box: { panel: PANEL } },
} as unknown as FacetTheme;

const ASSETS: StageToolAssets = {
  theme: THEME,
  patterns: [NOTICE],
  brickIndex: [],
  presetIndex: [
    {
      brick: "box",
      name: "panel",
      description: PANEL.description,
      useWhen: PANEL.useWhen,
    },
  ],
  patternIndex: [{ name: NOTICE.name, description: NOTICE.description, useWhen: NOTICE.useWhen }],
};

function expectZeroStageEffects(result: StageToolResult): void {
  expect(result.messages).toEqual([]);
  expect(result.patches).toEqual([]);
  expect(result.changedNodeIds).toEqual([]);
  expect(result.patchCount).toBe(0);
  expect(result.summary).toBe("no stage changes");
  expect(result.shadow).toBe(SHADOW);
  expect(result.observation.data).toMatchObject({
    applied: false,
    stage_changed: false,
    visible_to_visitor: false,
    patch_count: 0,
    changed_node_ids: [],
  });
}

function exactData(result: StageToolResult): unknown {
  expect(result.status).toBe("ok");
  expectZeroStageEffects(result);
  const serialized = result.observation.data?.data;
  expect(serialized).toBeDefined();
  return JSON.parse(serialized ?? "null") as unknown;
}

describe("asset read executor", () => {
  it("projects one compact Core Brick contract and reads assets without stage effects", () => {
    const brickResult = executeGetBrickSpec({ type: "progress" }, SHADOW, ASSETS);
    const brickData = exactData(brickResult) as {
      name: string;
      fields: unknown;
      supportsActiveWhen: boolean;
      style: {
        root: { properties: Record<string, "token" | "fixed"> };
        targets: Record<
          string,
          {
            properties: Record<string, "token" | "fixed">;
            states?: Readonly<Record<string, readonly string[]>>;
            applicableTo?: readonly string[];
          }
        >;
      };
    };

    expect(brickData.name).toBe("progress");
    expect(brickData.fields).toEqual(BRICK_CONTRACT.progress.fields);
    expect(brickData.supportsActiveWhen).toBe(false);
    expect(Object.keys(brickData.style.root.properties)).toEqual(
      Object.keys(BRICK_CONTRACT.progress.style.root.properties),
    );
    expect(brickData.style.root.properties.width).toBe("fixed");
    expect(Object.keys(brickData.style.targets.track?.properties ?? {})).toEqual(
      Object.keys(BRICK_CONTRACT.progress.style.targets.track?.properties ?? {}),
    );
    expect(brickData.style.targets.track?.properties.height).toBe("token");
    expect(brickData.style.targets.track?.properties).not.toHaveProperty("fontSize");

    const inputData = exactData(executeGetBrickSpec({ type: "input" }, SHADOW, ASSETS)) as {
      style: { targets: Record<string, { applicableTo?: readonly string[] }> };
    };
    expect(inputData.style.targets.indicator).toMatchObject({
      applicableTo: BRICK_CONTRACT.input.style.targets.indicator.applicableTo,
    });

    const choiceData = exactData(
      executeGetStyleChoices(
        { brick: "progress", target: "track", property: "height" },
        SHADOW,
        ASSETS,
      ),
    );
    expect(choiceData).toEqual({
      brick: "progress",
      target: "track",
      property: "height",
      description: BRICK_CONTRACT.progress.style.targets.track?.properties.height?.description,
      useWhen: BRICK_CONTRACT.progress.style.targets.track?.properties.height?.useWhen,
      source: "token",
      valueSetDescription: TOKEN_STYLE_VALUE_CONTRACT.progressThickness.description,
      choiceFields: ["name", "description", "useWhen", "avoidWhen?"],
      choices: TOKEN_STYLE_VALUE_CONTRACT.progressThickness.values.map((choice) => [
        choice.name,
        choice.description,
        choice.useWhen,
      ]),
    });

    expect(exactData(executeGetPreset({ brick: "box", name: "panel" }, SHADOW, ASSETS))).toEqual(
      PANEL,
    );
    expect(exactData(executeGetPattern({ name: "notice" }, SHADOW, ASSETS))).toEqual(NOTICE);

    const visiblePayloads = [
      brickResult,
      executeGetStyleChoices(
        { brick: "progress", target: "track", property: "height" },
        SHADOW,
        ASSETS,
      ),
      executeGetPreset({ brick: "box", name: "panel" }, SHADOW, ASSETS),
      executeGetPattern({ name: "notice" }, SHADOW, ASSETS),
    ]
      .map((result) => result.observation.text)
      .join("\n");
    expect(visiblePayloads).not.toContain("SECRET_CSS_VALUE");
    expect(visiblePayloads).not.toMatch(/(?:#[0-9a-f]{3,8}|rgba?\(|\d+(?:px|rem|em))/i);
  });

  it("keeps every Brick and local style-choice observation under 4,000 chars", () => {
    let maxBrickObservation = 0;
    let maxChoiceObservation = 0;

    for (const brick of BRICK_TYPES) {
      const brickResult = executeGetBrickSpec({ type: brick }, SHADOW, ASSETS);
      expect(brickResult.status).toBe("ok");
      maxBrickObservation = Math.max(maxBrickObservation, brickResult.observation.text.length);
      expect(brickResult.observation.text.length).toBeLessThanOrEqual(4_000);

      const contract = BRICK_CONTRACT[brick];
      const targets = [
        ["root", contract.style.root],
        ...Object.entries(contract.style.targets),
      ] as const;
      for (const [target, targetContract] of targets) {
        for (const property of Object.keys(targetContract.properties)) {
          const result = executeGetStyleChoices({ brick, target, property }, SHADOW, ASSETS);
          expect(result.status).toBe("ok");
          maxChoiceObservation = Math.max(maxChoiceObservation, result.observation.text.length);
          expect(result.observation.text.length).toBeLessThanOrEqual(4_000);
        }
      }
    }

    expect(maxBrickObservation).toBeGreaterThan(0);
    expect(maxChoiceObservation).toBeGreaterThan(0);
  });

  it("rejects invalid single-Brick reads atomically", () => {
    const hostileInput = Object.defineProperty({}, "type", {
      enumerable: true,
      get() {
        throw new Error("hostile type getter");
      },
    });
    const inputs: readonly unknown[] = [
      { type: ["progress"] },
      { type: "unknown" },
      { type: "progress", extra: true },
      { types: ["progress"] },
      hostileInput,
    ];

    for (const input of inputs) {
      const result = executeGetBrickSpec(
        input as Readonly<Record<string, unknown>>,
        SHADOW,
        ASSETS,
      );
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("invalid_input");
      expect(result.observation.data?.data).toBeUndefined();
      expect(result.observation.text).not.toContain("progressThickness");
      expectZeroStageEffects(result);
    }
  });

  it("rejects unknown or mismatched local style paths without leaking which segment exists", () => {
    const inputs = [
      { brick: "progress", target: "cell", property: "padding" },
      { brick: "progress", target: "track", property: "fontSize" },
      { brick: "progress", target: "missing", property: "height" },
      { brick: "progress", target: "track", property: "missing" },
    ] as const;
    const observations = inputs.map((input) => executeGetStyleChoices(input, SHADOW, ASSETS));

    for (const result of observations) {
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("not_available");
      expect(result.observation.text.length).toBeLessThan(2_000);
      expect(result.observation.data?.data).toBeUndefined();
      expect(result.observation.text).not.toMatch(/cell|padding|track|fontSize|missing|height/);
      expectZeroStageEffects(result);
    }
    expect(new Set(observations.map(({ observation }) => observation.text))).toHaveLength(1);
  });

  it("makes unavailable Preset and Pattern lookups indistinguishable", () => {
    const missingPreset = executeGetPreset({ brick: "box", name: "missing" }, SHADOW, ASSETS);
    const hiddenPreset = executeGetPreset({ brick: "text", name: "panel" }, SHADOW, ASSETS);
    const missingPattern = executeGetPattern({ name: "missing" }, SHADOW, ASSETS);
    const hiddenPattern = executeGetPattern({ name: "hidden" }, SHADOW, ASSETS);

    for (const result of [missingPreset, hiddenPreset, missingPattern, hiddenPattern]) {
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("not_available");
      expect(result.observation.data?.data).toBeUndefined();
      expectZeroStageEffects(result);
    }
    expect(missingPreset.observation.data?.message).toBe(hiddenPreset.observation.data?.message);
    expect(missingPattern.observation.data?.message).toBe(hiddenPattern.observation.data?.message);
    expect(missingPattern.observation.text).not.toContain("notice-root");
  });
});
