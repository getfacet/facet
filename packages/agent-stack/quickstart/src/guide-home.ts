import type { FacetTree } from "@facet/core";
import { QUICKSTART_NAV_ITEMS } from "./guide-shared.js";

export const QUICKSTART_HOME_NODES = {
  "qs.home.root": {
    id: "qs.home.root",
    type: "box",
    style: { direction: "col", gap: "lg", pad: "xl" },
    children: ["qs.nav.home", "qs.hero", "qs.metrics", "qs.surface.card", "qs.runtime.summary"],
  },
  "qs.nav.home": {
    id: "qs.nav.home",
    type: "tabs",
    variant: "default",
    items: QUICKSTART_NAV_ITEMS,
  },
  "qs.hero": {
    id: "qs.hero",
    type: "section",
    eyebrow: "Facet quickstart",
    title: "What is Facet?",
    body: "Facet is a live UI surface an agent can safely reshape while you talk: typed bricks, token styling, reusable assets, and JSON Patch updates instead of raw client code.",
    variant: "surface",
    children: ["qs.hero.actions"],
  },
  "qs.hero.actions": {
    id: "qs.hero.actions",
    type: "box",
    style: { direction: "row", gap: "sm", wrap: true },
    children: ["qs.hero.primary", "qs.hero.secondary"],
  },
  "qs.hero.primary": {
    id: "qs.hero.primary",
    type: "button",
    label: "Show a live example",
    variant: "primary",
    tone: "accent",
    onPress: {
      kind: "agent",
      name: "show_dynamic_example",
      payload: { example: "workflow" },
    },
  },
  "qs.hero.secondary": {
    id: "qs.hero.secondary",
    type: "button",
    label: "Try a use case",
    variant: "secondary",
    onPress: { kind: "navigate", to: "usecases" },
  },
  "qs.metrics": {
    id: "qs.metrics",
    type: "box",
    style: { direction: "col", gap: "md" },
    children: ["qs.metric.patch", "qs.card.safety", "qs.card.progress"],
  },
  "qs.metric.patch": {
    id: "qs.metric.patch",
    type: "metric",
    label: "Patch loop",
    value: "Live",
    delta: "per visitor",
    tone: "success",
    variant: "success",
  },
  "qs.card.safety": {
    id: "qs.card.safety",
    type: "card",
    title: "Safe vocabulary",
    body: "Agents emit validated stage data, not HTML or scripts.",
    children: ["qs.badge.safe"],
  },
  "qs.badge.safe": {
    id: "qs.badge.safe",
    type: "badge",
    label: "Closed vocabulary",
    tone: "success",
    variant: "success",
  },
  "qs.card.progress": {
    id: "qs.card.progress",
    type: "card",
    title: "First paint",
    body: "The shell starts with a real stage, then the provider-backed agent can refine it.",
    children: ["qs.progress.ready"],
  },
  "qs.progress.ready": {
    id: "qs.progress.ready",
    type: "progress",
    value: 82,
    label: "Polished default kit",
    tone: "info",
    variant: "default",
  },
  "qs.surface.card": {
    id: "qs.surface.card",
    type: "card",
    title: "Representative product surface",
    body: "Display components stay display-only. Ask the agent to turn this into your own dashboard, pricing path, or workflow.",
    variant: "interactive",
    children: ["qs.surface.chart", "qs.surface.divider", "qs.surface.table"],
  },
  "qs.surface.chart": {
    id: "qs.surface.chart",
    type: "chart",
    kind: "line",
    title: "Stage updates",
    variant: "default",
    labels: ["Visit", "Ask", "Tool", "Repair"],
    series: [{ label: "patches", values: [1, 4, 7, 5] }],
  },
  "qs.surface.divider": {
    id: "qs.surface.divider",
    type: "divider",
    label: "Tool outcomes",
    variant: "default",
  },
  "qs.surface.table": {
    id: "qs.surface.table",
    type: "table",
    caption: "Recent stage tool results",
    variant: "default",
    columns: [
      { key: "tool", label: "Tool" },
      { key: "result", label: "Result" },
      { key: "visible", label: "Visible" },
    ],
    rows: [
      { tool: "render_page", result: "applied_visible", visible: true },
      { tool: "append_node", result: "applied_visible", visible: true },
      { tool: "set_node", result: "needs_repair", visible: false },
    ],
  },
} satisfies FacetTree["nodes"];

export const QUICKSTART_HOME_SUMMARY_NODES = {
  "qs.runtime.summary": {
    id: "qs.runtime.summary",
    type: "section",
    title: "A page the agent owns",
    body: "Every tab is still the same Facet stage. Navigation is local, while agent actions can patch the visible page.",
    children: ["qs.runtime.list"],
  },
  "qs.runtime.list": {
    id: "qs.runtime.list",
    type: "list",
    variant: "compact",
    items: [
      { title: "Visitor event arrives", body: "Visit, chat, tap, or collected fields." },
      { title: "Provider selects tools", body: "Stage edits are validated before patches ship." },
      { title: "Renderer updates live", body: "The browser folds the same patch stream." },
    ],
  },
} satisfies FacetTree["nodes"];
