/**
 * The default layout component specs: `Screen`, `AppShell`, `Stack`, `Row`,
 * `Split` and `Grid`.
 *
 * These six are the whole of Facet's default layout vocabulary. Everything an
 * agent can say about arrangement it says here, through named scalar props over
 * the theme's space tokens — a gap, an alignment, a column count, or a closed
 * layout ratio. There is no coordinate, no stacking control and no escape
 * hatch, because layout stays **flow-contained**: children occupy the space
 * their parent gives them, in the order they were authored. Overlap exists only
 * through the framework's dedicated Modal frame, which is not authored geometry
 * at all.
 *
 * Every prop is a **scalar** — a string from a closed domain, a bounded number,
 * or a boolean. None is bindable, and none is an `array` or `object`. That is
 * what makes "no prop accepts inline object or array JSON" structural rather
 * than aspirational: a structured prop is satisfiable only by a `data:path`
 * binding, and a prop that is not structured has nowhere to put a JSON literal
 * even if the grammar admitted one, which it does not.
 *
 * These specs are plain serializable data. They travel to the agent as
 * discovery text, to the renderer as a validation table, and to disk as part of
 * a session, so nothing here may be a function, a symbol or a live reference.
 *
 * **Visibility: private.** This module is not a package entry point and is not
 * barrel-exported. `catalog.ts` assembles the default catalog from it; nothing
 * outside `@facet/assets` may import it.
 */

import type { ComponentSpec } from "@facet/core";

/**
 * The root of one named screen — a **registered catalog member**, and a
 * grammar position at the same time.
 *
 * `validateCatalog` reserves `Facet` alone and requires **exactly one** `Screen`
 * spec in every valid catalog, so this one is not an exception to registration
 * but the member that makes a catalog complete. It has to be: a document stores
 * its screen roots as ordinary component nodes, the renderer mounts them like
 * anything else, and bootstrap demands exact catalog/registry equality, so a
 * `Screen` no host could register would leave the root unmountable.
 *
 * Registering it reopens no nesting hole. **Placement stays owned by document
 * validation**, which refuses a `Screen` anywhere but as a direct child of the
 * envelope *before* the catalog is consulted at all — so no registration, and
 * nothing declared below, can make a nested `<Screen>` legal. What registration
 * buys is the other direction: a screen root that *is* in its position is then
 * checked against this spec like every mounted component, so `name` is required,
 * the presentation props below are checked against their domains, and a prop
 * this spec never declares is refused.
 *
 * `name` is the screen's identity — what `nav:` targets and what the entry
 * screen is chosen by — so it carries no default, no enum and no binding: it is
 * a literal the agent writes, one screen at a time.
 */
