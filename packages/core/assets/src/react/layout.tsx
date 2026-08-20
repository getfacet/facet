/** Trusted, flow-contained React implementations for Facet structure tags. */

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import type { ReactNode } from "react";

import type { FlowStyle, SpaceName } from "./style.js";
import {
  countProp,
  enumProp,
  flagProp,
  flowStyle,
  foundation,
  mountStyle,
  recipe,
  semantic,
  space,
  textProp,
} from "./style.js";

type Mount = ComponentMountProps<ReactNode>;

const SPACE_NAMES = ["none", "xs", "sm", "md", "lg", "xl"] as const;
const ALIGNMENTS = ["start", "center", "end", "stretch"] as const;
const ROW_ALIGNMENTS = ["start", "center", "end", "stretch", "baseline"] as const;
const JUSTIFICATIONS = ["start", "center", "end", "between"] as const;
const SPLIT_RATIOS = ["50:50", "60:40", "40:60", "70:30", "30:70"] as const;
const SCREEN_WIDTHS = ["narrow", "medium", "wide", "full"] as const;

const ALIGNMENT_VALUES = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
} as const;

const JUSTIFICATION_VALUES = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
} as const;

const SPLIT_WEIGHTS = {
  "50:50": [1, 1],
  "60:40": [3, 2],
  "40:60": [2, 3],
  "70:30": [7, 3],
  "30:70": [3, 7],
} as const satisfies Readonly<Record<string, readonly [number, number]>>;

const SCREEN_MAX_WIDTH = {
  narrow: foundation("size", "contentMeasureLg"),
  medium: foundation("size", "containerMd"),
  wide: foundation("size", "containerXl"),
  full: "100%",
} as const;

const CARD_EDGE = {
  neutral: semantic("border", "default"),
  accent: semantic("action", "primaryBorder"),
  success: semantic("status", "successBorder"),
  warning: semantic("status", "warningBorder"),
  danger: semantic("status", "dangerBorder"),
} as const;

const CARD_TONES = Object.keys(CARD_EDGE) as readonly (keyof typeof CARD_EDGE)[];
const CARD_PADDINGS = ["none", "sm", "md", "lg"] as const;
const SECTION_TONES = ["neutral", "accent", "muted"] as const;
const SECTION_PADDINGS = ["none", "sm", "md", "lg"] as const;

const ROOT_BOUNDS: FlowStyle = Object.freeze({
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
});

function responsiveTracks(columns: number, gap: string, minimum: string): string {
  const gaps = columns - 1;
  const share = `calc((100% - (${gap} * ${gaps})) / ${columns})`;
  return `repeat(auto-fit, minmax(max(min(${minimum}, 100%), ${share}), 1fr))`;
}

function headingStyle(color: string, size: string, weight: string): ReturnType<typeof flowStyle> {
  return flowStyle({
    margin: 0,
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    color,
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: size,
    fontWeight: weight,
    lineHeight: foundation("typography", "lineHeightTight"),
  });
}

function descriptionStyle(color: string): ReturnType<typeof flowStyle> {
  return flowStyle({
    margin: 0,
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    color,
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: foundation("typography", "fontSizeSm"),
    lineHeight: foundation("typography", "lineHeightNormal"),
  });
}

function slotRegionStyle(extra: FlowStyle = {}): ReturnType<typeof flowStyle> {
  return flowStyle({
    boxSizing: "border-box",
    minWidth: 0,
    maxWidth: "100%",
    ...extra,
  });
}

