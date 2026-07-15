import type { FacetTree } from "@facet/core";
import { QUICKSTART_NAV_ITEMS } from "./guide-shared.js";

/**
 * The intake nodes are assembled before the home summary to preserve the
 * established node insertion order, while ownership stays with the use-case
 * screen that references the form.
 */
export const QUICKSTART_INTAKE_NODES = {
  "qs.intake": {
    id: "qs.intake",
    type: "box",
    style: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md", shadow: "sm" },
    children: [
      "qs.intake.title",
      "qs.intake.body",
      "qs.intake.goal",
      "qs.intake.surface",
      "qs.intake.alert",
      "qs.intake.submit",
    ],
  },
  "qs.intake.title": {
    id: "qs.intake.title",
    type: "text",
    value: "Give the agent a target",
    style: { color: "fg", size: "lg", weight: "bold" },
  },
  "qs.intake.body": {
    id: "qs.intake.body",
    type: "text",
    value: "Field values remain browser view-state until this button collects them.",
    style: { color: "fg-muted" },
  },
  "qs.intake.goal": {
    id: "qs.intake.goal",
    type: "input",
    name: "goal",
    label: "What should the agent build?",
    placeholder: "A customer onboarding flow",
    variant: "default",
  },
  "qs.intake.surface": {
    id: "qs.intake.surface",
    type: "input",
    name: "surface",
    input: "select",
    label: "Surface",
    options: ["Dashboard", "Pricing", "Form flow", "Replay view"],
    variant: "default",
  },
  "qs.intake.alert": {
    id: "qs.intake.alert",
    type: "box",
    style: { gap: "sm", pad: "md", bg: "surface", border: true, radius: "md" },
    children: ["qs.intake.alert.title", "qs.intake.alert.body"],
  },
  "qs.intake.alert.title": {
    id: "qs.intake.alert.title",
    type: "text",
    value: "Provider-backed",
    style: { weight: "bold", color: "info" },
  },
  "qs.intake.alert.body": {
    id: "qs.intake.alert.body",
    type: "text",
    value:
      "The normal quickstart path still uses your OpenAI or Anthropic key; this seed is just the first paint.",
    style: { color: "fg" },
  },
  "qs.intake.submit": {
    id: "qs.intake.submit",
    type: "button",
    label: "Transform this page",
    variant: "primary",
    tone: "accent",
    onPress: {
      kind: "agent",
      name: "transform_quickstart",
      collect: "qs.intake",
    },
  },
} satisfies FacetTree["nodes"];

export const QUICKSTART_USE_CASE_NODES = {
  "qs.usecases.root": {
    id: "qs.usecases.root",
    type: "box",
    style: { direction: "col", gap: "lg", pad: "xl" },
    children: ["qs.nav.usecases", "qs.usecases.hero", "qs.usecases.examples", "qs.intake"],
  },
  "qs.nav.usecases": {
    id: "qs.nav.usecases",
    type: "tabs",
    variant: "default",
    items: QUICKSTART_NAV_ITEMS,
  },
  "qs.usecases.hero": {
    id: "qs.usecases.hero",
    type: "box",
    style: { bg: "surface", gap: "md", pad: "lg", radius: "lg", width: "full" },
    children: [
      "qs.usecases.hero.eyebrow",
      "qs.usecases.hero.title",
      "qs.usecases.hero.body",
      "qs.usecases.alert",
    ],
  },
  "qs.usecases.hero.eyebrow": {
    id: "qs.usecases.hero.eyebrow",
    type: "text",
    value: "Your turn",
    style: { color: "fg-muted", size: "sm", weight: "semibold" },
  },
  "qs.usecases.hero.title": {
    id: "qs.usecases.hero.title",
    type: "text",
    value: "Use Cases",
    style: { color: "fg", size: "xl", weight: "bold" },
  },
  "qs.usecases.hero.body": {
    id: "qs.usecases.hero.body",
    type: "text",
    value:
      "Ask Facet to draw a concrete app surface. The agent should update the page with ordinary native components, primitives, variants, and fields instead of only replying in chat.",
    style: { color: "fg" },
  },
  "qs.usecases.alert": {
    id: "qs.usecases.alert",
    type: "box",
    style: { gap: "sm", pad: "md", bg: "surface", border: true, radius: "md" },
    children: ["qs.usecases.alert.title", "qs.usecases.alert.body"],
  },
  "qs.usecases.alert.title": {
    id: "qs.usecases.alert.title",
    type: "text",
    value: "Try a real request",
    style: { weight: "bold", color: "info" },
  },
  "qs.usecases.alert.body": {
    id: "qs.usecases.alert.body",
    type: "text",
    value:
      "Examples: customer onboarding, pricing comparison, CRM dashboard, evaluation replay, or support triage.",
    style: { color: "fg" },
  },
  "qs.usecases.examples": {
    id: "qs.usecases.examples",
    type: "box",
    style: { gap: "md", pad: "lg", width: "full" },
    children: [
      "qs.usecases.examples.title",
      "qs.usecases.examples.body",
      "qs.usecases.list",
      "qs.usecases.actions",
    ],
  },
  "qs.usecases.examples.title": {
    id: "qs.usecases.examples.title",
    type: "text",
    value: "Starting points",
    style: { color: "fg", size: "xl", weight: "bold" },
  },
  "qs.usecases.examples.body": {
    id: "qs.usecases.examples.body",
    type: "text",
    value: "These are prompts the agent can turn into a live page.",
    style: { color: "fg" },
  },
  "qs.usecases.list": {
    id: "qs.usecases.list",
    type: "list",
    variant: "default",
    items: [
      { title: "Dashboard", body: "KPIs, chart, table, status, and next action." },
      { title: "Pricing", body: "Plan comparison with a conversion path." },
      { title: "Onboarding", body: "Step-by-step fields and completion state." },
      { title: "Replay view", body: "Evaluation results with summaries and details." },
    ],
  },
  "qs.usecases.actions": {
    id: "qs.usecases.actions",
    type: "box",
    style: { direction: "row", gap: "sm", wrap: true },
    children: [
      "qs.usecases.dashboard",
      "qs.usecases.pricing",
      "qs.usecases.onboarding",
      "qs.usecases.replay",
    ],
  },
  "qs.usecases.dashboard": {
    id: "qs.usecases.dashboard",
    type: "button",
    label: "Dashboard",
    variant: "secondary",
    onPress: {
      kind: "agent",
      name: "show_use_case",
      payload: { use_case: "dashboard" },
    },
  },
  "qs.usecases.pricing": {
    id: "qs.usecases.pricing",
    type: "button",
    label: "Pricing",
    variant: "secondary",
    onPress: {
      kind: "agent",
      name: "show_use_case",
      payload: { use_case: "pricing" },
    },
  },
  "qs.usecases.onboarding": {
    id: "qs.usecases.onboarding",
    type: "button",
    label: "Onboarding",
    variant: "secondary",
    onPress: {
      kind: "agent",
      name: "show_use_case",
      payload: { use_case: "onboarding" },
    },
  },
  "qs.usecases.replay": {
    id: "qs.usecases.replay",
    type: "button",
    label: "Replay view",
    variant: "secondary",
    onPress: {
      kind: "agent",
      name: "show_use_case",
      payload: { use_case: "replay" },
    },
  },
} satisfies FacetTree["nodes"];
