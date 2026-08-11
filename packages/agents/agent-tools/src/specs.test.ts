import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FACET_TOOL_NAMES, FACET_TOOL_SPECS, facetToolInputKeys } from "./specs.js";

const EXPECTED_TOOL_NAMES = [
  "render_page",
  "insert_subtree",
  "replace_subtree",
  "update_node",
  "remove_subtree",
  "read_component_spec",
  "read_screen",
  "read_data",
  "publish_data",
] as const;

function typesSource(): string {
  return readFileSync(new URL("./types.ts", import.meta.url), "utf8");
}

describe("FACET_TOOL_SPECS", () => {
  it("pins exactly the nine provider-neutral tool names and no conversational tool", () => {
    expect(FACET_TOOL_NAMES).toEqual(EXPECTED_TOOL_NAMES);
    expect(FACET_TOOL_SPECS.map((spec) => spec.name)).toEqual(EXPECTED_TOOL_NAMES);
    expect(FACET_TOOL_SPECS).toHaveLength(9);
    expect(FACET_TOOL_NAMES).not.toContain("say");
    expect(FACET_TOOL_NAMES).not.toContain("append_node"); // component-hard-cut: allowed-negative
    expect(FACET_TOOL_NAMES).not.toContain("set_node"); // component-hard-cut: allowed-negative
    expect(FACET_TOOL_NAMES).not.toContain("remove_node"); // component-hard-cut: allowed-negative
    expect(FACET_TOOL_NAMES).not.toContain("inspect_stage"); // component-hard-cut: allowed-negative
  });

  it("asserts render_page keeps its stable name but accepts markup, not tree", () => {
    const renderPage = FACET_TOOL_SPECS.find((spec) => spec.name === "render_page");

    expect(renderPage).toBeDefined();
    expect(renderPage?.inputSchema).toMatchObject({
      type: "object",
      required: ["markup"],
      properties: {
        markup: { type: "string" },
      },
      additionalProperties: false,
    });
    expect(JSON.stringify(renderPage?.inputSchema)).not.toContain("tree");
  });

  it("derives executor-facing input keys from the canonical tool specs", () => {
    expect(facetToolInputKeys("render_page")).toEqual(["markup"]);
    expect(facetToolInputKeys("insert_subtree")).toEqual(["targetId", "markup"]);
    expect(facetToolInputKeys("publish_data")).toEqual(["path", "value"]);
  });

  it("describes publish_data as data-lane work rather than visible authoring", () => {
    const publishData = FACET_TOOL_SPECS.find((spec) => spec.name === "publish_data");

    expect(publishData?.description).toContain(
      "visible UI only where current markup already binds",
    );
  });

  it("does not expose raw JSON Patch or a conversation-producing tool", () => {
    const names = FACET_TOOL_SPECS.map((spec) => spec.name).join(" ");
    const schemas = JSON.stringify(FACET_TOOL_SPECS);

    expect(names).not.toMatch(/patch|json_patch|document_mutation/u);
    expect(schemas).not.toContain("JsonPatch");
    expect(schemas).not.toContain("conversation");
    expect(FACET_TOOL_SPECS.every((spec) => spec.producesConversation === false)).toBe(true);
  });

  it("re-exports FacetToolSession from @facet/core without redeclaring it or importing runtime", () => {
    const source = typesSource();

    expect(source).not.toMatch(
      /import type \{[^}]*\bFacetToolSession\b[^}]*\} from "@facet\/core";/u,
    );
    expect(source).toContain('export type { FacetToolSession } from "@facet/core";');
    expect(source).not.toMatch(/interface\s+FacetToolSession|type\s+FacetToolSession/u);
    expect(source).not.toContain("@facet/runtime");
  });
});
