import { DEFAULT_CATALOG } from "@facet/assets";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import { deriveComponentInspectorRows } from "./component-inspector-model.js";

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

    for (const spec of DEFAULT_CATALOG.components) {
      const row = rowByTag(spec.tag);

      expect(Object.hasOwn(asRecord(spec), "category")).toBe(false);
      expect(Object.hasOwn(asRecord(spec), "group")).toBe(false);
      expect(row).not.toHaveProperty("category");
      expect(row).not.toHaveProperty("group");
      expect(row.whenToUse).toBe(spec.whenToUse);
      expect(row.contentMode).toBe(spec.content.mode);
      expect(row.contentClass).toMatch(/^(Leaf|Container|Structured)$/u);
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
    expect(rowByTag("Table").contentClass).toBe("Leaf");
    expect(tableRows).toMatchObject({
      name: "rows",
      type: "array",
      required: true,
      bindable: true,
      defaultValue: null,
    });

    expect(rowByTag("Field").collect).toEqual({
      valueProp: "value",
      valueKind: "string",
      sensitiveProp: "secret",
    });

    expect(rowByTag("Form")).toMatchObject({
      contentClass: "Structured",
      contentMode: "slots",
    });
    expect(rowByTag("Form").slots).toEqual([
      expect.objectContaining({ name: "fields", minChildren: 1, maxChildren: 20 }),
      expect.objectContaining({ name: "actions", minChildren: 1, maxChildren: 4 }),
    ]);

    expect(rowByTag("Screen").themeRecipe?.tokens).toContainEqual({
      name: "background",
      kind: "color",
    });
  });

  it("marks additive component specs as imported", () => {
    const importedSpec: ComponentSpec = {
      tag: "PromoBanner",
      whenToUse: "Use for active design announcements.",
      props: {},
      content: { mode: "none" },
    };
    const rows = deriveComponentInspectorRows({
      components: [...DEFAULT_CATALOG.components, importedSpec],
    });

    expect(rows.find((row) => row.tag === "Screen")?.source).toBe("default");
    expect(rows.find((row) => row.tag === "PromoBanner")?.source).toBe("imported");
    expect(rows.find((row) => row.tag === "PromoBanner")?.contentClass).toBe("Leaf");
  });
});
