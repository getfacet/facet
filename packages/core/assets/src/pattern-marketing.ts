import type { FacetPattern } from "@facet/core";

export const HERO_PATTERN = {
  name: "hero",
  description:
    "A compact product hero with a title, supporting copy, and action. Adapt its illustrative copy and action before authoring.",
  useWhen: "Introducing a product, feature, or first screen with one clear next action.",
  avoidWhen:
    "Avoid when the user needs dense operational data first; adapt all claims to the task.",
  root: "hero.root",
  nodes: {
    "hero.root": {
      id: "hero.root",
      type: "box",
      style: { gap: "md", padding: "lg", width: "full" },
      children: ["hero.title", "hero.body", "hero.cta"],
    },
    "hero.title": {
      id: "hero.title",
      type: "text",
      value: "Ship polished interfaces in minutes",
      style: { preset: "heading" },
    },
    "hero.body": {
      id: "hero.body",
      type: "text",
      value: "Compose safe, live UI for each user without shipping a new frontend.",
      style: { preset: "body" },
    },
    "hero.cta": {
      id: "hero.cta",
      type: "box",
      style: { preset: "primaryAction" },
      children: ["hero.cta-label"],
      onPress: { kind: "agent", name: "start" },
    },
    "hero.cta-label": {
      id: "hero.cta-label",
      type: "text",
      value: "Get started",
      style: { preset: "actionLabel" },
    },
  },
} satisfies FacetPattern;

export const PRICING_SECTION_PATTERN = {
  name: "pricing-section",
  description:
    "A compact three-plan comparison. Adapt its illustrative plan names, prices, claims, and action before authoring.",
  useWhen: "Showing a small set of plans, packages, or tiers side by side.",
  avoidWhen:
    "Avoid for a single-plan detail or when the supplied prices have not been verified and adapted.",
  root: "pricing-section.root",
  nodes: {
    "pricing-section.root": {
      id: "pricing-section.root",
      type: "box",
      style: { gap: "md", padding: "lg", width: "full" },
      children: [
        "pricing-section.title",
        "pricing-section.starter",
        "pricing-section.pro",
        "pricing-section.enterprise",
      ],
    },
    "pricing-section.title": {
      id: "pricing-section.title",
      type: "text",
      value: "Choose a plan",
      style: { preset: "heading" },
    },
    "pricing-section.starter": {
      id: "pricing-section.starter",
      type: "box",
      style: { preset: "panel" },
      children: [
        "pricing-section.starter-title",
        "pricing-section.starter-body",
        "pricing-section.starter-price-label",
        "pricing-section.starter-price-value",
      ],
    },
    "pricing-section.starter-title": {
      id: "pricing-section.starter-title",
      type: "text",
      value: "Starter",
      style: { preset: "subheading" },
    },
    "pricing-section.starter-body": {
      id: "pricing-section.starter-body",
      type: "text",
      value: "Simple tools for early teams.",
      style: { preset: "muted" },
    },
    "pricing-section.starter-price-label": {
      id: "pricing-section.starter-price-label",
      type: "text",
      value: "Monthly",
      style: { preset: "muted" },
    },
    "pricing-section.starter-price-value": {
      id: "pricing-section.starter-price-value",
      type: "text",
      value: "$19",
      style: { preset: "metric" },
    },
    "pricing-section.pro": {
      id: "pricing-section.pro",
      type: "box",
      style: { preset: "panel" },
      children: [
        "pricing-section.pro-title",
        "pricing-section.pro-body",
        "pricing-section.pro-price-label",
        "pricing-section.pro-price-value",
        "pricing-section.cta",
      ],
    },
    "pricing-section.pro-title": {
      id: "pricing-section.pro-title",
      type: "text",
      value: "Pro",
      style: { preset: "subheading" },
    },
    "pricing-section.pro-body": {
      id: "pricing-section.pro-body",
      type: "text",
      value: "Advanced workflows and analytics.",
      style: { preset: "muted" },
    },
    "pricing-section.pro-price-label": {
      id: "pricing-section.pro-price-label",
      type: "text",
      value: "Monthly",
      style: { preset: "muted" },
    },
    "pricing-section.pro-price-value": {
      id: "pricing-section.pro-price-value",
      type: "text",
      value: "$49",
      style: { preset: "metric" },
    },
    "pricing-section.cta": {
      id: "pricing-section.cta",
      type: "box",
      style: { preset: "primaryAction" },
      children: ["pricing-section.cta-label"],
      onPress: { kind: "agent", name: "compare_pricing" },
    },
    "pricing-section.cta-label": {
      id: "pricing-section.cta-label",
      type: "text",
      value: "Compare plans",
      style: { preset: "actionLabel" },
    },
    "pricing-section.enterprise": {
      id: "pricing-section.enterprise",
      type: "box",
      style: { preset: "panel" },
      children: [
        "pricing-section.enterprise-title",
        "pricing-section.enterprise-body",
        "pricing-section.enterprise-badge",
      ],
    },
    "pricing-section.enterprise-title": {
      id: "pricing-section.enterprise-title",
      type: "text",
      value: "Enterprise",
      style: { preset: "subheading" },
    },
    "pricing-section.enterprise-body": {
      id: "pricing-section.enterprise-body",
      type: "text",
      value: "Custom controls for larger organizations.",
      style: { preset: "muted" },
    },
    "pricing-section.enterprise-badge": {
      id: "pricing-section.enterprise-badge",
      type: "box",
      style: { preset: "badge" },
      children: ["pricing-section.enterprise-badge-label"],
    },
    "pricing-section.enterprise-badge-label": {
      id: "pricing-section.enterprise-badge-label",
      type: "text",
      value: "Custom",
      style: { preset: "badge" },
    },
  },
} satisfies FacetPattern;

