/** Default structure specs. Layout remains flow-contained; Modal is the sole overlap frame. */
import type { ComponentSpec } from "@facet/core";

export const SCREEN_SPEC: ComponentSpec = {
  tag: "Screen",
  whenToUse:
    "Use Screen as the root of each distinct navigable view. Do not use it as an inner layout wrapper; use Section, Stack, Grid, or Split inside it.",
  props: {
    name: {
      type: "string",
      guidance: "Unique screen name targeted by nav: actions.",
      required: true,
    },
    title: {
      type: "string",
      guidance: "Optional screen heading; omit it when the first child already names the screen.",
    },
    maxWidth: {
      type: "string",
      guidance: "Maximum width of the screen content.",
      enum: ["narrow", "medium", "wide", "full"],
      default: "medium",
    },
    padding: {
      type: "string",
      guidance: "Space between the screen edge and its content.",
      enum: ["none", "sm", "md", "lg"],
      default: "md",
    },
  },
  content: { mode: "children" },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      contentGap: "length",
      titleColor: "color",
      titleFontSize: "length",
      titleFontWeight: "fontWeight",
      titleLineHeight: "lineHeight",
    },
  },
};

export const STACK_SPEC: ComponentSpec = {
  tag: "Stack",
  whenToUse:
    "Use Stack when related regions should follow one vertical reading order. Prefer Row or Grid when horizontal alignment or repeated columns carries meaning.",
  props: {
    gap: {
      type: "string",
      guidance: "Space between children.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "md",
    },
    align: {
      type: "string",
      guidance: "How children align across the stack.",
      enum: ["start", "center", "end", "stretch"],
      default: "stretch",
    },
    justify: {
      type: "string",
      guidance: "How remaining vertical space is distributed.",
      enum: ["start", "center", "end", "between"],
      default: "start",
    },
    grow: {
      type: "boolean",
      guidance: "Whether the stack fills available vertical space.",
      default: false,
    },
    padding: {
      type: "string",
      guidance: "Space inside the stack.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "none",
    },
  },
  content: { mode: "children" },
  themeRecipe: { tokens: { defaultGap: "length", padding: "length" } },
};

export const ROW_SPEC: ComponentSpec = {
  tag: "Row",
  whenToUse:
    "Use Row when a small set of peers or controls should read horizontally and may wrap. Prefer Stack for vertical flow and Grid for repeated equal columns.",
  props: {
    gap: {
      type: "string",
      guidance: "Space between children.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "md",
    },
    align: {
      type: "string",
      guidance: "How children align vertically in the row.",
      enum: ["start", "center", "end", "stretch", "baseline"],
      default: "center",
    },
    justify: {
      type: "string",
      guidance: "How remaining horizontal space is distributed.",
      enum: ["start", "center", "end", "between"],
      default: "start",
    },
    wrap: {
      type: "boolean",
      guidance: "Whether children continue on another line when space runs out.",
      default: true,
    },
  },
  content: { mode: "children" },
  themeRecipe: { tokens: { defaultGap: "length", padding: "length" } },
};

export const GRID_SPEC: ComponentSpec = {
  tag: "Grid",
  whenToUse:
    "Use Grid when repeated peer content benefits from equal responsive columns. Prefer Row for one control band and Split for unequal primary and secondary regions.",
  props: {
    columns: {
      type: "number",
      guidance: "Number of equal columns on a wide container.",
      minimum: 1,
      maximum: 6,
      default: 3,
    },
    gap: {
      type: "string",
      guidance: "Space between grid cells.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "md",
    },
    collapse: {
      type: "boolean",
      guidance: "Whether the grid becomes one column when width is constrained.",
      default: true,
    },
  },
  content: { mode: "children" },
  themeRecipe: { tokens: { defaultGap: "length", minColumnWidth: "length" } },
};

export const SPLIT_SPEC: ComponentSpec = {
  tag: "Split",
  whenToUse:
    "Use Split when primary and secondary regions must stay visible together for comparison, reference, or coordinated work. Avoid it for a single linear flow.",
  props: {
    ratio: {
      type: "string",
      guidance: "How the primary and secondary regions share width.",
      enum: ["50:50", "60:40", "40:60", "70:30", "30:70"],
      default: "60:40",
    },
    gap: {
      type: "string",
      guidance: "Space between the two regions.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "lg",
    },
    align: {
      type: "string",
      guidance: "How the two regions align vertically.",
      enum: ["start", "center", "end", "stretch"],
      default: "stretch",
    },
    reverse: {
      type: "boolean",
      guidance: "Whether the visual order of the two named regions is reversed.",
      default: false,
    },
    collapse: {
      type: "boolean",
      guidance: "Whether the regions stack when width is constrained.",
      default: true,
    },
  },
  content: {
    mode: "slots",
    slots: {
      primary: { guidance: "Primary side of the split.", minChildren: 1, maxChildren: 1 },
      secondary: { guidance: "Secondary side of the split.", minChildren: 1, maxChildren: 1 },
    },
  },
  themeRecipe: { tokens: { defaultGap: "length", minColumnWidth: "length" } },
};

