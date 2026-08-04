import { DEFAULT_CATALOG } from "@facet/assets";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMPONENT_PRESENTATION_BY_TAG,
  deriveComponentInspectorRows,
} from "./component-inspector-model.js";

function defaultTags(): readonly string[] {
  return DEFAULT_CATALOG.components.map((spec) => spec.tag);
}

function rowByTag(tag: string) {
  const row = deriveComponentInspectorRows(DEFAULT_CATALOG).find((candidate) => {
    return candidate.tag === tag;
  });
  if (row === undefined) {
    throw new Error(`Missing component row for ${tag}`);
  }
  return row;
}

function asRecord(spec: ComponentSpec): Record<string, unknown> {
  return spec as unknown as Record<string, unknown>;
}

describe("component inspector model", () => {
  it("derives every default component without adding catalog category metadata", () => {
    const rows = deriveComponentInspectorRows(DEFAULT_CATALOG);
    const tags = defaultTags();

    expect(rows.map((row) => row.tag)).toEqual(tags);
    expect(Object.keys(DEFAULT_COMPONENT_PRESENTATION_BY_TAG).sort()).toEqual([...tags].sort());

    for (const spec of DEFAULT_CATALOG.components) {
      const row = rowByTag(spec.tag);

      expect(Object.hasOwn(asRecord(spec), "category")).toBe(false);
      expect(Object.hasOwn(asRecord(spec), "group")).toBe(false);
      expect(row).not.toHaveProperty("category");
      expect(row).not.toHaveProperty("group");
      expect(row.whenToUse).toBe(spec.whenToUse);
      expect(row.acceptsChildren).toBe(spec.acceptsChildren);
      expect(row.presentation.section).not.toBe("other");
      expect(row.props.map((prop) => prop.name)).toEqual(Object.keys(spec.props));
    }
  });

  it("formats props collect metadata and theme recipe tokens for component details", () => {
    const gridColumns = rowByTag("Grid").props.find((prop) => prop.name === "columns");
    expect(gridColumns).toMatchObject({
      name: "columns",
      type: "number",
      required: false,
      bindable: false,
      defaultValue: "3",
      rangeLabel: "1-6",
    });

    const badgeTone = rowByTag("Badge").props.find((prop) => prop.name === "tone");
    expect(badgeTone?.enumValues).toEqual(["neutral", "positive", "warning", "danger"]);
    expect(badgeTone?.defaultValue).toBe("neutral");

    const tableRows = rowByTag("Table").props.find((prop) => prop.name === "rows");
    expect(rowByTag("Table").presentation).toMatchObject({
      section: "content",
      label: "Content",
    });
    expect(tableRows).toMatchObject({
      name: "rows",
      type: "array",
      required: true,
      bindable: true,
      defaultValue: null,
    });

    expect(rowByTag("Field").collect).toEqual({
      valueProp: "value",
      sensitiveProp: "secret",
    });

    expect(rowByTag("Screen").themeRecipe?.tokens).toContainEqual({
      name: "background",
      kind: "color",
    });
  });
});