export const SCREEN_SPEC: ComponentSpec = {
  tag: "Screen",
  whenToUse:
    "The root of one named screen: it frames the screen's content, its reading width, and the space around it.",
  props: {
    name: {
      type: "string",
      guidance:
        "This screen's name, and how a nav: action reaches it. One identifier such as 'home' or 'invoices', unique in the document.",
      required: true,
    },
    title: {
      type: "string",
      guidance:
        "Optional heading at the top of the screen. Omit it when the first child already names the screen.",
    },
    maxWidth: {
      type: "string",
      guidance:
        "How wide the content column may grow before it stops. Use 'full' only for a dashboard that needs the whole viewport.",
      enum: ["narrow", "medium", "wide", "full"],
      default: "medium",
    },
    padding: {
      type: "string",
      guidance: "Space between the screen edge and its content, named in theme space tokens.",
      enum: ["none", "sm", "md", "lg"],
      default: "md",
    },
  },
  acceptsChildren: true,
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

/** Children in vertical reading order — the default container for anything. */
export const STACK_SPEC: ComponentSpec = {
  tag: "Stack",
  whenToUse:
    "Stack children vertically in reading order. The default container for a section, a form, or a list of cards.",
  props: {
    gap: {
      type: "string",
      guidance:
        "Space between children, named in theme space tokens. Use 'none' when the children carry their own spacing.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "md",
    },
    align: {
      type: "string",
      guidance:
        "How children line up across the stack. 'stretch' lets each child fill the width, which is what most content wants.",
      enum: ["start", "center", "end", "stretch"],
      default: "stretch",
    },
    justify: {
      type: "string",
      guidance:
        "How leftover vertical space is distributed when the stack grows. Use 'between' to pin the first and last child apart inside an equal-height card.",
      enum: ["start", "center", "end", "between"],
      default: "start",
    },
    grow: {
      type: "boolean",
      guidance:
        "Whether this stack expands to fill available vertical space from its parent. Use it sparingly inside equal-height cards.",
      default: false,
    },
    padding: {
      type: "string",
      guidance:
        "Space inside the stack, between its edge and its children, named in theme space tokens.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "none",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      defaultGap: "length",
      padding: "length",
    },
  },
};

/** A stable app frame: one rail child and the remaining children as main content. */
export const APP_SHELL_SPEC: ComponentSpec = {
  tag: "AppShell",
  whenToUse:
    "Frame an app-like screen with a side rail and main content, without hand-building the stretch and responsive behavior.",
  props: {
    gap: {
      type: "string",
      guidance: "Space between the rail and main content, named in theme space tokens.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "lg",
    },
    sidebar: {
      type: "string",
      guidance:
        "Which side the first child appears on as the rail. Remaining children become the main content region.",
      enum: ["start", "end"],
      default: "start",
    },
    collapse: {
      type: "boolean",
      guidance:
        "Whether the main content can wrap under the rail when the frame runs out of width.",
      default: true,
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      defaultGap: "length",
      mainMinWidth: "length",
      minHeight: "length",
    },
  },
};

/** Children side by side on one line, wrapping when the line runs out. */
export const ROW_SPEC: ComponentSpec = {
  tag: "Row",
  whenToUse:
    "Lay children out side by side on one line — a toolbar, a label and its value, a pair of buttons.",
  props: {
    gap: {
      type: "string",
      guidance: "Space between children, named in theme space tokens.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "md",
    },
    align: {
      type: "string",
      guidance:
        "How children line up vertically within the row. Use 'stretch' for side rails and equal-height columns; 'baseline' aligns text rather than boxes.",
      enum: ["start", "center", "end", "stretch", "baseline"],
      default: "center",
    },
    justify: {
      type: "string",
      guidance:
        "How leftover horizontal space is distributed. 'between' pushes the first and last child to the two ends.",
      enum: ["start", "center", "end", "between"],
      default: "start",
    },
    wrap: {
      type: "boolean",
      guidance:
        "Whether children continue onto a second line when the row runs out of width. Leave it on unless one line is required.",
      default: true,
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      defaultGap: "length",
      padding: "length",
    },
  },
};

/** A two-column split for asymmetric pages, hero/form pairs and editorial layouts. */
export const SPLIT_SPEC: ComponentSpec = {
  tag: "Split",
  whenToUse:
    "Divide content into two asymmetric columns, such as hero plus form, product story plus proof, or profile plus links.",
  props: {
    ratio: {
      type: "string",
      guidance:
        "How the first and second columns share space on wide containers. Use 60:40 or 40:60 for most service pages.",
      enum: ["50:50", "60:40", "40:60", "70:30", "30:70"],
      default: "60:40",
    },
    gap: {
      type: "string",
      guidance: "Space between split columns, named in theme space tokens.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "lg",
    },
    align: {
      type: "string",
      guidance:
        "How columns line up vertically. Use 'stretch' for paired panels and 'center' for hero/media compositions.",
      enum: ["start", "center", "end", "stretch"],
      default: "stretch",
    },
    reverse: {
      type: "boolean",
      guidance: "Whether the visual order is reversed while preserving the authored children.",
      default: false,
    },
    collapse: {
      type: "boolean",
      guidance:
        "Whether columns wrap when there is not enough width. Leave it on for most screens.",
      default: true,
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      defaultGap: "length",
      minColumnWidth: "length",
    },
  },
};

/** An even grid of equal columns, for repeated content of one kind. */
export const GRID_SPEC: ComponentSpec = {
  tag: "Grid",
  whenToUse:
    "Arrange children in an even grid of equal columns — metric tiles, a card gallery, a summary row.",
  props: {
    columns: {
      type: "number",
      guidance:
        "How many equal columns to lay out on a wide viewport. Three or four reads well; more than that crowds the content.",
      minimum: 1,
      maximum: 6,
      default: 3,
    },
    gap: {
      type: "string",
      guidance: "Space between grid cells, named in theme space tokens.",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "md",
    },
    collapse: {
      type: "boolean",
      guidance:
        "Whether the grid falls back to a single column on a narrow viewport. Leave it on unless every column must stay side by side.",
      default: true,
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      defaultGap: "length",
      minColumnWidth: "length",
    },
  },
};

/** The layout group, in the order the default catalog lists it. */
export const LAYOUT_SPECS: readonly ComponentSpec[] = [
  SCREEN_SPEC,
  APP_SHELL_SPEC,
  STACK_SPEC,
  ROW_SPEC,
  SPLIT_SPEC,
  GRID_SPEC,
];
