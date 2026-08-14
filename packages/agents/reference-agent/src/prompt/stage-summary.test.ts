import { describe, expect, it } from "vitest";

import { summarizeStageForPrompt } from "./stage-summary.js";

describe("summarizeStageForPrompt", () => {
  it("summarizes the semantic component index without full specs or data values", () => {
    const summary = summarizeStageForPrompt({
      stageRevision: 3,
      currentScreen: {
        name: "home",
        markup: '<Screen name="home" id="s-home"><Text value="Visible" id="n1" /></Screen>',
        issues: [],
      },
      screens: ["home", "settings"],
      components: [
        {
          tag: "Screen",
          whenToUse: "Root screen container.",
          role: "layout",
          semanticSignals: ["screen_root"],
        },
        {
          tag: "Text",
          whenToUse: "Short copy.",
          role: "display",
          semanticSignals: ["prose", "heading"],
        },
      ],
      data: [{ path: "rows", shape: "array", fields: ["name", "secret"], count: 1 }],
      issues: [],
    });

    expect(summary).toContain("stageRevision=3");
    expect(summary).toContain("currentScreen=home");
    expect(summary).toContain("screens=home, settings");
    expect(summary).toContain("- Text [display; prose, heading]: Short copy.");
    expect(summary).toContain("- rows: shape=array fields=name, secret count=1");
    expect(summary).toContain('<Text value="Visible" id="n1" />');
    expect(summary).not.toContain("Ada");
    expect(summary).not.toContain("prop");
  });

  it("bounds current-screen markup by characters", () => {
    const summary = summarizeStageForPrompt(
      {
        stageRevision: 1,
        currentScreen: { name: "home", markup: "x".repeat(1_000), issues: [] },
        screens: ["home"],
        components: [],
        data: [],
        issues: [],
      },
      { maxMarkupChars: 24 },
    );

    expect(summary).toContain("…[truncated]");
    expect(summary.length).toBeLessThan(400);
  });
});
