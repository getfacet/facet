import type { FacetTree } from "@facet/core";
import { QUICKSTART_NAV_ITEMS } from "./guide-shared.js";

const NAV_ITEM_STYLE = {
  preset: "secondaryAction",
  active: { preset: "primaryAction" },
} as const;
const NAV_LABEL_STYLE = {
  preset: "actionLabel",
  active: { color: "accentForeground" },
} as const;

export const QUICKSTART_HOME_NODES = {
  "qs.home.root": {
    id: "qs.home.root",
    type: "box",
    style: { direction: "column", gap: "lg", padding: "xl" },
    children: ["qs.nav.home", "qs.hero", "qs.metrics", "qs.surface.card", "qs.runtime.summary"],
  },
  "qs.nav.home": {
    id: "qs.nav.home",
    type: "box",
    style: { direction: "row", gap: "xs", wrap: true, width: "full" },
    children: [
      "qs.nav.home.what",
      "qs.nav.home.structure",
      "qs.nav.home.system",
      "qs.nav.home.usecases",
    ],
  },
  "qs.nav.home.what": {
    id: "qs.nav.home.what",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[0].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.home.what.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[0].to },
  },
  "qs.nav.home.what.label": {
    id: "qs.nav.home.what.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[0].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[0].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.home.structure": {
    id: "qs.nav.home.structure",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[1].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.home.structure.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[1].to },
  },
  "qs.nav.home.structure.label": {
    id: "qs.nav.home.structure.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[1].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[1].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.home.system": {
    id: "qs.nav.home.system",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[2].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.home.system.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[2].to },
  },
  "qs.nav.home.system.label": {
    id: "qs.nav.home.system.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[2].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[2].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.home.usecases": {
    id: "qs.nav.home.usecases",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[3].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.home.usecases.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[3].to },
  },
  "qs.nav.home.usecases.label": {
    id: "qs.nav.home.usecases.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[3].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[3].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.hero": {
    id: "qs.hero",
    type: "box",
    style: {
      preset: "panel",
      padding: "lg",
      borderWidth: "none",
      borderRadius: "lg",
      shadow: "none",
      width: "full",
    },
    children: ["qs.hero.eyebrow", "qs.hero.title", "qs.hero.body", "qs.hero.actions"],
  },
  "qs.hero.eyebrow": {
    id: "qs.hero.eyebrow",
    type: "text",
    value: "Facet quickstart",
    style: { preset: "eyebrow" },
  },
  "qs.hero.title": {
    id: "qs.hero.title",
    type: "text",
    value: "What is Facet?",
    style: { preset: "heading" },
  },
  "qs.hero.body": {
    id: "qs.hero.body",
    type: "text",
    value:
      "Facet is a live UI surface an agent can safely reshape while you talk: typed Bricks, Pattern references, Presets, deliberate direct style, and JSON Patch updates instead of raw client code.",
    style: { preset: "body" },
  },
  "qs.hero.actions": {
    id: "qs.hero.actions",
    type: "box",
    style: { direction: "row", gap: "sm", wrap: true },
    children: ["qs.hero.primary", "qs.hero.secondary"],
  },
  "qs.hero.primary": {
    id: "qs.hero.primary",
    type: "box",
    style: { preset: "primaryAction" },
    children: ["qs.hero.primary.label"],
    onPress: {
      kind: "agent",
      name: "show_dynamic_example",
      payload: { example: "workflow" },
    },
  },
  "qs.hero.primary.label": {
    id: "qs.hero.primary.label",
    type: "text",
    value: "Show a live example",
    style: { preset: "actionLabel" },
  },
  "qs.hero.secondary": {
    id: "qs.hero.secondary",
    type: "box",
    style: { preset: "secondaryAction" },
    children: ["qs.hero.secondary.label"],
    onPress: { kind: "navigate", to: "usecases" },
  },
  "qs.hero.secondary.label": {
    id: "qs.hero.secondary.label",
    type: "text",
    value: "Try a use case",
    style: { preset: "actionLabel" },
  },
  "qs.metrics": {
    id: "qs.metrics",
    type: "box",
    style: { direction: "column", gap: "md" },
    children: ["qs.metric.patch", "qs.card.safety", "qs.card.progress"],
  },
  "qs.metric.patch": {
    id: "qs.metric.patch",
    type: "box",
    style: { preset: "panel", gap: "xs", shadow: "none" },
    children: ["qs.metric.patch.label", "qs.metric.patch.value"],
  },
  "qs.metric.patch.label": {
    id: "qs.metric.patch.label",
    type: "text",
    value: "Patch loop",
    style: { preset: "muted", fontWeight: "medium" },
  },
  "qs.metric.patch.value": {
    id: "qs.metric.patch.value",
    type: "text",
    value: "Live · per visitor",
    style: { preset: "metric", color: "success" },
  },
  "qs.card.safety": {
    id: "qs.card.safety",
    type: "box",
    style: { preset: "panel", gap: "sm" },
    children: ["qs.card.safety.title", "qs.card.safety.body", "qs.badge.safe"],
  },
  "qs.card.safety.title": {
    id: "qs.card.safety.title",
    type: "text",
    value: "Safe vocabulary",
    style: { preset: "subheading" },
  },
  "qs.card.safety.body": {
    id: "qs.card.safety.body",
    type: "text",
    value: "Agents emit validated stage data, not HTML or scripts.",
    style: { preset: "muted" },
  },
  "qs.badge.safe": {
    id: "qs.badge.safe",
    type: "box",
    style: { preset: "successBadge" },
    children: ["qs.badge.safe.label"],
  },
  "qs.badge.safe.label": {
    id: "qs.badge.safe.label",
    type: "text",
    value: "Closed vocabulary",
    style: { preset: "successBadge" },
  },
  "qs.card.progress": {
    id: "qs.card.progress",
    type: "box",
    style: { preset: "panel", gap: "sm" },
    children: ["qs.card.progress.title", "qs.card.progress.body", "qs.progress.ready"],
  },
  "qs.card.progress.title": {
    id: "qs.card.progress.title",
    type: "text",
    value: "First paint",
    style: { preset: "subheading" },
  },
  "qs.card.progress.body": {
    id: "qs.card.progress.body",
    type: "text",
    value: "The shell starts with a real stage, then the provider-backed agent can refine it.",
    style: { preset: "muted" },
  },
  "qs.progress.ready": {
    id: "qs.progress.ready",
    type: "progress",
    value: 82,
    label: "Polished default kit",
    style: { preset: "standard", label: { color: "info" } },
  },
  "qs.surface.card": {
    id: "qs.surface.card",
    type: "box",
    style: { preset: "panel", gap: "sm", shadow: "md" },
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
    style: { preset: "subheading" },
  },
  "qs.surface.card.body": {
    id: "qs.surface.card.body",
    type: "text",
    value:
      "Display bricks stay display-only. Ask the agent to turn this into your own dashboard, pricing path, or workflow.",
    style: { preset: "muted" },
  },
  "qs.surface.chart": {
    id: "qs.surface.chart",
    type: "chart",
    kind: "line",
    title: "Stage updates",
    style: { preset: "panel" },
    labels: ["Visit", "Ask", "Tool", "Repair"],
    series: [{ label: "patches", values: [1, 4, 7, 5] }],
  },
  "qs.surface.divider": {
    id: "qs.surface.divider",
    type: "box",
    style: { borderWidth: "thin", background: "mutedSurface", borderRadius: "full" },
    children: [],
  },
  "qs.surface.table": {
    id: "qs.surface.table",
    type: "table",
    caption: "Recent stage tool results",
    style: { preset: "standard" },
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
    style: { gap: "md", padding: "lg", width: "full" },
    children: ["qs.runtime.summary.title", "qs.runtime.summary.body", "qs.runtime.list"],
  },
  "qs.runtime.summary.title": {
    id: "qs.runtime.summary.title",
    type: "text",
    value: "A page the agent owns",
    style: { preset: "heading" },
  },
  "qs.runtime.summary.body": {
    id: "qs.runtime.summary.body",
    type: "text",
    value:
      "Every tab is still the same Facet stage. Navigation is local, while agent actions can patch the visible page.",
    style: { preset: "body" },
  },
  "qs.runtime.list": {
    id: "qs.runtime.list",
    type: "list",
    style: { preset: "compact" },
    items: [
      { title: "Visitor event arrives", body: "Visit, chat, tap, or collected fields." },
      { title: "Provider selects tools", body: "Stage edits are validated before patches ship." },
      { title: "Renderer updates live", body: "The browser folds the same patch stream." },
    ],
  },
} satisfies FacetTree["nodes"];
