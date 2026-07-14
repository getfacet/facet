import { describe, expect, it } from "vitest";

import * as nodeModule from "./nodes.js";
import {
  canonicalComponentType,
  isComponentNodeType,
  isIntrinsicComponentType,
  isPrimitiveBrickType,
  MAX_COMPONENT_ARRAY_ITEMS,
  sanitizeComponentNode,
} from "./component-validation.js";
import { INTRINSIC_COMPONENT_TYPES, PRIMITIVE_BRICK_TYPES } from "./nodes.js";
import { validateTree } from "./validate.js";

const EXPECTED_INTRINSIC_COMPONENT_TYPES = [
  "button",
  "section",
  "card",
  "tabs",
  "nav",
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
  "filterBar",
  "emptyState",
  "loading",
] as const;

describe("component vocabulary", () => {
  it("keeps primitive bricks as the preserved fallback vocabulary", () => {
    expect(PRIMITIVE_BRICK_TYPES).toEqual(["box", "text", "media", "input", "richtext"]);

    for (const type of PRIMITIVE_BRICK_TYPES) {
      expect(isPrimitiveBrickType(type)).toBe(true);
      expect(isIntrinsicComponentType(type)).toBe(false);
      expect(isComponentNodeType(type)).toBe(false);
    }
  });

  it("locks the intrinsic component set and keeps stat as a legacy metric alias", () => {
    expect(INTRINSIC_COMPONENT_TYPES).toEqual(EXPECTED_INTRINSIC_COMPONENT_TYPES);
    expect(INTRINSIC_COMPONENT_TYPES).not.toContain("stat");
    expect(isIntrinsicComponentType("metric")).toBe(true);
    expect(isIntrinsicComponentType("stat")).toBe(false);
    expect(isComponentNodeType("metric")).toBe(true);
    expect(isComponentNodeType("stat")).toBe(true);
    expect(canonicalComponentType("metric")).toBe("metric");
    expect(canonicalComponentType("stat")).toBe("metric");
    expect(canonicalComponentType("marquee")).toBeUndefined();
    expect(nodeModule).not.toHaveProperty("HIGH_LEVEL_NODE_TYPES");
  });

  it("search node type removed — no longer a component and fail-safe dropped", () => {
    expect(isComponentNodeType("search")).toBe(false);
    expect(isIntrinsicComponentType("search")).toBe(false);
    expect(INTRINSIC_COMPONENT_TYPES).not.toContain("search");
    const { tree } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["s"] },
        s: { id: "s", type: "search", name: "q", placeholder: "Search customers" },
      },
    });
    expect(tree.nodes["s"]).toBeUndefined();
  });
});

describe("sanitizeComponentNode", () => {
  it("matches validateTree's established behavior for every legacy high-level component", () => {
    const fixtures = [
      { type: "button", label: "Run", tone: "invented" },
      { type: "section", title: "Section", children: [] },
      { type: "card", title: "Card", children: [] },
      {
        type: "tabs",
        items: Array.from({ length: 13 }, (_, index) => ({
          label: `Tab ${String(index)}`,
          to: "x",
        })),
      },
      {
        type: "table",
        columns: [{ key: "name", label: "Name", align: "end" }],
        rows: [{ name: "Facet", ignored: "drop" }],
      },
      {
        type: "chart",
        series: Array.from({ length: 9 }, (_, index) => ({
          label: `Series ${String(index)}`,
          values: [index],
        })),
      },
      { type: "stat", label: "ARR", value: "$1m", tone: "success" },
      { type: "badge", label: "Ready", tone: "success" },
      { type: "progress", value: 101, label: "Done" },
      { type: "alert", body: "Heads up", tone: "warning" },
      { type: "list", items: Array.from({ length: 51 }, (_, index) => `Item ${String(index)}`) },
      { type: "divider", label: "Next" },
    ] as const;

    for (const [index, fixture] of fixtures.entries()) {
      const id = `component-${String(index)}`;
      const directIssues: string[] = [];
      const direct = sanitizeComponentNode(id, fixture, directIssues);
      const validated = validateTree({
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: [id] },
          [id]: { id, ...fixture },
        },
      });

      expect(direct, fixture.type).toEqual(validated.tree.nodes[id]);
      expect(directIssues, fixture.type).toEqual(validated.issues);
    }
  });

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

  it("does not preserve raw code, CSS, or backend data-fetch fields on form/filterBar", () => {
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
    expect(filterBar).toMatchObject({
      type: "filterBar",
      onChange: { kind: "agent", name: "set_filter" },
    });

    for (const node of [form, filterBar]) {
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
      6,
    );
  });
});

describe("sortable table columns", () => {
  it("retains a boolean sortable flag on a validated column", () => {
    const issues: string[] = [];
    const node = sanitizeComponentNode(
      "sortableTable",
      {
        type: "table",
        columns: [
          { key: "name", label: "Name", sortable: true },
          { key: "age", label: "Age", sortable: false },
        ],
        rows: [{ name: "Facet", age: 1 }],
      },
      issues,
    );

    if (node?.type !== "table") throw new Error("expected table node");
    expect(node.columns[0]).toMatchObject({ key: "name", label: "Name", sortable: true });
    expect(node.columns[1]).toMatchObject({ key: "age", label: "Age", sortable: false });
    expect(issues).toEqual([]);
  });

  it("drops a non-boolean sortable with an issue and still renders the column", () => {
    const badValues: readonly unknown[] = ["yes", 1, {}, null];
    for (const bad of badValues) {
      const issues: string[] = [];
      const node = sanitizeComponentNode(
        "badSortable",
        {
          type: "table",
          columns: [{ key: "name", label: "Name", sortable: bad }],
          rows: [{ name: "Facet" }],
        },
        issues,
      );

      if (node?.type !== "table") throw new Error("expected table node");
      expect(node.columns).toHaveLength(1);
      expect(node.columns[0]).toMatchObject({ key: "name", label: "Name" });
      expect(node.columns[0]).not.toHaveProperty("sortable");
      expect(issues.some((issue) => issue.includes("sortable"))).toBe(true);
    }
  });

  it("omits sortable when absent and never throws on a malformed flag", () => {
    expect(() =>
      validateTree({
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["t"] },
          t: {
            id: "t",
            type: "table",
            columns: [{ key: "name", label: "Name", sortable: "bogus" }],
            rows: [{ name: "Facet" }],
          },
        },
      }),
    ).not.toThrow();

    const issues: string[] = [];
    const node = sanitizeComponentNode(
      "plainTable",
      { type: "table", columns: [{ key: "name", label: "Name" }], rows: [] },
      issues,
    );

    if (node?.type !== "table") throw new Error("expected table node");
    expect(node.columns[0]).not.toHaveProperty("sortable");
    expect(issues).toEqual([]);
  });
});
