import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateTree } from "@facet/core";
import { QUICKSTART_INITIAL_STAGE, QUICKSTART_PAGE_BRIEF } from "./guide.js";

const EXPECTED_NODE_ORDER = [
  "qs.home.root",
  "qs.nav.home",
  "qs.hero",
  "qs.hero.actions",
  "qs.hero.primary",
  "qs.hero.secondary",
  "qs.metrics",
  "qs.metric.patch",
  "qs.card.safety",
  "qs.badge.safe",
  "qs.card.progress",
  "qs.progress.ready",
  "qs.surface.card",
  "qs.surface.chart",
  "qs.surface.divider",
  "qs.surface.table",
  "qs.intake",
  "qs.intake.goal",
  "qs.intake.surface",
  "qs.intake.alert",
  "qs.intake.submit",
  "qs.runtime.summary",
  "qs.runtime.list",
  "qs.system.root",
  "qs.nav.system",
  "qs.system.hero",
  "qs.system.hero.alert",
  "qs.system.theme",
  "qs.system.theme.badges",
  "qs.system.badge.neutral",
  "qs.system.badge.success",
  "qs.system.badge.warning",
  "qs.system.badge.danger",
  "qs.system.theme.progress",
  "qs.system.theme.list",
  "qs.system.bricks",
  "qs.system.actions.card",
  "qs.system.action.buttons",
  "qs.system.button.primary",
  "qs.system.button.secondary",
  "qs.system.button.danger",
  "qs.system.action.metric",
  "qs.system.action.progress",
  "qs.system.action.divider",
  "qs.system.data.card",
  "qs.system.data.chart",
  "qs.system.data.table",
  "qs.system.form.card",
  "qs.system.form.name",
  "qs.system.form.kind",
  "qs.system.form.submit",
  "qs.system.feedback.card",
  "qs.system.feedback.alert",
  "qs.system.feedback.list",
  "qs.system.compositions",
  "qs.system.compositions.list",
  "qs.system.compositions.table",
  "qs.system.catalog",
  "qs.system.catalog.list",
  "qs.usecases.root",
  "qs.nav.usecases",
  "qs.usecases.hero",
  "qs.usecases.alert",
  "qs.usecases.examples",
  "qs.usecases.list",
  "qs.usecases.actions",
  "qs.usecases.dashboard",
  "qs.usecases.pricing",
  "qs.usecases.onboarding",
  "qs.usecases.replay",
  "qs.runtime.root",
  "qs.nav.runtime",
  "qs.runtime.section",
  "qs.structure.list",
  "qs.structure.table",
] as const;

describe("quickstart guide", () => {
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

    expect(serialized).toHaveLength(18_381);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "5d2007fc72ee77e20ffdcc42c4c3fc203d2e56e84dff01224c6e20e5ab091b9f",
    );
  });

  it("keeps the page brief on the established guide export", () => {
    expect(QUICKSTART_PAGE_BRIEF).toContain("# Facet quickstart tour");
    expect(QUICKSTART_PAGE_BRIEF).toContain("Preserve the top-level tabs");
  });
});
