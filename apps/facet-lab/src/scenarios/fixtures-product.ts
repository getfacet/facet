import type { FacetTree } from "@facet/core";

import type { ScenarioFixture } from "./scenarios.js";

const PRODUCT_TREE = {
  root: "product-root",
  nodes: {
    "product-root": {
      id: "product-root",
      type: "box",
      children: ["product-title", "product-list", "product-detail", "product-select"],
    },
    "product-title": {
      id: "product-title",
      type: "text",
      value: "Product workspace",
      style: { preset: "heading" },
    },
    "product-list": {
      id: "product-list",
      type: "list",
      items: [
        { title: "Atlas", body: "Active" },
        { title: "Beacon", body: "Draft" },
        { title: "Compass", body: "Paused" },
      ],
      style: { preset: "standard" },
    },
    "product-detail": {
      id: "product-detail",
      type: "keyValue",
      items: [
        { label: "Selected", value: "Atlas" },
        { label: "Owner", value: "Platform team" },
        { label: "State", value: "Active" },
      ],
      style: { preset: "standard" },
    },
    "product-select": {
      id: "product-select",
      type: "box",
      children: ["product-select-label"],
      onPress: { kind: "agent", name: "select_product" },
      style: { preset: "secondaryAction" },
    },
    "product-select-label": {
      id: "product-select-label",
      type: "text",
      value: "Select Beacon",
      style: { preset: "actionLabel" },
    },
  },
} as const satisfies FacetTree;

const SUPPORT_TREE = {
  root: "support-root",
  nodes: {
    "support-root": {
      id: "support-root",
      type: "box",
      children: [
        "support-title",
        "support-category",
        "support-details",
        "support-submit",
        "support-status",
      ],
      style: { preset: "panel" },
    },
    "support-title": {
      id: "support-title",
      type: "text",
      value: "Support request",
      style: { preset: "heading" },
    },
    "support-category": {
      id: "support-category",
      type: "input",
      name: "issue_type",
      input: "select",
      label: "Issue type",
      options: ["Billing", "Technical", "Account"],
      style: { preset: "standard" },
    },
    "support-details": {
      id: "support-details",
      type: "input",
      name: "details",
      input: "text",
      label: "What happened?",
      style: { preset: "standard" },
    },
    "support-submit": {
      id: "support-submit",
      type: "box",
      children: ["support-submit-label"],
      onPress: { kind: "agent", name: "submit_support", collect: "support-root" },
      style: { preset: "primaryAction" },
    },
    "support-submit-label": {
      id: "support-submit-label",
      type: "text",
      value: "Send request",
      style: { preset: "actionLabel" },
    },
    "support-status": {
      id: "support-status",
      type: "text",
      value: "Request details are ready",
      style: { preset: "muted" },
    },
  },
} as const satisfies FacetTree;

export const PRODUCT_FIXTURE = {
  role: "product-workflow",
  providerSteps: [
    { id: "product-initial", phase: "initial", output: { kind: "render", tree: PRODUCT_TREE } },
    {
      id: "product-ui-in",
      phase: "ui-in",
      output: {
        kind: "patch",
        patches: [{ op: "replace", path: "/nodes/product-detail/items/0/value", value: "Beacon" }],
      },
    },
    {
      id: "product-follow-up",
      phase: "follow-up",
      output: {
        kind: "patch",
        patches: [
          { op: "replace", path: "/nodes/product-title/value", value: "Product workspace: Beacon" },
        ],
      },
    },
  ],
} as const satisfies ScenarioFixture;

export const SUPPORT_FIXTURE = {
  role: "product-workflow",
  providerSteps: [
    { id: "support-initial", phase: "initial", output: { kind: "render", tree: SUPPORT_TREE } },
    {
      id: "support-ui-in",
      phase: "ui-in",
      output: {
        kind: "patch",
        patches: [
          { op: "replace", path: "/nodes/support-status/value", value: "Request submitted" },
        ],
      },
    },
    {
      id: "support-follow-up",
      phase: "follow-up",
      output: {
        kind: "patch",
        patches: [
          { op: "replace", path: "/nodes/support-title/value", value: "Support request received" },
        ],
      },
    },
  ],
} as const satisfies ScenarioFixture;
