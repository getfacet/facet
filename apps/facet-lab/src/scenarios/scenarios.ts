import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import { BRICK_TYPES, type BrickType, type FacetTree, type JsonPatchOperation } from "@facet/core";

import { ANALYTICS_FIXTURE, DATA_OPERATIONS_FIXTURE, SETTINGS_FIXTURE } from "./fixtures-data.js";
import { DOCUMENTATION_FIXTURE, MARKETING_FIXTURE } from "./fixtures-marketing.js";
import { PRODUCT_FIXTURE, SUPPORT_FIXTURE } from "./fixtures-product.js";
import { LIFECYCLE_FIXTURE, LIFECYCLE_TRANSITIONS } from "./fixtures-state.js";

export const OFFICIAL_SCENARIO_CAPABILITIES = [
  "marketing",
  "analytics",
  "data-operations",
  "settings-form",
  "documentation",
  "product-list-detail",
  "support-triage",
  "lifecycle",
] as const;
export type OfficialScenarioCapability = (typeof OFFICIAL_SCENARIO_CAPABILITIES)[number];

export type ScenarioFixtureRole =
  "marketing-content" | "data-workflow" | "product-workflow" | "lifecycle-state";
export type ProviderStepPhase = "initial" | "ui-in" | "follow-up";

export type ScenarioProviderOutput =
  | { readonly kind: "render"; readonly tree: FacetTree }
  | { readonly kind: "patch"; readonly patches: readonly JsonPatchOperation[] };

export interface ScenarioProviderStep {
  readonly id: string;
  readonly phase: ProviderStepPhase;
  readonly output: ScenarioProviderOutput;
}

export interface ScenarioFixture {
  readonly role: ScenarioFixtureRole;
  readonly providerSteps: readonly [ScenarioProviderStep, ...ScenarioProviderStep[]];
}

export interface ExpectedPreset {
  readonly brick: BrickType;
  readonly name: string;
}

export interface ScenarioExpectedAssets {
  readonly bricks: readonly BrickType[];
  readonly presets: readonly ExpectedPreset[];
  readonly patterns: readonly string[];
}

export interface ScenarioExpectedOutcomes {
  readonly actionNames: readonly string[];
  readonly stageMutations: number;
  readonly states?: readonly string[];
}

export interface OfficialScenario {
  readonly id: string;
  readonly official: true;
  readonly capability: OfficialScenarioCapability;
  readonly name: string;
  readonly prompt: string;
  readonly fixture: ScenarioFixture & { readonly source?: unknown };
  readonly expectedAssets: ScenarioExpectedAssets;
  readonly expectedOutcomes: ScenarioExpectedOutcomes;
  readonly supportedConstraints: readonly ["brick", "preset", "pattern"];
}

export type ScenarioConstraint =
  | { readonly kind: "brick"; readonly brick: string }
  | { readonly kind: "preset"; readonly brick: string; readonly name: string }
  | { readonly kind: "pattern"; readonly name: string };

export type ScenarioConstraintOutcome = "satisfied" | "unmet" | "unknown";

const LIFECYCLE_SCENARIO_FIXTURE = {
  role: "lifecycle-state",
  source: LIFECYCLE_FIXTURE,
  providerSteps: [
    {
      id: "lifecycle-initial",
      phase: "initial",
      output: { kind: "render", tree: LIFECYCLE_FIXTURE.initialTree },
    },
    {
      id: "lifecycle-empty",
      phase: "ui-in",
      output: { kind: "patch", patches: LIFECYCLE_TRANSITIONS[0].patches },
    },
    {
      id: "lifecycle-error",
      phase: "follow-up",
      output: { kind: "patch", patches: LIFECYCLE_TRANSITIONS[1].patches },
    },
    {
      id: "lifecycle-result",
      phase: "follow-up",
      output: { kind: "patch", patches: LIFECYCLE_TRANSITIONS[2].patches },
    },
  ],
} as const satisfies ScenarioFixture & { readonly source: typeof LIFECYCLE_FIXTURE };

