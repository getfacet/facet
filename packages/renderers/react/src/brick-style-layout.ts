import type { CSSProperties } from "react";
import type { BrickStyleDefinition, TableDividers } from "@facet/core";
import { collapseClass, collapseItemClass } from "./collapse-style.js";
import {
  INTERACTION_CLASS,
  interactionClass,
  interactionVariable,
  type InteractionProperty,
  type InteractionState,
} from "./interaction-style.js";
import { STICKY_TOP, TABLE_STICKY_HEADER_Z, rootContainmentStyle } from "./layout-contract.js";
import { projectSurface, projectTypography } from "./style-projection.js";
import { boxStyle, mediaStyle, textStyle, type ResolvedTheme } from "./theme.js";
import { projectWidthStyle } from "./width-style.js";

type BoxDefinition = BrickStyleDefinition<"box">;
type TextDefinition = BrickStyleDefinition<"text">;
type MediaDefinition = BrickStyleDefinition<"media">;
type TableDefinition = BrickStyleDefinition<"table">;

type TableCaptionDefinition = NonNullable<TableDefinition["caption"]>;
type TableHeaderDefinition = NonNullable<TableDefinition["header"]>;
type TableRowDefinition = NonNullable<TableDefinition["row"]>;
type TableCellDefinition = NonNullable<TableDefinition["cell"]>;

interface LayoutTargetStyle {
  readonly style: CSSProperties;
  readonly className?: string;
}

type InteractionValues = Partial<
  Readonly<Record<InteractionProperty, string | number | undefined>>
>;

function joinClasses(...values: readonly (string | undefined)[]): string | undefined {
  const classes = values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []);
  return classes.length === 0 ? undefined : [...new Set(classes)].join(" ");
}

function tableTargetPaintStyle(
  style: TableHeaderDefinition | TableCellDefinition,
  theme: ResolvedTheme,
): CSSProperties {
  const css = projectSurface(style, theme);
  delete css.borderColor;
  delete css.borderStyle;
  delete css.borderWidth;
  return css;
}

// Renderer-owned divider allocation over the closed `dividers` names, painted from
// the SAME resolved `borderColor`/`borderWidth` tokens the cell/header already
// carry (no new token scale, RISK-API-5). Absent/`rows`/`grid` keep today's
// horizontal row separator; `none` suppresses it; `grid` adds the vertical
// column separator.
function tableDividerStyle(
  style: TableHeaderDefinition | TableCellDefinition,
  theme: ResolvedTheme,
  dividers: TableDividers | undefined,
): CSSProperties {
  const css: CSSProperties = {};
  if (dividers !== "none") {
    if (style.borderColor !== undefined) css.borderBottomColor = theme.color[style.borderColor];
    if (style.borderWidth !== undefined) {
      css.borderBottomStyle = "solid";
      css.borderBottomWidth = theme.borderWidth[style.borderWidth];
    }
  }
  if (dividers === "grid") {
    if (style.borderColor !== undefined) css.borderRightColor = theme.color[style.borderColor];
    if (style.borderWidth !== undefined) {
      css.borderRightStyle = "solid";
      css.borderRightWidth = theme.borderWidth[style.borderWidth];
    }
  }
  return css;
}

function withoutLineClampDisplay(style: CSSProperties): CSSProperties {
  const css: CSSProperties = { ...style };
  delete css.display;
  delete css.overflow;
  delete css.textOverflow;
  delete (css as CSSProperties & { WebkitBoxOrient?: unknown }).WebkitBoxOrient;
  delete (css as CSSProperties & { WebkitLineClamp?: unknown }).WebkitLineClamp;
  return css;
}

export function tableTextContentTargetStyle(
  style: TableCaptionDefinition | TableHeaderDefinition | TableCellDefinition,
  theme: ResolvedTheme,
): CSSProperties {
  const typography = projectTypography(style, theme) as CSSProperties & {
    WebkitBoxOrient?: CSSProperties["WebkitBoxOrient"];
    WebkitLineClamp?: number;
  };
  const css: CSSProperties & {
    WebkitBoxOrient?: CSSProperties["WebkitBoxOrient"];
    WebkitLineClamp?: number;
  } = {
    minWidth: 0,
    maxWidth: "100%",
  };
  if (typography.display !== undefined) css.display = typography.display;
  if (typography.overflow !== undefined) css.overflow = typography.overflow;
  if (typography.WebkitBoxOrient !== undefined) css.WebkitBoxOrient = typography.WebkitBoxOrient;
  if (typography.WebkitLineClamp !== undefined) css.WebkitLineClamp = typography.WebkitLineClamp;
  return css;
}

