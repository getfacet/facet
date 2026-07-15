import type { FacetComposition } from "@facet/core";

export const CHART_TABLE_VIEW_COMPOSITION: FacetComposition = {
  name: "chart-table-view",
  metadata: {
    description: "A data view combining one chart and one small table.",
    category: "dashboard",
    useWhen: "Showing a compact trend with supporting records.",
    avoidWhen: "The data needs sorting, filtering, or live fetching.",
    tags: ["chart", "table", "data"],
    variants: ["summary"],
    repeatable: false,
    preferredParent: "root",
  },
  root: "chart-table-view.root",
  nodes: {
    "chart-table-view.root": {
      id: "chart-table-view.root",
      type: "box",
      style: { gap: "md", pad: "lg", width: "full" },
      children: ["chart-table-view.title", "chart-table-view.chart", "chart-table-view.table"],
    },
    "chart-table-view.title": {
      id: "chart-table-view.title",
      type: "text",
      value: "Weekly performance",
      style: { color: "fg", size: "xl", weight: "bold" },
    },
    "chart-table-view.chart": {
      id: "chart-table-view.chart",
      type: "chart",
      kind: "line",
      title: "Active workspaces",
      labels: ["Week 1", "Week 2", "Week 3"],
      series: [{ label: "Value", values: [12, 18, 24] }],
    },
    "chart-table-view.table": {
      id: "chart-table-view.table",
      type: "table",
      caption: "Recent regions",
      columns: [
        { key: "name", label: "Name" },
        { key: "value", label: "Value", align: "end" },
      ],
      rows: [
        { name: "Alpha", value: "12" },
        { name: "Beta", value: "18" },
        { name: "Gamma", value: "24" },
      ],
    },
  },
};
