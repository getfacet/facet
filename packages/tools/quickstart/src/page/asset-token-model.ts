import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import {
  FACET_THEME_CONTRACT,
  facetThemeToKebabCase,
  themeToCssVars,
  themeTokenRef,
  themeTokenVar,
} from "@facet/core";
import type {
  FacetCatalog,
  FacetFoundationGroupName,
  FacetFoundationTokenRef,
  FacetSemanticGroupName,
  FacetSemanticTokenRef,
  FacetTheme,
  FacetThemeTokenValueKind,
  FacetThemeTokenValues,
} from "@facet/core";

export type AssetTokenLayer = "foundation" | "semantic" | "recipe";

export type AssetTokenVisualKind =
  | "color"
  | "length"
  | "number"
  | "opacity"
  | "typography"
  | "motion"
  | "shadow"
  | "effect"
  | "text";

export interface AssetTokenVisual {
  readonly kind: AssetTokenVisualKind;
  readonly value: string;
  readonly referencedVariables: readonly string[];
}

interface AssetTokenRowBase {
  readonly layer: AssetTokenLayer;
  readonly token: string;
  readonly path: string;
  readonly value: string;
  readonly kind: FacetThemeTokenValueKind;
  readonly cssVariable: string;
  readonly cssReference: string;
  readonly visual: AssetTokenVisual;
}

export interface FoundationAssetTokenRow extends AssetTokenRowBase {
  readonly layer: "foundation";
  readonly group: FacetFoundationGroupName;
}

export interface SemanticAssetTokenRow extends AssetTokenRowBase {
  readonly layer: "semantic";
  readonly group: FacetSemanticGroupName;
}

export interface RecipeAssetTokenRow extends AssetTokenRowBase {
  readonly layer: "recipe";
  readonly namespace: string;
}

export type AssetTokenRow = FoundationAssetTokenRow | SemanticAssetTokenRow | RecipeAssetTokenRow;

const EMPTY_TOKEN_VALUES = Object.freeze({}) as FacetThemeTokenValues;
const CSS_VAR_REF_PATTERN = /var\(\s*(--facet-[^) ,]+)\s*(?:,[^)]+)?\)/g;

export const DEFAULT_THEME_TOKEN_ROWS: readonly AssetTokenRow[] = deriveDefaultThemeTokenRows();
export const DEFAULT_THEME_CSS_VARS: Readonly<Record<string, string>> = themeToCssVars(
  DEFAULT_THEME,
  {
    catalog: DEFAULT_CATALOG,
  },
);

export function deriveDefaultThemeTokenRows(): readonly AssetTokenRow[] {
  return deriveThemeTokenRows(DEFAULT_THEME, DEFAULT_CATALOG);
}

function deriveThemeTokenRows(theme: FacetTheme, catalog: FacetCatalog): readonly AssetTokenRow[] {
  return Object.freeze([
    ...deriveFoundationRows(theme),
    ...deriveSemanticRows(theme),
    ...deriveRecipeRows(theme, catalog),
  ]);
}

function deriveFoundationRows(theme: FacetTheme): readonly FoundationAssetTokenRow[] {
  const foundation = theme.foundation as FacetThemeTokenValues;
  return FACET_THEME_CONTRACT.foundation.flatMap((group) => {
    const groupName = group.name as FacetFoundationGroupName;
    return group.tokens.map((tokenSpec) => {
      const tokenRef = {
        layer: "foundation",
        group: groupName,
        token: tokenSpec.name,
      } as FacetFoundationTokenRef;
      const value = readRequiredToken(foundation, group.name, tokenSpec.name);
      return freezeRow({
        layer: "foundation",
        group: groupName,
        token: tokenSpec.name,
        path: tokenPath("foundation", group.name, tokenSpec.name),
        value,
        kind: tokenSpec.kind,
        cssVariable: themeTokenVar(tokenRef),
        cssReference: themeTokenRef(tokenRef),
        visual: visualFor(tokenSpec.kind, value),
      });
    });
  });
}

function deriveSemanticRows(theme: FacetTheme): readonly SemanticAssetTokenRow[] {
  const semantic = theme.semantic as FacetThemeTokenValues;
  return FACET_THEME_CONTRACT.semantic.flatMap((group) => {
    const groupName = group.name as FacetSemanticGroupName;
    return group.tokens.map((tokenSpec) => {
      const tokenRef = {
        layer: "semantic",
        group: groupName,
        token: tokenSpec.name,
      } as FacetSemanticTokenRef;
      const value = readRequiredToken(semantic, group.name, tokenSpec.name);
      return freezeRow({
        layer: "semantic",
        group: groupName,
        token: tokenSpec.name,
        path: tokenPath("semantic", group.name, tokenSpec.name),
        value,
        kind: tokenSpec.kind,
        cssVariable: themeTokenVar(tokenRef),
        cssReference: themeTokenRef(tokenRef),
        visual: visualFor(tokenSpec.kind, value),
      });
    });
  });
}

function deriveRecipeRows(
  theme: FacetTheme,
  catalog: FacetCatalog,
): readonly RecipeAssetTokenRow[] {
  const recipes = theme.recipes ?? EMPTY_TOKEN_VALUES;
  return catalog.components.flatMap((spec) => {
    const tokens = spec.themeRecipe?.tokens;
    if (tokens === undefined) return [];
    const namespace = facetThemeToKebabCase(spec.tag);
    return Object.entries(tokens).map(([token, kind]) => {
      const value = readRequiredToken(recipes, namespace, token);
      const tokenRef = { layer: "recipe", namespace, token } as const;
      return freezeRow({
        layer: "recipe",
        namespace,
        token,
        path: tokenPath("recipe", namespace, token),
        value,
        kind,
        cssVariable: themeTokenVar(tokenRef),
        cssReference: themeTokenRef(tokenRef),
        visual: visualFor(kind, value),
      });
    });
  });
}

function readRequiredToken(groups: FacetThemeTokenValues, group: string, token: string): string {
  const values = groups[group];
  const value = values?.[token];
  if (value === undefined) {
    throw new Error(`Missing default theme token: ${group}.${token}`);
  }
  return value;
}

function tokenPath(layer: AssetTokenLayer, group: string, token: string): string {
  return `${layer}.${group}.${token}`;
}

function visualFor(kind: FacetThemeTokenValueKind, value: string): AssetTokenVisual {
  return Object.freeze({
    kind: visualKindFor(kind),
    value,
    referencedVariables: extractReferencedVariables(value),
  });
}

function visualKindFor(kind: FacetThemeTokenValueKind): AssetTokenVisualKind {
  switch (kind) {
    case "fontFamily":
    case "fontWeight":
    case "lineHeight":
      return "typography";
    case "duration":
    case "easing":
      return "motion";
    case "color":
    case "length":
    case "number":
    case "opacity":
    case "shadow":
    case "effect":
    case "text":
      return kind;
  }
}

function extractReferencedVariables(value: string): readonly string[] {
  const variables: string[] = [];
  for (const match of value.matchAll(CSS_VAR_REF_PATTERN)) {
    const variable = match[1];
    if (variable !== undefined && !variables.includes(variable)) {
      variables.push(variable);
    }
  }
  return Object.freeze(variables);
}

function freezeRow<Row extends AssetTokenRow>(row: Row): Row {
  return Object.freeze(row);
}
