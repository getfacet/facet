/**
 * Theme value validation and CSS custom-property projection.
 *
 * Core owns the fixed foundation/semantic vocabulary and the generic mechanics
 * for component recipes and host extensions. Component sets own their recipe
 * declarations through `ComponentSpec.themeRecipe`; hosts own extension
 * declarations through bootstrap/session options.
 */

import type { FacetCatalog } from "./catalog.js";
import { isFacetIdentifier } from "./identifiers.js";
import type { ThemeRecipeSpec } from "./component-spec.js";
import {
  FACET_FOUNDATION_TOKEN_NAMES,
  FACET_SEMANTIC_TOKEN_NAMES,
  facetThemeToKebabCase,
  themeTokenVar,
} from "./theme-contract.js";
import type {
  FacetFoundationTheme,
  FacetSemanticTheme,
  FacetThemeTokenValueKind,
  FacetThemeTokenValues,
} from "./theme-contract.js";

export interface FacetTheme {
  readonly foundation: FacetFoundationTheme;
  readonly semantic: FacetSemanticTheme;
  readonly recipes?: FacetThemeTokenValues;
  readonly extensions?: FacetThemeTokenValues;
}

export interface FacetThemeExtensionDeclaration {
  readonly namespace: string;
  readonly tokens: Readonly<Record<string, FacetThemeTokenValueKind>>;
}

export interface FacetThemeValidationOptions {
  readonly catalog?: FacetCatalog;
  readonly extensions?: readonly FacetThemeExtensionDeclaration[];
}

export type ThemeValidationResult =
  | { readonly ok: true; readonly theme: FacetTheme }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