const COMMON_CONSTRAINTS = ["brick", "preset", "pattern"] as const;

export const OFFICIAL_SCENARIOS: readonly OfficialScenario[] = [
  {
    id: "landing-marketing",
    official: true,
    capability: "marketing",
    name: "Landing and marketing",
    prompt: "Create a concise product landing section with one clear agent action.",
    fixture: MARKETING_FIXTURE,
    expectedAssets: {
      bricks: ["box", "text"],
      presets: [
        { brick: "text", name: "heading" },
        { brick: "box", name: "primaryAction" },
      ],
      patterns: ["hero"],
    },
    expectedOutcomes: { actionNames: ["explore_marketing"], stageMutations: 2 },
    supportedConstraints: COMMON_CONSTRAINTS,
  },
  {
    id: "analytics-dashboard",
    official: true,
    capability: "analytics",
    name: "Analytics dashboard",
    prompt: "Build a compact analytics dashboard with summary, trend, and goal progress.",
    fixture: ANALYTICS_FIXTURE,
    expectedAssets: {
      bricks: ["box", "text", "keyValue", "chart", "progress"],
      presets: [
        { brick: "chart", name: "panel" },
        { brick: "progress", name: "success" },
      ],
      patterns: ["dashboard-summary"],
    },
    expectedOutcomes: { actionNames: ["refresh_analytics"], stageMutations: 2 },
    supportedConstraints: COMMON_CONSTRAINTS,
  },
  {
    id: "table-chart-data",
    official: true,
    capability: "data-operations",
    name: "Table and chart data",
    prompt: "Present the same small operational dataset as a chart and supporting table.",
    fixture: DATA_OPERATIONS_FIXTURE,
    expectedAssets: {
      bricks: ["box", "text", "chart", "table"],
      presets: [
        { brick: "chart", name: "panel" },
        { brick: "table", name: "standard" },
      ],
      patterns: ["chart-table-view"],
    },
    expectedOutcomes: { actionNames: ["refresh_data"], stageMutations: 2 },
    supportedConstraints: COMMON_CONSTRAINTS,
  },
  {
    id: "settings-form",
    official: true,
    capability: "settings-form",
    name: "Settings form",
    prompt: "Create a small settings form with collect-based save behavior and status feedback.",
    fixture: SETTINGS_FIXTURE,
    expectedAssets: {
      bricks: ["box", "text", "input"],
      presets: [
        { brick: "input", name: "standard" },
        { brick: "box", name: "primaryAction" },
      ],
      patterns: ["settings-panel"],
    },
    expectedOutcomes: { actionNames: ["save_settings"], stageMutations: 2 },
    supportedConstraints: COMMON_CONSTRAINTS,
  },
  {
    id: "documentation-content",
    official: true,
    capability: "documentation",
    name: "Documentation and content",
    prompt: "Compose an integration guide with rich prose, topic list, and a follow-up action.",
    fixture: DOCUMENTATION_FIXTURE,
    expectedAssets: {
      bricks: ["box", "text", "richtext", "list"],
      presets: [
        { brick: "richtext", name: "prose" },
        { brick: "list", name: "standard" },
      ],
      patterns: ["section"],
    },
    expectedOutcomes: { actionNames: ["show_docs_example"], stageMutations: 2 },
    supportedConstraints: COMMON_CONSTRAINTS,
  },
  {
    id: "product-list-detail",
    official: true,
    capability: "product-list-detail",
    name: "Product list and detail",
    prompt:
      "Build a product list with a synchronized selected-product detail and selection action.",
    fixture: PRODUCT_FIXTURE,
    expectedAssets: {
      bricks: ["box", "text", "list", "keyValue"],
      presets: [
        { brick: "list", name: "standard" },
        { brick: "keyValue", name: "standard" },
      ],
      patterns: ["card"],
    },
    expectedOutcomes: { actionNames: ["select_product"], stageMutations: 2 },
    supportedConstraints: COMMON_CONSTRAINTS,
  },
  {
    id: "support-triage",
    official: true,
    capability: "support-triage",
    name: "Support triage",
    prompt: "Collect a support category and description, then acknowledge the submitted request.",
    fixture: SUPPORT_FIXTURE,
    expectedAssets: {
      bricks: ["box", "text", "input"],
      presets: [
        { brick: "input", name: "standard" },
        { brick: "box", name: "primaryAction" },
      ],
      patterns: ["support-triage"],
    },
    expectedOutcomes: { actionNames: ["submit_support"], stageMutations: 2 },
    supportedConstraints: COMMON_CONSTRAINTS,
  },
  {
    id: "lifecycle-states",
    official: true,
    capability: "lifecycle",
    name: "Loading, empty, error, and result",
    prompt: "Demonstrate the complete deterministic lifecycle while preserving one coherent stage.",
    fixture: LIFECYCLE_SCENARIO_FIXTURE,
    expectedAssets: {
      bricks: ["box", "text", "loading", "keyValue"],
      presets: [],
      patterns: ["empty-state"],
    },
    expectedOutcomes: {
      actionNames: ["retry_lifecycle_fixture"],
      stageMutations: 3,
      states: LIFECYCLE_FIXTURE.steps.map(({ state }) => state),
    },
    supportedConstraints: COMMON_CONSTRAINTS,
  },
];

