import type { CSSProperties } from "react";
import {
  BRICK_CONTRACT,
  isStyleValueAllowedForProperty,
  type BrickStyleDefinition,
  type InputKind,
  type InputStyle,
  type RichTextStyle,
} from "@facet/core";
import {
  INTERACTION_CLASS,
  INTERACTION_PROPERTIES,
  interactionClass,
  interactionVariable,
  type InteractionProperty,
  type InteractionState,
} from "./interaction-style.js";
import { rootContainmentStyle } from "./layout-contract.js";
import { resolveBrickStyle } from "./style-resolver.js";
import { projectSurface, projectTypography } from "./style-projection.js";
import type { ResolvedTheme } from "./theme.js";
import { safeOwnValue } from "./renderer-value-safety.js";
import { projectWidthStyle } from "./width-style.js";

type InputDefinition = BrickStyleDefinition<"input">;
type RichTextDefinition = BrickStyleDefinition<"richtext">;
type ColorName = keyof ResolvedTheme["color"];

export interface StyledBrickTarget {
  readonly className?: string | undefined;
  readonly style: CSSProperties;
}

export interface InputStylePresentation {
  readonly root: CSSProperties;
  readonly label: CSSProperties;
  readonly control: StyledBrickTarget;
  readonly indicator: StyledBrickTarget;
  readonly option: StyledBrickTarget;
}

export interface RichTextStylePresentation {
  readonly root: CSSProperties;
  readonly heading1: CSSProperties;
  readonly heading2: CSSProperties;
  readonly heading3: CSSProperties;
  readonly quote: CSSProperties;
  readonly code: CSSProperties;
  readonly link: StyledBrickTarget;
  readonly listMarker: CSSProperties;
}

function stateValue(
  property: string,
  value: unknown,
  theme: ResolvedTheme,
): string | number | undefined {
  if (typeof value !== "string") return undefined;
  if (property === "background" || property === "color" || property === "borderColor") {
    return theme.color[value as ColorName];
  }
  if (property === "borderWidth") {
    return theme.borderWidth[value as keyof ResolvedTheme["borderWidth"]];
  }
  if (property === "shadow") return theme.shadow[value as keyof ResolvedTheme["shadow"]];
  if (property === "highlight") return theme.highlight[value as keyof ResolvedTheme["highlight"]];
  if (property === "fontWeight")
    return theme.fontWeight[value as keyof ResolvedTheme["fontWeight"]];
  return undefined;
}

function ownEntries(value: unknown): readonly [string, unknown][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  try {
    return Object.entries(value);
  } catch {
    return [];
  }
}

function hasAllowedAuthoredInputRootProperty(
  value: unknown,
  property: "alignItems" | "direction",
): boolean {
  const contract = BRICK_CONTRACT.input.style.root.properties[property];
  const authored = safeOwnValue(value, property);
  return isStyleValueAllowedForProperty(property, contract, authored);
}

function hasAllowedPresetInputRootProperty(
  theme: ResolvedTheme,
  authoredStyle: unknown,
  property: "alignItems" | "direction",
): boolean {
  const presetName = safeOwnValue(authoredStyle, "preset");
  if (typeof presetName !== "string") return false;
  const inputPresets = safeOwnValue(theme.presets, "input");
  const preset = safeOwnValue(inputPresets, presetName);
  const presetStyle = safeOwnValue(preset, "style");
  return hasAllowedAuthoredInputRootProperty(presetStyle, property);
}

function hasAllowedThemeDefaultInputRootProperty(
  theme: ResolvedTheme,
  property: "alignItems" | "direction",
): boolean {
  const inputDefaults = safeOwnValue(theme.defaults, "input");
  return hasAllowedAuthoredInputRootProperty(inputDefaults, property);
}

function hasAllowedInputRootLayoutIntent(
  theme: ResolvedTheme,
  authoredStyle: unknown,
  property: "alignItems" | "direction",
): boolean {
  return (
    hasAllowedThemeDefaultInputRootProperty(theme, property) ||
    hasAllowedAuthoredInputRootProperty(authoredStyle, property) ||
    hasAllowedPresetInputRootProperty(theme, authoredStyle, property)
  );
}

function statePresentation(
  source: unknown,
  states: readonly InteractionState[],
  theme: ResolvedTheme,
): StyledBrickTarget {
  const classes: string[] = [];
  const custom: Record<string, string | number> = {};
  for (const state of states) {
    const stateStyle = (source as Record<string, unknown> | undefined)?.[state];
    for (const [property, token] of ownEntries(stateStyle)) {
      if (!(INTERACTION_PROPERTIES as readonly string[]).includes(property)) continue;
      const value = stateValue(property, token, theme);
      if (value === undefined) continue;
      classes.push(interactionClass(state, property as InteractionProperty));
      custom[interactionVariable(state, property as InteractionProperty)] = value;
    }
  }
  if (classes.length === 0) return { style: {} };
  return {
    className: [INTERACTION_CLASS, ...classes].join(" "),
    style: custom as CSSProperties,
  };
}

