import type { CSSProperties } from "react";
import {
  INPUT_KINDS,
  MAX_FIELD_OPTIONS,
  MAX_FIELD_VALUE_CHARS,
  MAX_TABLE_CELL_CHARS,
  type BoxStyle,
  type ComponentRecipe,
  type NodeId,
  type RecipeComponentName,
  type RecipePartName,
  type TextStyle,
} from "@facet/core";
import { boxStyle, resolveRecipe, textStyle } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";
import { resolveRecipePart } from "./recipe-parts.js";
import { rootContainmentStyle } from "./layout-contract.js";

export const MAX_INTRINSIC_ITEMS = 32;

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeOwnValue(record: unknown, key: string): unknown {
  if (!isObjectRecord(record)) return undefined;
  try {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
    return record[key];
  } catch {
    return undefined;
  }
}

export function cappedArray(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  try {
    return value.slice(0, max);
  } catch {
    return [];
  }
}

export function styleOf<T extends object>(style: unknown): T | undefined {
  return isObjectRecord(style) ? (style as T) : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function cappedString(value: unknown, max: number): string | undefined {
  const text = stringValue(value);
  return text === undefined ? undefined : text.slice(0, max);
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function virtualFieldId(nodeId: NodeId, name: string): string {
  return `${String(nodeId.length)}:${nodeId}${name}`;
}

export function isFieldInput(input: unknown): input is (typeof INPUT_KINDS)[number] {
  return typeof input === "string" && (INPUT_KINDS as readonly string[]).includes(input);
}

export function optionsOf(options: unknown): readonly string[] {
  const kept: string[] = [];
  for (const option of cappedArray(options, MAX_FIELD_OPTIONS)) {
    if (typeof option === "string") {
      kept.push(option.slice(0, MAX_FIELD_VALUE_CHARS));
    }
  }
  return kept;
}

export function scalarString(value: unknown): string | undefined {
  if (typeof value === "string") return value.slice(0, MAX_FIELD_VALUE_CHARS);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function defaultInputForOptions(
  input: unknown,
  options: readonly string[],
): (typeof INPUT_KINDS)[number] {
  if (isFieldInput(input)) return input;
  return options.length > 0 ? "select" : "text";
}

export function tableCellText(value: unknown): string {
  const text =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
  return text.slice(0, MAX_TABLE_CELL_CHARS);
}

export function textAlignStyle(align: unknown): CSSProperties["textAlign"] | undefined {
  switch (align) {
    case "start":
      return "left";
    case "center":
      return "center";
    case "end":
      return "right";
    default:
      return undefined;
  }
}

export function clampProgress(value: unknown): number {
  const numeric = finiteNumber(value);
  if (numeric === undefined) return 0;
  return Math.min(100, Math.max(0, numeric));
}

export function withInert(style: CSSProperties, inert: boolean): CSSProperties {
  return inert ? { ...style, pointerEvents: "none" } : style;
}

export function componentRecipe(
  theme: ResolvedTheme,
  component: RecipeComponentName,
  variant: unknown,
  tone?: unknown,
): ComponentRecipe {
  return resolveRecipe(theme, component, variant, tone);
}

export function componentBoxStyle(
  theme: ResolvedTheme,
  recipe: ComponentRecipe,
  defaults: BoxStyle,
): CSSProperties {
  return boxStyle({ ...defaults, ...(recipe.box ?? {}) }, theme);
}

export function componentTextStyle(
  theme: ResolvedTheme,
  recipe: ComponentRecipe,
  defaults: TextStyle,
  partName?: RecipePartName,
): CSSProperties {
  const base = textStyle({ ...defaults, ...(recipe.text ?? {}) }, theme);
  if (partName === undefined) return base;
  const part = resolveRecipePart(recipe, partName, theme);
  return part.text === undefined ? base : { ...base, ...part.text };
}

export function partBoxStyle(
  theme: ResolvedTheme,
  recipe: ComponentRecipe,
  partName: RecipePartName,
  defaults: BoxStyle = {},
): CSSProperties {
  const base = boxStyle(defaults, theme);
  const part = resolveRecipePart(recipe, partName, theme);
  return part.box === undefined ? base : { ...base, ...part.box };
}

export function partTextStyle(
  theme: ResolvedTheme,
  recipe: ComponentRecipe,
  partName: RecipePartName,
  defaults: TextStyle = {},
): CSSProperties {
  const base = textStyle(defaults, theme);
  const part = resolveRecipePart(recipe, partName, theme);
  return part.text === undefined ? base : { ...base, ...part.text };
}

export function intrinsicBoxStyle(style: CSSProperties | undefined): CSSProperties {
  if (style === undefined) return {};
  const css: CSSProperties = { ...style };
  delete css.display;
  delete css.flexDirection;
  delete css.flexWrap;
  delete css.gap;
  delete css.alignItems;
  delete css.justifyContent;
  delete css.flexGrow;
  delete css.width;
  delete css.minWidth;
  delete css.maxWidth;
  delete css.overflowX;
  delete css.overflowY;
  delete css.maxHeight;
  delete css.minHeight;
  return rootContainmentStyle(css);
}

export function fieldControlStyle(theme: ResolvedTheme, recipe: ComponentRecipe): CSSProperties {
  const control = resolveRecipePart(recipe, "control", theme);
  const input = resolveRecipePart(recipe, "input", theme);
  const css: CSSProperties = {
    boxSizing: "border-box",
    background: theme.color.surface,
    color: theme.color.fg,
    border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.sm,
    padding: `${theme.space.sm} ${theme.space.md}`,
    font: "inherit",
    lineHeight: 1.4,
    minHeight: "40px",
    outline: "none",
    width: "100%",
    ...(intrinsicBoxStyle(control.box) ?? {}),
    ...(control.field ?? {}),
    ...(intrinsicBoxStyle(input.box) ?? {}),
    ...(input.field ?? {}),
  };
  return rootContainmentStyle(css);
}

export function fieldChoiceControlStyle(theme: ResolvedTheme): CSSProperties {
  return {
    accentColor: theme.color.accent,
  };
}

export function fieldChoiceOptionStyle(theme: ResolvedTheme): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: theme.space.sm,
    color: theme.color.fg,
    fontFamily: theme.fontFamily.sans,
    fontSize: theme.fontSize.md,
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
  };
}
