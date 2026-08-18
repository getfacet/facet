import { describe, expect, it } from "vitest";

import type { UiPatternSet } from "@facet/core";

import { FACET_TOOL_NAMES } from "./specs.js";
import {
  UI_PATTERN_RESOURCE_BOUNDS,
  findUiPattern,
  projectUiPatternIndex,
  renderUiPatternForAgent,
} from "./ui-pattern.js";

const SET: UiPatternSet = {
  version: "test-v1",
  patterns: [
    {
      id: "compare",
      title: "Compare and decide",
      whenToUse: "Use when alternatives share decision criteria.",
      avoidWhen: ["Avoid when only one subject exists."],
      informationOrder: ["Criteria", "Differences", "Decision"],
      regions: [
        {
          id: "alternatives",
          purpose: "Align the viable alternatives.",
          relationship: "Keep the decision beside the compared facts.",
        },
      ],
      componentChoices: [
        {
          whenToUse: "Use for two or three alternatives.",
          tags: ["Grid", "Card", "Button"],
          rationale: "Equal groups support like-for-like scanning.",
        },
      ],
      variants: [
        {
          id: "side-by-side",
          whenToUse: "Use for a short criterion set.",
          composition: "Equal columns followed by one decision area.",
          exampleMarkup:
            '<Facet entry="main"><Screen name="main"><Grid columns="2"><Card title="A" /><Card title="B" /></Grid></Screen></Facet>',
        },
      ],
      avoid: ["Do not repeat generic claims."],
    },
  ],
};

describe("UI Pattern agent resources", () => {
  it("projects only compact discovery metadata", () => {
    expect(projectUiPatternIndex(SET)).toEqual([
      {
        id: "compare",
        title: "Compare and decide",
        whenToUse: "Use when alternatives share decision criteria.",
      },
    ]);
  });

  it("finds an exact pattern and renders its component guidance and variants", () => {
    const pattern = findUiPattern(SET, "compare");
    expect(pattern).toBe(SET.patterns[0]);
    expect(findUiPattern(SET, "missing")).toBeNull();
    if (pattern === null) return;

    const rendered = renderUiPatternForAgent(pattern);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.body).toContain("Component choices:");
    expect(rendered.body).toContain("Grid, Card, Button");
    expect(rendered.body).toContain("Variant side-by-side:");
    expect(rendered.body).toContain('<Grid columns="2">');
    expect(rendered.body.length).toBeLessThanOrEqual(UI_PATTERN_RESOURCE_BOUNDS.bodyChars);
  });

  it("keeps UI Pattern resources outside the exact nine stage tools", () => {
    expect(FACET_TOOL_NAMES).toEqual([
      "render_page",
      "insert_subtree",
      "replace_subtree",
      "update_node",
      "remove_subtree",
      "read_component_spec",
      "read_screen",
      "read_data",
      "publish_data",
    ]);
    expect(FACET_TOOL_NAMES).not.toContain("read_ui_pattern");
  });
});
