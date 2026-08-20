/** Default navigation and action specs. Actions remain literal nav: or agent: references. */
import type { ComponentSpec } from "@facet/core";

export const NAVIGATION_SPEC: ComponentSpec = {
  tag: "Navigation",
  whenToUse:
    "Use Navigation when persistent destinations or commands must remain discoverable as a bar or rail. Avoid it for one-off next-step actions.",
  props: {
    label: {
      type: "string",
      guidance: "Optional accessible name distinguishing this navigation from others.",
    },
    orientation: {
      type: "string",
      guidance: "Whether items form a horizontal bar or vertical rail.",
      enum: ["horizontal", "vertical"],
      default: "horizontal",
    },
    density: {
      type: "string",
      guidance: "How tightly navigation items are spaced.",
      enum: ["compact", "comfortable"],
      default: "comfortable",
    },
    tone: {
      type: "string",
      guidance: "Semantic visual emphasis for the navigation surface.",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
    },
  },
  content: {
    mode: "slots",
    slots: {
      brand: { guidance: "Optional navigation identity.", minChildren: 0, maxChildren: 1 },
      items: {
        guidance: "Navigation destinations and commands.",
        minChildren: 1,
        maxChildren: 32,
      },
      actions: { guidance: "Optional navigation actions.", minChildren: 0, maxChildren: 4 },
    },
  },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      paddingBlock: "length",
      paddingInline: "length",
      gap: "length",
    },
  },
};

export const NAVIGATION_ITEM_SPEC: ComponentSpec = {
  tag: "NavigationItem",
  whenToUse:
    "Use NavigationItem for one destination or command inside Navigation. Prefer Button for a task action outside persistent navigation.",
  props: {
    label: {
      type: "string",
      guidance: "Visible label naming the destination or command.",
      required: true,
    },
    action: {
      type: "string",
      guidance: "Literal nav: destination or agent: event activated by this item.",
      required: true,
      action: true,
    },
    arg: {
      type: "string",
      guidance: "Optional explicit argument sent with an agent: event.",
    },
    mark: { type: "string", guidance: "Optional short leading mark." },
    meta: { type: "string", guidance: "Optional trailing count, status, or context." },
    active: {
      type: "boolean",
      guidance: "Whether this item denotes the current destination.",
      default: false,
    },
  },
  content: { mode: "none" },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      activeBg: "color",
      activeText: "color",
      activeBorder: "color",
      radius: "length",
      paddingBlock: "length",
      paddingInline: "length",
      gap: "length",
      focusRing: "shadow",
    },
  },
};

export const BUTTON_SPEC: ComponentSpec = {
  tag: "Button",
  whenToUse:
    "Use Button for one explicit action; for accepted choices, make one Button per offered value and set arg to that exact value. Avoid replacing choices with an argument-free continue Button.",
  props: {
    label: { type: "string", guidance: "Visible label naming the action.", required: true },
    action: {
      type: "string",
      guidance: "Literal nav: destination or agent: event activated by this button.",
      required: true,
      action: true,
    },
    arg: {
      type: "string",
      guidance:
        "Explicit argument sent with an agent: event. Required when the event contract declares accepted choice values; use one exact accepted value for each offered Button.",
    },
    collect: {
      type: "string",
      guidance: "Space-separated field names included with an agent: event.",
    },
    tone: {
      type: "string",
      guidance: "Prominence of the action within its surrounding controls.",
      enum: ["primary", "secondary", "quiet"],
      default: "secondary",
    },
  },
  content: { mode: "none" },
  themeRecipe: {
    tokens: {
      primaryBg: "color",
      primaryText: "color",
      primaryBorder: "color",
      secondaryBg: "color",
      secondaryText: "color",
      secondaryBorder: "color",
      quietText: "color",
      radius: "length",
      paddingInline: "length",
      paddingBlock: "length",
      focusRing: "shadow",
    },
  },
};

export const ACTION_GROUP_SPEC: ComponentSpec = {
  tag: "ActionGroup",
  whenToUse:
    "Use ActionGroup when several closely related actions need shared alignment or emphasis. Prefer ActionBar when actions need adjacent status or explanation.",
  props: {
    title: { type: "string", guidance: "Optional heading for the action group." },
    layout: {
      type: "string",
      guidance: "Whether actions run across a row or down a stack.",
      enum: ["row", "stack"],
      default: "stack",
    },
    align: {
      type: "string",
      guidance: "How actions align within the available width.",
      enum: ["start", "center", "end"],
      default: "start",
    },
    density: {
      type: "string",
      guidance: "How tightly actions are spaced.",
      enum: ["compact", "comfortable"],
      default: "comfortable",
    },
    tone: {
      type: "string",
      guidance: "Semantic visual emphasis for the group surface.",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
    },
  },
  content: { mode: "children" },
  themeRecipe: {
    tokens: {
      background: "color",
      border: "color",
      radius: "length",
      padding: "length",
      gap: "length",
      titleColor: "color",
    },
  },
};

export const ACTION_BAR_SPEC: ComponentSpec = {
  tag: "ActionBar",
  whenToUse:
    "Use ActionBar when compact context or a current selection must stay beside its available actions. Prefer ActionGroup when no contextual region is needed.",
  props: {
    align: {
      type: "string",
      guidance: "How context and actions share the band.",
      enum: ["start", "center", "between"],
      default: "start",
    },
    tone: {
      type: "string",
      guidance: "Semantic visual emphasis for the action band.",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
    },
  },
  content: {
    mode: "slots",
    slots: {
      context: { guidance: "Optional context for the actions.", minChildren: 0, maxChildren: 4 },
      actions: { guidance: "The available actions.", minChildren: 1, maxChildren: 4 },
    },
  },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      gap: "length",
    },
  },
};

/** The complete navigation/action group in the locked catalog order. */
export const SURFACE_SPECS: readonly ComponentSpec[] = Object.freeze([
  NAVIGATION_SPEC,
  NAVIGATION_ITEM_SPEC,
  BUTTON_SPEC,
  ACTION_GROUP_SPEC,
  ACTION_BAR_SPEC,
]);
