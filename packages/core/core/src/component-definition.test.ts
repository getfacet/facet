import { describe, expect, it } from "vitest";

import { validateComponentDefinition } from "./component-definition.js";
import { validateComponentDefinition as barrelValidateComponentDefinition } from "./index.js";
import { validateTheme } from "./theme.js";

describe("validateComponentDefinition", () => {
  it("normalizes a safe stamp-compatible component template", () => {
    const { definition, issues } = validateComponentDefinition({
      name: "customerSummaryCard",
      description: "Reusable customer summary",
      slots: {
        customer: "Acme",
        arr: "$24k",
      },
      root: "card",
      nodes: {
        card: {
          id: "card",
          type: "card",
          title: "{{customer}}",
          children: ["metric", "action"],
        },
        metric: { id: "metric", type: "metric", label: "ARR", value: "{{arr}}" },
        action: {
          id: "action",
          type: "button",
          label: "Open customer",
          onPress: { name: "open_customer", payload: { id: "acme" } },
        },
      },
    });

    expect(issues).toHaveLength(0);
    expect(definition).toMatchObject({
      name: "customerSummaryCard",
      description: "Reusable customer summary",
      root: "card",
      slots: {
        customer: "Acme",
        arr: "$24k",
      },
    });
    expect(definition?.nodes["metric"]).toMatchObject({
      id: "metric",
      type: "metric",
      label: "ARR",
      value: "{{arr}}",
    });
    expect(definition?.nodes["action"]).toMatchObject({
      type: "button",
      onPress: { kind: "agent", name: "open_customer", payload: { id: "acme" } },
    });
    expect(barrelValidateComponentDefinition).toBe(validateComponentDefinition);
  });

  it("refuses raw HTML JS CSS data-binding and backend-fetch fields", () => {
    const { definition, issues } = validateComponentDefinition({
      name: "leadCapture",
      root: "form",
      nodes: {
        form: {
          id: "form",
          type: "form",
          title: "Lead capture",
          children: [],
          html: "<form></form>",
          js: "alert(1)",
          css: ".lead { display: none }",
          dataSource: "leads",
          query: "select * from leads",
          endpoint: "https://api.example.test/leads",
        },
      },
    });

    expect(definition).toBeUndefined();
    expect(
      issues.filter((issue) => issue.includes("not allowed in component definitions")),
    ).toHaveLength(6);
  });

  it("refuses templates that reference unknown component names", () => {
    const { definition, issues } = validateComponentDefinition({
      name: "badSummary",
      root: "root",
      nodes: {
        root: { id: "root", type: "customerSummaryCard", children: [] },
      },
    });

    expect(definition).toBeUndefined();
    expect(issues.some((issue) => issue.includes("unknown component type"))).toBe(true);
  });

  it("caps intrinsic arrays while keeping safe normalized output", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      label: `Label ${String(index)}`,
      value: `Value ${String(index)}`,
    }));

    const { definition, issues } = validateComponentDefinition({
      name: "details",
      root: "kv",
      nodes: {
        kv: { id: "kv", type: "keyValue", items },
      },
    });

    const kv = definition?.nodes["kv"] as unknown as { items?: readonly unknown[] } | undefined;
    expect(kv?.items).toHaveLength(32);
    expect(issues.some((issue) => issue.includes("items exceeded"))).toBe(true);
  });

  it("fails safe on cyclic and pathologically deep templates", () => {
    const cyclic = validateComponentDefinition({
      name: "cyclic",
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["child"] },
        child: { id: "child", type: "box", children: ["root"] },
      },
    });
    const child = cyclic.definition?.nodes["child"] as unknown as
      { children?: readonly string[] } | undefined;
    expect(child?.children).toEqual([]);
    expect(cyclic.issues.some((issue) => issue.includes("cyclic"))).toBe(true);

    const nodes: Record<string, unknown> = {
      root: { id: "root", type: "box", children: ["n0"] },
    };
    for (let i = 0; i < 5000; i += 1) {
      nodes[`n${String(i)}`] = {
        id: `n${String(i)}`,
        type: "box",
        children: i < 4999 ? [`n${String(i + 1)}`] : [],
      };
    }

    expect(() =>
      validateComponentDefinition({
        name: "deep",
        root: "root",
        nodes,
      }),
    ).not.toThrow();
    const deep = validateComponentDefinition({ name: "deep", root: "root", nodes });
    expect(deep.definition).toBeDefined();
    expect(deep.issues.some((issue) => issue.includes("max depth"))).toBe(true);
  });

  it("refuses malformed hostile definitions without throwing", () => {
    const input = {
      name: "bad",
      root: "root",
      get nodes(): unknown {
        throw new Error("boom");
      },
    };

    expect(() => validateComponentDefinition(input)).not.toThrow();
    const { definition, issues } = validateComponentDefinition(input);
    expect(definition).toBeUndefined();
    expect(issues).toContain("component definition could not be read safely; refused");
  });

  it("keeps component definitions out of theme recipes", () => {
    const { theme, issues } = validateTheme({
      name: "brand",
      componentDefinitions: {
        customerSummaryCard: {
          root: "card",
          nodes: { card: { id: "card", type: "card", children: [] } },
        },
      },
      recipes: {
        customerSummaryCard: {
          default: {
            root: "card",
            nodes: { card: { id: "card", type: "card", children: [] } },
          },
        },
        card: {
          default: {
            root: "card",
            nodes: { card: { id: "card", type: "card", children: [] } },
            box: { bg: "surface", pad: "md" },
          },
        },
      },
    });

    expect(theme?.recipes?.card?.default).toEqual({ box: { bg: "surface", pad: "md" } });
    expect(theme?.recipes).not.toHaveProperty("customerSummaryCard");
    expect(theme).not.toHaveProperty("componentDefinitions");
    expect(issues.some((issue) => issue.message.includes("unknown theme key"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("unknown component"))).toBe(true);
  });
});
