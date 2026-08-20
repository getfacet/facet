/** Default task-surface component contracts. */
import type { ComponentSpec } from "@facet/core";

function slot(
  guidance: string,
  minChildren: number,
  maxChildren: number,
): {
  readonly guidance: string;
  readonly minChildren: number;
  readonly maxChildren: number;
} {
  return { guidance, minChildren, maxChildren };
}

export const HEADER_SPEC: ComponentSpec = {
  tag: "Header",
  whenToUse:
    "Use Header to establish the identity and priority of a page, record, profile, or major task with optional status and actions. Avoid it for ordinary subsections.",
  props: {
    title: { type: "string", required: true, guidance: "The primary heading." },
    description: { type: "string", guidance: "Optional supporting copy below the heading." },
    eyebrow: { type: "string", guidance: "Optional short context above the heading." },
    align: {
      type: "string",
      enum: ["start", "center"],
      default: "start",
      guidance: "Whether the header starts at the edge or centers its content.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
      guidance: "The bounded visual emphasis for the header.",
    },
  },
  content: {
    mode: "slots",
    slots: {
      leading: slot("Optional identity or icon before the heading.", 0, 1),
      meta: slot("Compact status, property, or metric context.", 0, 6),
      actions: slot("Primary and secondary actions for the header.", 0, 4),
      media: slot("Optional visual associated with the header.", 0, 1),
    },
  },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      padding: "length",
      gap: "length",
      titleFontSize: "length",
      titleFontWeight: "fontWeight",
    },
  },
};

export const COLLECTION_SPEC: ComponentSpec = {
  tag: "Collection",
  whenToUse:
    "Use Collection when visitors must browse, filter, or act on multiple peer records or resources. Prefer List for simple sequences and Detail for one item.",
  props: {
    title: { type: "string", guidance: "Optional heading for the collection." },
    description: { type: "string", guidance: "Optional context for the collection." },
    layout: {
      type: "string",
      enum: ["grid", "list"],
      default: "grid",
      guidance: "Grid for visual comparison or list for denser scanning.",
    },
    columns: {
      type: "number",
      minimum: 1,
      maximum: 4,
      default: 3,
      guidance: "Maximum item columns on a wide viewport when using grid layout.",
    },
  },
  content: {
    mode: "slots",
    slots: {
      controls: slot("Filters, search, or sorting controls for the collection.", 0, 8),
      items: slot("The records or resources in the collection.", 1, 24),
      actions: slot("Actions that apply to the collection as a whole.", 0, 4),
    },
  },
  themeRecipe: {
    tokens: {
      text: "color",
      mutedText: "color",
      titleColor: "color",
      gap: "length",
      itemGap: "length",
    },
  },
};

export const ITEM_CARD_SPEC: ComponentSpec = {
  tag: "ItemCard",
  whenToUse:
    "Use ItemCard to summarize one peer item in a browsable collection with optional facts and actions. Prefer Detail when one item is the primary focus.",
  props: {
    title: { type: "string", required: true, guidance: "The item's primary name." },
    description: { type: "string", guidance: "Optional short item summary." },
    eyebrow: { type: "string", guidance: "Optional category or context above the title." },
    meta: { type: "string", guidance: "Optional compact metadata below the summary." },
    tone: {
      type: "string",
      enum: ["neutral", "accent"],
      default: "neutral",
      guidance: "Ordinary or accent emphasis for the item.",
    },
  },
  content: {
    mode: "slots",
    slots: {
      media: slot("Optional visual for the item.", 0, 1),
      content: slot("Supporting properties, metrics, or status.", 0, 8),
      actions: slot("Actions scoped to this item.", 0, 3),
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
      titleColor: "color",
    },
  },
};

export const DETAIL_SPEC: ComponentSpec = {
  tag: "Detail",
  whenToUse:
    "Use Detail when the visitor must inspect one record, product, service, or resource in depth and may act on it. Prefer ItemCard when browsing many peers.",
  props: {
    title: { type: "string", required: true, guidance: "The detail view's primary heading." },
    description: { type: "string", guidance: "Optional overview below the heading." },
    eyebrow: { type: "string", guidance: "Optional category or context above the title." },
    meta: { type: "string", guidance: "Optional compact metadata for the record." },
    tone: {
      type: "string",
      enum: ["neutral", "accent"],
      default: "neutral",
      guidance: "Ordinary or accent emphasis for the detail view.",
    },
  },
  content: {
    mode: "slots",
    slots: {
      media: slot("Optional visual for the record.", 0, 1),
      summary: slot("High-priority status, metrics, or short context.", 0, 8),
      details: slot("The record's full properties and supporting content.", 0, 16),
      actions: slot("Actions scoped to this record.", 0, 4),
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
      titleColor: "color",
    },
  },
};

export const PROPERTY_LIST_SPEC: ComponentSpec = {
  tag: "PropertyList",
  whenToUse:
    "Use PropertyList when one record's label-value facts must be scanned together. Prefer Table for many records and Detail for richer content or actions.",
  props: {
    title: { type: "string", guidance: "Optional heading for the property set." },
    columns: {
      type: "number",
      minimum: 1,
      maximum: 3,
      default: 1,
      guidance: "Maximum property columns on a wide viewport.",
    },
  },
  content: {
    mode: "slots",
    slots: { items: slot("The label-value properties in the set.", 1, 32) },
  },
  themeRecipe: {
    tokens: { text: "color", mutedText: "color", border: "color", gap: "length" },
  },
};