export type ThemeExtensionDeclarationValidationResult =
  | {
      readonly ok: true;
      readonly extensions: readonly FacetThemeExtensionDeclaration[];
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

type ThemeRejection = Extract<ThemeValidationResult, { readonly ok: false }>;
type ExtensionRejection = Extract<
  ThemeExtensionDeclarationValidationResult,
  { readonly ok: false }
>;

interface TokenDeclaration {
  readonly namespace: string;
  readonly tokens: Readonly<Record<string, FacetThemeTokenValueKind>>;
}

const THEME_KEYS: readonly string[] = ["extensions", "foundation", "recipes", "semantic"];
const EXTENSION_KEYS: readonly string[] = ["namespace", "tokens"];
const RESERVED_EXTENSION_NAMESPACES: readonly string[] = [
  "facet",
  "foundation",
  "semantic",
  "recipe",
  "recipes",
  "extension",
  "extensions",
  "ext",
];
const TOKEN_VALUE_KINDS: readonly FacetThemeTokenValueKind[] = [
  "color",
  "length",
  "number",
  "opacity",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "duration",
  "easing",
  "shadow",
  "effect",
  "text",
];
const FORBIDDEN_VALUE_PATTERN = /[;{}<>\\]/u;
const FORBIDDEN_CSS_FUNCTION_PATTERN = /\burl\s*\(|@import/iu;
const CONTROL_CHARACTER_CEILING = 0x20;
const DELETE_CHARACTER = 0x7f;

export function validateTheme(
  value: unknown,
  options: FacetThemeValidationOptions = {},
): ThemeValidationResult {
  try {
    return validateThemeShape(value, options);
  } catch {
    return reject("theme_read_failed", "", "Reading the theme threw; it must be plain data.");
  }
}

export function validateThemeExtensionDeclarations(
  value: unknown,
): ThemeExtensionDeclarationValidationResult {
  try {
    return validateExtensionDeclarations(value);
  } catch {
    return extensionReject(
      "theme_extensions_read_failed",
      "",
      "Reading theme extension declarations threw; they must be plain data.",
    );
  }
}

export function themeToCssVars(
  theme: FacetTheme,
  options: FacetThemeValidationOptions = {},
): Readonly<Record<string, string>> {
  try {
    const vars: Record<string, string> = {};
    const recipeDeclarationResult = recipeDeclarations(options.catalog);
    if (!recipeDeclarationResult.ok) {
      return Object.freeze({});
    }
    projectFixedLayer(vars, theme, "foundation", FACET_FOUNDATION_TOKEN_NAMES);
    projectFixedLayer(vars, theme, "semantic", FACET_SEMANTIC_TOKEN_NAMES);
    projectDeclaredLayer(
      vars,
      readGroup(theme, "recipes"),
      "recipe",
      recipeDeclarationResult.declarations ?? declarationsFromValues(readGroup(theme, "recipes")),
    );
    projectDeclaredLayer(
      vars,
      readGroup(theme, "extensions"),
      "extension",
      options.extensions ?? declarationsFromValues(readGroup(theme, "extensions")),
    );
    return Object.freeze(vars);
  } catch {
    return Object.freeze({});
  }
}

function validateThemeShape(
  value: unknown,
  options: FacetThemeValidationOptions,
): ThemeValidationResult {
  if (!isRecord(value)) {
    return reject("theme_not_an_object", "", "A theme must be a plain object.");
  }
  const unknownKey = Object.keys(value)
    .sort()
    .find((key) => !THEME_KEYS.includes(key));
  if (unknownKey !== undefined) {
    return reject(
      "unknown_token_group",
      unknownKey,
      "The theme contract is closed; it has no top-level group by this name.",
    );
  }

  const foundation = validateFixedLayer(
    value["foundation"],
    "foundation",
    FACET_FOUNDATION_TOKEN_NAMES,
  );
  if (!foundation.ok) return foundation;

  const semantic = validateFixedLayer(value["semantic"], "semantic", FACET_SEMANTIC_TOKEN_NAMES);
  if (!semantic.ok) return semantic;

  const recipeDeclarationResult = recipeDeclarations(options.catalog);
  if (!recipeDeclarationResult.ok) return recipeDeclarationResult;
  const recipes = validateDeclaredLayer(
    value["recipes"],
    "recipes",
    recipeDeclarationResult.declarations ?? [],
  );
  if (!recipes.ok) return recipes;

  const extensions = validateDeclaredLayer(
    value["extensions"],
    "extensions",
    options.extensions ?? [],
  );
  if (!extensions.ok) return extensions;

  const theme: FacetTheme = {
    foundation: foundation.values as FacetFoundationTheme,
    semantic: semantic.values as FacetSemanticTheme,
    ...(recipes.values === undefined ? {} : { recipes: recipes.values }),
    ...(extensions.values === undefined ? {} : { extensions: extensions.values }),
  };
  return { ok: true, theme: Object.freeze(theme) };
}

function validateFixedLayer<Table extends Readonly<Record<string, readonly string[]>>>(
  raw: unknown,
  layer: "foundation" | "semantic",
  table: Table,
):
  | {
      readonly ok: true;
      readonly values: Readonly<Record<string, Readonly<Record<string, string>>>>;
    }
  | ThemeRejection {
  if (!isRecord(raw)) {
    return reject("token_group_not_an_object", layer, "A theme layer must be a plain object.");
  }
  const groups = Object.keys(table);
  const unknownGroup = Object.keys(raw)
    .sort()
    .find((key) => !groups.includes(key));
  if (unknownGroup !== undefined) {
    return reject(
      "unknown_token_group",
      `${layer}.${unknownGroup}`,
      "The token contract is closed; it has no group by this name.",
    );
  }
  const values: Record<string, Readonly<Record<string, string>>> = {};
  for (const group of groups) {
    const groupResult = validateTokenGroup(raw[group], `${layer}.${group}`, table[group] ?? []);
    if (!groupResult.ok) return groupResult;
    values[group] = groupResult.tokens;
  }
  return { ok: true, values: Object.freeze(values) };
}

function validateDeclaredLayer(
  raw: unknown,
  layer: "recipes" | "extensions",
  declarations: readonly TokenDeclaration[],
): { readonly ok: true; readonly values: FacetThemeTokenValues | undefined } | ThemeRejection {
  if (raw === undefined) {
    return declarations.length === 0
      ? { ok: true, values: undefined }
      : reject("missing_token_group", layer, "The active theme contract requires this layer.");
  }
  if (!isRecord(raw)) {
    return reject("token_group_not_an_object", layer, "A theme layer must be a plain object.");
  }
  const namespaces = declarations.map((declaration) => declaration.namespace);
  const unknownNamespace = Object.keys(raw)
    .sort()
    .find((key) => !namespaces.includes(key));
  if (unknownNamespace !== undefined) {
    return reject(
      layer === "recipes" ? "unknown_recipe_namespace" : "unknown_extension_namespace",
      `${layer}.${unknownNamespace}`,
      "This theme layer accepts only declared namespaces.",
    );
  }
  const values: Record<string, Readonly<Record<string, string>>> = {};
  for (const declaration of declarations) {
    const tokenNames = Object.keys(declaration.tokens);
    const groupResult = validateTokenGroup(
      raw[declaration.namespace],
      `${layer}.${declaration.namespace}`,
      tokenNames,
    );
    if (!groupResult.ok) return groupResult;
    values[declaration.namespace] = groupResult.tokens;
  }
  return { ok: true, values: Object.freeze(values) };
}

function validateTokenGroup(
  raw: unknown,
  at: string,
  tokenNames: readonly string[],
): { readonly ok: true; readonly tokens: Readonly<Record<string, string>> } | ThemeRejection {
  if (!isRecord(raw)) {
    return reject("token_group_not_an_object", at, "A token group is a plain object.");
  }
  const unknownToken = Object.keys(raw)
    .sort()
    .find((key) => !tokenNames.includes(key));
  if (unknownToken !== undefined) {
    return reject(
      "unknown_token_name",
      `${at}.${unknownToken}`,
      "The token contract is closed; it has no token by this name.",
    );
  }
  const values: Record<string, string> = {};
  for (const token of tokenNames) {
    const location = `${at}.${token}`;
    if (!Object.hasOwn(raw, token)) {
      return reject("missing_token", location, "The token contract requires this token.");
    }
    const value = raw[token];
    if (typeof value !== "string") {
      return reject("token_not_a_string", location, "A token value is a CSS-ready string.");
    }
    if (value.trim().length === 0) {
      return reject("token_empty", location, "A token value must resolve to something.");
    }
    if (
      FORBIDDEN_VALUE_PATTERN.test(value) ||
      FORBIDDEN_CSS_FUNCTION_PATTERN.test(value) ||
      hasControlCharacter(value)
    ) {
      return reject(
        "token_value_not_allowed",
        location,
        "A token value may not contain declaration breakers, url(), @import, or control characters.",
      );
    }
    values[token] = value;
  }
  return { ok: true, tokens: Object.freeze(values) };
}

function validateExtensionDeclarations(value: unknown): ThemeExtensionDeclarationValidationResult {
  if (value === undefined) {
    return { ok: true, extensions: Object.freeze([]) };
  }
  if (!Array.isArray(value)) {
    return extensionReject(
      "theme_extensions_not_an_array",
      "themeExtensions",
      "Theme extension declarations must be an array.",
    );
  }
  const extensions: FacetThemeExtensionDeclaration[] = [];
  const projectedNamespaces = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const at = `themeExtensions[${index}]`;
    const declaration = validateExtensionDeclaration(entry, at, projectedNamespaces);
    if (!declaration.ok) return declaration;
    extensions.push(declaration.extension);
  }
  return { ok: true, extensions: Object.freeze(extensions) };
}

function validateExtensionDeclaration(
  value: unknown,
  at: string,
  projectedNamespaces: Set<string>,
): { readonly ok: true; readonly extension: FacetThemeExtensionDeclaration } | ExtensionRejection {
  if (!isRecord(value)) {
    return extensionReject(
      "theme_extension_not_an_object",
      at,
      "A theme extension is a plain object.",
    );
  }
  const unknownKey = Object.keys(value)
    .sort()
    .find((key) => !EXTENSION_KEYS.includes(key));
  if (unknownKey !== undefined) {
    return extensionReject(
      "unknown_theme_extension_key",
      `${at}.${unknownKey}`,
      "The theme extension declaration form is closed.",
    );
  }
  const namespace = value["namespace"];
  if (!isFacetIdentifier(namespace)) {
    return extensionReject(
      "invalid_theme_extension_namespace",
      `${at}.namespace`,
      "An extension namespace must be a Facet identifier.",
    );
  }
  if (RESERVED_EXTENSION_NAMESPACES.includes(namespace)) {
    return extensionReject(
      "reserved_theme_extension_namespace",
      `${at}.namespace`,
      "This namespace is reserved by Facet's theme contract.",
    );
  }
  const projectedNamespace = facetThemeToKebabCase(namespace);
  if (projectedNamespaces.has(projectedNamespace)) {
    return extensionReject(
      "duplicate_theme_extension_namespace",
      `${at}.namespace`,
      "Extension namespaces must not collide after CSS variable projection.",
    );
  }
  projectedNamespaces.add(projectedNamespace);
  const tokens = validateTokenDeclarationMap(value["tokens"], `${at}.tokens`);
  if (!tokens.ok) return tokens;
  return {
    ok: true,
    extension: Object.freeze({ namespace, tokens: tokens.tokens }),
  };
}

function validateTokenDeclarationMap(
  raw: unknown,
  at: string,
):
  | { readonly ok: true; readonly tokens: Readonly<Record<string, FacetThemeTokenValueKind>> }
  | ExtensionRejection {
  if (!isRecord(raw)) {
    return extensionReject(
      "invalid_theme_extension_tokens",
      at,
      "Extension tokens must be a plain object.",
    );
  }
  const projectedNames = new Set<string>();
  const tokens: Record<string, FacetThemeTokenValueKind> = {};
  for (const name of Object.keys(raw).sort()) {
    if (!isFacetIdentifier(name)) {
      return extensionReject(
        "invalid_theme_extension_token",
        `${at}.${name}`,
        "Extension token names must be Facet identifiers.",
      );
    }
    const projected = facetThemeToKebabCase(name);
    if (projectedNames.has(projected)) {
      return extensionReject(
        "duplicate_theme_extension_token",
        `${at}.${name}`,
        "Extension token names must not collide after CSS variable projection.",
      );
    }
    projectedNames.add(projected);
    const kind = raw[name];
    if (typeof kind !== "string" || !TOKEN_VALUE_KINDS.includes(kind as FacetThemeTokenValueKind)) {
      return extensionReject(
        "invalid_theme_extension_token_kind",
        `${at}.${name}`,
        "Extension token kind is not declared by Facet.",
      );
    }
    tokens[name] = kind as FacetThemeTokenValueKind;
  }
  return { ok: true, tokens: Object.freeze(tokens) };
}

function recipeDeclarations(
  catalog: FacetCatalog | undefined,
):
  | { readonly ok: true; readonly declarations: readonly TokenDeclaration[] | undefined }
  | ThemeRejection {
  if (catalog === undefined) return { ok: true, declarations: undefined };
  const declarations: TokenDeclaration[] = [];
  const projectedNamespaces = new Set<string>();
  for (const [index, spec] of catalog.components.entries()) {
    if (spec.themeRecipe === undefined) continue;
    const namespace = facetThemeToKebabCase(spec.tag);
    if (projectedNamespaces.has(namespace)) {
      return reject(
        "duplicate_theme_recipe_namespace",
        `catalog.components[${index}].tag`,
        "Component recipe namespaces must not collide after CSS variable projection.",
      );
    }
    projectedNamespaces.add(namespace);
    declarations.push(recipeDeclaration(namespace, spec.themeRecipe));
  }
  return { ok: true, declarations: Object.freeze(declarations) };
}

function recipeDeclaration(namespace: string, recipe: ThemeRecipeSpec): TokenDeclaration {
  return Object.freeze({
    namespace,
    tokens: recipe.tokens,
  });
}

function declarationsFromValues(raw: unknown): readonly TokenDeclaration[] {
  if (!isRecord(raw)) return [];
  return Object.freeze(
    Object.keys(raw)
      .sort()
      .flatMap((namespace) => {
        const group = raw[namespace];
        if (!isRecord(group)) return [];
        return [
          Object.freeze({
            namespace,
            tokens: Object.freeze(
              Object.fromEntries(
                Object.keys(group)
                  .sort()
                  .map((token) => [token, "text"]),
              ),
            ) as Readonly<Record<string, FacetThemeTokenValueKind>>,
          }),
        ];
      }),
  );
}

function projectFixedLayer<Table extends Readonly<Record<string, readonly string[]>>>(
  vars: Record<string, string>,
  theme: unknown,
  layer: "foundation" | "semantic",
  table: Table,
): void {
  const layerValue = readGroup(theme, layer);
  for (const [group, tokens] of Object.entries(table)) {
    const groupValue = readGroup(layerValue, group);
    for (const token of tokens) {
      const value = readToken(groupValue, token);
      if (value !== undefined) {
        vars[themeTokenVar({ layer, group, token } as never)] = value;
      }
    }
  }
}

function projectDeclaredLayer(
  vars: Record<string, string>,
  raw: unknown,
  layer: "recipe" | "extension",
  declarations: readonly TokenDeclaration[],
): void {
  for (const declaration of declarations) {
    const groupValue = readGroup(raw, declaration.namespace);
    for (const token of Object.keys(declaration.tokens)) {
      const value = readToken(groupValue, token);
      if (value !== undefined) {
        vars[
          themeTokenVar(
            layer === "recipe"
              ? { layer, namespace: declaration.namespace, token }
              : { layer, namespace: declaration.namespace, token },
          )
        ] = value;
      }
    }
  }
}

function readGroup(source: unknown, key: string): unknown {
  try {
    if (!isRecord(source) || !Object.hasOwn(source, key)) return undefined;
    return source[key];
  } catch {
    return undefined;
  }
}

function readToken(source: unknown, key: string): string | undefined {
  try {
    if (!isRecord(source) || !Object.hasOwn(source, key)) return undefined;
    const value = source[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < CONTROL_CHARACTER_CEILING || code === DELETE_CHARACTER) return true;
  }
  return false;
}

function reject(code: string, at: string, detail: string): ThemeRejection {
  return { ok: false, code, at, detail };
}

function extensionReject(code: string, at: string, detail: string): ExtensionRejection {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
