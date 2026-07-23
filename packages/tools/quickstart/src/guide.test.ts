import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BRICK_TYPES, collectMessages, validateAuthorTree, validateTree } from "@facet/core";
import { DEFAULT_THEME } from "@facet/assets";
import {
  formatCurrentStageForPrompt,
  normalizeBudget,
  type ProviderStep,
  type ReferenceAgentTraceEvent,
  type ReferenceProvider,
  type ToolCall,
} from "@facet/reference-agent";
import { loadAssets, MemoryAssets, MemorySink } from "@facet/runtime";
import { createQuickstartAgent } from "./agent.js";
import { QUICKSTART_INITIAL_STAGE, QUICKSTART_PAGE_BRIEF } from "./guide.js";

const EXPECTED_NODE_ORDER = [
  "qs.home.root",
  "qs.nav.home",
  "qs.nav.home.what",
  "qs.nav.home.what.label",
  "qs.nav.home.structure",
  "qs.nav.home.structure.label",
  "qs.nav.home.system",
  "qs.nav.home.system.label",
  "qs.nav.home.usecases",
  "qs.nav.home.usecases.label",
  "qs.hero",
  "qs.hero.eyebrow",
  "qs.hero.title",
  "qs.hero.body",
  "qs.hero.actions",
  "qs.hero.primary",
  "qs.hero.primary.label",
  "qs.hero.secondary",
  "qs.hero.secondary.label",
  "qs.metrics",
  "qs.metric.patch",
  "qs.metric.patch.label",
  "qs.metric.patch.value",
  "qs.card.safety",
  "qs.card.safety.title",
  "qs.card.safety.body",
  "qs.badge.safe",
  "qs.badge.safe.label",
  "qs.card.progress",
  "qs.card.progress.title",
  "qs.card.progress.body",
  "qs.progress.ready",
  "qs.surface.card",
  "qs.surface.card.title",
  "qs.surface.card.body",
  "qs.surface.chart",
  "qs.surface.divider",
  "qs.surface.table",
  "qs.intake",
  "qs.intake.title",
  "qs.intake.body",
  "qs.intake.goal",
  "qs.intake.surface",
  "qs.intake.alert",
  "qs.intake.alert.title",
  "qs.intake.alert.body",
  "qs.intake.submit",
  "qs.intake.submit.label",
  "qs.runtime.summary",
  "qs.runtime.summary.title",
  "qs.runtime.summary.body",
  "qs.runtime.list",
  "qs.system.root",
  "qs.nav.system",
  "qs.nav.system.what",
  "qs.nav.system.what.label",
  "qs.nav.system.structure",
  "qs.nav.system.structure.label",
  "qs.nav.system.system",
  "qs.nav.system.system.label",
  "qs.nav.system.usecases",
  "qs.nav.system.usecases.label",
  "qs.system.hero",
  "qs.system.hero.eyebrow",
  "qs.system.hero.title",
  "qs.system.hero.body",
  "qs.system.hero.alert",
  "qs.system.hero.alert.title",
  "qs.system.hero.alert.body",
  "qs.system.theme",
  "qs.system.theme.title",
  "qs.system.theme.body",
  "qs.system.theme.badges",
  "qs.system.badge.neutral",
  "qs.system.badge.neutral.label",
  "qs.system.badge.success",
  "qs.system.badge.success.label",
  "qs.system.badge.warning",
  "qs.system.badge.warning.label",
  "qs.system.badge.danger",
  "qs.system.badge.danger.label",
  "qs.system.theme.progress",
  "qs.system.theme.list",
  "qs.system.bricks",
  "qs.system.bricks.title",
  "qs.system.bricks.body",
  "qs.system.actions.card",
  "qs.system.actions.card.title",
  "qs.system.actions.card.body",
  "qs.system.action.buttons",
  "qs.system.button.primary",
  "qs.system.button.primary.label",
  "qs.system.button.secondary",
  "qs.system.button.secondary.label",
  "qs.system.button.danger",
  "qs.system.button.danger.label",
  "qs.system.action.metric",
  "qs.system.action.metric.label",
  "qs.system.action.metric.value",
  "qs.system.action.progress",
  "qs.system.action.divider",
  "qs.system.data.card",
  "qs.system.data.card.title",
  "qs.system.data.card.body",
  "qs.system.data.chart",
  "qs.system.data.table",
  "qs.system.form.card",
  "qs.system.form.card.title",
  "qs.system.form.card.body",
  "qs.system.form.name",
  "qs.system.form.kind",
  "qs.system.form.submit",
  "qs.system.form.submit.label",
  "qs.system.feedback.card",
  "qs.system.feedback.card.title",
  "qs.system.feedback.card.body",
  "qs.system.feedback.alert",
  "qs.system.feedback.alert.title",
  "qs.system.feedback.alert.body",
  "qs.system.feedback.list",
  "qs.system.patterns",
  "qs.system.patterns.title",
  "qs.system.patterns.body",
  "qs.system.patterns.list",
  "qs.system.patterns.table",
  "qs.system.discovery",
  "qs.system.discovery.title",
  "qs.system.discovery.body",
  "qs.system.discovery.list",
  "qs.usecases.root",
  "qs.nav.usecases",
  "qs.nav.usecases.what",
  "qs.nav.usecases.what.label",
  "qs.nav.usecases.structure",
  "qs.nav.usecases.structure.label",
  "qs.nav.usecases.system",
  "qs.nav.usecases.system.label",
  "qs.nav.usecases.usecases",
  "qs.nav.usecases.usecases.label",
  "qs.usecases.hero",
  "qs.usecases.hero.eyebrow",
  "qs.usecases.hero.title",
  "qs.usecases.hero.body",
  "qs.usecases.alert",
  "qs.usecases.alert.title",
  "qs.usecases.alert.body",
  "qs.usecases.examples",
  "qs.usecases.examples.title",
  "qs.usecases.examples.body",
  "qs.usecases.list",
  "qs.usecases.actions",
  "qs.usecases.dashboard",
  "qs.usecases.dashboard.label",
  "qs.usecases.pricing",
  "qs.usecases.pricing.label",
  "qs.usecases.onboarding",
  "qs.usecases.onboarding.label",
  "qs.usecases.replay",
  "qs.usecases.replay.label",
  "qs.runtime.root",
  "qs.nav.runtime",
  "qs.nav.runtime.what",
  "qs.nav.runtime.what.label",
  "qs.nav.runtime.structure",
  "qs.nav.runtime.structure.label",
  "qs.nav.runtime.system",
  "qs.nav.runtime.system.label",
  "qs.nav.runtime.usecases",
  "qs.nav.runtime.usecases.label",
  "qs.runtime.section",
  "qs.runtime.section.eyebrow",
  "qs.runtime.section.title",
  "qs.runtime.section.body",
  "qs.structure.list",
  "qs.structure.table",
] as const;

