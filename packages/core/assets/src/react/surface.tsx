/**
 * The trusted React implementations of the three default surface components.
 *
 * A surface gives content an edge. `Card` bounds a group of related content,
 * `Empty` stands in for content there isn't any of yet, and `Modal` supplies
 * the inside of the one sanctioned overlap. All three describe **content
 * only**: none declares a coordinate, a size in pixels, or any control over
 * what paints in front of what.
 *
 * `Modal` is deliberately the least of the three. The framework's Modal frame
 * in `@facet/react` owns the scrim, the placement, the stacking band, the focus
 * trap, the escape key and the scroll lock, and it projects `triggerLabel` into
 * its trigger and `title` into its heading. This component therefore renders
 * **neither of those two strings** — printing them here would duplicate the
 * frame's own chrome — and emits no frame of its own. What is left is exactly
 * the flow content: the optional `description`, then the children. That is the
 * whole of what a registered `Modal` is allowed to be, and it is what keeps the
 * overlap mechanism the framework's rather than the catalog's.
 *
 * The only import besides `react` is `@facet/core`, keeping the assets→react
 * edge one-way.
 *
 * **Visibility: private.** This module is not a package entry point and is not
 * barrel-exported; `react.tsx` composes it into the default registry.
 */

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import type { ReactNode } from "react";

import {
  enumProp,
  flowStyle,
  foundation,
  mountStyle,
  recipe,
  semantic,
  space,
  textProp,
} from "./style.js";

const CARD_TONES = ["neutral", "accent", "success", "warning", "danger"] as const;
const CARD_PADDINGS = ["none", "sm", "md", "lg"] as const;

/**
 * The heading a surface puts above its content — `Card`'s title and the line
 * `Empty` leads with. One declaration, because the two are the same role at the
 * same level: a surface naming itself, one step down from the screen's own
 * heading. Frozen, since every mount of both components shares the object.
 */
function surfaceHeading(color: string): ReturnType<typeof flowStyle> {
  return flowStyle({
    margin: 0,
    fontSize: foundation("typography", "fontSizeLg"),
    fontWeight: foundation("typography", "fontWeightMedium"),
    lineHeight: foundation("typography", "lineHeightTight"),
    color,
  });
}

/**
 * The quieter second line — `Empty`'s description and `Modal`'s. Also one
 * declaration: both are context under a heading, and drifting them apart would
 * make the same sentence read differently depending on the surface it sat on.
 */
const SURFACE_DESCRIPTION = Object.freeze(
  flowStyle({
    margin: 0,
    fontSize: foundation("typography", "fontSizeSm"),
    lineHeight: foundation("typography", "lineHeightNormal"),
    color: semantic("text", "muted"),
  }),
);

/** The theme colour each declared card tone draws its edge from. */
const TONE_EDGES = {
  neutral: recipe("card", "border"),
  accent: semantic("action", "primaryBorder"),
  success: semantic("status", "successBorder"),
  warning: semantic("status", "warningBorder"),
  danger: semantic("status", "dangerBorder"),
} as const satisfies Readonly<Record<string, string>>;

/** A bounded surface that groups related content and separates it from the rest. */
export const Card: MountedComponent<ReactNode, ReactNode> = function Card({
  props,
  children,
  themeVars,
}: ComponentMountProps<ReactNode>): ReactNode {
  const title = textProp(props, "title");
  const edge = enumProp(props, "tone", CARD_TONES, "neutral");
  const padding = enumProp(props, "padding", CARD_PADDINGS, "md");

  return (
    <section
      data-facet-component="Card"
      data-facet-card-tone={edge}
      style={mountStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        minWidth: 0,
        gap: foundation("space", "sm"),
        padding: padding === "md" ? recipe("card", "padding") : space(padding),
        background: recipe("card", "background"),
        color: recipe("card", "text"),
        borderStyle: "solid",
        borderWidth: foundation("borderWidth", "thin"),
        borderColor: TONE_EDGES[edge],
        borderRadius: recipe("card", "radius"),
        boxShadow: recipe("card", "shadow"),
      })}
    >
      {title === undefined ? null : (
        <h2 style={surfaceHeading(recipe("card", "titleColor"))}>{title}</h2>
      )}
      {children}
    </section>
  );
};

/** The stand-in for a view with nothing in it yet. */
export const Empty: MountedComponent<ReactNode, ReactNode> = function Empty({
  props,
  children,
  themeVars,
}: ComponentMountProps<ReactNode>): ReactNode {
  const title = textProp(props, "title") ?? "";
  const description = textProp(props, "description");

  return (
    <div
      data-facet-component="Empty"
      style={mountStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        boxSizing: "border-box",
        minWidth: 0,
        gap: foundation("space", "sm"),
        padding: recipe("empty", "padding"),
        textAlign: "center",
        borderStyle: "dashed",
        borderWidth: foundation("borderWidth", "thin"),
        borderColor: recipe("empty", "border"),
        borderRadius: recipe("empty", "radius"),
        background: recipe("empty", "background"),
        color: recipe("empty", "text"),
      })}
    >
      <p style={surfaceHeading(recipe("empty", "titleColor"))}>{title}</p>
      {description === undefined ? null : <p style={SURFACE_DESCRIPTION}>{description}</p>}
      {children}
    </div>
  );
};

/**
 * The inside of the one sanctioned overlap: flow content, and nothing that
 * would place it. The frame around it belongs to `@facet/react`.
 */
export const Modal: MountedComponent<ReactNode, ReactNode> = function Modal({
  props,
  children,
  themeVars,
}: ComponentMountProps<ReactNode>): ReactNode {
  const description = textProp(props, "description");

  return (
    <div
      data-facet-component="Modal"
      style={mountStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        minWidth: 0,
        gap: foundation("space", "md"),
        color: recipe("modal", "frameText"),
      })}
    >
      {description === undefined ? null : <p style={SURFACE_DESCRIPTION}>{description}</p>}
      {children}
    </div>
  );
};
