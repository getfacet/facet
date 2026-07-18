import type { FacetTree } from "@facet/core";

import type { ScenarioFixture } from "./scenarios.js";

const MARKETING_TREE = {
  root: "marketing-root",
  nodes: {
    "marketing-root": {
      id: "marketing-root",
      type: "box",
      children: ["marketing-title", "marketing-body", "marketing-action"],
    },
    "marketing-title": {
      id: "marketing-title",
      type: "text",
      value: "A safer way to build adaptive interfaces",
      style: { preset: "heading" },
    },
    "marketing-body": {
      id: "marketing-body",
      type: "text",
      value: "Compose live product experiences from validated native bricks.",
      style: { preset: "body" },
    },
    "marketing-action": {
      id: "marketing-action",
      type: "box",
      children: ["marketing-action-label"],
      onPress: { kind: "agent", name: "explore_marketing" },
      style: { preset: "primaryAction" },
    },
    "marketing-action-label": {
      id: "marketing-action-label",
      type: "text",
      value: "Explore the approach",
      style: { preset: "actionLabel" },
    },
  },
} as const satisfies FacetTree;

const DOCUMENTATION_TREE = {
  root: "docs-root",
  nodes: {
    "docs-root": {
      id: "docs-root",
      type: "box",
      children: ["docs-title", "docs-content", "docs-topics", "docs-action"],
    },
    "docs-title": {
      id: "docs-title",
      type: "text",
      value: "Integration guide",
      style: { preset: "heading" },
    },
    "docs-content": {
      id: "docs-content",
      type: "richtext",
      style: { preset: "prose" },
      blocks: [
        {
          type: "paragraph",
          runs: [{ text: "Start with a validated Theme, then let the agent author patches." }],
        },
      ],
    },
    "docs-topics": {
      id: "docs-topics",
      type: "list",
      style: { preset: "standard" },
      items: [
        { title: "Contracts", body: "Closed bricks and styles" },
        { title: "Runtime", body: "Ordered UI-IN and patch flow" },
      ],
    },
    "docs-action": {
      id: "docs-action",
      type: "box",
      children: ["docs-action-label"],
      onPress: { kind: "agent", name: "show_docs_example" },
      style: { preset: "secondaryAction" },
    },
    "docs-action-label": {
      id: "docs-action-label",
      type: "text",
      value: "Show an example",
      style: { preset: "actionLabel" },
    },
  },
} as const satisfies FacetTree;

export const MARKETING_FIXTURE = {
  role: "marketing-content",
  providerSteps: [
    {
      id: "marketing-initial",
      phase: "initial",
      output: { kind: "render", tree: MARKETING_TREE },
    },
    {
      id: "marketing-ui-in",
      phase: "ui-in",
      output: {
        kind: "patch",
        patches: [
          {
            op: "replace",
            path: "/nodes/marketing-body/value",
            value: "The page adapted after the primary action.",
          },
        ],
      },
    },
    {
      id: "marketing-follow-up",
      phase: "follow-up",
      output: {
        kind: "patch",
        patches: [
          {
            op: "replace",
            path: "/nodes/marketing-title/value",
            value: "Adaptive interfaces, ready for review",
          },
        ],
      },
    },
  ],
} as const satisfies ScenarioFixture;

export const DOCUMENTATION_FIXTURE = {
  role: "marketing-content",
  providerSteps: [
    {
      id: "documentation-initial",
      phase: "initial",
      output: { kind: "render", tree: DOCUMENTATION_TREE },
    },
    {
      id: "documentation-ui-in",
      phase: "ui-in",
      output: {
        kind: "patch",
        patches: [
          {
            op: "replace",
            path: "/nodes/docs-title/value",
            value: "Integration guide: worked example",
          },
        ],
      },
    },
    {
      id: "documentation-follow-up",
      phase: "follow-up",
      output: {
        kind: "patch",
        patches: [
          {
            op: "replace",
            path: "/nodes/docs-content/blocks/0/runs/0/text",
            value: "Validate assets, author RFC 6902 patches, and replay only accepted frames.",
          },
        ],
      },
    },
  ],
} as const satisfies ScenarioFixture;
