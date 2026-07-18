import type { FacetTree } from "@facet/core";

import type { ScenarioFixture } from "./scenarios.js";

const ANALYTICS_TREE = {
  root: "analytics-root",
  nodes: {
    "analytics-root": {
      id: "analytics-root",
      type: "box",
      children: [
        "analytics-title",
        "analytics-summary",
        "analytics-chart",
        "analytics-progress",
        "analytics-refresh",
      ],
    },
    "analytics-title": {
      id: "analytics-title",
      type: "text",
      value: "Workspace analytics",
      style: { preset: "heading" },
    },
    "analytics-summary": {
      id: "analytics-summary",
      type: "keyValue",
      style: { preset: "standard" },
      items: [
        { label: "Active workspaces", value: "24" },
        { label: "Weekly change", value: "+12%" },
      ],
    },
    "analytics-chart": {
      id: "analytics-chart",
      type: "chart",
      kind: "line",
      title: "Weekly activity",
      labels: ["Week 1", "Week 2", "Week 3"],
      series: [{ label: "Active", values: [12, 18, 24] }],
      style: { preset: "panel" },
    },
    "analytics-progress": {
      id: "analytics-progress",
      type: "progress",
      value: 72,
      label: "Quarterly goal",
      style: { preset: "success" },
    },
    "analytics-refresh": {
      id: "analytics-refresh",
      type: "box",
      children: ["analytics-refresh-label"],
      onPress: { kind: "agent", name: "refresh_analytics" },
      style: { preset: "secondaryAction" },
    },
    "analytics-refresh-label": {
      id: "analytics-refresh-label",
      type: "text",
      value: "Refresh analytics",
      style: { preset: "actionLabel" },
    },
  },
} as const satisfies FacetTree;

const DATA_OPERATIONS_TREE = {
  root: "data-root",
  nodes: {
    "data-root": {
      id: "data-root",
      type: "box",
      children: ["data-title", "data-chart", "data-table", "data-refresh"],
    },
    "data-title": {
      id: "data-title",
      type: "text",
      value: "Regional performance",
      style: { preset: "heading" },
    },
    "data-chart": {
      id: "data-chart",
      type: "chart",
      kind: "bar",
      title: "Orders",
      labels: ["North", "South", "West"],
      series: [{ label: "Orders", values: [18, 14, 11] }],
      style: { preset: "panel" },
    },
    "data-table": {
      id: "data-table",
      type: "table",
      caption: "Region detail",
      columns: [
        { key: "region", label: "Region" },
        { key: "value", label: "Orders" },
      ],
      rows: [
        { region: "North", value: 18 },
        { region: "South", value: 14 },
        { region: "West", value: 11 },
      ],
      style: { preset: "standard" },
    },
    "data-refresh": {
      id: "data-refresh",
      type: "box",
      children: ["data-refresh-label"],
      onPress: { kind: "agent", name: "refresh_data" },
      style: { preset: "secondaryAction" },
    },
    "data-refresh-label": {
      id: "data-refresh-label",
      type: "text",
      value: "Refresh rows",
      style: { preset: "actionLabel" },
    },
  },
} as const satisfies FacetTree;

const SETTINGS_TREE = {
  root: "settings-root",
  nodes: {
    "settings-root": {
      id: "settings-root",
      type: "box",
      children: [
        "settings-title",
        "settings-email",
        "settings-timezone",
        "settings-save",
        "settings-status",
      ],
      style: { preset: "panel" },
    },
    "settings-title": {
      id: "settings-title",
      type: "text",
      value: "Workspace settings",
      style: { preset: "heading" },
    },
    "settings-email": {
      id: "settings-email",
      type: "input",
      name: "notification_email",
      input: "email",
      label: "Notification email",
      style: { preset: "standard" },
    },
    "settings-timezone": {
      id: "settings-timezone",
      type: "input",
      name: "timezone",
      input: "select",
      label: "Timezone",
      options: ["UTC", "PST", "EST"],
      style: { preset: "standard" },
    },
    "settings-save": {
      id: "settings-save",
      type: "box",
      children: ["settings-save-label"],
      onPress: { kind: "agent", name: "save_settings", collect: "settings-root" },
      style: { preset: "primaryAction" },
    },
    "settings-save-label": {
      id: "settings-save-label",
      type: "text",
      value: "Save settings",
      style: { preset: "actionLabel" },
    },
    "settings-status": {
      id: "settings-status",
      type: "text",
      value: "No pending changes",
      style: { preset: "muted" },
    },
  },
} as const satisfies FacetTree;

export const ANALYTICS_FIXTURE = {
  role: "data-workflow",
  providerSteps: [
    { id: "analytics-initial", phase: "initial", output: { kind: "render", tree: ANALYTICS_TREE } },
    {
      id: "analytics-ui-in",
      phase: "ui-in",
      output: {
        kind: "patch",
        patches: [{ op: "replace", path: "/nodes/analytics-progress/value", value: 82 }],
      },
    },
    {
      id: "analytics-follow-up",
      phase: "follow-up",
      output: {
        kind: "patch",
        patches: [
          {
            op: "replace",
            path: "/nodes/analytics-title/value",
            value: "Workspace analytics: refreshed",
          },
        ],
      },
    },
  ],
} as const satisfies ScenarioFixture;

export const DATA_OPERATIONS_FIXTURE = {
  role: "data-workflow",
  providerSteps: [
    {
      id: "data-operations-initial",
      phase: "initial",
      output: { kind: "render", tree: DATA_OPERATIONS_TREE },
    },
    {
      id: "data-operations-ui-in",
      phase: "ui-in",
      output: {
        kind: "patch",
        patches: [{ op: "replace", path: "/nodes/data-table/rows/0/value", value: 19 }],
      },
    },
    {
      id: "data-operations-follow-up",
      phase: "follow-up",
      output: {
        kind: "patch",
        patches: [
          { op: "replace", path: "/nodes/data-title/value", value: "Regional performance: latest" },
        ],
      },
    },
  ],
} as const satisfies ScenarioFixture;

export const SETTINGS_FIXTURE = {
  role: "data-workflow",
  providerSteps: [
    { id: "settings-initial", phase: "initial", output: { kind: "render", tree: SETTINGS_TREE } },
    {
      id: "settings-ui-in",
      phase: "ui-in",
      output: {
        kind: "patch",
        patches: [{ op: "replace", path: "/nodes/settings-status/value", value: "Settings saved" }],
      },
    },
    {
      id: "settings-follow-up",
      phase: "follow-up",
      output: {
        kind: "patch",
        patches: [
          {
            op: "replace",
            path: "/nodes/settings-title/value",
            value: "Workspace settings: current",
          },
        ],
      },
    },
  ],
} as const satisfies ScenarioFixture;