const CONVERTED_CONTAINER_IDS = [
  "qs.hero",
  "qs.card.safety",
  "qs.card.progress",
  "qs.surface.card",
  "qs.runtime.summary",
  "qs.runtime.section",
  "qs.system.hero",
  "qs.system.theme",
  "qs.system.bricks",
  "qs.system.actions.card",
  "qs.system.data.card",
  "qs.system.form.card",
  "qs.system.feedback.card",
  "qs.system.patterns",
  "qs.system.discovery",
  "qs.intake",
  "qs.usecases.hero",
  "qs.usecases.examples",
] as const;

const CONVERTED_CONTAINER_TEXT_IDS = [
  "qs.hero.eyebrow",
  "qs.hero.title",
  "qs.hero.body",
  "qs.card.safety.title",
  "qs.card.safety.body",
  "qs.card.progress.title",
  "qs.card.progress.body",
  "qs.surface.card.title",
  "qs.surface.card.body",
  "qs.runtime.summary.title",
  "qs.runtime.summary.body",
  "qs.runtime.section.eyebrow",
  "qs.runtime.section.title",
  "qs.runtime.section.body",
  "qs.system.hero.eyebrow",
  "qs.system.hero.title",
  "qs.system.hero.body",
  "qs.system.theme.title",
  "qs.system.theme.body",
  "qs.system.bricks.title",
  "qs.system.bricks.body",
  "qs.system.actions.card.title",
  "qs.system.actions.card.body",
  "qs.system.data.card.title",
  "qs.system.data.card.body",
  "qs.system.form.card.title",
  "qs.system.form.card.body",
  "qs.system.feedback.card.title",
  "qs.system.feedback.card.body",
  "qs.system.patterns.title",
  "qs.system.patterns.body",
  "qs.system.discovery.title",
  "qs.system.discovery.body",
  "qs.intake.title",
  "qs.intake.body",
  "qs.usecases.hero.eyebrow",
  "qs.usecases.hero.title",
  "qs.usecases.hero.body",
  "qs.usecases.examples.title",
  "qs.usecases.examples.body",
] as const;

