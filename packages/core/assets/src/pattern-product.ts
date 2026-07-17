import type { FacetPattern } from "@facet/core";

export const DASHBOARD_SUMMARY_PATTERN = {
  name: "dashboard-summary",
  description:
    "A KPI summary with status and progress. Adapt its illustrative values and labels to verified data before authoring.",
  useWhen: "Summarizing current performance or account state in a compact overview.",
  avoidWhen:
    "Avoid when detailed raw records are needed first or the example values cannot be adapted safely.",
  root: "dashboard-summary.root",
  nodes: {
    "dashboard-summary.root": {
      id: "dashboard-summary.root",
      type: "box",
      style: { preset: "panel", padding: "lg" },
      children: [
        "dashboard-summary.title",
        "dashboard-summary.stat",
        "dashboard-summary.badge",
        "dashboard-summary.progress",
      ],
    },
    "dashboard-summary.title": {
      id: "dashboard-summary.title",
      type: "text",
      value: "Overview",
      style: { preset: "heading" },
    },
    "dashboard-summary.stat": {
      id: "dashboard-summary.stat",
      type: "box",
      style: { gap: "xs" },
      children: [
        "dashboard-summary.stat-label",
        "dashboard-summary.stat-value",
        "dashboard-summary.stat-delta",
      ],
    },
    "dashboard-summary.stat-label": {
      id: "dashboard-summary.stat-label",
      type: "text",
      value: "Revenue",
      style: { preset: "muted" },
    },
    "dashboard-summary.stat-value": {
      id: "dashboard-summary.stat-value",
      type: "text",
      value: "$42k",
      style: { preset: "metric" },
    },
    "dashboard-summary.stat-delta": {
      id: "dashboard-summary.stat-delta",
      type: "text",
      value: "+12%",
      style: { fontSize: "sm", fontWeight: "semibold", color: "success" },
    },
    "dashboard-summary.badge": {
      id: "dashboard-summary.badge",
      type: "box",
      style: { preset: "successBadge" },
      children: ["dashboard-summary.badge-label"],
    },
    "dashboard-summary.badge-label": {
      id: "dashboard-summary.badge-label",
      type: "text",
      value: "Healthy",
      style: { preset: "successBadge" },
    },
    "dashboard-summary.progress": {
      id: "dashboard-summary.progress",
      type: "progress",
      label: "Goal",
      value: 72,
      style: { preset: "standard" },
    },
  },
} satisfies FacetPattern;

export const SETTINGS_PANEL_PATTERN = {
  name: "settings-panel",
  description:
    "A small settings form with a save action. Adapt its illustrative fields, choices, and action contract before authoring.",
  useWhen: "Collecting a small configuration update with one submit action.",
  avoidWhen:
    "Avoid for a long multi-step form or when the fields cannot be adapted to the real settings contract.",
  root: "settings-panel.root",
  nodes: {
    "settings-panel.root": {
      id: "settings-panel.root",
      type: "box",
      style: { preset: "panel" },
      children: [
        "settings-panel.title",
        "settings-panel.email",
        "settings-panel.timezone",
        "settings-panel.save",
      ],
    },
    "settings-panel.title": {
      id: "settings-panel.title",
      type: "text",
      value: "Workspace settings",
      style: { preset: "subheading" },
    },
    "settings-panel.email": {
      id: "settings-panel.email",
      type: "input",
      name: "email",
      input: "email",
      label: "Notification email",
      style: { preset: "standard" },
    },
    "settings-panel.timezone": {
      id: "settings-panel.timezone",
      type: "input",
      name: "timezone",
      input: "select",
      label: "Timezone",
      options: ["UTC", "PST", "EST"],
      style: { preset: "standard" },
    },
    "settings-panel.save": {
      id: "settings-panel.save",
      type: "box",
      style: { preset: "primaryAction" },
      children: ["settings-panel.save-label"],
      onPress: { kind: "agent", name: "save_settings", collect: "settings-panel.root" },
    },
    "settings-panel.save-label": {
      id: "settings-panel.save-label",
      type: "text",
      value: "Save settings",
      style: { preset: "actionLabel" },
    },
  },
} satisfies FacetPattern;

export const SUPPORT_TRIAGE_PATTERN = {
  name: "support-triage",
  description:
    "A compact support-intake form. Adapt its illustrative categories, fields, and submit action before authoring.",
  useWhen: "Collecting basic support context before an agent follow-up.",
  avoidWhen:
    "Avoid when the user already supplied the details or the form cannot be adapted to the support workflow.",
  root: "support-triage.root",
  nodes: {
    "support-triage.root": {
      id: "support-triage.root",
      type: "box",
      style: { preset: "panel" },
      children: [
        "support-triage.title",
        "support-triage.issue",
        "support-triage.details",
        "support-triage.submit",
      ],
    },
    "support-triage.title": {
      id: "support-triage.title",
      type: "text",
      value: "How can we help?",
      style: { preset: "subheading" },
    },
    "support-triage.issue": {
      id: "support-triage.issue",
      type: "input",
      name: "issue_type",
      input: "select",
      label: "Issue type",
      options: ["Billing", "Technical", "Account"],
      style: { preset: "standard" },
    },
    "support-triage.details": {
      id: "support-triage.details",
      type: "input",
      name: "details",
      input: "text",
      label: "Describe what happened",
      style: { preset: "standard" },
    },
    "support-triage.submit": {
      id: "support-triage.submit",
      type: "box",
      style: { preset: "primaryAction" },
      children: ["support-triage.submit-label"],
      onPress: { kind: "agent", name: "submit_support", collect: "support-triage.root" },
    },
    "support-triage.submit-label": {
      id: "support-triage.submit-label",
      type: "text",
      value: "Send request",
      style: { preset: "actionLabel" },
    },
  },
} satisfies FacetPattern;

export const PRODUCT_PATTERNS: readonly FacetPattern[] = [
  DASHBOARD_SUMMARY_PATTERN,
  SETTINGS_PANEL_PATTERN,
  SUPPORT_TRIAGE_PATTERN,
];
