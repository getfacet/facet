/**
 * The default content components: `Text`, `Metric` and `Badge`.
 *
 * These three are what a page says rather than how it is arranged. Each one
 * takes no children and carries its content in props, because the author
 * grammar admits quoted scalars and explicit references only — content that
 * arrives as a nested tree would need a shape the grammar cannot express.
 *
 * One rule governs `bindable` across the group: **the single prop that carries
 * the component's data is bindable, and nothing else is.** `Text.value`,
 * `Metric.value` and `Badge.label` read published data through a `data:path`
 * reference, so republishing that path refreshes the page with no markup
 * rewrite at all (DC-019). Every other prop is a closed vocabulary or a piece of
 * authored framing; binding one would let published data choose a component's
 * appearance, which is a decision the author makes and the catalog bounds.
 *
 * `Metric.value` is a **number**, not a display string. A binding is checked
 * against the declared type exactly, so a metric bound to a published `42000000`
 * only resolves if the prop says `number` — declaring it a string would push
 * every host into pre-formatting its own numbers before publishing them, and
 * would silently fail against an ordinary numeric model. Formatting belongs to
 * the trusted React implementation, which is where locale and currency live.
 *
 * The module is **private**: it is not barrel-exported and is not a package
 * entry point. `catalog.ts` composes it into the one public default catalog.
 */

import type { ComponentSpec } from "@facet/core";

export const TEXT_SPEC: ComponentSpec = {
  tag: "Text",
  whenToUse: "Show a line or a paragraph of prose — a title, a heading, body copy, or a caption.",
  props: {
    value: {
      type: "string",
      required: true,
      bindable: true,
      guidance:
        "The words to show. Write them inline, or bind published copy with `data:<path>` so a republish updates the line without rewriting the markup.",
    },
    variant: {
      type: "string",
      enum: ["title", "heading", "body", "caption"],
      default: "body",
      guidance:
        "The typographic role the line plays: a page title, a section heading, ordinary body copy, or a small caption beneath something.",
    },
    tone: {
      type: "string",
      enum: ["default", "muted"],
      default: "default",
      guidance: "How loud the line reads: ordinary copy, or muted secondary copy.",
    },
  },
  acceptsChildren: false,
};

export const METRIC_SPEC: ComponentSpec = {
  tag: "Metric",
  whenToUse: "Show one headline number together with the label that says what it measures.",
  props: {
    label: {
      type: "string",
      required: true,
      guidance: "What the number measures, shown with it — for example `Total revenue`.",
    },
    value: {
      type: "number",
      required: true,
      bindable: true,
      guidance:
        "The number itself. Bind it with `data:<path>` so republishing that path refreshes the figure with no markup mutation; the path must hold a number, not a formatted string.",
    },
    unit: {
      type: "string",
      guidance: "A short unit or currency shown beside the number, such as `%`, `USD` or `ms`.",
    },
  },
  acceptsChildren: false,
};

export const BADGE_SPEC: ComponentSpec = {
  tag: "Badge",
  whenToUse: "Mark a short status beside the thing it describes.",
  props: {
    label: {
      type: "string",
      required: true,
      bindable: true,
      guidance:
        "The status word. Write it inline, or bind it with `data:<path>` when the status itself is published data.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "positive", "warning", "danger"],
      default: "neutral",
      guidance:
        "What the status means: neutral information, a good outcome, something to watch, or a failure.",
    },
  },
  acceptsChildren: false,
};

/**
 * The content group, in the order the default catalog registers it. Frozen so a
 * host reading the assembled catalog cannot lengthen the group; the specs
 * themselves are frozen by `validateCatalog` at the trust boundary.
 */
export const CONTENT_SPECS: readonly ComponentSpec[] = Object.freeze([
  TEXT_SPEC,
  METRIC_SPEC,
  BADGE_SPEC,
]);
