import type { FacetTree } from "@facet/core";
import { buildQuickstartNavigation } from "./guide-shared.js";

export const QUICKSTART_STRUCTURE_NODES = {
  "qs.runtime.root": {
    id: "qs.runtime.root",
    type: "box",
    style: { direction: "column", gap: "lg", padding: "xl" },
    children: ["qs.nav.runtime", "qs.runtime.section"],
  },
  ...buildQuickstartNavigation("runtime"),
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
