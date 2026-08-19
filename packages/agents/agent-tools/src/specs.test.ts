import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { validateComponentSpec } from "@facet/core";

import {
  FACET_TOOL_NAMES,
  FACET_TOOL_SPECS,
  componentSpecDetail,
  facetToolInputKeys,
} from "./specs.js";

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

    expect(publishData?.description).toContain("creates no visible markup");
    expect(publishData?.description).toContain("cannot finish that binding");
    expect(publishData?.description).toContain("publish once, then mutate markup");
    expect(publishData?.description).toContain("never republish unchanged data");
    expect(publishData?.description).toContain("existing exact binding");
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

  it("describes the complete structured component contract with a derived class", () => {
    const validated = validateComponentSpec({
      tag: "Collection",
      whenToUse: "Present repeated records with named content and action regions.",
      props: {
        name: {
          type: "string",
          required: true,
          guidance: "The field name used by collection requests.",
        },
        value: {
          type: "boolean",
          default: false,
          guidance: "Whether this collection is selected.",
        },
        rows: {
          type: "array",
          bindable: true,
          guidance: "Records published through the data model.",
          shape: {
            fields: {
              label: { type: "string", required: true, guidance: "Visible row label." },
              count: { type: "number", guidance: "Optional row count." },
              active: { type: "boolean", guidance: "Whether the row is active." },
            },
          },
        },
        image: {
          type: "string",
          assetKind: "image",
          guidance: "Host-pinned collection image.",
        },
      },
      content: {
        mode: "slots",
        slots: {
          items: {
            guidance: "Repeated visible items.",
            minChildren: 1,
            maxChildren: 8,
            allowedTags: ["Text", "Image"],
          },
          actions: {
            guidance: "Optional collection actions.",
            minChildren: 0,
            maxChildren: 2,
          },
        },
      },
      collect: { collectable: true, valueProp: "value", valueKind: "boolean" },
    });
    if (!validated.ok) {
      throw new Error(`expected component acceptance, got ${validated.code} at ${validated.at}`);
    }

    const detail = componentSpecDetail(validated.spec);

    expect(detail.contentClass).toBe("Structured");
    expect(detail.content).toEqual({
      mode: "slots",
      slots: {
        actions: {
          guidance: "Optional collection actions.",
          minChildren: 0,
          maxChildren: 2,
        },
        items: {
          guidance: "Repeated visible items.",
          minChildren: 1,
          maxChildren: 8,
          allowedTags: ["Text", "Image"],
        },
      },
    });
    expect(detail.props["rows"]).toMatchObject({
      type: "array",
      shape: {
        fields: {
          label: { type: "string", required: true },
          count: { type: "number" },
          active: { type: "boolean" },
        },
      },
    });
    expect(detail.props["image"]).toMatchObject({ type: "string", assetKind: "image" });
    expect(detail.collect).toMatchObject({ valueProp: "value", valueKind: "boolean" });
    expect(Object.isFrozen(detail)).toBe(true);
  });
});
