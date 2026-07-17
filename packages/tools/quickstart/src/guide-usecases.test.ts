import { describe, expect, it } from "vitest";
import { validateAuthorNode } from "@facet/core";
import { DEFAULT_THEME } from "@facet/react";
import { QUICKSTART_INTAKE_NODES, QUICKSTART_USE_CASE_NODES } from "./guide-usecases.js";

const RETIRED_NODE_FIELDS = ["active", "activeStyle", "activeVariant", "variant"] as const; // style-hard-cut: allowed-negative
const RETIRED_STYLE_PROPERTIES = [
  "align",
  "bg",
  "border",
  "pad",
  "radius",
  "size",
  "weight",
] as const;

describe("quickstart use-case guide", () => {
  it("uses only current authored style syntax", () => {
    const nodes = { ...QUICKSTART_INTAKE_NODES, ...QUICKSTART_USE_CASE_NODES };

    for (const node of Object.values(nodes)) {
      for (const field of RETIRED_NODE_FIELDS) {
        expect(node).not.toHaveProperty(field);
      }
      for (const property of RETIRED_STYLE_PROPERTIES) {
        expect(node.style).not.toHaveProperty(property);
      }

      const validated = validateAuthorNode(node, DEFAULT_THEME);
      expect(validated.issues, node.id).toEqual([]);
      expect(validated.value, node.id).toEqual(node);
    }

    expect(nodes["qs.intake"].style).toMatchObject({ preset: "panel" });
    expect(nodes["qs.usecases.hero.title"].style).toMatchObject({ preset: "heading" });
    expect(nodes["qs.usecases.actions"].style).toMatchObject({
      direction: "row",
      gap: "sm",
    });
  });
});
