import type { FacetPattern } from "@facet/core";

export const CTA_BUTTON_PATTERN = {
  name: "cta-button",
  description: "A pressable action surface with one concise text label.",
  useWhen: "The user should take one clear next action.",
  avoidWhen: "The action needs surrounding explanation or fields.",
  root: "cta-button.root",
  nodes: {
    "cta-button.root": {
      id: "cta-button.root",
      type: "box",
      style: { preset: "primaryAction" },
      children: ["cta-button.label"],
      onPress: { kind: "agent", name: "start" },
    },
    "cta-button.label": {
      id: "cta-button.label",
      type: "text",
      value: "Get started",
      style: { preset: "actionLabel" },
    },
  },
} satisfies FacetPattern;

export const FORM_PATTERN = {
  name: "form",
  description: "An input group with an explicitly closed agent submit action.",
  useWhen: "Collecting a small set of visitor fields for one agent action.",
  avoidWhen: "The visitor can complete the interaction with fixed local choices.",
  root: "form.root",
  nodes: {
    "form.root": {
      id: "form.root",
      type: "box",
      style: { preset: "panel", gap: "sm" },
      children: ["form.title", "form.email", "form.role", "form.submit"],
    },
    "form.title": {
      id: "form.title",
      type: "text",
      value: "Join the workspace",
      style: { preset: "subheading" },
    },
    "form.email": {
      id: "form.email",
      type: "input",
      name: "email",
      input: "email",
      label: "Work email",
      placeholder: "you@example.com",
      style: { preset: "standard" },
    },
    "form.role": {
      id: "form.role",
      type: "input",
      name: "role",
      input: "select",
      label: "Role",
      options: ["Design", "Engineering", "Product"],
      style: { preset: "standard" },
    },
    "form.submit": {
      id: "form.submit",
      type: "box",
      style: { preset: "primaryAction" },
      children: ["form.submit-label"],
      onPress: { kind: "agent", name: "submit_form", collect: "form.root" },
    },
    "form.submit-label": {
      id: "form.submit-label",
      type: "text",
      value: "Continue",
      style: { preset: "actionLabel" },
    },
  },
} satisfies FacetPattern;

export const FIXED_FILTER_PATTERN = {
  name: "fixed-filter",
  description: "A bounded filter row that navigates among pre-authored local screens.",
  useWhen: "A small fixed choice can reveal already-authored result views locally.",
  avoidWhen: "Filtering requires a new backend query, arbitrary criteria, or agent reasoning.",
  root: "fixed-filter.root",
  nodes: {
    "fixed-filter.root": {
      id: "fixed-filter.root",
      type: "box",
      style: { direction: "row", gap: "xs", width: "full" },
      children: ["fixed-filter.all", "fixed-filter.open", "fixed-filter.closed"],
    },
    "fixed-filter.all": {
      id: "fixed-filter.all",
      type: "box",
      activeWhen: { screen: "filter-all" },
      style: { preset: "secondaryAction", active: { preset: "primaryAction" } },
      children: ["fixed-filter.all-label"],
      onPress: { kind: "navigate", to: "filter-all" },
    },
    "fixed-filter.all-label": {
      id: "fixed-filter.all-label",
      type: "text",
      value: "All",
      activeWhen: { screen: "filter-all" },
      style: { preset: "actionLabel", active: { color: "accentForeground" } },
    },
    "fixed-filter.open": {
      id: "fixed-filter.open",
      type: "box",
      activeWhen: { screen: "filter-open" },
      style: { preset: "secondaryAction", active: { preset: "primaryAction" } },
      children: ["fixed-filter.open-label"],
      onPress: { kind: "navigate", to: "filter-open" },
    },
    "fixed-filter.open-label": {
      id: "fixed-filter.open-label",
      type: "text",
      value: "Open",
      activeWhen: { screen: "filter-open" },
      style: { preset: "actionLabel", active: { color: "accentForeground" } },
    },
    "fixed-filter.closed": {
      id: "fixed-filter.closed",
      type: "box",
      activeWhen: { screen: "filter-closed" },
      style: { preset: "secondaryAction", active: { preset: "primaryAction" } },
      children: ["fixed-filter.closed-label"],
      onPress: { kind: "navigate", to: "filter-closed" },
    },
    "fixed-filter.closed-label": {
      id: "fixed-filter.closed-label",
      type: "text",
      value: "Closed",
      activeWhen: { screen: "filter-closed" },
      style: { preset: "actionLabel", active: { color: "accentForeground" } },
    },
  },
} satisfies FacetPattern;

