/**
 * The trusted React implementations of the four default layout components.
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
const ROW_ALIGNMENTS = ["start", "center", "end", "baseline"] as const;
const ROW_JUSTIFICATIONS = ["start", "center", "end", "between"] as const;

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

/** The narrowest a grid column may become before the grid drops a column. */
const GRID_MIN_COLUMN = "12rem";

/** A grid's declared column bounds, mirroring `GRID_SPEC`. */
const GRID_MIN_COLUMNS = 1;
const GRID_MAX_COLUMNS = 6;
const GRID_DEFAULT_COLUMNS = 3;

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
  const padding: SpaceName = enumProp(props, "padding", SPACE_NAMES, "none");

  return (
    <div
      data-facet-component="Stack"
      style={mountStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        minWidth: 0,
        gap: space(gap),
        padding: space(padding),
        alignItems: ALIGNMENTS[align],
      })}
    >
      {children}
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
        gridTemplateColumns: gridTracks(columns, space(gap), collapse),
      })}
    >
      {children}
    </div>
  );
};