/** One named screen and its ordered container children. */
export const Screen: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const name = textProp(props, "name");
  const title = textProp(props, "title");
  const maxWidth = enumProp(props, "maxWidth", SCREEN_WIDTHS, "medium");
  const padding = enumProp(props, "padding", CARD_PADDINGS, "md");

  return (
    <section
      data-facet-component="Screen"
      data-facet-screen={name}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        padding: space(padding),
        background: recipe("screen", "background"),
        color: recipe("screen", "text"),
        fontFamily: foundation("typography", "fontFamilySans"),
        fontSize: foundation("typography", "fontSizeMd"),
        lineHeight: foundation("typography", "lineHeightNormal"),
      })}
    >
      <div
        style={slotRegionStyle({
          display: "flex",
          flexDirection: "column",
          width: "100%",
          marginInline: "auto",
          gap: recipe("screen", "contentGap"),
          maxWidth: SCREEN_MAX_WIDTH[maxWidth],
        })}
      >
        {title === undefined ? null : (
          <h1
            style={flowStyle({
              ...headingStyle(
                recipe("screen", "titleColor"),
                recipe("screen", "titleFontSize"),
                recipe("screen", "titleFontWeight"),
              ),
              lineHeight: recipe("screen", "titleLineHeight"),
            })}
          >
            {title}
          </h1>
        )}
        {children}
      </div>
    </section>
  );
};

/** Ordered children in a vertical flow. */
export const Stack: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const gap: SpaceName = enumProp(props, "gap", SPACE_NAMES, "md");
  const align = enumProp(props, "align", ALIGNMENTS, "stretch");
  const justify = enumProp(props, "justify", JUSTIFICATIONS, "start");
  const grow = flagProp(props, "grow", false);
  const padding: SpaceName = enumProp(props, "padding", SPACE_NAMES, "none");

  return (
    <div
      data-facet-component="Stack"
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        flexGrow: grow ? 1 : 0,
        flexBasis: grow ? 0 : "auto",
        gap: gap === "md" ? recipe("stack", "defaultGap") : space(gap),
        padding: space(padding),
        alignItems: ALIGNMENT_VALUES[align],
        justifyContent: JUSTIFICATION_VALUES[justify],
      })}
    >
      {children}
    </div>
  );
};

/** Ordered children in a wrapping horizontal flow. */
export const Row: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const gap: SpaceName = enumProp(props, "gap", SPACE_NAMES, "md");
  const align = enumProp(props, "align", ROW_ALIGNMENTS, "center");
  const justify = enumProp(props, "justify", JUSTIFICATIONS, "start");
  const wrap = flagProp(props, "wrap", true);

  return (
    <div
      data-facet-component="Row"
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "row",
        flexWrap: wrap ? "wrap" : "nowrap",
        alignItems: ALIGNMENT_VALUES[align],
        justifyContent: JUSTIFICATION_VALUES[justify],
        gap: gap === "md" ? recipe("row", "defaultGap") : space(gap),
      })}
    >
      {children}
    </div>
  );
};

/** Ordered children in bounded, container-responsive tracks. */
export const Grid: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const columns = countProp(props, "columns", 1, 6, 3);
  const gap: SpaceName = enumProp(props, "gap", SPACE_NAMES, "md");
  const collapse = flagProp(props, "collapse", true);
  const resolvedGap = gap === "md" ? recipe("grid", "defaultGap") : space(gap);

  return (
    <div
      data-facet-component="Grid"
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "grid",
        alignItems: "stretch",
        gap: resolvedGap,
        gridTemplateColumns: collapse
          ? responsiveTracks(columns, resolvedGap, recipe("grid", "minColumnWidth"))
          : `repeat(${columns}, minmax(0, 1fr))`,
      })}
    >
      {children}
    </div>
  );
};