export const METRIC_PATTERN = {
  name: "metric",
  description: "A label and data-bound value pair for one key metric.",
  useWhen: "Highlighting one important value from an existing stage dataset.",
  avoidWhen: "The user needs a full comparison table or trend chart.",
  root: "metric.root",
  nodes: {
    "metric.root": {
      id: "metric.root",
      type: "box",
      style: { preset: "panel", gap: "xs" },
      children: ["metric.label", "metric.value"],
    },
    "metric.label": {
      id: "metric.label",
      type: "text",
      value: "Revenue",
      style: { preset: "muted" },
    },
    "metric.value": {
      id: "metric.value",
      type: "text",
      value: "$42k",
      from: "summary",
      column: "revenue",
      row: 0,
      style: { preset: "metric" },
    },
  },
} satisfies FacetPattern;

export const TABS_PATTERN = {
  name: "tabs",
  description: "A tab row that switches among pre-authored local screens.",
  useWhen: "Peer views should remain available without an agent turn.",
  avoidWhen: "Selecting a tab must compute or retrieve new information.",
  root: "tabs.root",
  nodes: {
    "tabs.root": {
      id: "tabs.root",
      type: "box",
      style: { direction: "row", gap: "xs", width: "full" },
      children: ["tabs.overview", "tabs.activity", "tabs.settings"],
    },
    "tabs.overview": {
      id: "tabs.overview",
      type: "box",
      activeWhen: { screen: "overview" },
      style: { preset: "secondaryAction", active: { preset: "primaryAction" } },
      children: ["tabs.overview-label"],
      onPress: { kind: "navigate", to: "overview" },
    },
    "tabs.overview-label": {
      id: "tabs.overview-label",
      type: "text",
      value: "Overview",
      activeWhen: { screen: "overview" },
      style: { preset: "actionLabel", active: { color: "accentForeground" } },
    },
    "tabs.activity": {
      id: "tabs.activity",
      type: "box",
      activeWhen: { screen: "activity" },
      style: { preset: "secondaryAction", active: { preset: "primaryAction" } },
      children: ["tabs.activity-label"],
      onPress: { kind: "navigate", to: "activity" },
    },
    "tabs.activity-label": {
      id: "tabs.activity-label",
      type: "text",
      value: "Activity",
      activeWhen: { screen: "activity" },
      style: { preset: "actionLabel", active: { color: "accentForeground" } },
    },
    "tabs.settings": {
      id: "tabs.settings",
      type: "box",
      activeWhen: { screen: "settings" },
      style: { preset: "secondaryAction", active: { preset: "primaryAction" } },
      children: ["tabs.settings-label"],
      onPress: { kind: "navigate", to: "settings" },
    },
    "tabs.settings-label": {
      id: "tabs.settings-label",
      type: "text",
      value: "Settings",
      activeWhen: { screen: "settings" },
      style: { preset: "actionLabel", active: { color: "accentForeground" } },
    },
  },
} satisfies FacetPattern;

export const NAV_PATTERN = {
  name: "nav",
  description: "A navigation row for moving among pre-authored local screens.",
  useWhen: "The visitor needs stable movement among a small set of local destinations.",
  avoidWhen: "A destination is not already represented by an authored screen.",
  root: "nav.root",
  nodes: {
    "nav.root": {
      id: "nav.root",
      type: "box",
      style: { direction: "row", gap: "sm", padding: "sm", width: "full" },
      children: ["nav.home", "nav.projects", "nav.settings"],
    },
    "nav.home": {
      id: "nav.home",
      type: "box",
      activeWhen: { screen: "home" },
      style: { preset: "secondaryAction", active: { preset: "primaryAction" } },
      children: ["nav.home-label"],
      onPress: { kind: "navigate", to: "home" },
    },
    "nav.home-label": {
      id: "nav.home-label",
      type: "text",
      value: "Home",
      activeWhen: { screen: "home" },
      style: { preset: "actionLabel", active: { color: "accentForeground" } },
    },
    "nav.projects": {
      id: "nav.projects",
      type: "box",
      activeWhen: { screen: "projects" },
      style: { preset: "secondaryAction", active: { preset: "primaryAction" } },
      children: ["nav.projects-label"],
      onPress: { kind: "navigate", to: "projects" },
    },
    "nav.projects-label": {
      id: "nav.projects-label",
      type: "text",
      value: "Projects",
      activeWhen: { screen: "projects" },
      style: { preset: "actionLabel", active: { color: "accentForeground" } },
    },
    "nav.settings": {
      id: "nav.settings",
      type: "box",
      activeWhen: { screen: "settings" },
      style: { preset: "secondaryAction", active: { preset: "primaryAction" } },
      children: ["nav.settings-label"],
      onPress: { kind: "navigate", to: "settings" },
    },
    "nav.settings-label": {
      id: "nav.settings-label",
      type: "text",
      value: "Settings",
      activeWhen: { screen: "settings" },
      style: { preset: "actionLabel", active: { color: "accentForeground" } },
    },
  },
} satisfies FacetPattern;

export const CONTROL_PATTERNS: readonly FacetPattern[] = [
  CTA_BUTTON_PATTERN,
  FORM_PATTERN,
  FIXED_FILTER_PATTERN,
  METRIC_PATTERN,
  TABS_PATTERN,
  NAV_PATTERN,
];
