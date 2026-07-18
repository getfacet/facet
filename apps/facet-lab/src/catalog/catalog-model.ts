import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import {
  BRICK_CONTRACT,
  BRICK_TYPES,
  STYLE_VALUE_CONTRACT,
  validatePattern,
  validateTheme,
  type BrickContractEntry,
  type BrickType,
  type FacetPattern,
  type FacetPreset,
  type FacetTheme,
  type StyleValueDomain,
  type StyleValueMetadata,
} from "@facet/core";

export type CatalogCategoryId =
  "bricks" | "presets" | "patterns" | "token-values" | "fixed-choices";

export type CatalogItemKind = "brick" | "preset" | "pattern" | "token" | "fixed";

export interface CatalogDiagnostic {
  readonly itemId: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

interface CatalogItemBase {
  readonly id: string;
  readonly kind: CatalogItemKind;
  readonly name: string;
  readonly description?: string;
  readonly useWhen?: string;
  readonly avoidWhen?: string;
  readonly diagnostics: readonly CatalogDiagnostic[];
}

export interface CatalogBrickItem extends CatalogItemBase {
  readonly kind: "brick";
  readonly brick: string;
  readonly definition: BrickContractEntry | null;
  readonly defaultStyle: unknown;
}

export interface CatalogPresetItem extends CatalogItemBase {
  readonly kind: "preset";
  readonly brick: BrickType;
  readonly definition: FacetPreset;
}

export interface CatalogPatternItem extends CatalogItemBase {
  readonly kind: "pattern";
  readonly definition: FacetPattern;
}

export interface CatalogStyleValueItem extends CatalogItemBase {
  readonly kind: "token" | "fixed";
  readonly domain: string;
  readonly definition: StyleValueMetadata;
  readonly domainDefinition: StyleValueDomain;
}

export type CatalogItem =
  CatalogBrickItem | CatalogPresetItem | CatalogPatternItem | CatalogStyleValueItem;

export interface CatalogCategory {
  readonly id: CatalogCategoryId;
  readonly label: string;
  readonly items: readonly CatalogItem[];
}

export interface CatalogTotals {
  readonly bricks: number;
  readonly presets: number;
  readonly patterns: number;
  readonly tokenValues: number;
  readonly fixedChoices: number;
}

export interface CatalogModel {
  readonly sourceName: string;
  readonly categories: readonly CatalogCategory[];
  readonly totals: CatalogTotals;
  readonly diagnostics: readonly CatalogDiagnostic[];
}

export interface CatalogSource {
  readonly sourceName: string;
  readonly brickTypes: readonly string[];
  readonly brickContract: Readonly<Record<string, BrickContractEntry>>;
  readonly styleValueContract: {
    readonly tokens: Readonly<Record<string, StyleValueDomain>>;
    readonly fixed: Readonly<Record<string, StyleValueDomain>>;
  };
  readonly theme: FacetTheme;
  readonly patterns: readonly FacetPattern[];
}

export const PACKAGE_CATALOG_SOURCE: CatalogSource = {
  sourceName: "@facet/core + @facet/assets",
  brickTypes: BRICK_TYPES,
  brickContract: BRICK_CONTRACT,
  styleValueContract: STYLE_VALUE_CONTRACT,
  theme: DEFAULT_THEME,
  patterns: DEFAULT_PATTERNS,
};

function error(itemId: string, message: string): CatalogDiagnostic {
  return { itemId, message, severity: "error" };
}

function isBrickType(value: string): value is BrickType {
  return BRICK_TYPES.some((brick) => brick === value);
}

function createBrickItems(source: CatalogSource): readonly CatalogBrickItem[] {
  return source.brickTypes.map((brick) => {
    const id = `brick:${brick}`;
    const definition = source.brickContract[brick] ?? null;
    const diagnostics =
      definition === null ? [error(id, `No public Brick contract exists for "${brick}".`)] : [];
    const defaultStyle = isBrickType(brick) ? source.theme.defaults[brick] : undefined;
    return {
      id,
      kind: "brick",
      name: brick,
      brick,
      definition,
      defaultStyle,
      ...(definition === null
        ? {}
        : { description: definition.description, useWhen: definition.useWhen }),
      ...(definition?.avoidWhen === undefined ? {} : { avoidWhen: definition.avoidWhen }),
      diagnostics,
    };
  });
}

function createPresetItems(
  source: CatalogSource,
  themeDiagnostics: readonly CatalogDiagnostic[],
): readonly CatalogPresetItem[] {
  return source.brickTypes.flatMap((brick) => {
    if (!isBrickType(brick)) return [];
    const definitions = source.theme.presets?.[brick];
    if (definitions === undefined) return [];
    return Object.entries(definitions).map(([name, definition]) => {
      const id = `preset:${brick}:${name}`;
      const path = `theme.presets.${brick}.${name}`;
      return {
        id,
        kind: "preset" as const,
        name,
        brick,
        definition,
        description: definition.description,
        useWhen: definition.useWhen,
        ...(definition.avoidWhen === undefined ? {} : { avoidWhen: definition.avoidWhen }),
        diagnostics: themeDiagnostics
          .filter(({ message }) => message.includes(path))
          .map(({ message, severity }) => ({ itemId: id, message, severity })),
      };
    });
  });
}

function createPatternItems(source: CatalogSource): readonly CatalogPatternItem[] {
  const counts = new Map<string, number>();
  for (const pattern of source.patterns) {
    counts.set(pattern.name, (counts.get(pattern.name) ?? 0) + 1);
  }

  return source.patterns.map((pattern) => {
    const id = `pattern:${pattern.name}`;
    const validation = validatePattern(pattern, source.theme);
    const diagnostics: CatalogDiagnostic[] = validation.issues.map((message) => error(id, message));
    if ((counts.get(pattern.name) ?? 0) > 1) {
      diagnostics.push(error(id, `Pattern name "${pattern.name}" is duplicated.`));
    }
    return {
      id,
      kind: "pattern",
      name: pattern.name,
      definition: pattern,
      description: pattern.description,
      useWhen: pattern.useWhen,
      ...(pattern.avoidWhen === undefined ? {} : { avoidWhen: pattern.avoidWhen }),
      diagnostics,
    };
  });
}

function createStyleValueItems(
  kind: "token" | "fixed",
  domains: Readonly<Record<string, StyleValueDomain>>,
): readonly CatalogStyleValueItem[] {
  return Object.entries(domains).flatMap(([domain, domainDefinition]) =>
    domainDefinition.values.map((definition) => ({
      id: `${kind}:${domain}:${String(definition.name)}`,
      kind,
      name: String(definition.name),
      domain,
      definition,
      domainDefinition,
      description: definition.description,
      useWhen: definition.useWhen,
      ...(definition.avoidWhen === undefined ? {} : { avoidWhen: definition.avoidWhen }),
      diagnostics: [],
    })),
  );
}

export function createCatalogModel(source: CatalogSource = PACKAGE_CATALOG_SOURCE): CatalogModel {
  const themeResult = validateTheme(source.theme);
  const themeDiagnostics = themeResult.issues.map(({ message, severity }): CatalogDiagnostic => ({
    itemId: `theme:${source.theme.name}`,
    message,
    severity,
  }));
  const bricks = createBrickItems(source);
  const presets = createPresetItems(source, themeDiagnostics);
  const patterns = createPatternItems(source);
  const tokenValues = createStyleValueItems("token", source.styleValueContract.tokens);
  const fixedChoices = createStyleValueItems("fixed", source.styleValueContract.fixed);
  const categories: readonly CatalogCategory[] = [
    { id: "bricks", label: "Bricks", items: bricks },
    { id: "presets", label: "Presets", items: presets },
    { id: "patterns", label: "Patterns", items: patterns },
    { id: "token-values", label: "Token values", items: tokenValues },
    { id: "fixed-choices", label: "Fixed choices", items: fixedChoices },
  ];
  const itemDiagnostics = categories.flatMap(({ items }) =>
    items.flatMap(({ diagnostics }) => diagnostics),
  );
  const matchedThemeDiagnostics = new Set(
    presets.flatMap(({ diagnostics }) => diagnostics.map(({ message }) => message)),
  );

  return {
    sourceName: source.sourceName,
    categories,
    totals: {
      bricks: bricks.length,
      presets: presets.length,
      patterns: patterns.length,
      tokenValues: tokenValues.length,
      fixedChoices: fixedChoices.length,
    },
    diagnostics: [
      ...itemDiagnostics,
      ...themeDiagnostics.filter(({ message }) => !matchedThemeDiagnostics.has(message)),
    ],
  };
}
