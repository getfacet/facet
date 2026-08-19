/** Trusted semantic navigation and action React implementations. */

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import type { ReactNode } from "react";

import type { FlowStyle } from "./style.js";
import {
  enumProp,
  flagProp,
  flowStyle,
  foundation,
  mountStyle,
  recipe,
  semantic,
  textProp,
} from "./style.js";

type Mount = ComponentMountProps<ReactNode>;

const NAVIGATION_ORIENTATIONS = ["horizontal", "vertical"] as const;
const DENSITIES = ["compact", "comfortable"] as const;
const SURFACE_TONES = ["neutral", "accent", "inverse"] as const;
const BUTTON_TONES = ["primary", "secondary", "quiet"] as const;
const ACTION_GROUP_LAYOUTS = ["row", "stack"] as const;
const ACTION_GROUP_ALIGNMENTS = ["start", "center", "end"] as const;
const ACTION_BAR_ALIGNMENTS = ["start", "center", "between"] as const;

const ALIGNMENT_VALUES = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
} as const;

const ROOT_BOUNDS: FlowStyle = Object.freeze({
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
});

const BUTTON_COLORS = {
  primary: {
    background: recipe("button", "primaryBg"),
    color: recipe("button", "primaryText"),
    border: recipe("button", "primaryBorder"),
  },
  secondary: {
    background: recipe("button", "secondaryBg"),
    color: recipe("button", "secondaryText"),
    border: recipe("button", "secondaryBorder"),
  },
  quiet: {
    background: "transparent",
    color: recipe("button", "quietText"),
    border: semantic("border", "transparent"),
  },
} as const;

function surfaceColors(namespace: string, tone: (typeof SURFACE_TONES)[number]) {
  if (tone === "accent") {
    return {
      background: semantic("state", "selectedBg"),
      color: semantic("state", "selectedText"),
      border: semantic("action", "primaryBorder"),
    } as const;
  }
  if (tone === "inverse") {
    return {
      background: semantic("surface", "inverse"),
      color: semantic("text", "inverse"),
      border: semantic("border", "strong"),
    } as const;
  }
  return {
    background: recipe(namespace, "background"),
    color: recipe(namespace, "text"),
    border: recipe(namespace, "border"),
  } as const;
}

function regionStyle(extra: FlowStyle = {}): ReturnType<typeof flowStyle> {
  return flowStyle({
    boxSizing: "border-box",
    minWidth: 0,
    maxWidth: "100%",
    ...extra,
  });
}

function controlStyle(tone: (typeof BUTTON_TONES)[number]): FlowStyle {
  const colors = BUTTON_COLORS[tone];
  return {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
    maxWidth: "100%",
    minHeight: foundation("size", "touchTarget"),
    padding: `${recipe("button", "paddingBlock")} ${recipe("button", "paddingInline")}`,
    border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
    borderRadius: recipe("button", "radius"),
    background: colors.background,
    color: colors.color,
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: foundation("typography", "fontSizeSm"),
    fontWeight: foundation("typography", "fontWeightMedium"),
    lineHeight: foundation("typography", "lineHeightTight"),
    textAlign: "center",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    boxShadow: recipe("button", "focusRing"),
    cursor: "pointer",
  };
}