/** Two named regions with a responsive ratio and no child-order inference. */
export const Split: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const ratio = enumProp(props, "ratio", SPLIT_RATIOS, "60:40");
  const gap: SpaceName = enumProp(props, "gap", SPACE_NAMES, "lg");
  const align = enumProp(props, "align", ALIGNMENTS, "stretch");
  const reverse = flagProp(props, "reverse", false);
  const collapse = flagProp(props, "collapse", true);
  const weights = SPLIT_WEIGHTS[ratio];
  const minimum = `min(${recipe("split", "minColumnWidth")}, 100%)`;

  const primary = (
    <div
      data-facet-slot="primary"
      style={slotRegionStyle({
        display: "flex",
        flexDirection: "column",
        minWidth: collapse ? minimum : 0,
        flex: `${weights[0]} 1 ${minimum}`,
        alignSelf: align === "stretch" ? "stretch" : "auto",
      })}
    >
      {slots["primary"] ?? null}
    </div>
  );
  const secondary = (
    <div
      data-facet-slot="secondary"
      style={slotRegionStyle({
        display: "flex",
        flexDirection: "column",
        minWidth: collapse ? minimum : 0,
        flex: `${weights[1]} 1 ${minimum}`,
        alignSelf: align === "stretch" ? "stretch" : "auto",
      })}
    >
      {slots["secondary"] ?? null}
    </div>
  );

  return (
    <div
      data-facet-component="Split"
      data-facet-split-ratio={ratio}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "row",
        flexWrap: collapse ? "wrap" : "nowrap",
        alignItems: ALIGNMENT_VALUES[align],
        gap: gap === "lg" ? recipe("split", "defaultGap") : space(gap),
      })}
    >
      {reverse ? (
        <>
          {secondary}
          {primary}
        </>
      ) : (
        <>
          {primary}
          {secondary}
        </>
      )}
    </div>
  );
};

/** Named navigation, header, and main regions in an intrinsic app frame. */
export const AppShell: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const gap: SpaceName = enumProp(props, "gap", SPACE_NAMES, "lg");
  const sidebar = enumProp(props, "sidebar", ["start", "end"] as const, "start");
  const collapse = flagProp(props, "collapse", true);
  const navigation = slots["navigation"];
  const header = slots["header"];
  const navigationRegion =
    navigation === undefined || navigation === null ? null : (
      <aside
        data-facet-slot="navigation"
        style={slotRegionStyle({
          display: "flex",
          flexDirection: "column",
          width: "100%",
          minWidth: collapse ? `min(${foundation("size", "containerXs")}, 100%)` : 0,
          flex: `0 1 min(${foundation("size", "containerXs")}, 100%)`,
          alignSelf: "stretch",
        })}
      >
        {navigation}
      </aside>
    );
  const mainRegion = (
    <div
      style={slotRegionStyle({
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minWidth: collapse ? `min(${recipe("app-shell", "mainMinWidth")}, 100%)` : 0,
        flex: `1 1 min(${recipe("app-shell", "mainMinWidth")}, 100%)`,
        gap: foundation("space", "md"),
      })}
    >
      {header === undefined || header === null ? null : (
        <header data-facet-slot="header" style={slotRegionStyle()}>
          {header}
        </header>
      )}
      <main
        data-facet-slot="main"
        style={slotRegionStyle({
          display: "flex",
          flexDirection: "column",
          width: "100%",
          flex: "1 1 auto",
        })}
      >
        {slots["main"] ?? null}
      </main>
    </div>
  );

  return (
    <div
      data-facet-component="AppShell"
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "row",
        flexWrap: collapse ? "wrap" : "nowrap",
        alignItems: "stretch",
        gap: gap === "lg" ? recipe("app-shell", "defaultGap") : space(gap),
        minHeight: recipe("app-shell", "minHeight"),
      })}
    >
      {sidebar === "end" ? (
        <>
          {mainRegion}
          {navigationRegion}
        </>
      ) : (
        <>
          {navigationRegion}
          {mainRegion}
        </>
      )}
    </div>
  );
};