function interactionValues(raw: unknown, theme: ResolvedTheme): InteractionValues {
  if (typeof raw !== "object" || raw === null) return {};
  const value = raw as Readonly<Record<string, unknown>>;
  return {
    background:
      typeof value.background === "string"
        ? theme.color[value.background as keyof typeof theme.color]
        : undefined,
    color:
      typeof value.color === "string"
        ? theme.color[value.color as keyof typeof theme.color]
        : undefined,
    borderColor:
      typeof value.borderColor === "string"
        ? theme.color[value.borderColor as keyof typeof theme.color]
        : undefined,
    borderWidth:
      typeof value.borderWidth === "string"
        ? theme.borderWidth[value.borderWidth as keyof typeof theme.borderWidth]
        : undefined,
    shadow:
      typeof value.shadow === "string"
        ? theme.shadow[value.shadow as keyof typeof theme.shadow]
        : undefined,
  };
}

function withInteractionStates(
  base: CSSProperties,
  states: Partial<Readonly<Record<InteractionState, unknown>>>,
  theme: ResolvedTheme,
): LayoutTargetStyle {
  const variables: Record<string, string | number> = {};
  const classes: string[] = [];
  for (const state of ["hover", "pressed", "focus"] as const) {
    const values = interactionValues(states[state], theme);
    for (const property of [
      "background",
      "color",
      "borderColor",
      "borderWidth",
      "shadow",
    ] as const) {
      const value = values[property];
      if (value === undefined) continue;
      variables[interactionVariable(state, property)] = value;
      classes.push(interactionClass(state, property));
    }
  }
  const style = { ...base, ...variables } as CSSProperties;
  const className = joinClasses(INTERACTION_CLASS, ...classes);
  return className === undefined ? { style } : { style, className };
}

export function layoutBoxTargetStyle(
  style: BoxDefinition,
  theme: ResolvedTheme,
): LayoutTargetStyle {
  const css = boxStyle(style, theme);
  // Horizontal/vertical containment is renderer-owned, but it must not erase
  // the Brick's closed maxWidth choice when both are present.
  if (style.maxWidth !== undefined) css.maxWidth = theme.maxWidth[style.maxWidth];
  const interaction = withInteractionStates(css, style, theme);
  // The collapse markers ride the SAME class channel as INTERACTION_CLASS: the
  // row marker (collapseClass, R7) and the basis-item marker (collapseItemClass,
  // R8b) are both computed from this post-active resolved style and joined next
  // to the interaction classes. Both are `undefined` on a non-collapsing box, so
  // a collapse-free box stays byte-identical (joinClasses drops the undefineds).
  const className = joinClasses(
    interaction.className,
    collapseClass(style),
    collapseItemClass(style),
  );
  return className === undefined
    ? { style: interaction.style }
    : { style: interaction.style, className };
}

export function layoutTextTargetStyle(style: TextDefinition, theme: ResolvedTheme): CSSProperties {
  return textStyle(style, theme);
}

export function layoutMediaTargetStyle(
  style: MediaDefinition,
  theme: ResolvedTheme,
): CSSProperties {
  return mediaStyle(style, theme);
}

export function tableRootTargetStyle(style: TableDefinition, theme: ResolvedTheme): CSSProperties {
  // The visible table frame (surface + authored width), bounded to its parent.
  // The horizontal (and, for a sticky header, vertical) scroll is owned by the
  // renderer's inner containment wrapper (`tableScrollContainmentStyle`), NOT this
  // root — so a sticky header can pin against that wrapper's scroll region.
  // The root still CLIPS: a rounded frame only rounds its children when its own
  // overflow is not visible, otherwise header and row paint squares over the
  // corners. `hidden` clips without making this element the scrollport.
  return rootContainmentStyle({
    ...projectWidthStyle(style.width),
    ...projectSurface(style, theme),
    overflow: "hidden",
  });
}

/**
 * A pinned `<thead>` cell: `position:sticky` at the framework top, a confined
 * local positive z, and an OPAQUE background so scrolled body rows never show
 * through. The background is the resolved header background, falling back to the
 * table root background, then the theme surface. Container-relative pinning
 * against the table's own scroll region (RISK-INV-1) — no author z/inset/height.
 */
