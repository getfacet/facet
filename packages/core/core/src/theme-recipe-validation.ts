import {
  ALIGNS,
  APPEARS,
  COLORS,
  COLUMNS,
  DIRECTIONS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  JUSTIFIES,
  RADII,
  RATIOS,
  SCROLL_AXES,
  SHADOWS,
  SIZINGS,
  SPACES,
  TEXT_ALIGNS,
} from "./tokens.js";
import { isForbiddenKey, isPlainObject, nullMap, printableKey } from "./issues.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import { validateRecipeParts } from "./theme-recipes.js";
import { IssueList } from "./theme-issues.js";
import {
  booleanValue,
  recipeStyleObject,
  tokenValue,
  warnUnknownStyleKeys,
} from "./theme-token-validation.js";
import { RECIPE_COMPONENTS } from "./theme-types.js";
import type {
  ComponentRecipe,
  ComponentRecipePart,
  ComponentRecipes,
  RecipeBoxStyle,
  RecipeComponentName,
  RecipeFieldStyle,
  RecipeMediaStyle,
  RecipeTextStyle,
} from "./theme-types.js";

const RECIPE_BOX_STYLE_KEYS = new Set([
  "direction",
  "gap",
  "pad",
  "align",
  "justify",
  "wrap",
  "bg",
  "radius",
  "border",
  "grow",
  "width",
  "appear",
  "scroll",
  "columns",
  "shadow",
]);

function validateRecipeBoxStyle(
  raw: unknown,
  path: string,
  issues: IssueList,
): RecipeBoxStyle | undefined {
  const input = recipeStyleObject(raw, path, issues);
  if (input === undefined) return undefined;
  warnUnknownStyleKeys(input, RECIPE_BOX_STYLE_KEYS, path, issues);
  const out: Record<string, unknown> = nullMap<unknown>();
  if (input.direction !== undefined) {
    const value = tokenValue(input.direction, DIRECTIONS, `${path}.direction`, issues);
    if (value !== undefined) out.direction = value;
  }
  if (input.gap !== undefined) {
    const value = tokenValue(input.gap, SPACES, `${path}.gap`, issues);
    if (value !== undefined) out.gap = value;
  }
  if (input.pad !== undefined) {
    const value = tokenValue(input.pad, SPACES, `${path}.pad`, issues);
    if (value !== undefined) out.pad = value;
  }
  if (input.align !== undefined) {
    const value = tokenValue(input.align, ALIGNS, `${path}.align`, issues);
    if (value !== undefined) out.align = value;
  }
  if (input.justify !== undefined) {
    const value = tokenValue(input.justify, JUSTIFIES, `${path}.justify`, issues);
    if (value !== undefined) out.justify = value;
  }
  if (input.wrap !== undefined) {
    const value = booleanValue(input.wrap, `${path}.wrap`, issues);
    if (value !== undefined) out.wrap = value;
  }
  if (input.bg !== undefined) {
    const value = tokenValue(input.bg, COLORS, `${path}.bg`, issues);
    if (value !== undefined) out.bg = value;
  }
  if (input.radius !== undefined) {
    const value = tokenValue(input.radius, RADII, `${path}.radius`, issues);
    if (value !== undefined) out.radius = value;
  }
  if (input.border !== undefined) {
    const value = booleanValue(input.border, `${path}.border`, issues);
    if (value !== undefined) out.border = value;
  }
  if (input.grow !== undefined) {
    const value = booleanValue(input.grow, `${path}.grow`, issues);
    if (value !== undefined) out.grow = value;
  }
  if (input.width !== undefined) {
    const value = tokenValue(input.width, SIZINGS, `${path}.width`, issues);
    if (value !== undefined) out.width = value;
  }
  if (input.appear !== undefined) {
    const value = tokenValue(input.appear, APPEARS, `${path}.appear`, issues);
    if (value !== undefined) out.appear = value;
  }
  if (input.scroll !== undefined) {
    if (input.scroll === true) {
      out.scroll = true;
    } else {
      const value = tokenValue(input.scroll, SCROLL_AXES, `${path}.scroll`, issues);
      if (value !== undefined) out.scroll = value;
    }
  }
  if (input.columns !== undefined) {
    const value = tokenValue(input.columns, COLUMNS, `${path}.columns`, issues);
    if (value !== undefined) out.columns = value;
  }
  if (input.shadow !== undefined) {
    const value = tokenValue(input.shadow, SHADOWS, `${path}.shadow`, issues);
    if (value !== undefined) out.shadow = value;
  }
  return Object.keys(out).length > 0 ? (out as RecipeBoxStyle) : undefined;
}

