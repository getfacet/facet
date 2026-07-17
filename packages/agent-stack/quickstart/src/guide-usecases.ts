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
const ACTION_STYLE = { preset: "secondaryAction" } as const;
const ACTION_LABEL_STYLE = { preset: "actionLabel" } as const;

/**
 * The intake nodes are assembled before the home summary to preserve the
 * established node insertion order, while ownership stays with the use-case
 * screen that references the form.
 */
export const QUICKSTART_INTAKE_NODES = {
  "qs.intake": {
    id: "qs.intake",
    type: "box",
    style: { preset: "panel", gap: "sm" },
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
    style: { preset: "subheading" },
  },
  "qs.intake.body": {
    id: "qs.intake.body",
    type: "text",
    value: "Field values remain browser view-state until this action collects them.",
    style: { preset: "muted" },
  },
  "qs.intake.goal": {
    id: "qs.intake.goal",
    type: "input",
    name: "goal",
    label: "What should the agent build?",
    placeholder: "A customer onboarding flow",
    style: { preset: "standard" },
  },
  "qs.intake.surface": {
    id: "qs.intake.surface",
    type: "input",
    name: "surface",
    input: "select",
    label: "Surface",
    options: ["Dashboard", "Pricing", "Form flow", "Replay view"],
    style: { preset: "standard" },
  },
  "qs.intake.alert": {
    id: "qs.intake.alert",
    type: "box",
    style: { preset: "infoAlert" },
    children: ["qs.intake.alert.title", "qs.intake.alert.body"],
  },
  "qs.intake.alert.title": {
    id: "qs.intake.alert.title",
    type: "text",
    value: "Provider-backed",
    style: { preset: "infoAlert" },
  },
  "qs.intake.alert.body": {
    id: "qs.intake.alert.body",
    type: "text",
    value:
      "The normal quickstart path still uses your OpenAI or Anthropic key; this seed is just the first paint.",
    style: { preset: "body", color: "infoForeground" },
  },
  "qs.intake.submit": {
    id: "qs.intake.submit",
    type: "box",
    style: { preset: "primaryAction" },
    children: ["qs.intake.submit.label"],
    onPress: {
      kind: "agent",
      name: "transform_quickstart",
      collect: "qs.intake",
    },
  },
  "qs.intake.submit.label": {
    id: "qs.intake.submit.label",
    type: "text",
    value: "Transform this page",
    style: { preset: "actionLabel" },
  },
} satisfies FacetTree["nodes"];