export function tableStickyHeaderCellStyle(
  rootStyle: TableDefinition,
  headerStyle: TableHeaderDefinition,
  theme: ResolvedTheme,
): CSSProperties {
  const background =
    headerStyle.background !== undefined
      ? theme.color[headerStyle.background]
      : rootStyle.background !== undefined
        ? theme.color[rootStyle.background]
        : theme.color.surface;
  return {
    position: "sticky",
    top: STICKY_TOP,
    zIndex: TABLE_STICKY_HEADER_Z,
    background,
  };
}

export function tableCaptionTargetStyle(
  style: TableCaptionDefinition,
  theme: ResolvedTheme,
): CSSProperties {
  // Shell/content split (the 636caa9 th/td treatment): a clamp's -webkit-box
  // display must never land on <caption> — overriding display:table-caption
  // re-wraps the caption as an anonymous table row. The clamp lives on the
  // inner content span (tableTextContentTargetStyle).
  const css: CSSProperties = {
    ...withoutLineClampDisplay(projectTypography(style, theme)),
  };
  if (style.padding !== undefined) css.padding = theme.space[style.padding];
  if (style.background !== undefined) css.background = theme.color[style.background];
  return rootContainmentStyle(css);
}

function tableHeaderBaseStyle(
  style: TableHeaderDefinition,
  theme: ResolvedTheme,
  dividers: TableDividers | undefined,
): CSSProperties {
  const typography = projectTypography(style, theme);
  const shellTypography = withoutLineClampDisplay(typography);
  const css: CSSProperties = {
    ...shellTypography,
    ...tableTargetPaintStyle(style, theme),
    ...tableDividerStyle(style, theme, dividers),
    whiteSpace: typography.whiteSpace ?? "nowrap",
    overflowWrap: typography.overflowWrap ?? "normal",
    verticalAlign: "bottom",
  };
  if (style.padding !== undefined) css.padding = theme.space[style.padding];
  return rootContainmentStyle(css);
}

export function tableHeaderTargetStyle(
  style: TableHeaderDefinition,
  theme: ResolvedTheme,
  sorted: boolean,
  dividers?: TableDividers,
): LayoutTargetStyle {
  const sortedStyle = sorted && style.sorted !== undefined ? style.sorted : {};
  const base = {
    ...tableHeaderBaseStyle(style, theme, dividers),
    ...projectTypography(sortedStyle, theme),
    ...tableTargetPaintStyle(sortedStyle, theme),
  };
  return withInteractionStates(base, style, theme);
}

function tableRowDirectStyle(style: TableRowDefinition, theme: ResolvedTheme): CSSProperties {
  return rootContainmentStyle(projectSurface(style, theme));
}

export function tableRowTargetStyle(
  style: TableRowDefinition,
  theme: ResolvedTheme,
  alternate: boolean,
): LayoutTargetStyle {
  const base = {
    ...tableRowDirectStyle(style, theme),
    ...(alternate && style.alternate !== undefined
      ? tableRowDirectStyle(style.alternate as TableRowDefinition, theme)
      : {}),
  };
  return withInteractionStates(base, { hover: style.hover }, theme);
}

export function tableCellTargetStyle(
  style: TableCellDefinition,
  theme: ResolvedTheme,
  dividers?: TableDividers,
): CSSProperties {
  const typography = projectTypography(style, theme);
  const shellTypography = withoutLineClampDisplay(typography);
  const css: CSSProperties = {
    ...shellTypography,
    ...tableTargetPaintStyle(style, theme),
    ...tableDividerStyle(style, theme, dividers),
    whiteSpace: typography.whiteSpace ?? "nowrap",
    overflowWrap: typography.overflowWrap ?? "normal",
    verticalAlign: "top",
  };
  if (style.padding !== undefined) css.padding = theme.space[style.padding];
  return rootContainmentStyle(css);
}

export function tableEmptyCellTargetStyle(
  style: TableCellDefinition,
  theme: ResolvedTheme,
  dividers?: TableDividers,
): CSSProperties {
  return {
    ...tableCellTargetStyle(style, theme, dividers),
    color: theme.color.mutedForeground,
    fontStyle: "italic",
    textAlign: "center",
  };
}