describe("quickstart guide", () => {
  it("uses Pattern Preset and direct styles only", () => {
    const validated = validateAuthorTree(QUICKSTART_INITIAL_STAGE, DEFAULT_THEME);

    expect(validated.issues).toEqual([]);
    expect(validated.value).toEqual(QUICKSTART_INITIAL_STAGE);
    expect(QUICKSTART_INITIAL_STAGE).not.toHaveProperty("theme");

    for (const node of Object.values(QUICKSTART_INITIAL_STAGE.nodes)) {
      expect(node).not.toHaveProperty("active");
      expect(node).not.toHaveProperty("activeStyle"); // style-hard-cut: allowed-negative
      expect(node).not.toHaveProperty("activeVariant"); // style-hard-cut: allowed-negative
      expect(node).not.toHaveProperty("tone");
      expect(node).not.toHaveProperty("variant"); // style-hard-cut: allowed-negative
    }

    const authoredGuide = `${QUICKSTART_PAGE_BRIEF}\n${JSON.stringify(QUICKSTART_INITIAL_STAGE)}`;
    expect(authoredGuide).toContain("Pattern");
    expect(authoredGuide).toContain("Preset");
    expect(authoredGuide).toContain("direct style");
    expect(authoredGuide).not.toMatch(/\b(?:catalog|composition|recipe|variant)\b/i);

    expect(QUICKSTART_INITIAL_STAGE.nodes["qs.hero"]).toMatchObject({
      style: { preset: "panel" },
    });
    expect(QUICKSTART_INITIAL_STAGE.nodes["qs.hero.title"]).toMatchObject({
      style: { preset: "heading" },
    });
    expect(QUICKSTART_INITIAL_STAGE.nodes["qs.nav.home.what"]).toMatchObject({
      style: {
        preset: "secondaryAction",
        active: { preset: "primaryAction" },
      },
    });
  });

  it("contains only the final brick roster", () => {
    const retiredNodeTypes = new Set<string>([
      "button",
      "tabs",
      "nav",
      "form",
      "filterBar",
      "metric",
      "stat",
      "section",
      "card",
      "emptyState",
    ]); // composition-hard-cut: allowed-negative
    const retiredNodes = Object.values(QUICKSTART_INITIAL_STAGE.nodes).filter((node) =>
      retiredNodeTypes.has(node.type),
    );

    expect(retiredNodes).toEqual([]);
    expect(
      Object.values(QUICKSTART_INITIAL_STAGE.nodes).every((node) =>
        (BRICK_TYPES as readonly string[]).includes(node.type),
      ),
    ).toBe(true);
    expect(CONVERTED_CONTAINER_IDS).toHaveLength(18);
    expect(CONVERTED_CONTAINER_TEXT_IDS).toHaveLength(40);
    expect(new Set(CONVERTED_CONTAINER_TEXT_IDS)).toHaveProperty("size", 40);
    for (const id of CONVERTED_CONTAINER_IDS) {
      expect(QUICKSTART_INITIAL_STAGE.nodes[id]).toMatchObject({ id, type: "box" });
    }
    for (const id of CONVERTED_CONTAINER_TEXT_IDS) {
      expect(QUICKSTART_INITIAL_STAGE.nodes[id]).toMatchObject({ id, type: "text" });
    }

    const validated = validateTree(QUICKSTART_INITIAL_STAGE);
    expect(validated.issues).toEqual([]);
    expect(validated.tree).toEqual(QUICKSTART_INITIAL_STAGE);
  });

  it("keeps the seeded stage valid and every node keyed by its id", () => {
    const validated = validateTree(QUICKSTART_INITIAL_STAGE);

    expect(validated.issues).toEqual([]);
    expect(validated.tree).toEqual(QUICKSTART_INITIAL_STAGE);
    expect(
      Object.entries(QUICKSTART_INITIAL_STAGE.nodes).every(([id, node]) => node.id === id),
    ).toBe(true);
  });

  it("preserves the screen map and node insertion order", () => {
    expect(QUICKSTART_INITIAL_STAGE.screens).toEqual({
      what: "qs.home.root",
      structure: "qs.runtime.root",
      system: "qs.system.root",
      usecases: "qs.usecases.root",
    });
    expect(EXPECTED_NODE_ORDER).toHaveLength(175);
    expect(Object.keys(QUICKSTART_INITIAL_STAGE.nodes)).toEqual(EXPECTED_NODE_ORDER);
  });

  it("preserves the serialized initial stage byte-for-byte through module extraction", () => {
    const serialized = JSON.stringify(QUICKSTART_INITIAL_STAGE);

    expect(serialized).toContain('"value":"Patterns"');
    expect(serialized).toContain('"caption":"Pattern examples"');
    expect(serialized).toContain(
      '"description":"A compact product hero with a title, subtitle, and CTA."',
    );
    expect(serialized).toContain('"title":"Native authoring"');
    expect(serialized).toContain('"title":"Preset"');
    expect(serialized).not.toContain('"slots"');
    expect(serialized).toHaveLength(36_977);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "f94cf14cb65ea41d3e151c066367094da0afd2cd02b2b53ff091b88317868f81",
    );
  });

  it("keeps the expanded native seed inside the quickstart full-stage budget", () => {
    const budget = normalizeBudget();
    const prompt = formatCurrentStageForPrompt(QUICKSTART_INITIAL_STAGE, {
      maxJsonChars: budget.maxStageJsonChars,
      maxSummaryNodes: budget.maxStageSummaryNodes,
    });

    expect(prompt).toMatch(/^CURRENT STAGE: /);
    expect(prompt.length).toBeLessThanOrEqual(budget.maxStageJsonChars + "CURRENT STAGE: ".length);
  });

  it("reaches a visible mutation after seeded progressive discovery and repair", async () => {
    const agentId = "quickstart-guide-progressive";
    const assets = await loadAssets(new MemoryAssets({}), agentId);
    expect(assets.patterns).toHaveLength(21);
    expect(Object.keys(QUICKSTART_INITIAL_STAGE.nodes)).toHaveLength(175);

    let callId = 0;
    const call = (name: string, input: unknown): ToolCall => {
      callId += 1;
      return { id: `quickstart-progressive-${String(callId)}`, name, input };
    };
    const renderedTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["message"] },
        message: { id: "message", type: "text", value: "Progressive authoring completed." },
      },
    } as const;
    const steps: readonly ProviderStep[] = [
      { text: "", toolCalls: [call("get_pattern", { name: "dashboard-summary" })] },
      {
        text: "",
        toolCalls: ["box", "text", "chart", "table", "progress", "list"].map((type) =>
          call("get_brick_spec", { type }),
        ),
      },
      {
        text: "",
        toolCalls: [
          ["box", "panel"],
          ["text", "heading"],
          ["chart", "panel"],
          ["table", "standard"],
          ["progress", "standard"],
          ["list", "standard"],
        ].map(([brick, name]) => call("get_preset", { brick, name })),
      },
      { text: "", toolCalls: [call("inspect_stage", { maxNodes: 200 })] },
      { text: "", toolCalls: [call("get_brick_spec", { type: "input" })] },
      {
        text: "",
        toolCalls: [
          call("get_style_choices", {
            brick: "input",
            target: "control",
            property: "controlHeight",
          }),
        ],
      },
      { text: "", toolCalls: [call("render_page", { tree: renderedTree })] },
      { text: "Progressive authoring is complete.", toolCalls: [] },
    ];
    let providerStep = 0;
    let mutationStepReached = false;
    const provider: ReferenceProvider = {
      name: "openai",
      model: "guide-progressive-fixture",
      contextWindowTokens: 128_000,
      async run() {
        const step = steps[providerStep];
        if (step === undefined) return { text: "Unexpected extra provider step.", toolCalls: [] };
        providerStep += 1;
        if (step.toolCalls.some((toolCall) => toolCall.name === "render_page")) {
          mutationStepReached = true;
        }
        return step;
      },
    };
    const trace: ReferenceAgentTraceEvent[] = [];
    const agent = createQuickstartAgent({
      provider,
      guide: QUICKSTART_PAGE_BRIEF,
      sink: new MemorySink(),
      agentId,
      theme: assets.theme,
      patterns: assets.patterns,
      summaryStore: null,
      trace: (event) => {
        trace.push(event);
      },
    });
    const visitor = { visitorId: "quickstart-guide-progressive-visitor" };
    const result = agent(
      { kind: "visit", visitor },
      { agentId, visitor, stage: QUICKSTART_INITIAL_STAGE },
    );
    const messages = await collectMessages(result);
    const rootReplacement = messages
      .filter((message) => message.kind === "patch")
      .flatMap((message) => message.patches)
      .find((patch) => patch.op === "replace" && patch.path === "");

    expect(mutationStepReached).toBe(true);
    expect(providerStep).toBe(steps.length);
    expect(rootReplacement?.op).toBe("replace");
    if (rootReplacement?.op !== "replace")
      throw new Error("root replacement patch was not emitted");
    expect(rootReplacement.value).toEqual(renderedTree);
    expect(trace).not.toContainEqual(
      expect.objectContaining({ type: "stop", reason: "context_limit" }),
    );
    expect(trace).toContainEqual(
      expect.objectContaining({ type: "stop", reason: "provider_stop" }),
    );
  });

  it("keeps the page brief on the established guide export", () => {
    expect(QUICKSTART_PAGE_BRIEF).toContain("# Facet quickstart tour");
    expect(QUICKSTART_PAGE_BRIEF).toContain("Preserve the top-level screen choices");
    expect(QUICKSTART_PAGE_BRIEF).toContain("the exact native brick vocabulary");
    expect(QUICKSTART_PAGE_BRIEF).toContain("box, text, media, input, richtext");
    expect(QUICKSTART_PAGE_BRIEF).toContain("inspect an available Pattern");
    expect(QUICKSTART_PAGE_BRIEF).toContain("ordinary native Bricks");
    expect(QUICKSTART_PAGE_BRIEF).toContain("same-Brick Preset");
    expect(QUICKSTART_PAGE_BRIEF).toContain("direct style");
  });
});
