import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  validateChart,
  validateKeyValue,
  validateList,
  validateLoading,
  validateProgress,
  validateTable,
} from "./brick-validation.js";
import { MAX_BRICK_ARRAY_ITEMS, MAX_TABLE_COLUMNS } from "./brick-validation-shared.js";

type SurvivorValidator = (id: string, raw: Record<string, unknown>, issues: string[]) => unknown;

function validate(
  validator: SurvivorValidator,
  id: string,
  raw: Record<string, unknown>,
): { node: unknown; issues: readonly string[] } {
  const issues: string[] = [];
  return { node: validator(id, raw, issues), issues };
}

describe("brick survivor validation", () => {
  it("styles six data bricks without variant or tone", () => {
    expect(
      validate(validateTable, "table", {
        columns: [{ key: "name", label: "Name", align: "end" }],
        rows: [{ name: "Facet" }],
        variant: "dense", // style-hard-cut: allowed-negative
        style: {
          preset: "dense",
          width: "full",
          header: { background: "accentSurface", sorted: { fontWeight: "bold" } },
          cell: { padding: "sm" },
        },
      }),
    ).toEqual({
      node: {
        id: "table",
        type: "table",
        columns: [{ key: "name", label: "Name" }],
        rows: [{ name: "Facet" }],
        style: {
          preset: "dense",
          width: "full",
          header: { background: "accentSurface", sorted: { fontWeight: "bold" } },
          cell: { padding: "sm" },
        },
      },
      issues: [],
    });

    expect(
      validate(validateChart, "chart", {
        series: [{ label: "Revenue", values: [1, 2] }],
        variant: "dashboard", // style-hard-cut: allowed-negative
        style: {
          gap: "md",
          title: { fontSize: "xl" },
          series: { color1: "chart1", thickness: "lg" },
        },
      }),
    ).toEqual({
      node: {
        id: "chart",
        type: "chart",
        kind: "bar",
        series: [{ label: "Revenue", values: [1, 2] }],
        style: {
          gap: "md",
          title: { fontSize: "xl" },
          series: { color1: "chart1", thickness: "lg" },
        },
      },
      issues: [],
    });

    expect(
      validate(validateList, "list", {
        items: ["One"],
        variant: "stack", // style-hard-cut: allowed-negative
        style: { gap: "sm", item: { padding: "md" }, marker: { color: "accent" } },
      }),
    ).toEqual({
      node: {
        id: "list",
        type: "list",
        items: [{ title: "One" }],
        style: { gap: "sm", item: { padding: "md" }, marker: { color: "accent" } },
      },
      issues: [],
    });

    expect(
      validate(validateKeyValue, "keyValue", {
        items: [{ label: "Revenue", value: "$12", tone: "success" }], // style-hard-cut: allowed-negative
        variant: "summary", // style-hard-cut: allowed-negative
        style: { gap: "xs", value: { fontWeight: "semibold" } },
      }),
    ).toEqual({
      node: {
        id: "keyValue",
        type: "keyValue",
        items: [{ label: "Revenue", value: "$12" }],
        style: { gap: "xs", value: { fontWeight: "semibold" } },
      },
      issues: [],
    });

    expect(
      validate(validateProgress, "progress", {
        value: 75,
        tone: "success", // style-hard-cut: allowed-negative
        variant: "positive", // style-hard-cut: allowed-negative
        style: {
          width: "full",
          track: { height: "md" },
          fill: { backgroundGradient: "success" },
        },
      }),
    ).toEqual({
      node: {
        id: "progress",
        type: "progress",
        value: 75,
        style: {
          width: "full",
          track: { height: "md" },
          fill: { backgroundGradient: "success" },
        },
      },
      issues: [],
    });

    expect(
      validate(validateLoading, "loading", {
        label: "Waiting",
        variant: "inline", // style-hard-cut: allowed-negative
        style: {
          direction: "row",
          indicator: { size: "sm", animation: "pulse" },
          label: { color: "mutedForeground" },
        },
      }),
    ).toEqual({
      node: {
        id: "loading",
        type: "loading",
        label: "Waiting",
        style: {
          direction: "row",
          indicator: { size: "sm", animation: "pulse" },
          label: { color: "mutedForeground" },
        },
      },
      issues: [],
    });
  });

  it("preserves all six survivor validators under the brick roster", () => {
    const longLabel = "x".repeat(201);

    expect(
      validate(validateTable, "table", {
        type: "table",
        columns: [
          { key: "name", label: "Name", align: "end", sortable: "yes" },
          { key: "bad key", label: "Dropped" },
        ],
        rows: [{ name: "Facet", ignored: "drop" }],
        caption: "Results",
        from: "sales",
      }),
    ).toEqual({
      node: {
        id: "table",
        type: "table",
        columns: [{ key: "name", label: "Name" }],
        rows: [{ name: "Facet" }],
        caption: "Results",
        from: "sales",
      },
      issues: ['node "table": non-boolean sortable "yes" dropped'],
    });

    expect(
      validate(validateChart, "chart", {
        type: "chart",
        kind: "pie",
        series: [{ label: "Revenue", values: [1, 2, "3", Number.POSITIVE_INFINITY] }],
        labels: ["Q1", 2],
        title: "Revenue",
        from: "bad dataset",
      }),
    ).toEqual({
      node: {
        id: "chart",
        type: "chart",
        kind: "bar",
        series: [{ label: "Revenue", values: [1, 2] }],
        labels: ["Q1"],
        title: "Revenue",
      },
      issues: ['node "chart": malformed from dropped'],
    });

    expect(
      validate(validateList, "list", {
        type: "list",
        items: ["One", { title: "Two", body: "Body" }, { title: 3 }],
        from: "sales",
      }),
    ).toEqual({
      node: {
        id: "list",
        type: "list",
        items: [{ title: "One" }, { title: "Two", body: "Body" }],
        from: "sales",
      },
      issues: [],
    });

    expect(
      validate(validateKeyValue, "keyValue", {
        type: "keyValue",
        items: [
          { key: "revenue", label: "Revenue", value: "$12" },
          { label: "Dropped", value: 12 },
        ],
        from: "bad dataset",
      }),
    ).toEqual({
      node: {
        id: "keyValue",
        type: "keyValue",
        items: [{ key: "revenue", label: "Revenue", value: "$12" }],
      },
      issues: ['node "keyValue": malformed from dropped'],
    });

    expect(
      validate(validateProgress, "progress", {
        type: "progress",
        value: 101,
        label: "Done",
      }),
    ).toEqual({
      node: { id: "progress", type: "progress", value: 100, label: "Done" },
      issues: ['node "progress": progress value clamped to 100'],
    });

    expect(
      validate(validateLoading, "loading", {
        type: "loading",
        label: longLabel,
      }),
    ).toEqual({
      node: { id: "loading", type: "loading", label: longLabel.slice(0, 200) },
      issues: ['node "loading": label truncated to 200 characters'],
    });
  });

  it("bounds survivor arrays without reading beyond their caps", () => {
    const items: unknown[] = Array.from({ length: MAX_BRICK_ARRAY_ITEMS }, (_, index) => ({
      label: `Label ${String(index)}`,
      value: `Value ${String(index)}`,
    }));
    items.length = MAX_BRICK_ARRAY_ITEMS + 3;
    Object.defineProperty(items, String(MAX_BRICK_ARRAY_ITEMS), {
      get() {
        throw new Error("key-value item cap over-read");
      },
    });

    const columns: unknown[] = Array.from({ length: MAX_TABLE_COLUMNS }, (_, index) => ({
      key: `column_${String(index)}`,
      label: `Column ${String(index)}`,
    }));
    columns.length = MAX_TABLE_COLUMNS + 3;
    Object.defineProperty(columns, String(MAX_TABLE_COLUMNS), {
      get() {
        throw new Error("table column cap over-read");
      },
    });

    const keyValueIssues: string[] = [];
    const tableIssues: string[] = [];
    const keyValue = validateKeyValue("keyValue", { type: "keyValue", items }, keyValueIssues);
    const table = validateTable("table", { type: "table", columns, rows: [] }, tableIssues);

    expect(keyValue.items).toHaveLength(MAX_BRICK_ARRAY_ITEMS);
    expect(table.columns).toHaveLength(MAX_TABLE_COLUMNS);
    expect(keyValueIssues).toEqual([
      `node "keyValue": items exceeded the ${String(MAX_BRICK_ARRAY_ITEMS)}-item cap`,
    ]);
    expect(tableIssues).toEqual([
      `node "table": columns exceeded the ${String(MAX_TABLE_COLUMNS)}-item cap; extra items dropped`,
    ]);
  });

  it("contains no retired or role-routed validation path", () => {
    const source = [
      readFileSync(new URL("./brick-validation.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./brick-validation-shared.ts", import.meta.url), "utf8"),
    ].join("\n");

    for (const retired of [
      "button",
      "tabs",
      "nav",
      "metric",
      "stat",
      "form",
      "filterBar",
      "component",
      "control",
      "variant",
      "tone",
    ]) {
      expect(source).not.toMatch(new RegExp(`\\b${retired}\\b`, "i"));
    }
  });
});