const RECIPE_TEXT_STYLE_KEYS = new Set(["family", "size", "weight", "color", "align"]);

function validateRecipeTextStyle(
  raw: unknown,
  path: string,
  issues: IssueList,
): RecipeTextStyle | undefined {
  const input = recipeStyleObject(raw, path, issues);
  if (input === undefined) return undefined;
  warnUnknownStyleKeys(input, RECIPE_TEXT_STYLE_KEYS, path, issues);
  const out: Record<string, unknown> = nullMap<unknown>();
  if (input.family !== undefined) {
    const value = tokenValue(input.family, FONT_FAMILIES, `${path}.family`, issues);
    if (value !== undefined) out.family = value;
  }
  if (input.size !== undefined) {
    const value = tokenValue(input.size, FONT_SIZES, `${path}.size`, issues);
    if (value !== undefined) out.size = value;
  }
  if (input.weight !== undefined) {
    const value = tokenValue(input.weight, FONT_WEIGHTS, `${path}.weight`, issues);
    if (value !== undefined) out.weight = value;
  }
  if (input.color !== undefined) {
    const value = tokenValue(input.color, COLORS, `${path}.color`, issues);
    if (value !== undefined) out.color = value;
  }
  if (input.align !== undefined) {
    const value = tokenValue(input.align, TEXT_ALIGNS, `${path}.align`, issues);
    if (value !== undefined) out.align = value;
  }
  return Object.keys(out).length > 0 ? (out as RecipeTextStyle) : undefined;
}

const RECIPE_MEDIA_STYLE_KEYS = new Set(["radius", "width", "ratio"]);

function validateRecipeMediaStyle(
  raw: unknown,
  path: string,
  issues: IssueList,
): RecipeMediaStyle | undefined {
  const input = recipeStyleObject(raw, path, issues);
  if (input === undefined) return undefined;
  warnUnknownStyleKeys(input, RECIPE_MEDIA_STYLE_KEYS, path, issues);
  const out: Record<string, unknown> = nullMap<unknown>();
  if (input.radius !== undefined) {
    const value = tokenValue(input.radius, RADII, `${path}.radius`, issues);
    if (value !== undefined) out.radius = value;
  }
  if (input.width !== undefined) {
    const value = tokenValue(input.width, SIZINGS, `${path}.width`, issues);
    if (value !== undefined) out.width = value;
  }
  if (input.ratio !== undefined) {
    const value = tokenValue(input.ratio, RATIOS, `${path}.ratio`, issues);
    if (value !== undefined) out.ratio = value;
  }
  return Object.keys(out).length > 0 ? (out as RecipeMediaStyle) : undefined;
}

const RECIPE_FIELD_STYLE_KEYS = new Set(["width"]);

function validateRecipeFieldStyle(
  raw: unknown,
  path: string,
  issues: IssueList,
): RecipeFieldStyle | undefined {
  const input = recipeStyleObject(raw, path, issues);
  if (input === undefined) return undefined;
  warnUnknownStyleKeys(input, RECIPE_FIELD_STYLE_KEYS, path, issues);
  const out: Record<string, unknown> = nullMap<unknown>();
  if (input.width !== undefined) {
    const value = tokenValue(input.width, SIZINGS, `${path}.width`, issues);
    if (value !== undefined) out.width = value;
  }
  return Object.keys(out).length > 0 ? (out as RecipeFieldStyle) : undefined;
}

const COMPONENT_RECIPE_PART_KEYS = new Set(["box", "text", "media", "field"]);
const COMPONENT_RECIPE_KEYS = new Set([...COMPONENT_RECIPE_PART_KEYS, "parts"]);

function recipeObject(
  raw: unknown,
  path: string,
  issues: IssueList,
): Record<string, unknown> | undefined {
  if (!isPlainObject(raw)) {
    issues.push({ severity: "warning", message: `${path}: recipe is not an object; ignored` });
    return undefined;
  }
  return raw;
}

