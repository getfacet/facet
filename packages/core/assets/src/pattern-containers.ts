import type { FacetPattern } from "@facet/core";

export const CARD_PATTERN = {
  name: "card",
  description: "A titled content card with body copy.",
  useWhen: "Grouping one concept, record, or explanation.",
  avoidWhen: "The content is a whole screen section.",
  root: "card.root",
  nodes: {
    "card.root": {
      id: "card.root",
      type: "box",
      style: { preset: "panel", gap: "sm" },
      children: ["card.header"],
    },
    "card.header": {
      id: "card.header",
      type: "box",
      style: { gap: "xs" },
      children: ["card.title", "card.body"],
    },
    "card.title": {
      id: "card.title",
      type: "text",
      value: "Quarterly planning",
      style: { preset: "subheading" },
    },
    "card.body": {
      id: "card.body",
      type: "text",
      value: "Review goals, owners, and open decisions for the next release.",
      style: { preset: "muted" },
    },
  },
} satisfies FacetPattern;

export const SECTION_PATTERN = {
  name: "section",
  description: "A general content section with a title and supporting copy.",
  useWhen: "Grouping a focused part of a page under one heading.",
  avoidWhen: "A smaller card or a whole screen is the clearer boundary.",
  root: "section.root",
  nodes: {
    "section.root": {
      id: "section.root",
      type: "box",
      style: { gap: "md", padding: "lg", width: "full" },
      children: ["section.title", "section.body"],
    },
    "section.title": {
      id: "section.title",
      type: "text",
      value: "Section title",
      style: { preset: "heading" },
    },
    "section.body": {
      id: "section.body",
      type: "text",
      value: "Add focused content for this part of the page.",
      style: { preset: "body" },
    },
  },
} satisfies FacetPattern;

export const EMPTY_STATE_PATTERN = {
  name: "empty-state",
  description: "A compact empty state with a recovery action.",
  useWhen: "There is no data yet and the user needs a clear next action.",
  avoidWhen: "There is meaningful content to summarize.",
  root: "empty-state.root",
  nodes: {
    "empty-state.root": {
      id: "empty-state.root",
      type: "box",
      style: { preset: "panel", gap: "sm", padding: "lg", alignItems: "center" },
      children: ["empty-state.title", "empty-state.body", "empty-state.action"],
    },
    "empty-state.title": {
      id: "empty-state.title",
      type: "text",
      value: "No projects yet",
      style: { preset: "subheading", textAlign: "center" },
    },
    "empty-state.body": {
      id: "empty-state.body",
      type: "text",
      value: "Create your first project to start organizing this workspace.",
      style: { preset: "muted", textAlign: "center" },
    },
    "empty-state.action": {
      id: "empty-state.action",
      type: "box",
      style: { preset: "primaryAction" },
      children: ["empty-state.action-label"],
      onPress: { kind: "agent", name: "create_item" },
    },
    "empty-state.action-label": {
      id: "empty-state.action-label",
      type: "text",
      value: "Create project",
      style: { preset: "actionLabel" },
    },
  },
} satisfies FacetPattern;

export const CONTAINER_PATTERNS: readonly FacetPattern[] = [
  CARD_PATTERN,
  SECTION_PATTERN,
  EMPTY_STATE_PATTERN,
];
