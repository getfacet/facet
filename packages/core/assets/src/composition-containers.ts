import type { FacetComposition } from "@facet/core";

export const CARD_COMPOSITION: FacetComposition = {
  name: "card",
  metadata: {
    description: "A titled content card with body copy.",
    category: "content",
    useWhen: "Grouping one concept, record, or explanation.",
    avoidWhen: "The content is a whole screen section.",
    tags: ["card", "content"],
    variants: ["default", "interactive"],
    repeatable: true,
    preferredParent: "box",
  },
  root: "card.root",
  nodes: {
    "card.root": {
      id: "card.root",
      type: "box",
      style: {
        bg: "surface",
        border: true,
        gap: "sm",
        pad: "md",
        radius: "md",
        shadow: "sm",
      },
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
      style: { color: "fg", size: "lg", weight: "bold" },
    },
    "card.body": {
      id: "card.body",
      type: "text",
      value: "Review goals, owners, and open decisions for the next release.",
      style: { color: "fg-muted" },
    },
  },
};

export const SECTION_COMPOSITION: FacetComposition = {
  name: "section",
  metadata: {
    description: "A general content section with a title and supporting copy.",
    category: "content",
    useWhen: "Grouping a focused part of a page under one heading.",
    avoidWhen: "A smaller card or a whole screen is the clearer boundary.",
    tags: ["section", "content", "layout"],
    variants: ["default", "surface"],
    repeatable: true,
    preferredParent: "root",
  },
  root: "section.root",
  nodes: {
    "section.root": {
      id: "section.root",
      type: "box",
      style: { gap: "md", pad: "lg", width: "full" },
      children: ["section.title", "section.body"],
    },
    "section.title": {
      id: "section.title",
      type: "text",
      value: "Section title",
      style: { color: "fg", size: "xl", weight: "bold" },
    },
    "section.body": {
      id: "section.body",
      type: "text",
      value: "Add focused content for this part of the page.",
      style: { color: "fg" },
    },
  },
};

export const EMPTY_STATE_COMPOSITION: FacetComposition = {
  name: "empty-state",
  metadata: {
    description: "A compact empty state with a recovery action.",
    category: "feedback",
    useWhen: "There is no data yet and the user needs a clear next action.",
    avoidWhen: "There is meaningful content to summarize.",
    tags: ["empty", "feedback", "action"],
    variants: ["default"],
    repeatable: true,
    preferredParent: "box",
  },
  root: "empty-state.root",
  nodes: {
    "empty-state.root": {
      id: "empty-state.root",
      type: "box",
      style: {
        bg: "surface",
        border: true,
        gap: "sm",
        pad: "lg",
        radius: "md",
        align: "center",
        width: "full",
      },
      children: ["empty-state.title", "empty-state.body", "empty-state.action"],
    },
    "empty-state.title": {
      id: "empty-state.title",
      type: "text",
      value: "No projects yet",
      style: { color: "fg", align: "center", size: "lg", weight: "bold" },
    },
    "empty-state.body": {
      id: "empty-state.body",
      type: "text",
      value: "Create your first project to start organizing this workspace.",
      style: { color: "fg-muted", align: "center" },
    },
    "empty-state.action": {
      id: "empty-state.action",
      type: "button",
      label: "Create project",
      variant: "primary",
      onPress: { kind: "agent", name: "create_item" },
    },
  },
};