/** A semantic navigation landmark with explicit brand, items, and actions regions. */
export const Navigation: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const label = textProp(props, "label") ?? "Navigation";
  const orientation = enumProp(props, "orientation", NAVIGATION_ORIENTATIONS, "horizontal");
  const vertical = orientation === "vertical";
  const density = enumProp(props, "density", DENSITIES, "comfortable");
  const tone = enumProp(props, "tone", SURFACE_TONES, "neutral");
  const colors = surfaceColors("navigation", tone);
  const gap = density === "compact" ? foundation("space", "xs") : recipe("navigation", "gap");
  const brand = slots["brand"];
  const actions = slots["actions"];

  return (
    <nav
      data-facet-component="Navigation"
      data-facet-navigation-orientation={orientation}
      data-facet-navigation-density={density}
      data-facet-navigation-tone={tone}
      aria-label={label}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        flexWrap: vertical ? "nowrap" : "wrap",
        alignItems: vertical ? "stretch" : "center",
        gap,
        padding: `${recipe("navigation", "paddingBlock")} ${recipe("navigation", "paddingInline")}`,
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        borderRadius: recipe("navigation", "radius"),
        background: colors.background,
        color: colors.color,
      })}
    >
      {brand === undefined || brand === null ? null : (
        <div
          data-facet-slot="brand"
          style={regionStyle({
            display: "flex",
            alignItems: "center",
            flex: vertical ? "0 0 auto" : "0 1 auto",
            minHeight: foundation("size", "touchTarget"),
          })}
        >
          {brand}
        </div>
      )}
      <div
        data-facet-slot="items"
        style={regionStyle({
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          flexWrap: vertical ? "nowrap" : "wrap",
          alignItems: vertical ? "stretch" : "center",
          flex: "1 1 auto",
          gap,
          minHeight: foundation("size", "touchTarget"),
        })}
      >
        {slots["items"] ?? null}
      </div>
      {actions === undefined || actions === null ? null : (
        <div
          data-facet-slot="actions"
          style={regionStyle({
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: vertical ? "flex-start" : "flex-end",
            flex: vertical ? "0 0 auto" : "0 1 auto",
            gap,
            minHeight: foundation("size", "touchTarget"),
          })}
        >
          {actions}
        </div>
      )}
    </nav>
  );
};

/** One native navigation button leaf. */
export const NavigationItem: MountedComponent<ReactNode, ReactNode> = ({
  props,
  themeVars,
  onAction,
}: Mount): ReactNode => {
  const label = textProp(props, "label") ?? "";
  const mark = textProp(props, "mark");
  const meta = textProp(props, "meta");
  const active = flagProp(props, "active", false);

  return (
    <button
      type="button"
      data-facet-component="NavigationItem"
      aria-current={active ? "page" : undefined}
      style={mountStyle(themeVars, {
        ...controlStyle("quiet"),
        width: "auto",
        gap: recipe("navigation-item", "gap"),
        padding: `${recipe("navigation-item", "paddingBlock")} ${recipe(
          "navigation-item",
          "paddingInline",
        )}`,
        borderRadius: recipe("navigation-item", "radius"),
        boxShadow: recipe("navigation-item", "focusRing"),
        justifyContent: "flex-start",
        background: active
          ? recipe("navigation-item", "activeBg")
          : recipe("navigation-item", "background"),
        color: active ? recipe("navigation-item", "activeText") : recipe("navigation-item", "text"),
        borderColor: active
          ? recipe("navigation-item", "activeBorder")
          : recipe("navigation-item", "border"),
      })}
      onClick={() => {
        onAction("action");
      }}
    >
      {mark === undefined ? null : (
        <span
          aria-hidden="true"
          data-facet-navigation-item="mark"
          style={flowStyle({
            flex: "0 1 auto",
            minWidth: 0,
            maxWidth: foundation("size", "touchTarget"),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: recipe("navigation-item", "mutedText"),
          })}
        >
          {mark}
        </span>
      )}
      <span
        data-facet-navigation-item="label"
        style={flowStyle({
          flex: "1 1 auto",
          minWidth: 0,
          maxWidth: "100%",
          overflowWrap: "anywhere",
        })}
      >
        {label}
      </span>
      {meta === undefined ? null : (
        <span
          data-facet-navigation-item="meta"
          style={flowStyle({
            flex: "0 1 auto",
            minWidth: 0,
            maxWidth: "40%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginInlineStart: "auto",
            color: recipe("navigation-item", "mutedText"),
            fontSize: foundation("typography", "fontSizeXs"),
          })}
        >
          {meta}
        </span>
      )}
    </button>
  );
};

/** One native action button leaf. */
export const Button: MountedComponent<ReactNode, ReactNode> = ({
  props,
  themeVars,
  onAction,
}: Mount): ReactNode => {
  const label = textProp(props, "label") ?? "";
  const tone = enumProp(props, "tone", BUTTON_TONES, "secondary");

  return (
    <button
      type="button"
      data-facet-component="Button"
      style={mountStyle(themeVars, controlStyle(tone))}
      onClick={() => {
        onAction("action");
      }}
    >
      {label}
    </button>
  );
};

