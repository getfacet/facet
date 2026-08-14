/**
 * The default interactive components: `Button` and `Field`.
 *
 * Two declarations here carry weight beyond their own tags.
 *
 * **`Button.action` is a string.** An authored `nav:` or `agent:` reference may
 * only sit on a prop declared `string`, so a narrower type would make the one
 * control that does anything unable to say what it does. It declares no `enum`
 * either: the domain is the closed scheme vocabulary — `nav:<screen>` and
 * `agent:<event>` — whose targets are open, and browser-local action routing is refused by the
 * grammar itself rather than by a value list here. It is not bindable, because
 * what a control does is authored; letting published data choose it would make
 * the action surface depend on a data publish.
 *
 * **`Field` declares the collect contract (D-08).** `collect` names `value` as
 * the prop Facet injects and `secret` as the flag that withholds it. Naming them
 * here is what makes collectable identity catalog-owned: the renderer reads the
 * spec, not a DOM stamp, so a component cannot opt itself in, opt itself out, or
 * quietly yield nothing. `value` declares a `default` of `""` — that default is
 * exactly what a collectable node that never registered yields, so the fallback
 * is a stated value rather than an inferred blank. `secret` is a boolean because
 * the collect contract requires the sensitive prop to be one.
 *
 * The module is **private**: it is not barrel-exported and is not a package
 * entry point. `catalog.ts` composes it into the one public default catalog.
 */

import type { ComponentSpec } from "@facet/core";

export const BUTTON_SPEC: ComponentSpec = {
  tag: "Button",
  whenToUse:
    "Give the visitor one control that moves to another screen or sends an event to the agent.",
  authoring: {
    role: "action",
    interactionTypes: ["submit", "navigate", "trigger_agent"],
  },
  props: {
    label: {
      type: "string",
      required: true,
      guidance: "The words on the control, naming what activating it does.",
    },
    action: {
      type: "string",
      required: true,
      guidance:
        "What activating it does: `nav:<screen>` to move to a screen this document declares, or `agent:<event>` to send a named event. There is no other action.",
    },
    arg: {
      type: "string",
      guidance:
        "One explicit argument sent with an `agent:` event, when the event needs a value the visitor did not type.",
    },
    collect: {
      type: "string",
      guidance:
        "The `Field` names whose values this `agent:` event carries, separated by spaces. A field this never names is never sent.",
    },
    tone: {
      type: "string",
      enum: ["primary", "secondary", "quiet"],
      default: "secondary",
      guidance:
        "How prominent the control is: the screen's primary action, an ordinary one, or a quiet one.",
    },
  },
  acceptsChildren: false,
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

export const FIELD_SPEC: ComponentSpec = {
  tag: "Field",
  whenToUse: "Ask the visitor for one value that a `Button` can name in its `collect` list.",
  authoring: {
    role: "action",
    interactionTypes: ["enter_value", "provide_input"],
  },
  props: {
    name: {
      type: "string",
      required: true,
      guidance:
        "The name a `Button` writes in `collect` to send this value. Unique within the screen.",
    },
    label: {
      type: "string",
      required: true,
      guidance: "What the visitor is being asked for, shown beside the input.",
    },
    value: {
      type: "string",
      default: "",
      guidance:
        "The value shown. Facet owns it once the visitor types; write it only to seed a starting value, and read it back through `collect`, never from the page.",
    },
    placeholder: {
      type: "string",
      guidance: "A short hint shown while the field is still empty.",
    },
    secret: {
      type: "boolean",
      default: false,
      guidance:
        "`true` masks the value and keeps it out of every event payload — it is reported as withheld rather than sent.",
    },
  },
  acceptsChildren: false,
  collect: {
    collectable: true,
    valueProp: "value",
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
    },
  },
};

/**
 * The interactive group, in the order the default catalog registers it. Frozen
 * so a host reading the assembled catalog cannot lengthen the group; the specs
 * themselves are frozen by `validateCatalog` at the trust boundary.
 */
export const INTERACTIVE_SPECS: readonly ComponentSpec[] = Object.freeze([BUTTON_SPEC, FIELD_SPEC]);
