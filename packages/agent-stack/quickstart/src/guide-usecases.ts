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
    type: "card",
    title: "Give the agent a target",
    body: "Field values remain browser view-state until this button collects them.",
    children: ["qs.intake.goal", "qs.intake.surface", "qs.intake.alert", "qs.intake.submit"],
  },
  "qs.intake.goal": {
    id: "qs.intake.goal",
    type: "field",
    name: "goal",
    label: "What should the agent build?",
    placeholder: "A customer onboarding flow",
    variant: "default",
  },
  "qs.intake.surface": {
    id: "qs.intake.surface",
    type: "field",
    name: "surface",
    input: "select",
    label: "Surface",
    options: ["Dashboard", "Pricing", "Form flow", "Replay view"],
    variant: "default",
  },
  "qs.intake.alert": {
    id: "qs.intake.alert",
    type: "alert",
    title: "Provider-backed",
    body: "The normal quickstart path still uses your OpenAI or Anthropic key; this seed is just the first paint.",
    tone: "info",
    variant: "info",
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
    type: "section",
    eyebrow: "Your turn",
    title: "Use Cases",
    body: "Ask Facet to draw a concrete app surface. The agent should update the page with components, compositions, variants, and fields instead of only replying in chat.",
    variant: "surface",
    children: ["qs.usecases.alert"],
  },
  "qs.usecases.alert": {
    id: "qs.usecases.alert",
    type: "alert",
    title: "Try a real request",
    body: "Examples: customer onboarding, pricing comparison, CRM dashboard, evaluation replay, or support triage.",
    variant: "info",
    tone: "info",
  },
  "qs.usecases.examples": {
    id: "qs.usecases.examples",
    type: "section",
    title: "Starting points",
    body: "These are prompts the agent can turn into a live page.",
    children: ["qs.usecases.list", "qs.usecases.actions"],
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
