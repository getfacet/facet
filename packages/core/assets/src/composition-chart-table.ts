import type { FacetComposition } from "@facet/core";

export const CHART_TABLE_VIEW_COMPOSITION: FacetComposition = {
  name: "chart-table-view",
  description: "A data view combining one chart and one small table.",
  metadata: {
    category: "dashboard",
    useWhen: "Showing a compact trend with supporting records.",
    avoidWhen: "The data needs sorting, filtering, or live fetching.",
    tags: ["chart", "table", "data"],
    variants: ["summary"],
    repeatable: false,
    preferredParent: "root",
  },
  slots: {
    title: "Performance",
    chart: "Trend",
    table: "Recent rows",
  },
  root: "chart-table-view.root",
  nodes: {
    "chart-table-view.root": {
      id: "chart-table-view.root",
      type: "section",
      title: "{{title}}",
      children: ["chart-table-view.chart", "chart-table-view.table"],
    },
    "chart-table-view.chart": {
      id: "chart-table-view.chart",
      type: "chart",
      kind: "line",
      title: "{{chart}}",
      labels: ["Week 1", "Week 2", "Week 3"],
      series: [{ label: "Value", values: [12, 18, 24] }],
    },
    "chart-table-view.table": {
      id: "chart-table-view.table",
      type: "table",
      caption: "{{table}}",
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