export const APP_SHELL_SPEC: ComponentSpec = {
  tag: "AppShell",
  whenToUse:
    "Use AppShell when navigation or a persistent header frames one changing main workspace. Avoid it for a focused page without persistent application chrome.",
  props: {
    gap: {
      type: "string",
      guidance: "Space between navigation and main content.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "lg",
    },
    sidebar: {
      type: "string",
      guidance: "Which side holds the navigation region on wide containers.",
      enum: ["start", "end"],
      default: "start",
    },
    collapse: {
      type: "boolean",
      guidance: "Whether navigation and main may stack when width is constrained.",
      default: true,
    },
  },
  content: {
    mode: "slots",
    slots: {
      navigation: { guidance: "Optional app navigation.", minChildren: 0, maxChildren: 1 },
      header: { guidance: "Optional app header.", minChildren: 0, maxChildren: 1 },
      main: { guidance: "The app's main content.", minChildren: 1, maxChildren: 1 },
    },
  },
  themeRecipe: {
    tokens: { defaultGap: "length", mainMinWidth: "length", minHeight: "length" },
  },
};

export const SECTION_SPEC: ComponentSpec = {
  tag: "Section",
  whenToUse:
    "Use Section when one meaningful page region needs its own heading, context, or tone in normal flow. Avoid it as a wrapper that adds no semantic grouping.",
  props: {
    title: { type: "string", guidance: "Optional section heading." },
    description: { type: "string", guidance: "Optional supporting text below the heading." },
    tone: {
      type: "string",
      guidance: "Semantic visual emphasis for the section.",
      enum: ["neutral", "accent", "muted"],
      default: "neutral",
    },
    padding: {
      type: "string",
      guidance: "Space inside the section.",
      enum: ["none", "sm", "md", "lg"],
      default: "md",
    },
  },
  content: { mode: "children" },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      titleFontSize: "length",
      titleFontWeight: "fontWeight",
    },
  },
};

export const CARD_SPEC: ComponentSpec = {
  tag: "Card",
  whenToUse:
    "Use Card when one compact, self-contained content group should scan as a bounded unit. Prefer Section for a major region and ItemCard for a collection record.",
  props: {
    title: { type: "string", guidance: "Optional heading for the card." },
    tone: {
      type: "string",
      guidance: "Semantic visual tone for the card.",
      enum: ["neutral", "accent", "success", "warning", "danger"],
      default: "neutral",
    },
    padding: {
      type: "string",
      guidance: "Space between the card edge and its content.",
      enum: ["none", "sm", "md", "lg"],
      default: "md",
    },
  },
  content: { mode: "children" },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      shadow: "shadow",
      padding: "length",
      titleColor: "color",
    },
  },
};

export const MODAL_SPEC: ComponentSpec = {
  tag: "Modal",
  whenToUse:
    "Use Modal when one short, interrupting decision or task must finish without leaving the current context. Avoid it for primary page content or long workflows.",
  props: {
    triggerLabel: {
      type: "string",
      guidance: "Label of the control that opens the modal.",
      required: true,
    },
    title: { type: "string", guidance: "Heading shown in the modal frame.", required: true },
    description: { type: "string", guidance: "Optional context shown below the heading." },
  },
  content: {
    mode: "slots",
    slots: {
      body: { guidance: "Modal content in reading order.", minChildren: 1, maxChildren: 16 },
      actions: { guidance: "Optional modal actions.", minChildren: 0, maxChildren: 4 },
    },
  },
  themeRecipe: {
    tokens: {
      frameText: "color",
    },
  },
};

export const DIVIDER_SPEC: ComponentSpec = {
  tag: "Divider",
  whenToUse:
    "Use Divider when adjacent regions need a visible or labeled break in reading flow. Prefer spacing or Section when the grouping is already clear.",
  props: {
    label: { type: "string", guidance: "Optional short label in the divider." },
    emphasis: {
      type: "string",
      guidance: "How visible the separation should be.",
      enum: ["subtle", "strong"],
      default: "subtle",
    },
  },
  content: { mode: "none" },
  themeRecipe: { tokens: { color: "color", text: "color", gap: "length" } },
};

/** The complete structure group in the locked catalog order. */
export const LAYOUT_SPECS: readonly ComponentSpec[] = Object.freeze([
  SCREEN_SPEC,
  STACK_SPEC,
  ROW_SPEC,
  GRID_SPEC,
  SPLIT_SPEC,
  APP_SHELL_SPEC,
  SECTION_SPEC,
  CARD_SPEC,
  MODAL_SPEC,
  DIVIDER_SPEC,
]);
