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
  "get_composition",
  "set_node",
  "remove_node",
  "say",
  "set_theme",
  "inspect_stage",
  "inspect_node",
];

const RETIRED_TERMS = [
  ["compo", "nent"].join(""),
  ["intrin", "sic"].join(""),
  ["primi", "tive"].join(""),
  ["leg", "acy"].join(""),
  ["but", "ton"].join(""),
  ["ta", "bs"].join(""),
  ["n", "av"].join(""),
  ["met", "ric"].join(""),
  ["st", "at"].join(""),
  ["fo", "rm"].join(""),
  ["filter", "Bar"].join(""),
] as const;

function tool(name: FacetStageToolName): ToolSpec<FacetStageToolName> {
  const found = getStageToolSpec(name);
  expect(found).toBeDefined();
  return found as ToolSpec<FacetStageToolName>;
}

function propertiesOf(spec: ToolSpec<FacetStageToolName>): Record<string, unknown> {
  return spec.parameters["properties"] as Record<string, unknown>;
}

describe("FACET_STAGE_TOOL_SPECS", () => {
  it("describes the brick-only stage contract", () => {
    const text = JSON.stringify(FACET_STAGE_TOOL_SPECS);
    const nodeSchemaText = JSON.stringify(propertiesOf(tool("append_node"))["node"]);
    const exactRoster = `Bricks are ${BRICK_TYPES.join(", ")}.`;

    expect(nodeSchemaText).toContain(exactRoster);
    expect(propertiesOf(tool("append_node"))["parentId"]).toMatchObject({
      description: expect.stringMatching(/existing box/i),
    });
    expect(tool("append_node").description).toMatch(/one brick/i);
    expect(tool("set_node").description).toMatch(/one brick/i);
    for (const term of RETIRED_TERMS) {
      expect(text).not.toMatch(new RegExp(`\\b${term}\\b`, "i"));
    }

    const reference = tool("get_composition");
    expect(reference.description).toMatch(/optionally read/i);
    expect(reference.description).toMatch(/reference/i);
    expect(reference.description).toMatch(/read-only/i);
    expect(reference.description).toMatch(/does not edit/i);
  });

  it("exports the exact provider-neutral stage tool surface", () => {
    const names = FACET_STAGE_TOOL_SPECS.map((spec) => spec.name);

    expect(names).toEqual(EXPECTED_NAMES);
    expect(FACET_STAGE_TOOL_NAMES).toEqual(EXPECTED_NAMES);
    expect(new Set(names).size).toBe(EXPECTED_NAMES.length);
    expect(TOOLS).toBe(FACET_STAGE_TOOL_SPECS);
    for (const spec of FACET_STAGE_TOOL_SPECS) {
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.parameters["type"]).toBe("object");
      expect(spec.parameters["properties"]).toEqual(expect.any(Object));
    }
  });

  it("keeps reference and theme tools name-only", () => {
    for (const name of ["get_composition", "set_theme"] as const) {
      const spec = tool(name);
      const props = propertiesOf(spec);
      expect(Object.keys(props)).toEqual(["name"]);
      expect(props["name"]).toMatchObject({ type: "string" });
      expect(spec.parameters["required"]).toEqual(["name"]);
      expect(spec.parameters["additionalProperties"]).toBe(false);
    }
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
