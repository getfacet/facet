import type { CSSProperties } from "react";
import type {
  BoxStyle,
  BrickRecipe,
  RecipeBrickName,
  RecipePartName,
  TextStyle,
} from "@facet/core";
import { resolveRecipePart } from "./recipe-parts.js";
import { boxStyle, resolveRecipe, textStyle } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";

/** Renderer-private lookup for one brick's theme recipe. */
export function brickRecipe(
  theme: ResolvedTheme,
  brick: RecipeBrickName,
  variant: unknown,
  tone?: unknown,
): BrickRecipe {
  return resolveRecipe(theme, brick, variant, tone);
}

/** Renderer-private merge of a brick recipe over its structural box defaults. */
export function brickBoxStyle(
  theme: ResolvedTheme,
  recipe: BrickRecipe,
  defaults: BoxStyle,
): CSSProperties {
  return boxStyle({ ...defaults, ...(recipe.box ?? {}) }, theme);
}

/** Renderer-private text style with an optional named recipe-part overlay. */
export function brickTextStyle(
  theme: ResolvedTheme,
  recipe: BrickRecipe,
  defaults: TextStyle,
  partName?: RecipePartName,
): CSSProperties {
  const base = textStyle({ ...defaults, ...(recipe.text ?? {}) }, theme);
  if (partName === undefined) return base;
  const part = resolveRecipePart(recipe, partName, theme);
  return part.text === undefined ? base : { ...base, ...part.text };
}
