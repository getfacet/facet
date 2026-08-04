/**
 * The trusted React implementations of the six default layout components.
 *
 * These are the other half of Facet's trust boundary. The catalog says a
 * `Grid` accepts a `columns` between one and six; this module is the code that
 * runs when an agent authors one, and the host registered it before the session
 * ever started. An agent's markup selects among these implementations and fills
 * their declared props; it never reaches the code itself.
 *
 * Everything here is **flow-contained**. There is no coordinate, no stacking
 * control and no escape hatch, and the `FlowStyle` type the shared helpers
 * accept makes that structural rather than a promise: overlap exists only
 * through the framework's Modal frame, which is not authored geometry at all.
 * `Grid`'s narrow-viewport collapse is the interesting case — it is expressed
 * entirely in the track sizing, so it needs no media query, no stylesheet and no
 * resize listener, and it stays correct inside any container the parent gives
 * it rather than only against the viewport.
 *
 * `Screen` is a registered component like the other three. It is a structural
 * position in the grammar *and* a catalog member, because a document stores its
 * screen roots as ordinary nodes the renderer mounts, and bootstrap demands
 * exact catalog/registry equality. So it is handed the registered props —
 * `name`, plus the presentation props — and honours them here, exactly as any
 * mounted component does.
 *
 * The only import besides `react` is `@facet/core`. That one-way edge is what
 * lets `@facet/react` mount these without either package depending on the
 * other.
 *
 * **Visibility: private.** This module is not a package entry point and is not
 * barrel-exported; `react.tsx` composes it into the default registry.
 */

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import { Children, Fragment, isValidElement } from "react";
import type { ReactNode } from "react";

import type { SpaceName } from "./style.js";
import {
  countProp,
  enumProp,
  flagProp,
  flowStyle,
  foundation,
  mountStyle,
  recipe,
  space,
  textProp,
} from "./style.js";

/** How wide a screen's reading column may grow. */
const MAX_WIDTHS = {
  narrow: "38rem",
  medium: "60rem",
  wide: "80rem",
  full: "100%",
} as const satisfies Readonly<Record<string, string>>;

const SCREEN_MAX_WIDTHS = ["narrow", "medium", "wide", "full"] as const;
const SCREEN_PADDINGS = ["none", "sm", "md", "lg"] as const;
const SPACE_NAMES = ["none", "xs", "sm", "md", "lg", "xl"] as const;
const STACK_ALIGNMENTS = ["start", "center", "end", "stretch"] as const;
const STACK_JUSTIFICATIONS = ["start", "center", "end", "between"] as const;
const ROW_ALIGNMENTS = ["start", "center", "end", "stretch", "baseline"] as const;
const ROW_JUSTIFICATIONS = ["start", "center", "end", "between"] as const;
const APP_SHELL_SIDEBARS = ["start", "end"] as const;
const SPLIT_RATIOS = ["50:50", "60:40", "40:60", "70:30", "30:70"] as const;
const SPLIT_ALIGNMENTS = ["start", "center", "end", "stretch"] as const;

/** Cross-axis alignment, as a stack and a row each name it. */
const ALIGNMENTS = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
} as const satisfies Readonly<Record<string, string>>;

/** Distribution of leftover space along a row. */
const JUSTIFICATIONS = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
} as const satisfies Readonly<Record<string, string>>;

const SPLIT_RATIO_WEIGHTS = {
  "50:50": [1, 1],
  "60:40": [3, 2],
  "40:60": [2, 3],
  "70:30": [7, 3],
  "30:70": [3, 7],
} as const satisfies Readonly<Record<string, readonly [number, number]>>;

/** The narrowest a grid column may become before the grid drops a column. */
const GRID_MIN_COLUMN = "12rem";

/** A grid's declared column bounds, mirroring `GRID_SPEC`. */
const GRID_MIN_COLUMNS = 1;
const GRID_MAX_COLUMNS = 6;
const GRID_DEFAULT_COLUMNS = 3;

function layoutChildren(children: ReactNode): readonly ReactNode[] {
  const values: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement<{ readonly children?: ReactNode }>(child) && child.type === Fragment) {
      values.push(...layoutChildren(child.props.children));
      return;
    }
    values.push(child);
  });
  return values;
}

/**
 * The track sizing for one grid.
 *
 * When the grid may collapse, each track's floor is the larger of a readable
 * minimum and the share it would take at the requested column count. On a wide
 * container the share wins and the grid lays out exactly the requested columns;
 * as the container narrows the readable minimum takes over and `auto-fit` drops
 * columns one at a time, down to one. The whole behaviour is in the value, so
 * it responds to the container it is actually in and needs no listener.
 */
