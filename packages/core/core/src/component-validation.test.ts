import { describe, expect, it } from "vitest";

import {
  canonicalComponentType,
  isComponentNodeType,
  isIntrinsicComponentType,
  isPrimitiveBrickType,
  MAX_COMPONENT_ARRAY_ITEMS,
  sanitizeComponentNode,
} from "./component-validation.js";
import {
  HIGH_LEVEL_NODE_TYPES,
  INTRINSIC_COMPONENT_TYPES,
  PRIMITIVE_BRICK_TYPES,
} from "./nodes.js";

const EXPECTED_INTRINSIC_COMPONENT_TYPES = [
  "button",
  "section",
  "card",
  "tabs",
  "table",
  "chart",
  "metric",
  "keyValue",
  "badge",
  "progress",
  "alert",
  "list",
  "divider",
  "form",
  "search",
  "filterBar",
  "emptyState",
  "loading",
] as const;

describe("component vocabulary", () => {
  it("keeps primitive bricks as the preserved fallback vocabulary", () => {
    expect(PRIMITIVE_BRICK_TYPES).toEqual(["box", "text", "media", "field"]);

    for (const type of PRIMITIVE_BRICK_TYPES) {
      expect(isPrimitiveBrickType(type)).toBe(true);
      expect(isIntrinsicComponentType(type)).toBe(false);
      expect(isComponentNodeType(type)).toBe(false);
    }
  });

  it("locks the intrinsic component set and keeps stat as a legacy metric alias", () => {
    expect(INTRINSIC_COMPONENT_TYPES).toEqual(EXPECTED_INTRINSIC_COMPONENT_TYPES);
    expect(INTRINSIC_COMPONENT_TYPES).not.toContain("stat");
    expect(HIGH_LEVEL_NODE_TYPES).toContain("stat");

    expect(isIntrinsicComponentType("metric")).toBe(true);
    expect(isIntrinsicComponentType("stat")).toBe(false);
    expect(isComponentNodeType("metric")).toBe(true);
    expect(isComponentNodeType("stat")).toBe(true);
    expect(canonicalComponentType("metric")).toBe("metric");
    expect(canonicalComponentType("stat")).toBe("metric");
    expect(canonicalComponentType("marquee")).toBeUndefined();
  });
});

describe("sanitizeComponentNode", () => {
  it("bounds component arrays without reading past the cap", () => {
    const items: unknown[] = Array.from({ length: MAX_COMPONENT_ARRAY_ITEMS }, (_, index) => ({
      label: `Label ${String(index)}`,
      value: `Value ${String(index)}`,
    }));
    items.length = MAX_COMPONENT_ARRAY_ITEMS + 3;
    Object.defineProperty(items, String(MAX_COMPONENT_ARRAY_ITEMS), {
      get() {
        throw new Error("component item cap over-read");
      },
    });
    const filters: unknown[] = Array.from({ length: MAX_COMPONENT_ARRAY_ITEMS }, (_, index) => ({
      name: `filter_${String(index)}`,
      label: `Filter ${String(index)}`,
      options: ["one", "two"],
    }));
    filters.length = MAX_COMPONENT_ARRAY_ITEMS + 3;
    Object.defineProperty(filters, String(MAX_COMPONENT_ARRAY_ITEMS), {
      get() {
        throw new Error("component filter cap over-read");
      },
    });

    const issues: string[] = [];
    const keyValue = sanitizeComponentNode("kv", { type: "keyValue", items }, issues);
    const filterBar = sanitizeComponentNode("filters", { type: "filterBar", filters }, issues);

    if (keyValue?.type !== "keyValue") throw new Error("expected keyValue node");
    if (filterBar?.type !== "filterBar") throw new Error("expected filterBar node");
    expect(keyValue.items).toHaveLength(MAX_COMPONENT_ARRAY_ITEMS);
    expect(filterBar.filters).toHaveLength(MAX_COMPONENT_ARRAY_ITEMS);
    expect(issues.some((issue) => issue.includes("items exceeded"))).toBe(true);
    expect(issues.some((issue) => issue.includes("filters exceeded"))).toBe(true);
  });

  it("does not preserve raw code, CSS, or backend data-fetch fields on form/search/filterBar", () => {
    const issues: string[] = [];
    const form = sanitizeComponentNode(
      "leadForm",
      {
        type: "form",
        title: "Lead capture",
        children: [],
        onSubmit: { name: "submit_lead" },
        endpoint: "https://api.example.test/leads",
        html: "<form></form>",
        css: ".lead { display: none }",
      },
      issues,
    );
    const search = sanitizeComponentNode(
      "search",
      {
        type: "search",
        name: "q",
        placeholder: "Search",
        onSubmit: { name: "run_search" },
        fetch: "/api/search",
        js: "alert(1)",
        dataSource: "tickets",
        query: "select * from tickets",
      },
      issues,
    );
    const filterBar = sanitizeComponentNode(
      "filters",
      {
        type: "filterBar",
        filters: [{ name: "status", label: "Status", options: ["Open"] }],
        onChange: { name: "set_filter" },
        url: "/api/filter",
        rawHtml: "<select></select>",
        expression: "status == 'Open'",
      },
      issues,
    );

    expect(form).toMatchObject({ type: "form", onSubmit: { kind: "agent", name: "submit_lead" } });
    expect(search).toMatchObject({
      type: "search",
      onSubmit: { kind: "agent", name: "run_search" },
    });
    expect(filterBar).toMatchObject({
      type: "filterBar",
      onChange: { kind: "agent", name: "set_filter" },
    });

    for (const node of [form, search, filterBar]) {
      const record = node as unknown as Record<string, unknown>;
      expect(record).not.toHaveProperty("endpoint");
      expect(record).not.toHaveProperty("fetch");
      expect(record).not.toHaveProperty("url");
      expect(record).not.toHaveProperty("html");
      expect(record).not.toHaveProperty("rawHtml");
      expect(record).not.toHaveProperty("js");
      expect(record).not.toHaveProperty("css");
      expect(record).not.toHaveProperty("dataSource");
      expect(record).not.toHaveProperty("query");
      expect(record).not.toHaveProperty("expression");
    }
    expect(issues.filter((issue) => issue.includes("not allowed on component nodes")).length).toBe(
      10,
    );
  });
});
