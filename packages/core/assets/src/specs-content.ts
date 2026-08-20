/** Default content, media, and data-display component contracts. */
import type { ComponentSpec } from "@facet/core";

export const TEXT_SPEC: ComponentSpec = {
  tag: "Text",
  whenToUse:
    "Use Text for standalone visitor-facing titles, headings, paragraphs, or captions. Prefer a component's title or description prop when the copy names that component.",
  props: {
    value: {
      type: "string",
      required: true,
      bindable: true,
      guidance: "The copy to show, written directly or bound from published data.",
    },
    variant: {
      type: "string",
      enum: ["title", "heading", "body", "caption"],
      default: "body",
      guidance: "The semantic typographic role of the copy.",
    },
    tone: {
      type: "string",
      enum: ["default", "muted"],
      default: "default",
      guidance: "Whether the copy uses ordinary or quieter emphasis.",
    },
  },
  content: { mode: "none" },
  themeRecipe: {
    tokens: {
      titleFontSize: "length",
      titleFontWeight: "fontWeight",
      headingFontSize: "length",
      headingFontWeight: "fontWeight",
      bodyFontSize: "length",
      captionFontSize: "length",
      defaultText: "color",
      mutedText: "color",
    },
  },
};

export const AVATAR_SPEC: ComponentSpec = {
  tag: "Avatar",
  whenToUse:
    "Use Avatar for compact identity of a person, team, or brand when initials are sufficient. Prefer Image when the actual visual asset matters.",
  props: {
    label: { type: "string", required: true, guidance: "Accessible identity name." },
    initials: {
      type: "string",
      guidance: "One to three initials; omit to derive them from the label.",
    },
    size: {
      type: "string",
      enum: ["sm", "md", "lg"],
      default: "md",
      guidance: "The avatar size within the surrounding flow.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "warm", "cool"],
      default: "accent",
      guidance: "The bounded color treatment for the identity mark.",
    },
  },
  content: { mode: "none" },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      size: "length",
      fontSize: "length",
      fontWeight: "fontWeight",
    },
  },
};

export const ICON_SPEC: ComponentSpec = {
  tag: "Icon",
  whenToUse:
    "Use Icon as a familiar supplemental cue for an action, status, or concept. Do not use it as the only meaning when a clear text label is needed.",
  props: {
    name: { type: "string", required: true, guidance: "A trusted icon name from the default set." },
    label: { type: "string", guidance: "Accessible meaning when the icon is not decorative." },
    size: {
      type: "string",
      enum: ["sm", "md", "lg"],
      default: "md",
      guidance: "The icon size within the surrounding flow.",
    },
    tone: {
      type: "string",
      enum: ["default", "muted", "accent"],
      default: "default",
      guidance: "The icon's ordinary, quiet, or accent emphasis.",
    },
  },
  content: { mode: "none" },
  themeRecipe: { tokens: { defaultText: "color", mutedText: "color", accentText: "color" } },
};

export const IMAGE_SPEC: ComponentSpec = {
  tag: "Image",
  whenToUse:
    "Use Image when a host-approved visual helps the visitor identify, inspect, or compare something. Avoid decorative imagery that does not support the current task.",
  props: {
    asset: {
      type: "string",
      required: true,
      assetKind: "image",
      guidance:
        "An asset:key reference to a host-pinned image; URLs and data bindings are invalid.",
    },
    alt: { type: "string", required: true, guidance: "Concise alternative text for the image." },
    aspect: {
      type: "string",
      enum: ["auto", "square", "portrait", "landscape", "wide"],
      default: "auto",
      guidance: "The bounded frame ratio used around the image.",
    },
    fit: {
      type: "string",
      enum: ["cover", "contain"],
      default: "cover",
      guidance: "Whether the image fills the frame or remains fully visible.",
    },
  },
  content: { mode: "none" },
  themeRecipe: { tokens: { background: "color", border: "color", radius: "length" } },
};

export const BADGE_SPEC: ComponentSpec = {
  tag: "Badge",
  whenToUse:
    "Use Badge for a short status or category attached to a specific object. Prefer Alert for an important message and Text for explanatory copy.",
  props: {
    label: {
      type: "string",
      required: true,
      bindable: true,
      guidance: "The short status label, written directly or bound from published data.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "positive", "warning", "danger"],
      default: "neutral",
      guidance: "The semantic meaning of the status.",
    },
  },
  content: { mode: "none" },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      paddingInline: "length",
      paddingBlock: "length",
    },
  },
};

export const METRIC_SPEC: ComponentSpec = {
  tag: "Metric",
  whenToUse:
    "Use Metric for one decision-relevant number with a concise label. Prefer Property for an ordinary fact and Progress for bounded completion.",
  props: {
    label: { type: "string", required: true, guidance: "What the number measures." },
    value: {
      type: "number",
      required: true,
      bindable: true,
      guidance: "The finite numeric value, commonly bound from published data.",
    },
    unit: { type: "string", guidance: "A short unit or currency shown with the number." },
  },
  content: { mode: "none" },
  themeRecipe: {
    tokens: {
      valueColor: "color",
      valueFontSize: "length",
      valueFontWeight: "fontWeight",
      labelColor: "color",
      labelFontSize: "length",
    },
  },
};

