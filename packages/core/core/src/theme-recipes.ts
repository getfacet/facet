import { isForbiddenKey, isPlainObject, nullMap, printableKey } from "./issues.js";

export const RECIPE_PARTS = [
  "label",
  "control",
  "input",
  "placeholder",
  "helpText",
  "errorText",
  "icon",
  "prefix",
  "suffix",
  "header",
  "title",
  "description",
  "body",
  "footer",
  "actions",
  "tabList",
  "tab",
  "activeTab",
  "panel",
  "table",
  "headerRow",
  "headerCell",
  "row",
  "cell",
  "chart",
  "plot",
  "axis",
  "series",
  "legend",
  "track",
  "fill",
  "value",
  "trend",
  "marker",
  "rule",
  "item",
  "itemTitle",
  "itemText",
] as const;

export type RecipePartName = (typeof RECIPE_PARTS)[number];

interface RecipePartIssueSink {
  push(issue: { readonly severity: "warning"; readonly message: string }): void;
}

const RECIPE_PART_NAMES: ReadonlySet<string> = new Set(RECIPE_PARTS);

export function isRecipePartName(value: string): value is RecipePartName {
  return RECIPE_PART_NAMES.has(value);
}

export function validateRecipeParts<T>(
  raw: unknown,
  path: string,
  issues: RecipePartIssueSink,
  validatePart: (raw: unknown, path: string) => T | undefined,
): Readonly<Partial<Record<RecipePartName, T>>> | undefined {
  if (!isPlainObject(raw)) {
    issues.push({ severity: "warning", message: `${path}: parts is not an object; ignored` });
    return undefined;
  }

  let keys: string[];
  try {
    keys = Object.keys(raw);
  } catch {
    issues.push({ severity: "warning", message: `${path}: parts could not be read; ignored` });
    return undefined;
  }

  const out = nullMap<T>();
  for (const key of keys) {
    if (isForbiddenKey(key)) {
      issues.push({
        severity: "warning",
        message: `${path}: forbidden part "${printableKey(key)}" dropped`,
      });
      continue;
    }
    if (!isRecipePartName(key)) {
      issues.push({
        severity: "warning",
        message: `${path}: unsupported part "${printableKey(key)}" dropped`,
      });
      continue;
    }

    let partRaw: unknown;
    try {
      partRaw = raw[key];
    } catch {
      issues.push({
        severity: "warning",
        message: `${path}.${key}: part threw during validation; ignored`,
      });
      continue;
    }

    let part: T | undefined;
    try {
      part = validatePart(partRaw, `${path}.${key}`);
    } catch {
      issues.push({
        severity: "warning",
        message: `${path}.${key}: part threw during validation; ignored`,
      });
      continue;
    }
    if (part !== undefined) out[key] = part;
  }

  return Object.keys(out).length > 0
    ? (out as Readonly<Partial<Record<RecipePartName, T>>>)
    : undefined;
}