function namedStatePresentation(
  source: unknown,
  state: string,
  allowedProperties: readonly string[],
  theme: ResolvedTheme,
): StyledBrickTarget {
  const stateStyle = (source as Record<string, unknown> | undefined)?.[state];
  const classes: string[] = [];
  const custom: Record<string, string | number> = {};
  for (const [property, token] of ownEntries(stateStyle)) {
    if (!allowedProperties.includes(property)) continue;
    const value = stateValue(property, token, theme);
    if (value === undefined) continue;
    classes.push(`facet-${state}-${property}`);
    custom[`--facet-${state}-${property}`] = value;
  }
  return {
    ...(classes.length === 0 ? {} : { className: classes.join(" ") }),
    style: custom as CSSProperties,
  };
}

function placeholderPresentation(
  source: InputDefinition["placeholder"],
  theme: ResolvedTheme,
): StyledBrickTarget {
  const classes: string[] = [];
  const custom: Record<string, string> = {};
  if (source?.color !== undefined) {
    classes.push("facet-placeholder-color");
    custom["--facet-placeholder-color"] = theme.color[source.color];
  }
  if (source?.fontStyle !== undefined) {
    classes.push("facet-placeholder-fontStyle");
    custom["--facet-placeholder-fontStyle"] = source.fontStyle;
  }
  return {
    ...(classes.length === 0 ? {} : { className: classes.join(" ") }),
    style: custom as CSSProperties,
  };
}

export function joinStyleClasses(...values: readonly (string | undefined)[]): string | undefined {
  const joined = values.filter((value): value is string => value !== undefined && value !== "");
  return joined.length === 0 ? undefined : joined.join(" ");
}

/**
 * Fixed renderer selectors for pseudo-elements and checked browser state. The
 * author supplies only validated Theme-backed variables; no document value can
 * become selector text or a declaration name.
 */
export const INPUT_TARGET_CSS = [
  ".facet-placeholder-color::placeholder{color:var(--facet-placeholder-color)!important}",
  ".facet-placeholder-fontStyle::placeholder{font-style:var(--facet-placeholder-fontStyle)!important}",
  ".facet-checked-color:checked{color:var(--facet-checked-color)!important}",
  ".facet-checked-background:checked{background:var(--facet-checked-background)!important}",
  ".facet-checked-borderColor:checked{border-color:var(--facet-checked-borderColor)!important}",
  ".facet-option.facet-checked-color:has(>input:checked),option.facet-option.facet-checked-color:checked{color:var(--facet-checked-color)!important}",
  ".facet-option.facet-checked-fontWeight:has(>input:checked),option.facet-option.facet-checked-fontWeight:checked{font-weight:var(--facet-checked-fontWeight)!important}",
  ".facet-option.facet-hover-fontWeight:hover{font-weight:var(--facet-hover-fontWeight)!important}",
].join("\n");