export const METRIC_GROUP_SPEC: ComponentSpec = {
  tag: "MetricGroup",
  whenToUse:
    "Use MetricGroup when several related metrics must be scanned or compared as one summary. Prefer a single Metric when only one number matters.",
  props: {
    title: { type: "string", guidance: "Optional heading for the metric set." },
    columns: {
      type: "number",
      minimum: 1,
      maximum: 4,
      default: 3,
      guidance: "Maximum metric columns on a wide viewport.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent"],
      default: "neutral",
      guidance: "Ordinary or accent emphasis for the group.",
    },
  },
  content: { mode: "children" },
  themeRecipe: {
    tokens: { background: "color", border: "color", radius: "length", gap: "length" },
  },
};

export const TABLE_SPEC: ComponentSpec = {
  tag: "Table",
  whenToUse:
    "Use Table when visitors must scan or compare many records across consistent columns. Prefer Collection for visual browsing and PropertyList for one record.",
  props: {
    rows: {
      type: "array",
      required: true,
      bindable: true,
      guidance: "Open records bound from published data; unusable rows are ignored safely.",
    },
    caption: { type: "string", guidance: "Optional accessible caption naming the records." },
  },
  content: { mode: "none" },
  themeRecipe: {
    tokens: {
      background: "color",
      border: "color",
      radius: "length",
      captionText: "color",
      text: "color",
      headerText: "color",
      headerBg: "color",
      rowBorder: "color",
      cellPadding: "length",
    },
  },
};

export const CHART_SPEC: ComponentSpec = {
  tag: "Chart",
  whenToUse:
    "Use Chart when a numeric trend, distribution, or comparison is clearer visually than as rows. Prefer Metric or Table when exact values matter more.",
  props: {
    data: {
      type: "array",
      required: true,
      bindable: true,
      guidance: "Open records bound from published data; unusable rows are ignored safely.",
    },
    xKey: {
      type: "string",
      required: true,
      guidance: "Record key used for category or time labels.",
    },
    yKey: {
      type: "string",
      required: true,
      guidance: "Record key used for finite numeric values.",
    },
    type: {
      type: "string",
      enum: ["bar", "line", "area"],
      default: "bar",
      guidance: "The trusted chart treatment for the same record set.",
    },
    title: { type: "string", guidance: "Optional accessible title for the chart." },
  },
  content: { mode: "none" },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      grid: "color",
      series: "color",
      fill: "color",
      radius: "length",
    },
  },
};

export const PROGRESS_SPEC: ComponentSpec = {
  tag: "Progress",
  whenToUse:
    "Use Progress when one task or process has meaningful bounded completion from zero to one hundred. Prefer Badge for status and Timeline for ordered stages.",
  props: {
    label: { type: "string", required: true, guidance: "What is progressing." },
    value: {
      type: "number",
      required: true,
      bindable: true,
      minimum: 0,
      maximum: 100,
      guidance: "Completion as a number from zero through one hundred.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "success", "warning"],
      default: "accent",
      guidance: "Progress meaning or emphasis.",
    },
  },
  content: { mode: "none" },
  themeRecipe: {
    tokens: {
      labelText: "color",
      valueText: "color",
      track: "color",
      fill: "color",
      radius: "length",
      height: "length",
    },
  },
};

export const TIMELINE_SPEC: ComponentSpec = {
  tag: "Timeline",
  whenToUse:
    "Use Timeline when the order of milestones or dated events explains progress or history. Prefer Calendar when date placement and selection matter.",
  props: {
    title: { type: "string", guidance: "Optional heading for the sequence." },
    tone: {
      type: "string",
      enum: ["neutral", "accent"],
      default: "neutral",
      guidance: "Quiet or accent emphasis for the sequence.",
    },
  },
  content: { mode: "children" },
  themeRecipe: {
    tokens: {
      text: "color",
      mutedText: "color",
      line: "color",
      markerBg: "color",
      markerText: "color",
      gap: "length",
      titleColor: "color",
    },
  },
};

export const LIST_SPEC: ComponentSpec = {
  tag: "List",
  whenToUse:
    "Use List for a simple ordered or unordered sequence read in one flow. Prefer Collection when items need rich summaries, controls, or item actions.",
  props: {
    title: { type: "string", guidance: "Optional heading for the list." },
    marker: {
      type: "string",
      enum: ["bullet", "number", "none"],
      default: "bullet",
      guidance: "Bullet, numeric, or unmarked item treatment.",
    },
    density: {
      type: "string",
      enum: ["compact", "comfortable"],
      default: "comfortable",
      guidance: "How tightly neighboring items are spaced.",
    },
  },
  content: { mode: "children" },
  themeRecipe: {
    tokens: { text: "color", markerText: "color", titleColor: "color", gap: "length" },
  },
};

export const CONTENT_SPECS: readonly ComponentSpec[] = Object.freeze([
  TEXT_SPEC,
  AVATAR_SPEC,
  ICON_SPEC,
  IMAGE_SPEC,
  BADGE_SPEC,
  METRIC_SPEC,
  METRIC_GROUP_SPEC,
  TABLE_SPEC,
  CHART_SPEC,
  PROGRESS_SPEC,
  TIMELINE_SPEC,
  LIST_SPEC,
]);
