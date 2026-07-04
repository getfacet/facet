import type { FacetStamp } from "@facet/core";

/**
 * `DEFAULT_STAMPS` — the default stamp library as literal, validated
 * `FacetStamp` trees. A stamp is a named `{root, nodes}` subtree an operator
 * hands to the assets registry; the LLM copies it into ordinary patches.
 *
 * These replace the retired kit-factory `KIT_STAMPS`, which captured the same
 * three shapes (hero, card, cta-button) by running the kit presets through a
 * graft builder. Here the trees are written out by hand — plain box/text bricks
 * with token style values, no builder/renderer dependency — so `@facet/assets`
 * stays node-free with deps = the core contract only.
 *
 * Every node id is prefixed with its stamp's own `name` (e.g. `hero.root`,
 * `hero.title`), so the stamps are pairwise disjoint and none touches the
 * reserved `"root"` id. Each tree passes `validateStamp` with zero error issues.
 */
export const DEFAULT_STAMPS: readonly FacetStamp[] = [
  {
    name: "hero",
    description:
      "A centered hero banner: large title, optional subtitle, and a call-to-action button.",
    root: "hero.root",
    nodes: {
      "hero.root": {
        id: "hero.root",
        type: "box",
        style: { direction: "col", gap: "lg", pad: "2xl", align: "center" },
        children: ["hero.title", "hero.subtitle", "hero.cta"],
      },
      "hero.title": {
        id: "hero.title",
        type: "text",
        value: "Your headline",
        style: { size: "3xl", weight: "bold", align: "center" },
      },
      "hero.subtitle": {
        id: "hero.subtitle",
        type: "text",
        value: "A short supporting line.",
        style: { size: "md", color: "fg-muted", align: "center" },
      },
      "hero.cta": {
        id: "hero.cta",
        type: "box",
        style: { bg: "accent", radius: "md", pad: "md", align: "center" },
        onPress: { kind: "agent", name: "start" },
        children: ["hero.cta-label"],
      },
      "hero.cta-label": {
        id: "hero.cta-label",
        type: "text",
        value: "Get started",
        style: { color: "accent-fg", weight: "semibold" },
      },
    },
  },
  {
    name: "card",
    description: "A bordered, padded content card stacking a heading over body copy.",
    root: "card.root",
    nodes: {
      "card.root": {
        id: "card.root",
        type: "box",
        style: { direction: "col", gap: "sm", pad: "lg", border: true, radius: "lg" },
        children: ["card.title", "card.body"],
      },
      "card.title": {
        id: "card.title",
        type: "text",
        value: "Card title",
        style: { size: "3xl", weight: "bold" },
      },
      "card.body": {
        id: "card.body",
        type: "text",
        value: "Card body copy.",
      },
    },
  },
  {
    name: "cta-button",
    description: "A single accent call-to-action button that fires an agent action.",
    root: "cta-button.root",
    nodes: {
      "cta-button.root": {
        id: "cta-button.root",
        type: "box",
        style: { bg: "accent", radius: "md", pad: "md", align: "center" },
        onPress: { kind: "agent", name: "start" },
        children: ["cta-button.label"],
      },
      "cta-button.label": {
        id: "cta-button.label",
        type: "text",
        value: "Get started",
        style: { color: "accent-fg", weight: "semibold" },
      },
    },
  },
];