/** A normal-flow page section containing ordered children. */
export const Section: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const description = textProp(props, "description");
  const tone = enumProp(props, "tone", SECTION_TONES, "neutral");
  const padding = enumProp(props, "padding", SECTION_PADDINGS, "md");
  const background =
    tone === "accent"
      ? semantic("state", "selectedBg")
      : tone === "muted"
        ? semantic("surface", "muted")
        : semantic("surface", "default");

  return (
    <section
      data-facet-component="Section"
      data-facet-section-tone={tone}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: foundation("space", "md"),
        padding: padding === "md" ? recipe("section", "padding") : space(padding),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("section", "border")}`,
        borderRadius: recipe("section", "radius"),
        background,
        color: recipe("section", "text"),
      })}
    >
      {title === undefined ? null : (
        <h2
          style={headingStyle(
            recipe("section", "text"),
            recipe("section", "titleFontSize"),
            recipe("section", "titleFontWeight"),
          )}
        >
          {title}
        </h2>
      )}
      {description === undefined ? null : (
        <p style={descriptionStyle(recipe("section", "mutedText"))}>{description}</p>
      )}
      {children}
    </section>
  );
};

/** An equal-height-capable bounded surface containing ordered children. */
export const Card: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const tone = enumProp(props, "tone", CARD_TONES, "neutral");
  const padding = enumProp(props, "padding", CARD_PADDINGS, "md");

  return (
    <article
      data-facet-component="Card"
      data-facet-card-tone={tone}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: foundation("space", "sm"),
        padding: padding === "md" ? recipe("card", "padding") : space(padding),
        border: `${foundation("borderWidth", "thin")} solid ${CARD_EDGE[tone]}`,
        borderRadius: recipe("card", "radius"),
        boxShadow: recipe("card", "shadow"),
        background: recipe("card", "background"),
        color: recipe("card", "text"),
      })}
    >
      {title === undefined ? null : (
        <h2
          style={headingStyle(
            recipe("card", "titleColor"),
            foundation("typography", "fontSizeLg"),
            foundation("typography", "fontWeightMedium"),
          )}
        >
          {title}
        </h2>
      )}
      {children}
    </article>
  );
};

/** Flow content for the renderer-owned modal frame. */
export const Modal: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const description = textProp(props, "description");
  const actions = slots["actions"];

  return (
    <div
      data-facet-component="Modal"
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: foundation("space", "lg"),
        color: recipe("modal", "frameText"),
      })}
    >
      {description === undefined ? null : (
        <p style={descriptionStyle(semantic("text", "muted"))}>{description}</p>
      )}
      <div data-facet-slot="body" style={slotRegionStyle()}>
        {slots["body"] ?? null}
      </div>
      {actions === undefined || actions === null ? null : (
        <div
          data-facet-slot="actions"
          style={slotRegionStyle({
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: foundation("space", "sm"),
            minHeight: foundation("size", "touchTarget"),
          })}
        >
          {actions}
        </div>
      )}
    </div>
  );
};

/** A labelled separator leaf. */
export const Divider: MountedComponent<ReactNode, ReactNode> = ({
  props,
  themeVars,
}: Mount): ReactNode => {
  const label = textProp(props, "label");
  const emphasis = enumProp(props, "emphasis", ["subtle", "strong"] as const, "subtle");
  const line: FlowStyle = {
    flex: "1 1 auto",
    minWidth: 0,
    borderTopStyle: "solid",
    borderTopWidth: foundation("borderWidth", emphasis === "strong" ? "medium" : "thin"),
    borderTopColor: recipe("divider", "color"),
  };

  return (
    <div
      data-facet-component="Divider"
      role="separator"
      aria-label={label}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        alignItems: "center",
        gap: recipe("divider", "gap"),
        minHeight: foundation("borderWidth", emphasis === "strong" ? "medium" : "thin"),
        color: recipe("divider", "text"),
      })}
    >
      <span aria-hidden="true" style={flowStyle(line)} />
      {label === undefined ? null : (
        <span
          style={flowStyle({
            flex: "0 1 auto",
            minWidth: 0,
            maxWidth: "100%",
            overflowWrap: "anywhere",
            fontFamily: foundation("typography", "fontFamilySans"),
            fontSize: foundation("typography", "fontSizeXs"),
            fontWeight: foundation("typography", "fontWeightMedium"),
            lineHeight: foundation("typography", "lineHeightTight"),
          })}
        >
          {label}
        </span>
      )}
      <span aria-hidden="true" style={flowStyle(line)} />
    </div>
  );
};
