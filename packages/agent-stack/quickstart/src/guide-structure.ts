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

export const QUICKSTART_STRUCTURE_NODES = {
  "qs.runtime.root": {
    id: "qs.runtime.root",
    type: "box",
    style: { direction: "column", gap: "lg", padding: "xl" },
    children: ["qs.nav.runtime", "qs.runtime.section"],
  },
  "qs.nav.runtime": {
    id: "qs.nav.runtime",
    type: "box",
    style: { direction: "row", gap: "xs", wrap: true, width: "full" },
    children: [
      "qs.nav.runtime.what",
      "qs.nav.runtime.structure",
      "qs.nav.runtime.system",
      "qs.nav.runtime.usecases",
    ],
  },
  "qs.nav.runtime.what": {
    id: "qs.nav.runtime.what",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[0].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.runtime.what.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[0].to },
  },
  "qs.nav.runtime.what.label": {
    id: "qs.nav.runtime.what.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[0].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[0].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.runtime.structure": {
    id: "qs.nav.runtime.structure",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[1].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.runtime.structure.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[1].to },
  },
  "qs.nav.runtime.structure.label": {
    id: "qs.nav.runtime.structure.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[1].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[1].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.runtime.system": {
    id: "qs.nav.runtime.system",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[2].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.runtime.system.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[2].to },
  },
  "qs.nav.runtime.system.label": {
    id: "qs.nav.runtime.system.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[2].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[2].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.runtime.usecases": {
    id: "qs.nav.runtime.usecases",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[3].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.runtime.usecases.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[3].to },
  },
  "qs.nav.runtime.usecases.label": {
    id: "qs.nav.runtime.usecases.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[3].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[3].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.runtime.section": {
    id: "qs.runtime.section",
    type: "box",
    style: {
      preset: "panel",
      padding: "lg",
      borderWidth: "none",
      borderRadius: "lg",
      shadow: "none",
      width: "full",
    },
    children: [
      "qs.runtime.section.eyebrow",
      "qs.runtime.section.title",
      "qs.runtime.section.body",
      "qs.structure.list",
      "qs.structure.table",
    ],
  },
  "qs.runtime.section.eyebrow": {
    id: "qs.runtime.section.eyebrow",
    type: "text",
    value: "Architecture",
    style: { preset: "eyebrow" },
  },
  "qs.runtime.section.title": {
    id: "qs.runtime.section.title",
    type: "text",
    value: "Core Structure",
    style: { preset: "heading" },
  },
  "qs.runtime.section.body": {
    id: "qs.runtime.section.body",
    type: "text",
    value:
      "Facet separates the safe stage contract, renderer, runtime, assets, transport, and agent tools. The model chooses bounded intent; Facet validates and renders.",
    style: { preset: "body" },
  },
  "qs.structure.list": {
    id: "qs.structure.list",
    type: "list",
    style: { preset: "standard" },
    items: [
      {
        title: "Stage",
        body: "A validated tree of native bricks and local screens.",
      },
      { title: "Patch loop", body: "Server and browser fold the same JSON Patch stream." },
      {
        title: "Assets",
        body: "One Theme and an exact Pattern list provide the available design system references.",
      },
      {
        title: "Renderer",
        body: "React resolves Presets, direct style, and token names into product UI.",
      },
    ],
  },
  "qs.structure.table": {
    id: "qs.structure.table",
    type: "table",
    caption: "Package roles",
    style: { preset: "standard" },
    columns: [
      { key: "layer", label: "Layer" },
      { key: "package", label: "Package" },
      { key: "owns", label: "Owns" },
    ],
    rows: [
      { layer: "Contract", package: "@facet/core", owns: "nodes, tokens, patches" },
      { layer: "Assets", package: "@facet/assets", owns: "default Theme and Patterns" },
      { layer: "Renderer", package: "@facet/react", owns: "brick rendering" },
      { layer: "Agent tools", package: "@facet/agent-tools", owns: "safe mutations" },
    ],
  },
} satisfies FacetTree["nodes"];