function assignRecipeStyleBundles(
  input: Record<string, unknown>,
  out: Record<string, unknown>,
  path: string,
  issues: IssueList,
  knownKeys: ReadonlySet<string>,
): void {
  for (const key of Object.keys(input)) {
    if (isForbiddenKey(key)) {
      issues.push({
        severity: "warning",
        message: `${path}: forbidden key "${printableKey(key)}" dropped`,
      });
      continue;
    }
    if (!knownKeys.has(key)) {
      issues.push({
        severity: "warning",
        message: `${path}: unknown recipe key "${printableKey(key)}" dropped`,
      });
    }
  }
  if (input.box !== undefined) {
    const box = validateRecipeBoxStyle(input.box, `${path}.box`, issues);
    if (box !== undefined) out.box = box;
  }
  if (input.text !== undefined) {
    const text = validateRecipeTextStyle(input.text, `${path}.text`, issues);
    if (text !== undefined) out.text = text;
  }
  if (input.media !== undefined) {
    const media = validateRecipeMediaStyle(input.media, `${path}.media`, issues);
    if (media !== undefined) out.media = media;
  }
  if (input.field !== undefined) {
    const field = validateRecipeFieldStyle(input.field, `${path}.field`, issues);
    if (field !== undefined) out.field = field;
  }
}

function validateComponentRecipePart(
  raw: unknown,
  path: string,
  issues: IssueList,
): ComponentRecipePart | undefined {
  const input = recipeObject(raw, path, issues);
  if (input === undefined) return undefined;
  const out: Record<string, unknown> = nullMap<unknown>();
  assignRecipeStyleBundles(input, out, path, issues, COMPONENT_RECIPE_PART_KEYS);
  return Object.keys(out).length > 0 ? (out as ComponentRecipePart) : undefined;
}

function validateComponentRecipe(
  raw: unknown,
  path: string,
  issues: IssueList,
): ComponentRecipe | undefined {
  const input = recipeObject(raw, path, issues);
  if (input === undefined) return undefined;
  const out: Record<string, unknown> = nullMap<unknown>();
  assignRecipeStyleBundles(input, out, path, issues, COMPONENT_RECIPE_KEYS);
  if (input.parts !== undefined) {
    const parts = validateRecipeParts(input.parts, `${path}.parts`, issues, (partRaw, partPath) =>
      validateComponentRecipePart(partRaw, partPath, issues),
    );
    if (parts !== undefined) out.parts = parts;
  }
  return Object.keys(out).length > 0 ? (out as ComponentRecipe) : undefined;
}

function isRecipeComponentName(value: string): value is RecipeComponentName {
  return (RECIPE_COMPONENTS as readonly string[]).includes(value);
}

export function validateRecipes(raw: unknown, issues: IssueList): ComponentRecipes | undefined {
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "warning",
      message: `theme group "recipes" is not an object; ignored`,
    });
    return undefined;
  }
  const out = nullMap<Readonly<Record<string, ComponentRecipe>>>();
  for (const component of Object.keys(raw)) {
    if (isForbiddenKey(component)) {
      issues.push({
        severity: "warning",
        message: `theme "recipes": forbidden component "${printableKey(component)}" dropped`,
      });
      continue;
    }
    if (!isRecipeComponentName(component)) {
      issues.push({
        severity: "warning",
        message: `theme "recipes": unknown component "${printableKey(component)}" dropped`,
      });
      continue;
    }
    const variantsRaw = raw[component];
    if (!isPlainObject(variantsRaw)) {
      issues.push({
        severity: "warning",
        message: `theme "recipes.${component}" is not an object; ignored`,
      });
      continue;
    }
    const variants = nullMap<ComponentRecipe>();
    for (const variant of Object.keys(variantsRaw)) {
      if (isForbiddenKey(variant)) {
        issues.push({
          severity: "warning",
          message: `theme "recipes.${component}": forbidden variant "${printableKey(variant)}" dropped`,
        });
        continue;
      }
      if (!SLOT_NAME_RE.test(variant)) {
        issues.push({
          severity: "warning",
          message: `theme "recipes.${component}": malformed variant "${printableKey(variant)}" dropped`,
        });
        continue;
      }
      const recipe = validateComponentRecipe(
        variantsRaw[variant],
        `theme recipes.${component}.${variant}`,
        issues,
      );
      if (recipe !== undefined) variants[variant] = recipe;
    }
    if (Object.keys(variants).length > 0) out[component] = variants;
  }
  return Object.keys(out).length > 0 ? (out as ComponentRecipes) : undefined;
}

/** Parse a safe color value to sRGB channels [0,255]; else undefined. */
