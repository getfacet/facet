import type { CSSProperties } from "react";
import { RECIPE_PARTS } from "@facet/core";
import type { BrickRecipe, BrickRecipePart, RecipePartName } from "@facet/core";
import { boxStyle, fieldStyle, mediaStyle, textStyle } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";

export interface ResolvedRecipePart {
  readonly box?: CSSProperties;
  readonly text?: CSSProperties;
  readonly media?: CSSProperties;
  readonly field?: CSSProperties;
}

const EMPTY_PART: ResolvedRecipePart = Object.freeze({});
const RECIPE_PART_NAMES: ReadonlySet<string> = new Set(RECIPE_PARTS);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRecipePartName(value: unknown): value is RecipePartName {
  return typeof value === "string" && RECIPE_PART_NAMES.has(value);
}

function safeOwnValue(record: Record<string, unknown>, key: string): unknown {
  try {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
    return record[key];
  } catch {
    return undefined;
  }
}

function recipeStyleBundle<Key extends keyof BrickRecipePart>(
  part: Record<string, unknown>,
  key: Key,
): BrickRecipePart[Key] | undefined {
  const value = safeOwnValue(part, key);
  return isObjectRecord(value) ? (value as BrickRecipePart[Key]) : undefined;
}

export function resolveRecipePart(
  recipe: BrickRecipe | undefined,
  partName: unknown,
  theme: ResolvedTheme,
): ResolvedRecipePart {
  if (recipe === undefined || !isRecipePartName(partName)) return EMPTY_PART;
  const parts = isObjectRecord(recipe.parts) ? recipe.parts : undefined;
  if (parts === undefined) return EMPTY_PART;
  const part = safeOwnValue(parts, partName);
  if (!isObjectRecord(part)) return EMPTY_PART;

  const box = recipeStyleBundle(part, "box");
  const text = recipeStyleBundle(part, "text");
  const media = recipeStyleBundle(part, "media");
  const field = recipeStyleBundle(part, "field");
  if (box === undefined && text === undefined && media === undefined && field === undefined) {
    return EMPTY_PART;
  }

  const resolved: {
    box?: CSSProperties;
    text?: CSSProperties;
    media?: CSSProperties;
    field?: CSSProperties;
  } = {};
  if (box !== undefined) resolved.box = boxStyle(box, theme);
  if (text !== undefined) resolved.text = textStyle(text, theme);
  if (media !== undefined) resolved.media = mediaStyle(media, theme);
  if (field !== undefined) resolved.field = fieldStyle(field, theme);
  return resolved;
}