export const FAQ_SECTION_PATTERN = {
  name: "faq-section",
  description:
    "A concise FAQ list with illustrative questions. Adapt every question and answer to the user's actual context.",
  useWhen: "Answering several predictable questions in a compact reference list.",
  avoidWhen:
    "Avoid when the user needs an interactive troubleshooting flow or the examples cannot be adapted accurately.",
  root: "faq-section.root",
  nodes: {
    "faq-section.root": {
      id: "faq-section.root",
      type: "box",
      style: { gap: "md", padding: "lg", width: "full" },
      children: ["faq-section.title", "faq-section.list"],
    },
    "faq-section.title": {
      id: "faq-section.title",
      type: "text",
      value: "Questions",
      style: { preset: "heading" },
    },
    "faq-section.list": {
      id: "faq-section.list",
      type: "list",
      items: [
        { title: "What is included?", body: "Replace this with a verified answer." },
        { title: "Can I cancel?", body: "Replace this with the applicable policy." },
        { title: "How do I get support?", body: "Replace this with the correct support path." },
      ],
      style: { preset: "standard" },
    },
  },
} satisfies FacetPattern;

export const FEATURE_GRID_PATTERN = {
  name: "feature-grid",
  description:
    "A three-card feature overview. Adapt its illustrative capability names and claims before authoring.",
  useWhen: "Explaining a small set of peer product capabilities.",
  avoidWhen:
    "Avoid when one focused workflow is clearer or the claims have not been adapted and verified.",
  root: "feature-grid.root",
  nodes: {
    "feature-grid.root": {
      id: "feature-grid.root",
      type: "box",
      style: { gap: "md", padding: "lg", columns: 3, width: "full" },
      children: [
        "feature-grid.title",
        "feature-grid.first",
        "feature-grid.second",
        "feature-grid.third",
      ],
    },
    "feature-grid.title": {
      id: "feature-grid.title",
      type: "text",
      value: "Features",
      style: { preset: "heading" },
    },
    "feature-grid.first": {
      id: "feature-grid.first",
      type: "box",
      style: { preset: "panel" },
      children: ["feature-grid.first-title", "feature-grid.first-body"],
    },
    "feature-grid.first-title": {
      id: "feature-grid.first-title",
      type: "text",
      value: "Fast setup",
      style: { preset: "subheading" },
    },
    "feature-grid.first-body": {
      id: "feature-grid.first-body",
      type: "text",
      value: "Start from safe default UI patterns.",
      style: { preset: "muted" },
    },
    "feature-grid.second": {
      id: "feature-grid.second",
      type: "box",
      style: { preset: "panel" },
      children: ["feature-grid.second-title", "feature-grid.second-body"],
    },
    "feature-grid.second-title": {
      id: "feature-grid.second-title",
      type: "text",
      value: "Live UI",
      style: { preset: "subheading" },
    },
    "feature-grid.second-body": {
      id: "feature-grid.second-body",
      type: "text",
      value: "Render task-specific screens as the conversation changes.",
      style: { preset: "muted" },
    },
    "feature-grid.third": {
      id: "feature-grid.third",
      type: "box",
      style: { preset: "panel" },
      children: ["feature-grid.third-title", "feature-grid.third-body"],
    },
    "feature-grid.third-title": {
      id: "feature-grid.third-title",
      type: "text",
      value: "Safe patches",
      style: { preset: "subheading" },
    },
    "feature-grid.third-body": {
      id: "feature-grid.third-body",
      type: "text",
      value: "Keep every update declarative and bounded.",
      style: { preset: "muted" },
    },
  },
} satisfies FacetPattern;
