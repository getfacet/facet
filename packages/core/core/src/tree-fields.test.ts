import { describe, expect, it } from "vitest";
import { TREE_FIELDS } from "./tree-fields.js";

describe("TREE_FIELDS", () => {
  it("lists every FacetTree field once in canonical document order", () => {
    expect(TREE_FIELDS).toEqual(["root", "nodes", "screens", "entry", "data"]);
    expect(new Set(TREE_FIELDS).size).toBe(TREE_FIELDS.length);
  });
});
