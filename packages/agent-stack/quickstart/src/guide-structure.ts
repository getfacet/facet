import type { FacetTree } from "@facet/core";
import { QUICKSTART_NAV_ITEMS } from "./guide-shared.js";

const NAV_ITEM_STYLE = { border: true, pad: "sm", radius: "md" } as const;
const NAV_LABEL_STYLE = { color: "fg", align: "center", weight: "semibold" } as const;

export const QUICKSTART_STRUCTURE_NODES = {
  "qs.runtime.root": {
    id: "qs.runtime.root",
    type: "box",
    style: { direction: "col", gap: "lg", pad: "xl" },
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
    active: { screen: QUICKSTART_NAV_ITEMS[0].to },
    activeVariant: "selected",
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.runtime.what.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[0].to },
  },
  "qs.nav.runtime.what.label": {
    id: "qs.nav.runtime.what.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[0].label,
    active: { screen: QUICKSTART_NAV_ITEMS[0].to },
    activeStyle: { color: "accent-fg" },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.runtime.structure": {
    id: "qs.nav.runtime.structure",
    type: "box",
    active: { screen: QUICKSTART_NAV_ITEMS[1].to },
    activeVariant: "selected",
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.runtime.structure.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[1].to },
  },
  "qs.nav.runtime.structure.label": {
    id: "qs.nav.runtime.structure.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[1].label,
    active: { screen: QUICKSTART_NAV_ITEMS[1].to },
    activeStyle: { color: "accent-fg" },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.runtime.system": {
    id: "qs.nav.runtime.system",
    type: "box",
    active: { screen: QUICKSTART_NAV_ITEMS[2].to },
    activeVariant: "selected",
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.runtime.system.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[2].to },
  },
  "qs.nav.runtime.system.label": {
    id: "qs.nav.runtime.system.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[2].label,
    active: { screen: QUICKSTART_NAV_ITEMS[2].to },
    activeStyle: { color: "accent-fg" },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.runtime.usecases": {
    id: "qs.nav.runtime.usecases",
    type: "box",
    active: { screen: QUICKSTART_NAV_ITEMS[3].to },
    activeVariant: "selected",
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.runtime.usecases.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[3].to },
  },
  "qs.nav.runtime.usecases.label": {
    id: "qs.nav.runtime.usecases.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[3].label,
    active: { screen: QUICKSTART_NAV_ITEMS[3].to },
    activeStyle: { color: "accent-fg" },
    style: NAV_LABEL_STYLE,
  },
  "qs.runtime.section": {
    id: "qs.runtime.section",
    type: "box",
    style: { bg: "surface", gap: "md", pad: "lg", radius: "lg", width: "full" },
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
    style: { color: "fg-muted", size: "sm", weight: "semibold" },
  },
  "qs.runtime.section.title": {
    id: "qs.runtime.section.title",
    type: "text",
    value: "Core Structure",
    style: { color: "fg", size: "xl", weight: "bold" },
  },
  "qs.runtime.section.body": {
    id: "qs.runtime.section.body",
    type: "text",
    value:
      "Facet separates the safe stage contract, renderer, runtime, assets, transport, and agent tools. The model chooses bounded intent; Facet validates and renders.",
    style: { color: "fg" },
  },
  "qs.structure.list": {
    id: "qs.structure.list",
    type: "list",
    variant: "default",
    items: [
      {
        title: "Stage",
        body: "A validated tree of native bricks and local screens.",
      },
      { title: "Patch loop", body: "Server and browser fold the same JSON Patch stream." },
      { title: "Assets", body: "Themes, compositions, and catalog policy guide visual intent." },
      { title: "Renderer", body: "React resolves token recipes into product UI." },
    ],
  },
  "qs.structure.table": {
    id: "qs.structure.table",
    type: "table",
    caption: "Package roles",
    variant: "default",
    columns: [
      { key: "layer", label: "Layer" },
      { key: "package", label: "Package" },
      { key: "owns", label: "Owns" },
    ],
    rows: [
      { layer: "Contract", package: "@facet/core", owns: "nodes, tokens, patches" },
      { layer: "Assets", package: "@facet/assets", owns: "default recipes, compositions" },
      { layer: "Renderer", package: "@facet/react", owns: "brick rendering" },
      { layer: "Agent tools", package: "@facet/agent-tools", owns: "safe mutations" },
    ],
  },
} satisfies FacetTree["nodes"];
