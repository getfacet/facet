import { BRICK_TYPES } from "@facet/core";
import { describe, expect, it } from "vitest";
import {
  FACET_STAGE_TOOL_NAMES,
  FACET_STAGE_TOOL_SPECS,
  TOOLS,
  getStageToolSpec,
} from "./specs.js";
import type { FacetStageToolName, ToolSpec } from "./types.js";

const EXPECTED_NAMES: readonly FacetStageToolName[] = [
  "render_page",
  "append_node",
  "set_node",
  "remove_node",
  "say",
  "get_brick_spec",
  "get_style_choices",
  "get_preset",
  "get_pattern",
  "inspect_stage",
  "inspect_node",
];
const RETIRED_TOOLS = ["get_composition", "set_theme", "get_token"] as const; // style-hard-cut: allowed-negative

function tool(name: FacetStageToolName): ToolSpec<FacetStageToolName> {
  const found = getStageToolSpec(name);
  expect(found).toBeDefined();
  return found as ToolSpec<FacetStageToolName>;
}

function propertiesOf(spec: ToolSpec<FacetStageToolName>): Record<string, unknown> {
  return spec.parameters["properties"] as Record<string, unknown>;
}

describe("FACET_STAGE_TOOL_SPECS", () => {
  it("exports only the hard-cut tool roster", () => {
    const names = FACET_STAGE_TOOL_SPECS.map((spec) => spec.name);

    expect(names).toEqual(EXPECTED_NAMES);
    expect(FACET_STAGE_TOOL_NAMES).toEqual(EXPECTED_NAMES);
    expect(new Set(names).size).toBe(EXPECTED_NAMES.length);
    expect(TOOLS).toBe(FACET_STAGE_TOOL_SPECS);
    for (const retired of RETIRED_TOOLS) {
      expect(names).not.toContain(retired);
    }
  });

  it("keeps mutation schemas generic and compact", () => {
    const node = propertiesOf(tool("append_node"))["node"] as Record<string, unknown>;
    const tree = propertiesOf(tool("render_page"))["tree"] as Record<string, unknown>;
    const serialized = JSON.stringify(FACET_STAGE_TOOL_SPECS);

    expect(Object.keys(node)).toEqual(["type", "description"]);
    expect(Object.keys(tree)).toEqual(["type", "description"]);
    expect(serialized.length).toBeLessThan(7_000);
    expect(serialized).not.toMatch(/"theme"|"tokens"|"presets"|"patterns"/i);
    expect(String(node["description"])).toContain(BRICK_TYPES.join(", "));
    expect(String(node["description"])).toMatch(/get_brick_spec/i);
  });

  it("defines bounded progressive discovery inputs", () => {
    expect(propertiesOf(tool("get_brick_spec"))["type"]).toMatchObject({
      type: "string",
      enum: BRICK_TYPES,
    });
    expect(tool("get_brick_spec").parameters["required"]).toEqual(["type"]);

    expect(Object.keys(propertiesOf(tool("get_style_choices")))).toEqual([
      "brick",
      "target",
      "property",
    ]);
    expect(propertiesOf(tool("get_style_choices"))["brick"]).toMatchObject({
      type: "string",
      enum: BRICK_TYPES,
    });
    expect(tool("get_style_choices").parameters["required"]).toEqual([
      "brick",
      "target",
      "property",
    ]);

    expect(Object.keys(propertiesOf(tool("get_preset")))).toEqual(["brick", "name"]);
    expect(Object.keys(propertiesOf(tool("get_pattern")))).toEqual(["name"]);
    expect(tool("get_preset").parameters["required"]).toEqual(["brick", "name"]);
    expect(tool("get_pattern").parameters["required"]).toEqual(["name"]);
  });

  it("keeps product-grade vocabulary behind progressive reads", () => {
    const getBrickSpec = tool("get_brick_spec");
    const getStyleChoices = tool("get_style_choices");
    const appendNode = propertiesOf(tool("append_node"))["node"] as Record<string, unknown>;
    const descriptions = `${getBrickSpec.description}\n${getStyleChoices.description}`;

    expect(String(appendNode["description"])).toContain(BRICK_TYPES.join(", "));
    expect(Object.keys(appendNode)).toEqual(["type", "description"]);
    expect(getBrickSpec.parameters).toMatchObject({
      properties: { type: { enum: BRICK_TYPES } },
      required: ["type"],
    });
    expect(getStyleChoices.parameters).toMatchObject({
      properties: { brick: { enum: BRICK_TYPES } },
      required: ["brick", "target", "property"],
    });
    expect(descriptions).toMatch(/media icon/i);
    expect(descriptions).toMatch(/table alignment/i);
    expect(descriptions).toMatch(/chart line style/i);
    expect(descriptions).toMatch(/textWrap/i);
    expect(descriptions).toMatch(/lineClamp/i);
    expect(descriptions).toMatch(/lineStyle/i);
    expect(descriptions).toMatch(/axisColor/i);
    expect(descriptions).toMatch(/gridColor/i);
    expect(descriptions).toMatch(/labelColor/i);
  });

  it("bounds inspection schemas", () => {
    expect(propertiesOf(tool("inspect_stage"))["maxNodes"]).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 200,
    });
    expect(propertiesOf(tool("inspect_node"))["depth"]).toMatchObject({
      type: "integer",
      minimum: 0,
      maximum: 5,
    });
  });
});

describe("analytics-data-surface discovery vocabulary", () => {
  it("enumerates the new chart and table vocabulary in the progressive-read descriptions", () => {
    const descriptions = `${tool("get_brick_spec").description}\n${tool("get_style_choices").description}`;

    for (const term of [
      "width",
      "narrow",
      "medium",
      "wide",
      "emptyLabel",
      "dividers",
      "none",
      "rows",
      "grid",
      "stickyHeader",
      "axis",
      "primary",
      "secondary",
    ]) {
      expect(descriptions).toContain(term);
    }
    // Existing progressive-read anchors must survive the extension.
    expect(descriptions).toMatch(/media icon/i);
    expect(descriptions).toMatch(/table alignment/i);
    expect(descriptions).toMatch(/chart line style/i);
  });
});