export const FREE_FORM_SCENARIO = {
  id: "free-form",
  official: false,
  capability: "free-form",
  name: "Free-form prompt",
  prompt: "",
  fixture: null,
  supportedConstraints: COMMON_CONSTRAINTS,
} as const;

function isKnownBrick(brick: string): brick is BrickType {
  return (BRICK_TYPES as readonly string[]).includes(brick);
}

export function evaluateScenarioConstraint(
  scenario: OfficialScenario,
  constraint: ScenarioConstraint,
): ScenarioConstraintOutcome {
  if (constraint.kind === "brick") {
    if (!isKnownBrick(constraint.brick)) return "unknown";
    return scenario.expectedAssets.bricks.includes(constraint.brick) ? "satisfied" : "unmet";
  }
  if (constraint.kind === "pattern") {
    if (!DEFAULT_PATTERNS.some(({ name }) => name === constraint.name)) return "unknown";
    return scenario.expectedAssets.patterns.includes(constraint.name) ? "satisfied" : "unmet";
  }
  if (!isKnownBrick(constraint.brick)) return "unknown";
  const presetMap = DEFAULT_THEME.presets?.[constraint.brick];
  if (presetMap === undefined || presetMap[constraint.name] === undefined) return "unknown";
  return scenario.expectedAssets.presets.some(
    ({ brick, name }) => brick === constraint.brick && name === constraint.name,
  )
    ? "satisfied"
    : "unmet";
}

export const SCENARIO_CONSTRAINT_CASES = [
  {
    id: "analytics-chart-satisfied",
    scenarioId: "analytics-dashboard",
    constraint: { kind: "brick", brick: "chart" },
    expected: "satisfied",
  },
  {
    id: "marketing-table-unmet",
    scenarioId: "landing-marketing",
    constraint: { kind: "brick", brick: "table" },
    expected: "unmet",
  },
  {
    id: "unknown-pattern",
    scenarioId: "documentation-content",
    constraint: { kind: "pattern", name: "not-a-shipped-pattern" },
    expected: "unknown",
  },
] as const satisfies readonly {
  readonly id: string;
  readonly scenarioId: (typeof OFFICIAL_SCENARIOS)[number]["id"];
  readonly constraint: ScenarioConstraint;
  readonly expected: ScenarioConstraintOutcome;
}[];
