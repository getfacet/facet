import {
  BRICK_CONTRACT,
  BRICK_TYPES,
  validatePatternList,
  validateTheme,
  type BrickType,
  type FacetPattern,
  type FacetTheme,
} from "@facet/core";
import type {
  BrickIndexEntry,
  PatternIndexEntry,
  PresetIndexEntry,
  StageToolAssets,
  StageToolAssetSource,
} from "./types.js";

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function exactTheme(source: StageToolAssetSource): FacetTheme {
  let raw: unknown;
  try {
    raw = source.theme;
  } catch {
    throw new TypeError("Stage tool Theme is invalid.");
  }
  const result = validateTheme(raw);
  if (result.theme === undefined) throw new TypeError("Stage tool Theme is invalid.");
  return result.theme;
}

function exactPatterns(source: StageToolAssetSource, theme: FacetTheme): readonly FacetPattern[] {
  let raw: unknown;
  try {
    raw = source.patterns;
  } catch {
    return [];
  }
  const validated = validatePatternList(raw, theme).patterns;
  const unique: FacetPattern[] = [];
  const names = new Set<string>();
  for (const pattern of validated) {
    if (names.has(pattern.name)) continue;
    names.add(pattern.name);
    unique.push(pattern);
  }
  return unique;
}

function brickIndex(): readonly BrickIndexEntry[] {
  return BRICK_TYPES.map((type) => ({
    type,
    description: BRICK_CONTRACT[type].description,
    useWhen: BRICK_CONTRACT[type].useWhen,
  }));
}

function presetIndex(theme: FacetTheme): readonly PresetIndexEntry[] {
  const entries: PresetIndexEntry[] = [];
  for (const brick of BRICK_TYPES) {
    const presets = theme.presets?.[brick] as
      | Readonly<Record<string, { readonly description: string; readonly useWhen: string }>>
      | undefined;
    if (presets === undefined) continue;
    for (const [name, preset] of Object.entries(presets)) {
      entries.push({
        brick: brick as BrickType,
        name,
        description: preset.description,
        useWhen: preset.useWhen,
      });
    }
  }
  return entries;
}

function patternIndex(patterns: readonly FacetPattern[]): readonly PatternIndexEntry[] {
  return patterns.map(({ name, description, useWhen }) => ({ name, description, useWhen }));
}

/**
 * Detaches, validates, indexes, and deeply freezes the exact assets used for
 * one provider turn. Concrete Theme values remain internal; agent-visible
 * indexes contain metadata and closed names only.
 */
export function createStageToolAssetSnapshot(source: StageToolAssetSource): StageToolAssets {
  const theme = exactTheme(source);
  const patterns = exactPatterns(source, theme);
  return deepFreeze({
    theme,
    patterns,
    brickIndex: brickIndex(),
    presetIndex: presetIndex(theme),
    patternIndex: patternIndex(patterns),
  });
}