export const QUICKSTART_USE_CASE_NODES = {
  "qs.usecases.root": {
    id: "qs.usecases.root",
    type: "box",
    style: { direction: "column", gap: "lg", padding: "xl" },
    children: ["qs.nav.usecases", "qs.usecases.hero", "qs.usecases.examples", "qs.intake"],
  },
  "qs.nav.usecases": {
    id: "qs.nav.usecases",
    type: "box",
    style: { direction: "row", gap: "xs", wrap: true, width: "full" },
    children: [
      "qs.nav.usecases.what",
      "qs.nav.usecases.structure",
      "qs.nav.usecases.system",
      "qs.nav.usecases.usecases",
    ],
  },
  "qs.nav.usecases.what": {
    id: "qs.nav.usecases.what",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[0].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.usecases.what.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[0].to },
  },
  "qs.nav.usecases.what.label": {
    id: "qs.nav.usecases.what.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[0].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[0].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.usecases.structure": {
    id: "qs.nav.usecases.structure",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[1].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.usecases.structure.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[1].to },
  },
  "qs.nav.usecases.structure.label": {
    id: "qs.nav.usecases.structure.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[1].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[1].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.usecases.system": {
    id: "qs.nav.usecases.system",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[2].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.usecases.system.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[2].to },
  },
  "qs.nav.usecases.system.label": {
    id: "qs.nav.usecases.system.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[2].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[2].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.nav.usecases.usecases": {
    id: "qs.nav.usecases.usecases",
    type: "box",
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[3].to },
    style: NAV_ITEM_STYLE,
    children: ["qs.nav.usecases.usecases.label"],
    onPress: { kind: "navigate", to: QUICKSTART_NAV_ITEMS[3].to },
  },
  "qs.nav.usecases.usecases.label": {
    id: "qs.nav.usecases.usecases.label",
    type: "text",
    value: QUICKSTART_NAV_ITEMS[3].label,
    activeWhen: { screen: QUICKSTART_NAV_ITEMS[3].to },
    style: NAV_LABEL_STYLE,
  },
  "qs.usecases.hero": {
    id: "qs.usecases.hero",
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
    style: { preset: "eyebrow" },
  },
  "qs.usecases.hero.title": {
    id: "qs.usecases.hero.title",
    type: "text",
    value: "Use Cases",
    style: { preset: "heading" },
  },
  "qs.usecases.hero.body": {
    id: "qs.usecases.hero.body",
    type: "text",
    value:
      "Ask Facet to draw a concrete app surface. The agent can inspect a Pattern, then author ordinary native bricks with Presets and deliberate direct style instead of only replying in chat.",
    style: { preset: "body" },
  },
  "qs.usecases.alert": {
    id: "qs.usecases.alert",
    type: "box",
    style: { preset: "infoAlert" },
    children: ["qs.usecases.alert.title", "qs.usecases.alert.body"],
  },
  "qs.usecases.alert.title": {
    id: "qs.usecases.alert.title",
    type: "text",
    value: "Try a real request",
    style: { preset: "infoAlert" },
  },
  "qs.usecases.alert.body": {
    id: "qs.usecases.alert.body",
    type: "text",
    value:
      "Examples: customer onboarding, pricing comparison, CRM dashboard, evaluation replay, or support triage.",
    style: { preset: "body", color: "infoForeground" },
  },
  "qs.usecases.examples": {
    id: "qs.usecases.examples",
    type: "box",
    style: { gap: "md", padding: "lg", width: "full" },
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
    style: { preset: "heading" },
  },
  "qs.usecases.examples.body": {
    id: "qs.usecases.examples.body",
    type: "text",
    value: "These are prompts the agent can turn into a live page using Patterns as references.",
    style: { preset: "body" },
  },
  "qs.usecases.list": {
    id: "qs.usecases.list",
    type: "list",
    style: { preset: "standard" },
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
    type: "box",
    style: ACTION_STYLE,
    children: ["qs.usecases.dashboard.label"],
    onPress: {
      kind: "agent",
      name: "show_use_case",
      payload: { use_case: "dashboard" },
    },
  },
  "qs.usecases.dashboard.label": {
    id: "qs.usecases.dashboard.label",
    type: "text",
    value: "Dashboard",
    style: ACTION_LABEL_STYLE,
  },
  "qs.usecases.pricing": {
    id: "qs.usecases.pricing",
    type: "box",
    style: ACTION_STYLE,
    children: ["qs.usecases.pricing.label"],
    onPress: {
      kind: "agent",
      name: "show_use_case",
      payload: { use_case: "pricing" },
    },
  },
  "qs.usecases.pricing.label": {
    id: "qs.usecases.pricing.label",
    type: "text",
    value: "Pricing",
    style: ACTION_LABEL_STYLE,
  },
  "qs.usecases.onboarding": {
    id: "qs.usecases.onboarding",
    type: "box",
    style: ACTION_STYLE,
    children: ["qs.usecases.onboarding.label"],
    onPress: {
      kind: "agent",
      name: "show_use_case",
      payload: { use_case: "onboarding" },
    },
  },
  "qs.usecases.onboarding.label": {
    id: "qs.usecases.onboarding.label",
    type: "text",
    value: "Onboarding",
    style: ACTION_LABEL_STYLE,
  },
  "qs.usecases.replay": {
    id: "qs.usecases.replay",
    type: "box",
    style: ACTION_STYLE,
    children: ["qs.usecases.replay.label"],
    onPress: {
      kind: "agent",
      name: "show_use_case",
      payload: { use_case: "replay" },
    },
  },
  "qs.usecases.replay.label": {
    id: "qs.usecases.replay.label",
    type: "text",
    value: "Replay view",
    style: ACTION_LABEL_STYLE,
  },
} satisfies FacetTree["nodes"];
