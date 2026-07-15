import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateTree } from "@facet/core";
import { QUICKSTART_INITIAL_STAGE, QUICKSTART_PAGE_BRIEF } from "./guide.js";

const EXPECTED_NODE_ORDER = [
  "qs.home.root",
  "qs.nav.home",
  "qs.hero",
  "qs.hero.eyebrow",
  "qs.hero.title",
  "qs.hero.body",
  "qs.hero.actions",
  "qs.hero.primary",
  "qs.hero.secondary",
  "qs.metrics",
  "qs.metric.patch",
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
  "qs.runtime.summary",
  "qs.runtime.summary.title",
  "qs.runtime.summary.body",
  "qs.runtime.list",
  "qs.system.root",
  "qs.nav.system",
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
  "qs.system.button.secondary",
  "qs.system.button.danger",
  "qs.system.action.metric",
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
  "qs.system.feedback.card",
  "qs.system.feedback.card.title",
  "qs.system.feedback.card.body",
  "qs.system.feedback.alert",
  "qs.system.feedback.alert.title",
  "qs.system.feedback.alert.body",
  "qs.system.feedback.list",
  "qs.system.compositions",
  "qs.system.compositions.title",
  "qs.system.compositions.body",
  "qs.system.compositions.list",
  "qs.system.compositions.table",
  "qs.system.catalog",
  "qs.system.catalog.title",
  "qs.system.catalog.body",
  "qs.system.catalog.list",
  "qs.usecases.root",
  "qs.nav.usecases",
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
  "qs.usecases.pricing",
  "qs.usecases.onboarding",
  "qs.usecases.replay",
  "qs.runtime.root",
  "qs.nav.runtime",
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
  "qs.system.compositions",
  "qs.system.catalog",
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
  "qs.system.compositions.title",
  "qs.system.compositions.body",
  "qs.system.catalog.title",
  "qs.system.catalog.body",
  "qs.intake.title",
  "qs.intake.body",
  "qs.usecases.hero.eyebrow",
  "qs.usecases.hero.title",
  "qs.usecases.hero.body",
  "qs.usecases.examples.title",
  "qs.usecases.examples.body",
] as const;

describe("quickstart guide", () => {
  it("contains only surviving node types after PR-5b", () => {
    const retiredNodeTypes = new Set<string>(["section", "card", "emptyState"]); // composition-hard-cut: allowed-negative
    const retiredNodes = Object.values(QUICKSTART_INITIAL_STAGE.nodes).filter((node) =>
      retiredNodeTypes.has(node.type),
    );

    expect(retiredNodes).toEqual([]);
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
    expect(Object.keys(QUICKSTART_INITIAL_STAGE.nodes)).toEqual(EXPECTED_NODE_ORDER);
  });

  it("preserves the serialized initial stage byte-for-byte through module extraction", () => {
    const serialized = JSON.stringify(QUICKSTART_INITIAL_STAGE);

    expect(serialized).toContain('"value":"Optional reference datasets"');
    expect(serialized).toContain('"caption":"Reference examples"');
    expect(serialized).toContain(
      '"description":"A compact product hero with a title, subtitle, and CTA."',
    );
    expect(serialized).toContain('"title":"Native authoring"');
    expect(serialized).toContain("box, text, media, input, and richtext");
    expect(serialized).not.toContain('"slots"');
    expect(serialized).toHaveLength(27_694);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "573d5125465e96ddfe3554733764563a4a610e5a89a8615999e4547cea36757f",
    );
  });

  it("keeps the page brief on the established guide export", () => {
    expect(QUICKSTART_PAGE_BRIEF).toContain("# Facet quickstart tour");
    expect(QUICKSTART_PAGE_BRIEF).toContain("Preserve the top-level tabs");
    expect(QUICKSTART_PAGE_BRIEF).toContain("component-first catalog authoring");
    expect(QUICKSTART_PAGE_BRIEF).toContain("box/text/media/input/richtext");
    expect(QUICKSTART_PAGE_BRIEF).toContain("inspect an available composition reference");
    expect(QUICKSTART_PAGE_BRIEF).toContain("ordinary native nodes");
  });
});
