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
    type: "box",
    style: { bg: "surface", gap: "md", pad: "lg", radius: "lg", width: "full" },
    children: ["qs.hero.eyebrow", "qs.hero.title", "qs.hero.body", "qs.hero.actions"],
  },
  "qs.hero.eyebrow": {
    id: "qs.hero.eyebrow",
    type: "text",
    value: "Facet quickstart",
    style: { color: "fg-muted", size: "sm", weight: "semibold" },
  },
  "qs.hero.title": {
    id: "qs.hero.title",
    type: "text",
    value: "What is Facet?",
    style: { color: "fg", size: "xl", weight: "bold" },
  },
  "qs.hero.body": {
    id: "qs.hero.body",
    type: "text",
    value:
      "Facet is a live UI surface an agent can safely reshape while you talk: typed bricks, token styling, reusable assets, and JSON Patch updates instead of raw client code.",
    style: { color: "fg" },
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
    type: "box",
    style: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md", shadow: "sm" },
    children: ["qs.card.safety.title", "qs.card.safety.body", "qs.badge.safe"],
  },
  "qs.card.safety.title": {
    id: "qs.card.safety.title",
    type: "text",
    value: "Safe vocabulary",
    style: { color: "fg", size: "lg", weight: "bold" },
  },
  "qs.card.safety.body": {
    id: "qs.card.safety.body",
    type: "text",
    value: "Agents emit validated stage data, not HTML or scripts.",
    style: { color: "fg-muted" },
  },
  "qs.badge.safe": {
    id: "qs.badge.safe",
    type: "box",
    style: { direction: "row", pad: "xs", radius: "full", bg: "surface", border: true },
    children: ["qs.badge.safe.label"],
  },
  "qs.badge.safe.label": {
    id: "qs.badge.safe.label",
    type: "text",
    value: "Closed vocabulary",
    style: { color: "success", size: "xs", weight: "semibold" },
  },
  "qs.card.progress": {
    id: "qs.card.progress",
    type: "box",
    style: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md", shadow: "sm" },
    children: ["qs.card.progress.title", "qs.card.progress.body", "qs.progress.ready"],
  },
  "qs.card.progress.title": {
    id: "qs.card.progress.title",
    type: "text",
    value: "First paint",
    style: { color: "fg", size: "lg", weight: "bold" },
  },
  "qs.card.progress.body": {
    id: "qs.card.progress.body",
    type: "text",
    value: "The shell starts with a real stage, then the provider-backed agent can refine it.",
    style: { color: "fg-muted" },
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
    type: "box",
    style: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md", shadow: "md" },
    children: [
      "qs.surface.card.title",
      "qs.surface.card.body",
      "qs.surface.chart",
      "qs.surface.divider",
      "qs.surface.table",
    ],
  },
  "qs.surface.card.title": {
    id: "qs.surface.card.title",
    type: "text",
    value: "Representative product surface",
    style: { color: "fg", size: "lg", weight: "bold" },
  },
  "qs.surface.card.body": {
    id: "qs.surface.card.body",
    type: "text",
    value:
      "Display components stay display-only. Ask the agent to turn this into your own dashboard, pricing path, or workflow.",
    style: { color: "fg-muted" },
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
    type: "box",
    style: { border: true, bg: "surface-2", radius: "full" },
    children: [],
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
    type: "box",
    style: { gap: "md", pad: "lg", width: "full" },
    children: ["qs.runtime.summary.title", "qs.runtime.summary.body", "qs.runtime.list"],
  },
  "qs.runtime.summary.title": {
    id: "qs.runtime.summary.title",
    type: "text",
    value: "A page the agent owns",
    style: { color: "fg", size: "xl", weight: "bold" },
  },
  "qs.runtime.summary.body": {
    id: "qs.runtime.summary.body",
    type: "text",
    value:
      "Every tab is still the same Facet stage. Navigation is local, while agent actions can patch the visible page.",
    style: { color: "fg" },
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
