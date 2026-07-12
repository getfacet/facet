import {
  COMPONENT_NODE_TYPES,
  INTRINSIC_COMPONENT_TYPES,
  PRIMITIVE_BRICK_TYPES,
  type ComponentNodeType,
  type FacetNode,
} from "./nodes.js";

export const CATALOG_COMPONENT_TYPES = [
  ...INTRINSIC_COMPONENT_TYPES,
] as const satisfies readonly ComponentNodeType[];

export const CATALOG_BRICK_TYPES = [
  ...PRIMITIVE_BRICK_TYPES,
  ...COMPONENT_NODE_TYPES,
] as const satisfies readonly FacetNode["type"][];

export interface CatalogThemePolicy {
  readonly active?: string;
  readonly switchPolicy: "locked" | "allowed";
  readonly allowed?: readonly string[];
}

export interface CatalogBrick {
  readonly type: FacetNode["type"];
  readonly variants?: readonly string[];
  readonly guidance?: string;
}

export interface CatalogComponent {
  readonly type: ComponentNodeType;
  readonly variants?: readonly string[];
  readonly guidance?: string;
}

export type CatalogCompositionsPolicy =
  { readonly mode: "all" } | { readonly mode: "allow"; readonly names: readonly string[] };

export type CatalogUsageOrder = readonly ["composition", "component", "primitive"];

export interface CatalogUsagePolicy {
  readonly order: CatalogUsageOrder;
  readonly editBeforeAppend: boolean;
  readonly compactScreens: boolean;
  readonly maxScreenSections?: number;
}

export interface FacetCatalog {
  readonly name: string;
  readonly description?: string;
  readonly theme: CatalogThemePolicy;
  readonly bricks: readonly CatalogBrick[];
  readonly components?: readonly CatalogComponent[];
  readonly compositions: CatalogCompositionsPolicy;
  readonly primitiveFallback: "allowed" | "discouraged";
  readonly policy: CatalogUsagePolicy;
}

export interface CatalogValidationResult {
  readonly catalog: FacetCatalog;
  readonly issues: readonly string[];
}