/** Ordered action children in a labelled row or stack. */
export const ActionGroup: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const layout = enumProp(props, "layout", ACTION_GROUP_LAYOUTS, "stack");
  const align = enumProp(props, "align", ACTION_GROUP_ALIGNMENTS, "start");
  const density = enumProp(props, "density", DENSITIES, "comfortable");
  const tone = enumProp(props, "tone", SURFACE_TONES, "neutral");
  const gap = density === "compact" ? foundation("space", "xs") : recipe("action-group", "gap");
  const background =
    tone === "accent"
      ? semantic("state", "selectedBg")
      : tone === "inverse"
        ? semantic("surface", "inverse")
        : recipe("action-group", "background");
  const border =
    tone === "accent"
      ? semantic("action", "primaryBorder")
      : tone === "inverse"
        ? semantic("border", "strong")
        : recipe("action-group", "border");

  return (
    <div
      data-facet-component="ActionGroup"
      data-facet-action-group-layout={layout}
      data-facet-action-group-tone={tone}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap,
        padding: recipe("action-group", "padding"),
        minHeight: foundation("size", "touchTarget"),
        border: `${foundation("borderWidth", "thin")} solid ${border}`,
        borderRadius: recipe("action-group", "radius"),
        background,
        color: tone === "inverse" ? semantic("text", "inverse") : semantic("text", "default"),
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle({
            margin: 0,
            minWidth: 0,
            maxWidth: "100%",
            overflowWrap: "anywhere",
            color:
              tone === "accent"
                ? semantic("state", "selectedText")
                : tone === "inverse"
                  ? semantic("text", "inverse")
                  : recipe("action-group", "titleColor"),
            fontFamily: foundation("typography", "fontFamilySans"),
            fontSize: foundation("typography", "fontSizeSm"),
            fontWeight: foundation("typography", "fontWeightMedium"),
            lineHeight: foundation("typography", "lineHeightTight"),
          })}
        >
          {title}
        </h2>
      )}
      <div
        data-facet-action-group="actions"
        style={regionStyle({
          display: "flex",
          flexDirection: layout === "row" ? "row" : "column",
          flexWrap: layout === "row" ? "wrap" : "nowrap",
          alignItems: layout === "row" ? "center" : ALIGNMENT_VALUES[align],
          justifyContent: layout === "row" ? ALIGNMENT_VALUES[align] : "flex-start",
          gap,
          minHeight: foundation("size", "touchTarget"),
        })}
      >
        {children}
      </div>
    </div>
  );
};

/** Responsive context and action regions for a page-level action bar. */
export const ActionBar: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const align = enumProp(props, "align", ACTION_BAR_ALIGNMENTS, "start");
  const tone = enumProp(props, "tone", SURFACE_TONES, "neutral");
  const colors = surfaceColors("action-bar", tone);
  const context = slots["context"];

  return (
    <div
      data-facet-component="ActionBar"
      data-facet-action-bar-align={align}
      data-facet-action-bar-tone={tone}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${foundation(
          "size",
          "containerXs",
        )}, 100%), 1fr))`,
        alignItems: "center",
        justifyItems: align === "center" ? "center" : "stretch",
        gap: recipe("action-bar", "gap"),
        padding: recipe("action-bar", "padding"),
        minHeight: foundation("size", "touchTarget"),
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        borderRadius: recipe("action-bar", "radius"),
        background: colors.background,
        color: colors.color,
      })}
    >
      {context === undefined || context === null ? null : (
        <div
          data-facet-slot="context"
          style={regionStyle({
            justifySelf: align === "center" ? "center" : "stretch",
            color: tone === "neutral" ? recipe("action-bar", "mutedText") : colors.color,
          })}
        >
          {context}
        </div>
      )}
      <div
        data-facet-slot="actions"
        style={regionStyle({
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent:
            align === "center" ? "center" : align === "between" ? "flex-end" : "flex-start",
          justifySelf: align === "center" ? "center" : "stretch",
          gap: recipe("action-bar", "gap"),
          minHeight: foundation("size", "touchTarget"),
        })}
      >
        {slots["actions"] ?? null}
      </div>
    </div>
  );
};