function gridTracks(columns: number, gap: string, collapse: boolean): string {
  if (!collapse || columns <= GRID_MIN_COLUMNS) {
    return `repeat(${columns}, minmax(0, 1fr))`;
  }
  const gaps = columns - 1;
  const share = `calc((100% - (${gap} * ${gaps})) / ${columns})`;
  return `repeat(auto-fit, minmax(max(${GRID_MIN_COLUMN}, ${share}), 1fr))`;
}

/**
 * The root of one named screen: its background, its reading column, and the
 * space around it.
 */
export const Screen: MountedComponent<ReactNode, ReactNode> = function Screen({
  props,
  children,
  themeVars,
}: ComponentMountProps<ReactNode>): ReactNode {
  const name = textProp(props, "name") ?? "";
  const title = textProp(props, "title");
  const maxWidth = enumProp(props, "maxWidth", SCREEN_MAX_WIDTHS, "medium");
  const padding = enumProp(props, "padding", SCREEN_PADDINGS, "md");

  return (
    <section
      data-facet-component="Screen"
      data-facet-screen={name}
      style={mountStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        width: "100%",
        minWidth: 0,
        padding: space(padding),
        background: recipe("screen", "background"),
        color: recipe("screen", "text"),
        fontFamily: foundation("typography", "fontFamilySans"),
        fontSize: foundation("typography", "fontSizeMd"),
        lineHeight: foundation("typography", "lineHeightNormal"),
      })}
    >
      <div
        style={flowStyle({
          display: "flex",
          flexDirection: "column",
          gap: recipe("screen", "contentGap"),
          width: "100%",
          minWidth: 0,
          maxWidth: MAX_WIDTHS[maxWidth],
          marginInline: "auto",
        })}
      >
        {title === undefined ? null : (
          <h1
            style={flowStyle({
              margin: 0,
              fontSize: recipe("screen", "titleFontSize"),
              fontWeight: recipe("screen", "titleFontWeight"),
              lineHeight: recipe("screen", "titleLineHeight"),
              color: recipe("screen", "titleColor"),
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

/** Children in vertical reading order. */
export const Stack: MountedComponent<ReactNode, ReactNode> = function Stack({
  props,
  children,
  themeVars,
}: ComponentMountProps<ReactNode>): ReactNode {
  const gap: SpaceName = enumProp(props, "gap", SPACE_NAMES, "md");
  const align = enumProp(props, "align", STACK_ALIGNMENTS, "stretch");
  const justify = enumProp(props, "justify", STACK_JUSTIFICATIONS, "start");
  const grow = flagProp(props, "grow", false);
  const padding: SpaceName = enumProp(props, "padding", SPACE_NAMES, "none");

  return (
    <div
      data-facet-component="Stack"
      style={mountStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        minWidth: 0,
        flexGrow: grow ? 1 : 0,
        flexBasis: grow ? 0 : "auto",
        gap: space(gap),
        padding: space(padding),
        alignItems: ALIGNMENTS[align],
        justifyContent: JUSTIFICATIONS[justify],
      })}
    >
      {children}
    </div>
  );
};

/** An app-like frame with one side rail and one main content region. */
export const AppShell: MountedComponent<ReactNode, ReactNode> = function AppShell({
  props,
  children,
  themeVars,
}: ComponentMountProps<ReactNode>): ReactNode {
  const gap: SpaceName = enumProp(props, "gap", SPACE_NAMES, "lg");
  const sidebar = enumProp(props, "sidebar", APP_SHELL_SIDEBARS, "start");
  const collapse = flagProp(props, "collapse", true);
  const childArray = layoutChildren(children);
  const railChild = childArray[0] ?? null;
  const mainChildren = childArray.slice(1);
  const rail =
    railChild === null ? null : (
      <div
        data-facet-app-shell-slot="rail"
        style={flowStyle({
          display: "flex",
          minWidth: 0,
          flex: "0 0 auto",
          alignSelf: "stretch",
        })}
      >
        {railChild}
      </div>
    );
  const main =
    mainChildren.length === 0 ? null : (
      <div
        data-facet-app-shell-slot="main"
        style={flowStyle({
          display: "flex",
          flexDirection: "column",
          minWidth: recipe("app-shell", "mainMinWidth"),
          flex: "1 1 0",
          alignSelf: "stretch",
        })}
      >
        {mainChildren}
      </div>
    );

  return (
    <div
      data-facet-component="AppShell"
      style={mountStyle(themeVars, {
        display: "flex",
        flexDirection: "row",
        flexWrap: collapse ? "wrap" : "nowrap",
        alignItems: "stretch",
        boxSizing: "border-box",
        width: "100%",
        minWidth: 0,
        minHeight: recipe("app-shell", "minHeight"),
        gap: gap === "lg" ? recipe("app-shell", "defaultGap") : space(gap),
      })}
    >
      {sidebar === "end" ? (
        <>
          {main}
          {rail}
        </>
      ) : (
        <>
          {rail}
          {main}
        </>
      )}
    </div>
  );
};

/** Children side by side on one line, wrapping when the line runs out. */
export const Row: MountedComponent<ReactNode, ReactNode> = function Row({
  props,
  children,
  themeVars,
}: ComponentMountProps<ReactNode>): ReactNode {
  const gap: SpaceName = enumProp(props, "gap", SPACE_NAMES, "md");
  const align = enumProp(props, "align", ROW_ALIGNMENTS, "center");
  const justify = enumProp(props, "justify", ROW_JUSTIFICATIONS, "start");
  const wrap = flagProp(props, "wrap", true);

  return (
    <div
      data-facet-component="Row"
      style={mountStyle(themeVars, {
        display: "flex",
        flexDirection: "row",
        boxSizing: "border-box",
        minWidth: 0,
        gap: space(gap),
        alignItems: ALIGNMENTS[align],
        justifyContent: JUSTIFICATIONS[justify],
        flexWrap: wrap ? "wrap" : "nowrap",
      })}
    >
      {children}
    </div>
  );
};

/** An asymmetric two-column frame for non-dashboard compositions. */
export const Split: MountedComponent<ReactNode, ReactNode> = function Split({
  props,
  children,
  themeVars,
}: ComponentMountProps<ReactNode>): ReactNode {
  const ratio = enumProp(props, "ratio", SPLIT_RATIOS, "60:40");
  const gap: SpaceName = enumProp(props, "gap", SPACE_NAMES, "lg");
  const align = enumProp(props, "align", SPLIT_ALIGNMENTS, "stretch");
  const reverse = flagProp(props, "reverse", false);
  const collapse = flagProp(props, "collapse", true);
  const weights = SPLIT_RATIO_WEIGHTS[ratio];
  const childArray = layoutChildren(children);
  const primaryChild = childArray[0] ?? null;
  const secondaryChildren = childArray.slice(1);
  const primary =
    primaryChild === null ? null : (
      <div
        data-facet-split-slot="primary"
        style={flowStyle({
          display: "flex",
          flexDirection: "column",
          minWidth: recipe("split", "minColumnWidth"),
          flex: `${weights[0]} 1 ${recipe("split", "minColumnWidth")}`,
          alignSelf: align === "stretch" ? "stretch" : "auto",
        })}
      >
        {primaryChild}
      </div>
    );
  const secondary =
    secondaryChildren.length === 0 ? null : (
      <div
        data-facet-split-slot="secondary"
        style={flowStyle({
          display: "flex",
          flexDirection: "column",
          minWidth: recipe("split", "minColumnWidth"),
          flex: `${weights[1]} 1 ${recipe("split", "minColumnWidth")}`,
          alignSelf: align === "stretch" ? "stretch" : "auto",
        })}
      >
        {secondaryChildren}
      </div>
    );

  return (
    <div
      data-facet-component="Split"
      data-facet-split-ratio={ratio}
      style={mountStyle(themeVars, {
        display: "flex",
        flexDirection: "row",
        flexWrap: collapse ? "wrap" : "nowrap",
        alignItems: ALIGNMENTS[align],
        boxSizing: "border-box",
        width: "100%",
        minWidth: 0,
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

/** An even grid of equal columns, for repeated content of one kind. */
export const Grid: MountedComponent<ReactNode, ReactNode> = function Grid({
  props,
  children,
  themeVars,
}: ComponentMountProps<ReactNode>): ReactNode {
  const columns = countProp(
    props,
    "columns",
    GRID_MIN_COLUMNS,
    GRID_MAX_COLUMNS,
    GRID_DEFAULT_COLUMNS,
  );
  const gap: SpaceName = enumProp(props, "gap", SPACE_NAMES, "md");
  const collapse = flagProp(props, "collapse", true);

  return (
    <div
      data-facet-component="Grid"
      style={mountStyle(themeVars, {
        display: "grid",
        boxSizing: "border-box",
        minWidth: 0,
        gap: space(gap),
        alignItems: "stretch",
        gridTemplateColumns: gridTracks(columns, space(gap), collapse),
      })}
    >
      {children}
    </div>
  );
};
