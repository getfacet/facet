import type { FacetPattern } from "@facet/core";

export const CHART_TABLE_VIEW_PATTERN = {
  name: "chart-table-view",
  description: "A data view combining one chart and one small table.",
  useWhen: "Showing a compact trend with supporting records.",
  avoidWhen: "The data needs filtering, live fetching, or more than a small comparison.",
  root: "chart-table-view.root",
  nodes: {
    "chart-table-view.root": {
      id: "chart-table-view.root",
      type: "box",
      style: { gap: "md", padding: "lg", width: "full" },
      children: ["chart-table-view.title", "chart-table-view.chart", "chart-table-view.table"],
    },
    "chart-table-view.title": {
      id: "chart-table-view.title",
      type: "text",
      value: "Weekly performance",
      style: { preset: "heading" },
    },
    "chart-table-view.chart": {
      id: "chart-table-view.chart",
      type: "chart",
      kind: "line",
      title: "Active workspaces",
      labels: ["Week 1", "Week 2", "Week 3"],
      series: [{ label: "Value", values: [12, 18, 24] }],
      style: { preset: "panel" },
    },
    "chart-table-view.table": {
      id: "chart-table-view.table",
      type: "table",
      caption: "Recent regions",
      columns: [
        { key: "name", label: "Name" },
        { key: "value", label: "Value" },
      ],
      rows: [
        { name: "Alpha", value: "12" },
        { name: "Beta", value: "18" },
        { name: "Gamma", value: "24" },
      ],
      style: { preset: "standard" },
    },
  },
} satisfies FacetPattern;

export const DATA_PATTERNS: readonly FacetPattern[] = [CHART_TABLE_VIEW_PATTERN];
