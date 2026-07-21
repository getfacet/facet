import { describe, expect, it } from "vitest";
import { BRICK_TYPES, type DataWarehouse, type FacetNode } from "@facet/core";

import { EXECUTOR_REGISTRY, describeNode, nodePreset } from "./executor-registry.js";

describe("executor registry exhaustiveness", () => {
  it("has exactly one entry per final brick", () => {
    expect(Object.keys(EXECUTOR_REGISTRY)).toEqual([...BRICK_TYPES]);
  });

  it("every entry carries only asNode and describe handlers", () => {
    for (const entry of Object.values(EXECUTOR_REGISTRY)) {
      expect(Object.keys(entry).sort()).toEqual(["asNode", "describe"]);
      expect(typeof entry.asNode).toBe("function");
      expect(typeof entry.describe).toBe("function");
    }
  });

  it("describes only current Preset style metadata", () => {
    const node = {
      id: "status",
      type: "progress",
      value: 75,
      style: { preset: "compact" },
    } as const satisfies FacetNode;

    expect(nodePreset(node)).toBe("compact");
    expect(describeNode(node, undefined)).toBe("status progress value=75 preset=compact");
  });
});

describe("richtext", () => {
  it("accepts a valid native brick and describes its block count", () => {
    const result = EXECUTOR_REGISTRY.richtext.asNode({
      id: "prose",
      type: "richtext",
      blocks: [
        {
          type: "paragraph",
          runs: [{ text: "Hello ", marks: [{ kind: "bold" }] }, { text: "world" }],
        },
      ],
    });
    expect("facetNode" in result).toBe(true);

    const node = {
      id: "prose",
      type: "richtext",
      blocks: [
        { type: "heading", level: 1, runs: [{ text: "Title" }] },
        { type: "paragraph", runs: [{ text: "Body" }] },
      ],
    } as unknown as FacetNode;
    expect(describeNode(node, undefined)).toBe("prose richtext blocks=2");
  });

  it("rejects a non-array blocks field", () => {
    const result = EXECUTOR_REGISTRY.richtext.asNode({
      id: "prose",
      type: "richtext",
      blocks: "nope",
    });
    expect("error" in result).toBe(true);
  });
});

describe("input", () => {
  it("requires a string name and describes it", () => {
    const ok = EXECUTOR_REGISTRY.input.asNode({ id: "q", type: "input", name: "query" });
    expect("facetNode" in ok).toBe(true);
    const bad = EXECUTOR_REGISTRY.input.asNode({ id: "q", type: "input" });
    expect("error" in bad).toBe(true);
    const node = { id: "q", type: "input", name: "query" } as unknown as FacetNode;
    expect(describeNode(node, undefined)).toBe('q input name="query"');
  });
});

describe("media", () => {
  it("accepts closed icon media without src and describes the icon name", () => {
    const ok = EXECUTOR_REGISTRY.media.asNode({
      id: "search",
      type: "media",
      kind: "icon",
      icon: "search",
    });
    expect(ok).toMatchObject({ facetNode: { kind: "icon", icon: "search" } });
    const badIcon = EXECUTOR_REGISTRY.media.asNode({
      id: "sparkles",
      type: "media",
      kind: "icon",
      icon: "sparkles",
    });
    expect(badIcon).toMatchObject({ error: expect.stringContaining("closed") });
    const badImage = EXECUTOR_REGISTRY.media.asNode({ id: "photo", type: "media", kind: "image" });
    expect(badImage).toMatchObject({ error: expect.stringContaining("src") });

    const icon = {
      id: "search",
      type: "media",
      kind: "icon",
      icon: "search",
    } as unknown as FacetNode;
    expect(describeNode(icon, undefined)).toBe('search media kind=icon icon="search"');
  });
});

describe("describeNode own-property guard", () => {
  it("plain-degrades every prototype-chain type without throwing", () => {
    for (const type of ["constructor", "toString", "prototype"]) {
      const junk = { id: "x", type } as unknown as FacetNode;
      expect(() => describeNode(junk, undefined)).not.toThrow();
      expect(describeNode(junk, undefined)).toBe(`type=${type}`);
    }
  });
});

describe("text from", () => {
  const boundText = {
    id: "kpi",
    type: "text",
    value: "",
    from: "sales",
    column: "revenue",
    row: 1,
  } as unknown as FacetNode;

  it("describes the resolved store cell and tracks later data", () => {
    const before: DataWarehouse = { sales: [{ revenue: 10 }, { revenue: 20 }] };
    const after: DataWarehouse = { sales: [{ revenue: 10 }, { revenue: 99 }] };
    expect(describeNode(boundText, before)).toBe('kpi text value="20"');
    expect(describeNode(boundText, after)).toBe('kpi text value="99"');
  });

  it("plain-degrades a dangling binding without throwing", () => {
    const warehouse: DataWarehouse = { other: [{ revenue: 5 }] };
    expect(() => describeNode(boundText, warehouse)).not.toThrow();
    expect(describeNode(boundText, warehouse)).toBe('kpi text value=""');
  });
});
