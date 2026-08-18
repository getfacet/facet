import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as agentTools from "./index.js";

const BARREL_EXPORT_CONTRACT = [
  "FACET_TOOL_NAMES",
  "FACET_TOOL_SPECS",
  "FacetToolName",
  "FacetToolSpec",
  "executeFacetTool",
  "FacetToolResult",
  "buildTurnObservation",
  "TurnObservation",
  "FACET_PROMPT_KIT",
  "createMarkupBuffer",
  "MarkupBuffer",
  "CatalogIndex",
  "RenderPageInput",
  "InsertSubtreeInput",
  "ReplaceSubtreeInput",
  "UpdateNodeInput",
  "RemoveSubtreeInput",
  "ReadComponentSpecInput",
  "ReadScreenInput",
  "ReadDataInput",
  "PublishDataInput",
  "FacetToolSession",
  "UI_PATTERN_RESOURCE_BOUNDS",
  "findUiPattern",
  "projectUiPatternIndex",
  "renderUiPatternForAgent",
  "RenderUiPatternResult",
  "UiPatternSummary",
] as const;

const VALUE_EXPORTS = [
  "FACET_PROMPT_KIT",
  "FACET_TOOL_NAMES",
  "FACET_TOOL_SPECS",
  "buildTurnObservation",
  "createMarkupBuffer",
  "executeFacetTool",
  "UI_PATTERN_RESOURCE_BOUNDS",
  "findUiPattern",
  "projectUiPatternIndex",
  "renderUiPatternForAgent",
] as const;

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function exportedNames(text: string): readonly string[] {
  const names = new Set<string>();
  const re = /export(?: type)? \{([^}]+)\}/g;
  for (const match of text.matchAll(re)) {
    const body = match[1];
    if (body === undefined) {
      continue;
    }
    for (const raw of body.split(",")) {
      const name = raw
        .trim()
        .split(/\s+as\s+/u)
        .at(-1)
        ?.trim();
      if (name !== undefined && name.length > 0) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

describe("@facet/agent-tools barrel", () => {
  it("exports exactly Barrel Export Contract list 6 and no retired names", () => {
    const text = source("./index.ts");

    expect(text).not.toMatch(/export\s+\*/u);
    expect(exportedNames(text)).toEqual([...BARREL_EXPORT_CONTRACT].sort());
    expect(text).not.toMatch(/SayToolInput|StageToolAssets|PatternIndexEntry|PresetIndexEntry/u);
    expect(Object.keys(agentTools).sort()).toEqual([...VALUE_EXPORTS].sort());
    expect("FacetToolSession" in agentTools).toBe(false);
  });

  it("pins the public roster and package dependency boundary", () => {
    expect(agentTools.FACET_TOOL_NAMES).toEqual([
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

    const productionSources = [
      "./types.ts",
      "./specs.ts",
      "./executor.ts",
      "./executor-mutations.ts",
      "./executor-reads.ts",
      "./executor-publish.ts",
      "./author-errors.ts",
      "./observation.ts",
      "./prompt-kit.ts",
      "./buffer.ts",
      "./ui-pattern.ts",
      "./index.ts",
    ].map(source);
    expect(productionSources.join("\n")).not.toContain("@facet/runtime");
  });
});
