import type { CSSProperties } from "react";
import type { BrickStyleDefinition } from "@facet/core";
import {
  INTERACTION_CLASS,
  interactionClass,
  interactionVariable,
  type InteractionProperty,
  type InteractionState,
} from "./interaction-style.js";
import { rootContainmentStyle, scrollContainmentStyle } from "./layout-contract.js";
import { projectSurface, projectTypography } from "./style-projection.js";
import { boxStyle, mediaStyle, textStyle, type ResolvedTheme } from "./theme.js";

type BoxDefinition = BrickStyleDefinition<"box">;
type TextDefinition = BrickStyleDefinition<"text">;
type MediaDefinition = BrickStyleDefinition<"media">;
type TableDefinition = BrickStyleDefinition<"table">;

type TableCaptionDefinition = NonNullable<TableDefinition["caption"]>;
type TableHeaderDefinition = NonNullable<TableDefinition["header"]>;
type TableRowDefinition = NonNullable<TableDefinition["row"]>;
type TableCellDefinition = NonNullable<TableDefinition["cell"]>;

export interface LayoutTargetStyle {
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
  return withInteractionStates(css, style, theme);
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
  const width: CSSProperties = style.width === "full" ? { width: "100%" } : {};
  return rootContainmentStyle({
    ...width,
    ...projectSurface(style, theme),
    ...scrollContainmentStyle("x"),
  });
}

export function tableCaptionTargetStyle(
  style: TableCaptionDefinition,
  theme: ResolvedTheme,
): CSSProperties {
  const css: CSSProperties = {
    ...projectTypography(style, theme),
  };
  if (style.padding !== undefined) css.padding = theme.space[style.padding];
  if (style.background !== undefined) css.background = theme.color[style.background];
  return rootContainmentStyle(css);
}

function tableHeaderBaseStyle(style: TableHeaderDefinition, theme: ResolvedTheme): CSSProperties {
  const css: CSSProperties = {
    ...projectTypography(style, theme),
    ...projectSurface(style, theme),
  };
  if (style.padding !== undefined) css.padding = theme.space[style.padding];
  return rootContainmentStyle(css);
}

export function tableHeaderTargetStyle(
  style: TableHeaderDefinition,
  theme: ResolvedTheme,
  sorted: boolean,
): LayoutTargetStyle {
  const sortedStyle = sorted && style.sorted !== undefined ? style.sorted : {};
  const base = {
    ...tableHeaderBaseStyle(style, theme),
    ...projectTypography(sortedStyle, theme),
    ...projectSurface(sortedStyle, theme),
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
): CSSProperties {
  const css: CSSProperties = {
    ...projectTypography(style, theme),
    ...projectSurface(style, theme),
  };
  if (style.padding !== undefined) css.padding = theme.space[style.padding];
  return rootContainmentStyle(css);
}