export const PROPERTY_SPEC: ComponentSpec = {
  tag: "Property",
  whenToUse:
    "Use Property for one labeled text value inside PropertyList. Prefer Metric for a headline number and Badge for a short status.",
  props: {
    label: { type: "string", required: true, guidance: "The name of the property." },
    value: {
      type: "string",
      required: true,
      bindable: true,
      guidance: "The displayed value, written directly or bound from published data.",
    },
    tone: {
      type: "string",
      enum: ["default", "muted"],
      default: "default",
      guidance: "Ordinary or quieter emphasis for the value.",
    },
  },
  content: { mode: "none" },
  themeRecipe: { tokens: { labelText: "color", valueText: "color", gap: "length" } },
};

export const BOARD_SPEC: ComponentSpec = {
  tag: "Board",
  whenToUse:
    "Use Board when work or records must be understood across a small set of named states or categories. Prefer Collection when column membership is not meaningful.",
  props: { title: { type: "string", guidance: "Optional heading for the board." } },
  content: {
    mode: "slots",
    slots: { columns: slot("The board's ordered workflow columns.", 1, 8) },
  },
  themeRecipe: { tokens: { text: "color", titleColor: "color", gap: "length" } },
};

export const BOARD_COLUMN_SPEC: ComponentSpec = {
  tag: "BoardColumn",
  whenToUse:
    "Use BoardColumn for one state or category inside Board and order its related items for scanning. Do not use it outside a board-style workflow.",
  props: {
    title: { type: "string", required: true, guidance: "The workflow state or category name." },
    description: { type: "string", guidance: "Optional short explanation of the column." },
    tone: {
      type: "string",
      enum: ["neutral", "accent"],
      default: "neutral",
      guidance: "Ordinary or accent emphasis for the column.",
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
      gap: "length",
    },
  },
};

export const CALENDAR_SPEC: ComponentSpec = {
  tag: "Calendar",
  whenToUse:
    "Use Calendar when visitors must scan or select one dated event from a compact grid or agenda list. Prefer Timeline for sequence or a custom component for date navigation.",
  props: {
    name: {
      type: "string",
      required: true,
      guidance: "The unique name a Button writes in its collect list.",
    },
    title: { type: "string", guidance: "Optional heading for the calendar." },
    events: {
      type: "array",
      required: true,
      bindable: true,
      shape: {
        fields: {
          id: { type: "string", required: true, guidance: "Stable event identifier." },
          title: { type: "string", required: true, guidance: "Visible event title." },
          start: { type: "string", required: true, guidance: "Event start date or date-time." },
          end: { type: "string", guidance: "Optional event end date or date-time." },
          tone: { type: "string", guidance: "Optional bounded presentation tone." },
        },
      },
      guidance: "Published events with the closed calendar event fields.",
    },
    view: {
      type: "string",
      enum: ["month", "agenda"],
      default: "month",
      guidance: "Compact event grid or single-column list; source order is preserved.",
    },
    value: {
      type: "string",
      default: "",
      guidance: "The initially selected event id; use an id present in events.",
    },
  },
  content: { mode: "none" },
  collect: { collectable: true, valueProp: "value", valueKind: "string" },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      accent: "color",
      radius: "length",
      gap: "length",
    },
  },
};

export const RESULT_SPEC: ComponentSpec = {
  tag: "Result",
  whenToUse:
    "Use Result when a search, operation, or task produced an outcome the visitor must understand and may act on. Prefer Alert for an active condition.",
  props: {
    title: { type: "string", required: true, guidance: "One line naming the outcome." },
    description: { type: "string", guidance: "Optional explanation or next-step context." },
    tone: {
      type: "string",
      enum: ["neutral", "success", "warning", "danger"],
      default: "neutral",
      guidance: "The semantic meaning of the outcome.",
    },
  },
  content: {
    mode: "slots",
    slots: {
      summary: slot("High-priority status, metrics, or short context.", 0, 8),
      details: slot("Supporting result details.", 0, 16),
      actions: slot("Available next steps for this result.", 0, 4),
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
      titleColor: "color",
    },
  },
};

export const EMPTY_SPEC: ComponentSpec = {
  tag: "Empty",
  whenToUse:
    "Use Empty when a view or collection legitimately has no content and the visitor needs context or a next step. Do not use it for loading or error states.",
  props: {
    title: { type: "string", required: true, guidance: "One line naming what is absent." },
    description: { type: "string", guidance: "Optional context explaining what can happen next." },
  },
  content: {
    mode: "slots",
    slots: {
      body: slot("Optional guidance or supporting content.", 0, 4),
      actions: slot("Actions that help the visitor continue.", 0, 2),
    },
  },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      padding: "length",
      titleColor: "color",
    },
  },
};

export const ALERT_SPEC: ComponentSpec = {
  tag: "Alert",
  whenToUse:
    "Use Alert when one active informational, success, warning, or danger condition needs immediate awareness or response. Prefer Result for a completed outcome.",
  props: {
    title: { type: "string", required: true, guidance: "One line naming the message." },
    description: { type: "string", guidance: "Optional supporting detail or next steps." },
    tone: {
      type: "string",
      enum: ["info", "success", "warning", "danger"],
      default: "info",
      guidance: "The semantic meaning of the message.",
    },
  },
  content: {
    mode: "slots",
    slots: {
      body: slot("Optional supporting message content.", 0, 4),
      actions: slot("Actions available in response to the message.", 0, 2),
    },
  },
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      padding: "length",
      titleColor: "color",
    },
  },
};

export const EXPRESSION_SPECS: readonly ComponentSpec[] = Object.freeze([
  HEADER_SPEC,
  COLLECTION_SPEC,
  ITEM_CARD_SPEC,
  DETAIL_SPEC,
  PROPERTY_LIST_SPEC,
  PROPERTY_SPEC,
  BOARD_SPEC,
  BOARD_COLUMN_SPEC,
  CALENDAR_SPEC,
  RESULT_SPEC,
  EMPTY_SPEC,
  ALERT_SPEC,
]);
