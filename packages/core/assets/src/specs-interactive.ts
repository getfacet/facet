/**
 * Default input, communication, and disclosure component specifications.
 *
 * Collection is catalog-owned. Each control declares its address, injected
 * value prop, and exact collected-value kind; components cannot opt themselves
 * into collection at render time. Structured data remains binding-only and the
 * two fixed shapes below are the complete option and message contracts.
 *
 * This module is private. `catalog.ts` is the only default-catalog assembler.
 */

import type { ComponentSpec } from "@facet/core";

const OPTION_SHAPE = {
  fields: {
    label: {
      type: "string",
      required: true,
      guidance: "The visitor-facing option label.",
    },
    value: {
      type: "string",
      required: true,
      guidance: "The stable value collected when the option is chosen.",
    },
    disabled: {
      type: "boolean",
      guidance: "Whether the option is unavailable.",
    },
  },
} as const;

const MESSAGE_SHAPE = {
  fields: {
    id: {
      type: "string",
      required: true,
      guidance: "The stable message identifier.",
    },
    author: {
      type: "string",
      required: true,
      guidance: "The name of the message author.",
    },
    body: {
      type: "string",
      required: true,
      guidance: "The message text.",
    },
    timestamp: {
      type: "string",
      guidance: "A display-ready timestamp.",
    },
    side: {
      type: "string",
      guidance: "Which side of the thread presents the message.",
    },
    status: {
      type: "string",
      guidance: "A display-ready delivery status.",
    },
  },
} as const;

export const FORM_SPEC: ComponentSpec = {
  tag: "Form",
  whenToUse:
    "Use Form when multiple collectable controls belong to one submission or decision. Prefer a standalone control when one value can be acted on independently.",
  props: {
    layout: {
      type: "string",
      enum: ["stacked", "inline"],
      default: "stacked",
      guidance: "Whether fields stack vertically or flow inline when space permits.",
    },
  },
  content: {
    mode: "slots",
    slots: {
      fields: {
        guidance: "The controls whose values this form collects.",
        minChildren: 1,
        maxChildren: 20,
      },
      actions: {
        guidance: "The controls that submit or otherwise act on the form.",
        minChildren: 1,
        maxChildren: 4,
      },
    },
  },
  themeRecipe: {
    tokens: {
      gap: "length",
      inlineGap: "length",
    },
  },
};

export const FIELD_SPEC: ComponentSpec = {
  tag: "Field",
  whenToUse:
    "Use Field when the visitor must enter one short non-sensitive text value. Prefer Select or ChoiceGroup when the valid options are already known.",
  props: {
    name: {
      type: "string",
      required: true,
      guidance: "The unique name a Button writes in its collect list.",
    },
    label: {
      type: "string",
      required: true,
      guidance: "What the visitor is being asked for.",
    },
    value: {
      type: "string",
      default: "",
      guidance: "The initial value before the visitor edits the field.",
    },
    placeholder: {
      type: "string",
      guidance: "A short hint shown while the field is empty.",
    },
    secret: {
      type: "boolean",
      default: false,
      guidance: "Whether the value is masked and withheld from event payloads.",
    },
  },
  content: { mode: "none" },
  collect: {
    collectable: true,
    valueProp: "value",
    valueKind: "string",
    sensitiveProp: "secret",
  },
  themeRecipe: {
    tokens: {
      labelText: "color",
      inputBg: "color",
      inputText: "color",
      inputBorder: "color",
      inputFocusBorder: "color",
      inputRadius: "length",
      inputPadding: "length",
      focusRing: "shadow",
    },
  },
};

export const SELECT_SPEC: ComponentSpec = {
  tag: "Select",
  whenToUse:
    "Use Select when the visitor must choose one value from a data-backed list, especially when options are numerous. Prefer ChoiceGroup for a short visible set.",
  props: {
    name: {
      type: "string",
      required: true,
      guidance: "The unique name a Button writes in its collect list.",
    },
    label: {
      type: "string",
      required: true,
      guidance: "What the visitor is choosing.",
    },
    options: {
      type: "array",
      required: true,
      bindable: true,
      shape: OPTION_SHAPE,
      guidance: "Options published through the data model.",
    },
    value: {
      type: "string",
      default: "",
      guidance: "The initially selected option value.",
    },
    placeholder: {
      type: "string",
      guidance: "A short prompt shown until an option is selected.",
    },
  },
  content: { mode: "none" },
  collect: { collectable: true, valueProp: "value", valueKind: "string" },
  themeRecipe: {
    tokens: {
      labelText: "color",
      inputBg: "color",
      inputText: "color",
      inputBorder: "color",
      inputFocusBorder: "color",
      inputRadius: "length",
      inputPadding: "length",
      focusRing: "shadow",
    },
  },
};

