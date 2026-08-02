/**
 * The default surface component specs: `Modal`, `Card` and `Empty`.
 *
 * A surface is a bounded region that gives content an edge — a card's border, a
 * modal's frame, the quiet block that stands in for content there isn't any of
 * yet. All three describe **content only**. None of them declares a coordinate,
 * a size in pixels, or any control over what paints in front of what.
 *
 * `Modal` is the one place in Facet where content may overlap the screen, and
 * it earns that by owning none of the mechanism. The framework's Modal frame
 * owns the scrim, the placement, the stacking band, the focus trap, the escape
 * key and the scroll lock; a registered `Modal` supplies flow content and the
 * two strings the frame projects into its own chrome — `triggerLabel` for the
 * control that opens it, `title` for its heading. Both are required, and
 * neither carries a default, because a registration that substituted its own
 * would make the frame's projection depend on the catalog instead of the
 * contract. `validateModalConformance` rejects either drift at registration
 * time, and `specs-surface.test.ts` proves this spec passes it.
 *
 * Every prop is a **scalar** — a string from a closed domain or free text. None
 * is bindable and none is an `array` or `object`, so no prop here can be handed
 * an inline JSON literal: a structured prop is satisfiable only by a
 * `data:path` binding, and the grammar admits no inline structure regardless.
 *
 * These specs are plain serializable data, travelling to the agent as discovery
 * text, to the renderer as a validation table, and to disk with the session.
 *
 * **Visibility: private.** This module is not a package entry point and is not
 * barrel-exported. `catalog.ts` assembles the default catalog from it; nothing
 * outside `@facet/assets` may import it.
 */

import type { ComponentSpec } from "@facet/core";

/**
 * The one sanctioned overlap. The props below are content; the frame is the
 * framework's, and the schema stays exactly what the frame projects.
 */
export const MODAL_SPEC: ComponentSpec = {
  tag: "Modal",
  whenToUse:
    "Interrupt the screen for one focused decision or a short form. Facet owns the frame; this describes only what goes inside it.",
  props: {
    triggerLabel: {
      type: "string",
      guidance:
        "Label of the control that opens the modal. A short verb phrase reads best, such as 'Edit budget'.",
      required: true,
    },
    title: {
      type: "string",
      guidance: "The modal's heading — one line naming the decision the visitor is about to make.",
      required: true,
    },
    description: {
      type: "string",
      guidance:
        "Optional line under the title, for context the visitor needs before deciding. Leave it out when the title is enough.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      triggerBg: "color",
      triggerText: "color",
      frameBg: "color",
      frameText: "color",
      frameBorder: "color",
      frameRadius: "length",
      frameShadow: "shadow",
      framePadding: "length",
      titleColor: "color",
    },
  },
};

/** A bounded surface that groups related content and separates it from the rest. */
export const CARD_SPEC: ComponentSpec = {
  tag: "Card",
  whenToUse:
    "Group related content into one bounded surface with its own edge and padding — a summary, a record, a settings block.",
  props: {
    title: {
      type: "string",
      guidance: "Optional heading for the card. Omit it when the content already names itself.",
    },
    tone: {
      type: "string",
      guidance:
        "The card's semantic tone, drawn from the theme's colors. Reserve 'danger' and 'warning' for content that genuinely needs them.",
      enum: ["neutral", "accent", "success", "warning", "danger"],
      default: "neutral",
    },
    padding: {
      type: "string",
      guidance: "Space between the card's edge and its content, named in theme space tokens.",
      enum: ["none", "sm", "md", "lg"],
      default: "md",
    },
  },
  acceptsChildren: true,
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

/**
 * The stand-in for content that isn't there. It takes children so a next step —
 * a button, a line of guidance — can sit inside it rather than being smuggled
 * in as another prop.
 */
export const EMPTY_SPEC: ComponentSpec = {
  tag: "Empty",
  whenToUse:
    "Stand in for a view with nothing in it yet — a search that matched nothing, a fresh account, a list before its first row.",
  props: {
    title: {
      type: "string",
      guidance:
        "One line naming what is missing, such as 'No invoices yet'. Say what is absent, not that an error occurred.",
      required: true,
    },
    description: {
      type: "string",
      guidance: "Optional second line telling the visitor what would put content here.",
    },
  },
  acceptsChildren: true,
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

/** The surface group, in the order the default catalog lists it. */
export const SURFACE_SPECS: readonly ComponentSpec[] = [MODAL_SPEC, CARD_SPEC, EMPTY_SPEC];
