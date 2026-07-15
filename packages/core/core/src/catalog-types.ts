import { BRICK_TYPES, type BrickType } from "./nodes.js";

export const CATALOG_BRICK_TYPES = [...BRICK_TYPES] as const satisfies readonly BrickType[];

export interface CatalogThemePolicy {
  readonly active?: string;
  readonly switchPolicy: "locked" | "allowed";
  readonly allowed?: readonly string[];
}

export interface CatalogBrick {
  readonly type: BrickType;
  readonly variants?: readonly string[];
  readonly guidance?: string;
}

/** Controls which reference datasets an agent may inspect; it is not an authoring tier. */
export type CatalogCompositionsPolicy =
  { readonly mode: "all" } | { readonly mode: "allow"; readonly names: readonly string[] };

/** Editing guidance that does not change the closed brick vocabulary. */
export interface CatalogUsagePolicy {
  readonly editBeforeAppend: boolean;
  readonly compactScreens: boolean;
  readonly maxScreenSections?: number;
}

export interface FacetCatalog {
  readonly name: string;
  readonly description?: string;
  readonly theme: CatalogThemePolicy;
  readonly bricks: readonly CatalogBrick[];
  readonly compositions: CatalogCompositionsPolicy;
  readonly policy: CatalogUsagePolicy;
}

export interface CatalogValidationResult {
  readonly catalog: FacetCatalog;
  readonly issues: readonly string[];
}