export function resolveInputStylePresentation(
  theme: ResolvedTheme,
  authoredStyle: InputStyle | unknown,
  inputKind: InputKind,
): InputStylePresentation {
  const style = resolveBrickStyle(theme, "input", authoredStyle, { inputKind });
  const isBooleanField = inputKind === "checkbox" || inputKind === "switch";
  const authoredDirection = hasAllowedInputRootLayoutIntent(theme, authoredStyle, "direction");
  const authoredAlignItems = hasAllowedInputRootLayoutIntent(theme, authoredStyle, "alignItems");
  const root: CSSProperties = {
    display: "flex",
    flexDirection: isBooleanField && !authoredDirection ? "row" : (style.direction ?? "column"),
  };
  if (style.gap !== undefined) root.gap = theme.space[style.gap];
  if (isBooleanField && !authoredAlignItems) {
    root.alignItems = "center";
  } else if (style.alignItems !== undefined) {
    root.alignItems =
      style.alignItems === "start"
        ? "flex-start"
        : style.alignItems === "end"
          ? "flex-end"
          : style.alignItems;
  }
  Object.assign(root, projectWidthStyle(style.width));

  const controlValues = style.control;
  const controlBase: CSSProperties = {
    ...projectTypography(controlValues, theme),
    ...projectSurface(controlValues, theme),
    boxSizing: "border-box",
    minWidth: 0,
    maxWidth: "100%",
    outline: "none",
  };
  if (controlValues?.padding !== undefined)
    controlBase.padding = theme.space[controlValues.padding];
  if (controlValues?.controlHeight !== undefined)
    controlBase.minHeight = theme.controlHeight[controlValues.controlHeight];
  if (inputKind !== "checkbox" && inputKind !== "radio" && inputKind !== "switch") {
    controlBase.width = "100%";
  }
  const controlState = statePresentation(controlValues, ["hover", "focus"], theme);
  const placeholder = placeholderPresentation(style.placeholder, theme);

  const indicatorValues = style.indicator;
  const indicatorBase: CSSProperties = {
    ...projectSurface(indicatorValues, theme),
    ...projectTypography(indicatorValues, theme),
  };
  if (indicatorValues?.indicatorSize !== undefined) {
    const size = theme.indicatorSize[indicatorValues.indicatorSize];
    indicatorBase.width = size;
    indicatorBase.height = size;
    indicatorBase.minHeight = size;
    indicatorBase.flex = "0 0 auto";
  }
  const indicatorState = statePresentation(indicatorValues, ["focus"], theme);
  const indicatorChecked = namedStatePresentation(
    indicatorValues,
    "checked",
    ["color", "background", "borderColor"],
    theme,
  );
  const checkedBackground =
    indicatorChecked.style["--facet-checked-background" as keyof CSSProperties];
  if (typeof checkedBackground === "string") indicatorBase.accentColor = checkedBackground;

  const optionValues = style.option;
  const optionBase: CSSProperties = {
    ...projectTypography(optionValues, theme),
    display: inputKind === "select" ? undefined : "flex",
    alignItems: inputKind === "select" ? undefined : "center",
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
  };
  if (optionValues?.gap !== undefined) optionBase.gap = theme.space[optionValues.gap];
  const optionState = statePresentation(optionValues, ["hover"], theme);
  const optionHoverWeight = namedStatePresentation(optionValues, "hover", ["fontWeight"], theme);
  const optionChecked = namedStatePresentation(
    optionValues,
    "checked",
    ["color", "fontWeight"],
    theme,
  );

  return {
    root: rootContainmentStyle(root),
    label: projectTypography(style.label, theme),
    control: {
      className: joinStyleClasses(controlState.className, placeholder.className),
      style: { ...controlBase, ...controlState.style, ...placeholder.style },
    },
    indicator: {
      className: joinStyleClasses(indicatorState.className, indicatorChecked.className),
      style: { ...indicatorBase, ...indicatorState.style, ...indicatorChecked.style },
    },
    option: {
      className: joinStyleClasses(
        "facet-option",
        optionState.className,
        optionHoverWeight.className,
        optionChecked.className,
      ),
      style: {
        ...optionBase,
        ...optionState.style,
        ...optionHoverWeight.style,
        ...optionChecked.style,
      },
    },
  };
}

function quoteStyle(values: RichTextDefinition["quote"], theme: ResolvedTheme): CSSProperties {
  const css: CSSProperties = {
    ...projectTypography(values, theme),
    ...projectSurface(values, theme),
  };
  delete css.borderColor;
  delete css.borderWidth;
  delete css.borderRadius;
  delete css.boxShadow;
  if (values?.background !== undefined) css.background = theme.color[values.background];
  if (values?.padding !== undefined) css.padding = theme.space[values.padding];
  if (values?.borderColor !== undefined)
    css.borderInlineStartColor = theme.color[values.borderColor];
  if (values?.borderWidth !== undefined) {
    css.borderInlineStartStyle = "solid";
    css.borderInlineStartWidth = theme.borderWidth[values.borderWidth];
  }
  return css;
}

function codeStyle(values: RichTextDefinition["code"], theme: ResolvedTheme): CSSProperties {
  const css: CSSProperties = {
    ...projectTypography(values, theme),
    ...projectSurface(values, theme),
  };
  if (values?.padding !== undefined) css.padding = theme.space[values.padding];
  return css;
}

export function resolveRichTextStylePresentation(
  theme: ResolvedTheme,
  authoredStyle: RichTextStyle | unknown,
): RichTextStylePresentation {
  const style = resolveBrickStyle(theme, "richtext", authoredStyle);
  const linkState = statePresentation(style.link, ["hover", "pressed", "focus"], theme);
  const root: CSSProperties = {
    ...projectTypography(style, theme),
    display: "flex",
    flexDirection: "column",
  };
  if (style.blockGap !== undefined) root.gap = theme.space[style.blockGap];
  return {
    root: rootContainmentStyle(root),
    heading1: projectTypography(style.heading1, theme),
    heading2: projectTypography(style.heading2, theme),
    heading3: projectTypography(style.heading3, theme),
    quote: quoteStyle(style.quote, theme),
    code: codeStyle(style.code, theme),
    link: {
      className: linkState.className,
      style: {
        ...projectTypography(style.link, theme),
        textDecorationLine: "underline",
        ...linkState.style,
      },
    },
    listMarker: projectTypography(style.listMarker, theme),
  };
}