export const CHOICE_GROUP_SPEC: ComponentSpec = {
  tag: "ChoiceGroup",
  whenToUse:
    "Use ChoiceGroup when a short set of data-backed choices should stay visible and one or more may be selected. Prefer Select for a longer single-choice list.",
  props: {
    name: {
      type: "string",
      required: true,
      guidance: "The unique name a Button writes in its collect list.",
    },
    label: {
      type: "string",
      required: true,
      guidance: "What the visitor is choosing.",
    },
    options: {
      type: "array",
      required: true,
      bindable: true,
      shape: OPTION_SHAPE,
      guidance: "Choices published through the data model.",
    },
    value: {
      type: "array",
      bindable: true,
      guidance: "The currently selected option values.",
    },
    layout: {
      type: "string",
      enum: ["stacked", "inline"],
      default: "stacked",
      guidance: "Whether choices stack vertically or flow inline when space permits.",
    },
  },
  content: { mode: "none" },
  collect: { collectable: true, valueProp: "value", valueKind: "string[]" },
  themeRecipe: {
    tokens: {
      labelText: "color",
      optionText: "color",
      optionBorder: "color",
      selectedBg: "color",
      selectedBorder: "color",
      radius: "length",
      gap: "length",
      focusRing: "shadow",
    },
  },
};

export const TOGGLE_SPEC: ComponentSpec = {
  tag: "Toggle",
  whenToUse:
    "Use Toggle when one boolean setting should change directly between on and off. Prefer ChoiceGroup when choosing among named alternatives.",
  props: {
    name: {
      type: "string",
      required: true,
      guidance: "The unique name a Button writes in its collect list.",
    },
    label: {
      type: "string",
      required: true,
      guidance: "The setting the visitor can turn on or off.",
    },
    value: {
      type: "boolean",
      default: false,
      guidance: "Whether the setting starts on.",
    },
  },
  content: { mode: "none" },
  collect: { collectable: true, valueProp: "value", valueKind: "boolean" },
  themeRecipe: {
    tokens: {
      labelText: "color",
      trackOff: "color",
      trackOn: "color",
      thumb: "color",
      focusRing: "shadow",
    },
  },
};

export const MESSAGE_THREAD_SPEC: ComponentSpec = {
  tag: "MessageThread",
  whenToUse:
    "Use MessageThread when a bounded chronological exchange is itself the information to inspect. Prefer List or Timeline for non-conversational events.",
  props: {
    messages: {
      type: "array",
      required: true,
      bindable: true,
      shape: MESSAGE_SHAPE,
      guidance: "Messages published through the data model in display order.",
    },
  },
  content: { mode: "none" },
  themeRecipe: {
    tokens: {
      incomingBg: "color",
      incomingText: "color",
      outgoingBg: "color",
      outgoingText: "color",
      mutedText: "color",
      radius: "length",
      gap: "length",
    },
  },
};

export const ACCORDION_SPEC: ComponentSpec = {
  tag: "Accordion",
  whenToUse:
    "Use Accordion when several related details are optional and should be revealed on demand. Avoid hiding information required for the visitor's next decision.",
  props: {
    multiple: {
      type: "boolean",
      default: false,
      guidance: "Whether more than one item may be expanded at a time.",
    },
  },
  content: {
    mode: "slots",
    slots: {
      items: {
        guidance: "The disclosure items in display order.",
        minChildren: 1,
        maxChildren: 12,
      },
    },
  },
  themeRecipe: {
    tokens: {
      border: "color",
      radius: "length",
      divider: "color",
    },
  },
};

export const ACCORDION_ITEM_SPEC: ComponentSpec = {
  tag: "AccordionItem",
  whenToUse:
    "Use AccordionItem for one titled disclosure inside Accordion with optional actions tied to its content. Do not use it as a standalone card.",
  props: {
    title: {
      type: "string",
      required: true,
      guidance: "The label on the disclosure control.",
    },
    defaultOpen: {
      type: "boolean",
      default: false,
      guidance: "Whether the item starts expanded.",
    },
  },
  content: {
    mode: "slots",
    slots: {
      body: {
        guidance: "The content revealed when the item is expanded.",
        minChildren: 1,
        maxChildren: 8,
      },
      actions: {
        guidance: "Optional actions associated with the item.",
        minChildren: 0,
        maxChildren: 2,
      },
    },
  },
  themeRecipe: {
    tokens: {
      summaryText: "color",
      bodyText: "color",
      focusRing: "shadow",
      gap: "length",
    },
  },
};

export const INTERACTIVE_SPECS: readonly ComponentSpec[] = Object.freeze([
  FORM_SPEC,
  FIELD_SPEC,
  SELECT_SPEC,
  CHOICE_GROUP_SPEC,
  TOGGLE_SPEC,
  MESSAGE_THREAD_SPEC,
  ACCORDION_SPEC,
  ACCORDION_ITEM_SPEC,
]);
