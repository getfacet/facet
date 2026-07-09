import { describe, expect, it } from "vitest";
import { INTRINSIC_COMPONENT_TYPES, PRIMITIVE_BRICK_TYPES } from "@facet/core";
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
  "use_stamp",
  "set_node",
  "remove_node",
  "say",
  "set_theme",
  "inspect_stage",
  "inspect_node",
];

function tool(name: FacetStageToolName): ToolSpec<FacetStageToolName> {
  const found = getStageToolSpec(name);
  expect(found).toBeDefined();
  return found as ToolSpec<FacetStageToolName>;
}

function propertiesOf(spec: ToolSpec<FacetStageToolName>): Record<string, unknown> {
  return spec.parameters["properties"] as Record<string, unknown>;
}

function allToolText(): string {
  return JSON.stringify(FACET_STAGE_TOOL_SPECS);
}

describe("FACET_STAGE_TOOL_SPECS", () => {
  it("exports existing stage tools plus bounded inspection tools", () => {
    const names = FACET_STAGE_TOOL_SPECS.map((spec) => spec.name);

    expect(names).toEqual(EXPECTED_NAMES);
    expect(FACET_STAGE_TOOL_NAMES).toEqual(EXPECTED_NAMES);
    expect(new Set(names).size).toBe(EXPECTED_NAMES.length);
    expect(TOOLS).toBe(FACET_STAGE_TOOL_SPECS);
  });

  it("uses provider-neutral object JSON Schema parameters for every tool", () => {
    for (const spec of FACET_STAGE_TOOL_SPECS) {
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.parameters["type"]).toBe("object");
      expect(spec.parameters["properties"]).toEqual(expect.any(Object));
    }
  });

  it("keeps set_theme name-only and never exposes CSS value fields", () => {
    const props = propertiesOf(tool("set_theme"));

    expect(Object.keys(props)).toEqual(["name"]);
    expect(props["name"]).toMatchObject({ type: "string" });
  });

  it("describes stamp expansion as name plus string params plus parent location", () => {
    const props = propertiesOf(tool("use_stamp"));
    const params = props["params"] as Record<string, unknown>;
    const at = props["at"] as Record<string, unknown>;

    expect(Object.keys(props)).toEqual(["name", "params", "at"]);
    expect(props["name"]).toMatchObject({ type: "string" });
    expect(params["additionalProperties"]).toMatchObject({ type: "string" });
    expect(at["required"]).toEqual(["parent"]);
  });

  it("documents component node schemas and catalog policy boundaries", () => {
    const renderPage = tool("render_page");
    const appendNode = tool("append_node");
    const setNode = tool("set_node");
    const setTheme = tool("set_theme");
    const useStamp = tool("use_stamp");
    const nodeSchemaText = JSON.stringify(propertiesOf(appendNode)["node"]);

    expect(renderPage.description).toMatch(/catalog policy/i);
    expect(appendNode.description).toMatch(/box, section, card, or form/i);
    expect(nodeSchemaText).toMatch(/Primitive Brick -> Component -> Catalog/);
    for (const type of PRIMITIVE_BRICK_TYPES) {
      expect(nodeSchemaText).toContain(type);
    }
    for (const type of INTRINSIC_COMPONENT_TYPES) {
      expect(nodeSchemaText).toContain(type);
    }
    expect(nodeSchemaText).toMatch(/metric/);
    expect(nodeSchemaText).toMatch(/legacy stat/i);
    expect(JSON.stringify(propertiesOf(setNode)["node"])).toMatch(/section|card|table|chart/);
    expect(setTheme.description).toMatch(/locked/i);
    expect(setTheme.description).toMatch(/catalog/i);
    expect(useStamp.description).toMatch(/compat/i);
    expect(useStamp.description).toMatch(/composition/i);
    const retiredTerm = new RegExp(["high-level", "brick"].join(" "), "i");
    expect(allToolText()).not.toMatch(retiredTerm);
    expect(allToolText()).not.toMatch(/v1 brick/i);
  });

  it("bounds inspection schemas", () => {
    const inspectStage = propertiesOf(tool("inspect_stage"));
    const inspectNode = propertiesOf(tool("inspect_node"));

    expect(inspectStage["maxNodes"]).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 200,
    });
    expect(inspectNode["depth"]).toMatchObject({
      type: "integer",
      minimum: 0,
      maximum: 5,
    });
    expect(inspectNode["nodeId"]).toMatchObject({ type: "string" });
  });
});
