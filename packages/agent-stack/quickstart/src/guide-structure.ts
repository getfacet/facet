import type { FacetTree } from "@facet/core";
import { QUICKSTART_NAV_ITEMS } from "./guide-shared.js";

export const QUICKSTART_STRUCTURE_NODES = {
  "qs.runtime.root": {
    id: "qs.runtime.root",
    type: "box",
    style: { direction: "col", gap: "lg", pad: "xl" },
    children: ["qs.nav.runtime", "qs.runtime.section"],
  },
  "qs.nav.runtime": {
    id: "qs.nav.runtime",
    type: "tabs",
    variant: "default",
    items: QUICKSTART_NAV_ITEMS,
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
        body: "A validated tree of primitive bricks, components, and local screens.",
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
      { layer: "Renderer", package: "@facet/react", owns: "component rendering" },
      { layer: "Agent tools", package: "@facet/agent-tools", owns: "safe mutations" },
    ],
  },
} satisfies FacetTree["nodes"];
